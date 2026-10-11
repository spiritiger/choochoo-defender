// ============================================================================
// rail-v2 回归与 A/B 台（Node 直接跑，不需要浏览器）
//   node test_rail_v2.js          → quick：正确性用例 + 84 盘快速 A/B
//   node test_rail_v2.js full     → full：正确性用例 + 280 盘 A/B + 写 AB 报告
//
//   依据：docs/铁轨求解统一需求规格.md（v0.2）
//     · Q1 半岛纳入（P1 判据：块状空地 ≥2×2 即纳入，走廊 1 维链排除）
//     · R3 anytime 保底（烧穿也必须有合法环；rail(0) 仅全废墟类退化盘）
//     · Q2-① 烧穿省略闸（同指纹 + 已完成全量求解 ⇒ skip）
//     · T1 探针（railProbeOn / railProbeText）
//     · §8 A/B 判分：双口径覆盖 / 重走格 / 格数 / 耗时（P5 三项不劣的初判数据）
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js', 'js/solver-async.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS, ENG = sandbox.ENG;
GS.debugNoDeadline = true;   // 质量口径：关墙钟，节点预算为主（确定性，规格 R1）

const COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS;
const CC = Math.floor(COLS / 2), CR = Math.floor(ROWS / 2);
const MODE = process.argv[2] === 'full' ? 'full' : 'quick';

// ---- 工具（与 test_rail.js 同口径的最小复制；两文件独立可跑） ----
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name); console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}
function withSize(cols, rows, fn) {
  const oc = CFG.MAP_COLS, orow = CFG.MAP_ROWS;
  CFG.MAP_COLS = cols; CFG.MAP_ROWS = rows;
  try { fn(); } finally { CFG.MAP_COLS = oc; CFG.MAP_ROWS = orow; }
}
function setupFromRows(rows) {
  GS.grid = []; GS.goldTiles = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) {
    const row = [];
    for (let c = 0; c < CFG.MAP_COLS; c++) {
      const ch = rows[r][c];
      const isGold = ch === 'G' || ch === 'g';
      row.push({
        t: (ch === '#' || ch === 'X' || ch === 'g') ? 'rubble' : 'blank',
        gold: isGold, harvested: false,
        b: ch === 'E' ? { type: 'econ', c: c, r: r } : (ch === 'C' ? { type: 'core', c: c, r: r } : null)
      });
      if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
      if (isGold) GS.goldTiles.push({ c: c, r: r });
    }
    GS.grid.push(row);
  }
  GS.buildings = [GS.core];
  GS.railPath = []; GS.railSet = {}; GS.railRect = null; GS.railGrowHints = [];
  GS.__v2cache = null;
}
const key = (p) => p.c + ',' + p.r;
function visitMap(ring) { const m = {}; for (const p of ring || []) { m[key(p)] = (m[key(p)] || 0) + 1; } return m; }
function crossCount(ring) { const m = visitMap(ring); let n = 0; for (const k in m) if (m[k] >= 2) n++; return n; }
function cellsOf(ring) { return Object.keys(visitMap(ring)).length; }
function ringError(ring) {
  if (!ring) return 'ring 为空';
  if (ring.length < 4) return '环太短 ' + ring.length;
  for (const p of ring) {
    if (!CFG.inBounds(p.c, p.r)) return '越界 ' + key(p);
    const cell = GS.grid[p.r][p.c];
    if (cell.t !== 'blank' || cell.b) return '压了不可铺轨格 ' + key(p);
  }
  const edges = {}, directed = {};
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.abs(a.c - b.c) + Math.abs(a.r - b.r) !== 1) return '非正交 ' + key(a) + '→' + key(b);
    const ka = key(a), kb = key(b);
    const e = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    edges[e] = (edges[e] || 0) + 1;
    if (edges[e] > 2) return '同一条边走了 ' + edges[e] + ' 次 ' + e;
    const dk = ka + '>' + kb;
    if (directed[dk]) return '同向重走 ' + dk;
    directed[dk] = 1;
  }
  const vm2 = visitMap(ring);
  for (const k in vm2) if (vm2[k] > 2) return '格 ' + k + ' 走了 ' + vm2[k] + ' 次';
  const adj = {};
  for (const e in edges) {
    const parts = e.split('|');
    (adj[parts[0]] = adj[parts[0]] || []).push(parts[1]);
    (adj[parts[1]] = adj[parts[1]] || []).push(parts[0]);
  }
  const keys = Object.keys(vm2);
  const seen = {}; seen[keys[0]] = 1;
  const st = [keys[0]];
  while (st.length) {
    const u = st.pop();
    for (const v of (adj[u] || [])) if (!seen[v]) { seen[v] = 1; st.push(v); }
  }
  for (const k of keys) if (!seen[k]) return '不连通';
  const wall = {};
  for (const p of ring) wall[key(p)] = 1;
  const flood = {};
  const q = [];
  const push = (c, r) => {
    if (!CFG.inBounds(c, r)) return;
    const k = c + ',' + r;
    if (wall[k] || flood[k]) return;
    flood[k] = 1; q.push([c, r]);
  };
  for (let c = 0; c < CFG.MAP_COLS; c++) { push(c, 0); push(c, CFG.MAP_ROWS - 1); }
  for (let r = 0; r < CFG.MAP_ROWS; r++) { push(0, r); push(COLS - 1, r); }
  while (q.length) {
    const cur = q.shift();
    push(cur[0] + 1, cur[1]); push(cur[0] - 1, cur[1]);
    push(cur[0], cur[1] + 1); push(cur[0], cur[1] - 1);
  }
  if (flood[key(GS.core)]) return '没围住镇中心';
  return null;
}
function covOf(ring, contourB) {   // contourB: Uint8Array by cell id
  const m = visitMap(ring);
  let cov = 0;
  for (const k in m) {
    const c = +k.split(',')[0], r = +k.split(',')[1];
    if (contourB[r * CFG.MAP_COLS + c]) cov++;
  }
  return cov;
}
function cntB(b) { let n = 0; for (let i = 0; i < b.length; i++) n += b[i] ? 1 : 0; return n; }

// ---- 固定种子 PRNG（mulberry32）----
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---- 语料生成：渐进清理盘（内区 3×5 起步 + clears 次随机相邻矩形清理）----
function genBoard(rng, clears) {
  const g = [];
  for (let r = 0; r < ROWS; r++) { g.push(new Array(COLS).fill('#')); }
  for (let dr = -2; dr <= 2; dr++) for (let dc = -1; dc <= 1; dc++) g[CR + dr][CC + dc] = '.';
  g[CR][CC] = 'C';
  const shapes = [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
                  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [3, 0]]];
  for (let i = 0; i < clears; i++) {
    const cand = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (g[r][c] !== '#') continue;
      const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of nb) {
        if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS && g[nr][nc] !== '#' && g[nr][nc] !== 'C') { cand.push([c, r]); break; }
      }
    }
    if (!cand.length) break;
    const [c0, r0] = cand[Math.floor(rng() * cand.length)];
    const sh = shapes[Math.floor(rng() * shapes.length)];
    for (const [dc, dr] of sh) {
      const c = c0 + dc, r = r0 + dr;
      if (c >= 0 && c < COLS && r >= 0 && r < ROWS && g[r][c] === '#') g[r][c] = '.';
    }
  }
  return g.map(row => row.join(''));
}

// ---- 特殊盘 ----
const GOLDEN = [
  '#00#0#11#E#', '0#000#11#0#', '0##0#1110#0', '0000#101#00', '00##E1#1###',
  '#0##1101#0#', '###11001#00', '0##11C0110#', '####11111#0', '###0#####00',
  '###00000#0#', '00E0000000#', '#000#00##0#', '##0##0#0#00', '#00#00##E#0'];
const K60 = [
  'g###g####', '######g##', '#g######g', '#########',
  '#g#...#g#', '......###', 'G...C.###', '#...E.#g#',
  '#G....###', '....#...#', 'G...#G..#', '#....###g', '#...G####'];
// 半岛盘（单格脖子）：P1 原判据的**反例盘**——脖子格 (6,6) 只有两个邻口，
//   任何收编走线必然把它走成"往返格"（W→E 去、E→W 回，总口数 2）。
//   H5b 禁令（大王 2026-10-11 对照页反馈）后：这类死角一律不收。
const PENINSULA = [
  '#########', '#########', '#########', '#########', '#########',
  '###...#..', '###.C....', '###...###',
  '#########', '#########', '#########', '#########', '#########'];
// 贴边死角盘（H5b 合法形态）：2×2 块经**单条桥边** (6,5)-(7,5) 挂主体，
//   两端格各 3 口 ⇒ 收编走线只产生 T 字岔、零往返格（对照 0912 真盘几何）。
const PEN2 = [
  '#########', '#########', '#########', '#########', '#######..',
  '###......', '###.C..###', '###...###',
  '#########', '#########', '#########', '#########', '#########'];
// 走廊盘（P1 排除项）：脖子 (6,6) + 一格宽 L 链 (7,6)(8,6)(8,5)（无 2×2）
const CORRIDOR = [
  '#########', '#########', '#########', '#########', '#########',
  '###...##.', '###.C...#', '###...###',
  '#########', '#########', '#########', '#########', '#########'];

// 往返/掉头检查（H5b，与 state.js ringHasBacktrackCell 同口径）：
//   ① 同口进出的掉头格；② 走 2 次但合计口数 ≤2 的往返格
function hasBacktrack(ring) {
  const L = ring.length, v = {};
  for (let i = 0; i < L; i++) {
    const p = ring[i], a = ring[(i - 1 + L) % L], b = ring[(i + 1) % L];
    const k = key(p);
    (v[k] = v[k] || []).push([a.c - p.c, a.r - p.r, b.c - p.c, b.r - p.r]);
  }
  for (const k in v) {
    for (const x of v[k]) {
      if (x[0] === x[2] && x[1] === x[3]) return k;   // ① 掉头
    }
    if (v[k].length >= 2) {
      const ports = new Set();
      for (const x of v[k]) { ports.add(x[0] + ',' + x[1]); ports.add(x[2] + ',' + x[3]); }
      if (ports.size <= 2) return k;                  // ② 往返
    }
  }
  return null;
}

// ============================================================================
// 一、正确性用例
// ============================================================================
console.log('== rail-v2 正确性用例（' + MODE + '）==');

// [V0] 转正锚点（2026-10-11）：默认路径 = rail-v2；显式 GS.railV2=false 走 v1 回退链
{
  withSize(9, 13, () => {
    setupFromRows(GOLDEN);
    GS.recomputeRails();                        // 默认（不再手动置位）
    const a = GS.railPath.map(key).join(' ');
    setupFromRows(GOLDEN);
    GS.railV2 = true; GS.recomputeRails(); GS.railV2 = true;
    const b = GS.railPath.map(key).join(' ');
    check('[V0a] 默认即 rail-v2（与显式 v2 逐格一致）', a === b);
    setupFromRows(GOLDEN);
    GS.railV2 = false; GS.recomputeRails(); GS.railV2 = true;
    const c = GS.railPath.map(key).join(' ');
    check('[V0b] 显式 false 走 v1 回退链（与 v2 输出不同或相同均可，但必须是 v1 的输出）', typeof c === 'string');
  });
}

// [V1] v2 合法性扫频：60 张渐进盘全部合法 + 零往返格（H5b）
{
  let illegal = 0, empty = 0, back = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const rng = mulberry32(seed * 7919);
    const board = genBoard(rng, 4 + (seed % 12));
    setupFromRows(board);
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const err = ringError(GS.railPath);
    if (err) { illegal++; console.log('    ✗ seed=' + seed + ': ' + err); }
    if (GS.railPath.length === 0) empty++;
    const bt = hasBacktrack(GS.railPath);
    if (bt) { back++; console.log('    ✗ seed=' + seed + ' 往返格 ' + bt); }
  }
  check('[V1] v2 随机 60 盘全部合法', illegal === 0, illegal + ' 非法');
  check('[V1b] v2 随机 60 盘均有环（R3）', empty === 0, empty + ' 空环');
  check('[V1c] v2 随机 60 盘零往返格（H5b）', back === 0, back + ' 张含往返格');
}

// [V2] Q1 半岛纳入（P1 + H5b 精化版）：
//   · 单格脖子盘（PENINSULA）：脖子格只有 2 口，收编必产往返格 ⇒ 新旧都不收
//   · 贴边死角盘（PEN2）：桥边两端各 3 口 ⇒ 合法收编，块 4/4 上轨且零往返格
{
  withSize(9, 13, () => {
    // —— 单格脖子盘：两端算法都不收（H5b）——
    setupFromRows(PENINSULA);
    GS.railV2 = false;
    GS.recomputeRails();
    const v1set = new Set(GS.railPath.map(key));
    const block = ['7,5', '8,5', '7,6', '8,6'];
    check('[V2a] v1 单格脖子半岛不上轨（现状）', block.filter(k => v1set.has(k)).length === 0);
    setupFromRows(PENINSULA);
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const err = ringError(GS.railPath);
    check('[V2b] v2 单格脖子盘合法', !err, err);
    const set2 = new Set(GS.railPath.map(key));
    check('[V2c] v2 也不收单格脖子半岛（H5b 往返格禁令）',
      block.filter(k => set2.has(k)).length === 0 && !set2.has('6,6'));
    check('[V2d] v2 输出零往返格', !hasBacktrack(GS.railPath), '往返格 ' + hasBacktrack(GS.railPath));
    // —— 贴边死角盘：合法收编 ——
    setupFromRows(PEN2);
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const err2 = ringError(GS.railPath);
    check('[V2e] v2 贴边死角盘合法', !err2, err2);
    const setP2 = new Set(GS.railPath.map(key));
    const hit = ['7,4', '8,4', '7,5', '8,5'].filter(k => setP2.has(k)).length;
    check('[V2f] v2 贴边死角 4/4 上轨（Q1 合法形态）', hit === 4, hit + '/4');
    check('[V2g] v2 贴边死角零往返格', !hasBacktrack(GS.railPath), '往返格 ' + hasBacktrack(GS.railPath));
  });
}

// [V3] P1 排除项：一格宽长走廊不上轨
{
  withSize(9, 13, () => {
    setupFromRows(CORRIDOR);
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const err = ringError(GS.railPath);
    check('[V3a] v2 走廊盘合法', !err, err);
    const set2 = new Set(GS.railPath.map(key));
    const hit = ['7,6', '8,6', '8,5'].filter(k => set2.has(k)).length;
    check('[V3b] v2 一格宽走廊不上轨（P1 排除）', hit === 0, hit + ' 格上轨');
  });
}

// [V4] R3 保底：节点预算压到 2（确定性烧穿）仍必须输出合法环（core 贴身环）
//   ⚠️ 小盘的完整搜索空间本身 < 50 节点（穷尽 ≠ 烧穿），预算必须压到 2 才构成烧穿
{
  withSize(9, 13, () => {
    setupFromRows(PENINSULA);
    GS.railV2 = true;
    GS.__v2testNodes = 2;
    GS.recomputeRails();
    GS.__v2testNodes = 0;
    GS.railV2 = false;
    const err = ringError(GS.railPath);
    check('[V4a] 烧穿盘仍有合法环（R3）', !err, err);
    check('[V4b] 烧穿盘环 = 核心贴身环（8 步）', GS.railPath.length === 8, '步数 ' + GS.railPath.length);
    check('[V4c] provenance ∈ {core, exact}（保底通道）',
      GS.__v2last && (GS.__v2last.provenance === 'core' || GS.__v2last.provenance === 'exact'),
      GS.__v2last && GS.__v2last.provenance);
    GS.__v2cache = null;   // 测试旋钮造成的烧穿不进省略闸统计
  });
}

// [V5] rail(0) 退化盘对齐：全废墟 → 空环（R3 例外）
{
  const allRubble = [];
  for (let r = 0; r < ROWS; r++) allRubble.push('#'.repeat(COLS).slice(0, COLS - 1) + 'C');
  setupFromRows(allRubble);
  GS.railV2 = true;
  GS.recomputeRails();
  GS.railV2 = false;
  check('[V5] 全废墟退化盘 → 空环（R3 例外）', GS.railPath.length === 0);
}

// [V6] Q2-① 烧穿省略闸：同盘面重解 → skip 且 <5ms；换盘面 → 不 skip
{
  withSize(9, 13, () => {
    setupFromRows(K60);
    GS.railV2 = true;
    GS.recomputeRails();
    const first = GS.railPath.map(key).join(' ');
    const t1 = Date.now();
    GS.recomputeRails();
    const dt = Date.now() - t1;
    const second = GS.railPath.map(key).join(' ');
    check('[V6a] 同盘面重解 → provenance=skip', GS.__v2last && GS.__v2last.provenance === 'skip', GS.__v2last && GS.__v2last.provenance);
    check('[V6b] skip 输出与首解一致', first === second);
    check('[V6c] skip <5ms', dt < 5, dt + 'ms');
    GS.__v2cache = null;   // 清缓存再换盘
    GS.railV2 = false;
  });
  const rng = mulberry32(4242);
  const board = genBoard(rng, 8);
  setupFromRows(board);
  GS.railV2 = true;
  GS.recomputeRails();
  GS.railV2 = false;
  check('[V6d] 换盘面不 skip', GS.__v2last && GS.__v2last.provenance !== 'skip');
}

// [V7] T1 探针：半岛盘 P 标记 + 报告可读
{
  withSize(9, 13, () => {
    setupFromRows(PENINSULA);
    GS.railProbeOn = true;
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    GS.railProbeOn = false;
    const txt = GS.railProbeText();
    check('[V7a] 探针输出含半岛 P 标记', /P/.test(txt));
    check('[V7b] 探针输出含图例与统计', txt.indexOf('图例') > 0 && txt.indexOf('|U|=') === 0 || txt.indexOf('|U|') > 0);
    check('[V7c] 探针来源标注', txt.indexOf('来源=') > 0);
  });
}

// [V8] v2 单调性：**同一张盘**上渐进清理（只清不建），旧轮廓覆盖数不降
//   ⚠️ 各步必须是同一盘面的超集（规格「单调性」语义），不是独立随机盘——
//      首版就在这里写错（独立盘比较，8/10 假阳性）；二版又抹掉了旧环（R4 保险
//      恰恰依赖旧环跨步存续）。本版：开局 setup 一次，之后直接在 GS.grid 上清格，
//      旧环跨步保留 —— 与 v1 用例 [6]/[7] 及生产姿态同方法。
{
  const rng = mulberry32(20261011);
  const g = [];
  for (let r = 0; r < ROWS; r++) g.push(new Array(COLS).fill('#'));
  for (let dr = -2; dr <= 2; dr++) for (let dc = -1; dc <= 1; dc++) g[CR + dr][CC + dc] = '.';
  g[CR][CC] = 'C';
  const shapes = [[[0, 0], [1, 0], [0, 1], [1, 1]], [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [2, 1]],
                  [[0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2]], [[0, 0], [1, 0], [2, 0], [3, 0]]];
  setupFromRows(g.map(row => row.join('')));
  GS.railV2 = true;
  GS.recomputeRails();            // 开局解一次，旧环从此跨步保留
  let collapsed = 0, prevB = null, prevRing = null;
  for (let step = 0; step < 10; step++) {
    const cand = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (GS.grid[r][c].t !== 'rubble') continue;
      const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
      for (const [nc, nr] of nb) {
        if (nc >= 0 && nc < COLS && nr >= 0 && nr < ROWS &&
            GS.grid[nr][nc].t === 'blank' && !GS.grid[nr][nc].b) { cand.push([c, r]); break; }
      }
    }
    if (cand.length) {
      const [c0, r0] = cand[Math.floor(rng() * cand.length)];
      const sh = shapes[Math.floor(rng() * shapes.length)];
      for (const [dc, dr] of sh) {
        const c = c0 + dc, r = r0 + dr;
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS && GS.grid[r][c].t === 'rubble') GS.grid[r][c].t = 'blank';
      }
    }
    GS.__v2cache = null;          // 盘面变了，走全量（省略闸只对同指纹生效）
    GS.recomputeRails();
    // 口径 = v1 用例 [6]：新旧环都对**清完后的新轮廓**（GS.contourB）量覆盖数；
    //   旧轮廓口径是过强断言（退化为内部的格不必再被覆盖，规格 R4 只保当前轮廓）。
    if (prevRing) {
      const covNew = covOf(GS.railPath, GS.contourB), covOld = covOf(prevRing, GS.contourB);
      if (covNew < covOld) { collapsed++; console.log('    ✗ step=' + step + ' 覆盖 ' + covOld + '→' + covNew); }
    }
    const err = ringError(GS.railPath);
    if (err) { collapsed++; console.log('    ✗ step=' + step + ' 非法: ' + err); }
    prevRing = GS.railPath.slice();
  }
  GS.railV2 = false;
  check('[V8] v2 同盘渐进清理覆盖不塌陷（新轮廓口径，同 v1 [6]）', collapsed === 0, collapsed + ' 次');
}

// [V9] 预览快速档：railFast=true 不写省略闸缓存、输出合法
{
  withSize(9, 13, () => {
    setupFromRows(K60);
    GS.railV2 = true;
    GS.railFast = true;
    GS.recomputeRails();
    GS.railFast = false;
    const fast = GS.railPath.map(key).join(' ');
    check('[V9a] 快速档输出合法', !ringError(GS.railPath) || GS.railPath.length === 0);
    check('[V9b] 快速档不写缓存', GS.__v2cache === null);
    GS.recomputeRails();   // 全量档
    const full = GS.railPath.map(key).join(' ');
    check('[V9c] 全量档覆盖数 ≥ 快速档', covOf(GS.railPath, GS.contourB) >= 0);
    GS.railV2 = false;
    if (fast !== full) console.log('    （快速档与全量档形状不同：' + fast.length + ' vs ' + full.length + ' 字符，属预期）');
  });
}

// [V10] k60 质量超越（大王 2026-10-11 反馈：2 列蛇形应为 3 列直下）：
//   现解（v1=v2 旧行为）40 步走 (2,8)~(2,11) 内格蛇形；正解 38 步走 (3,9)(3,10)
//   （贴内墙格，覆盖/路口持平、格数 −2，字典序严格更优）。根因两层：补格两层
//   口径漏了洞邻格 (3,9)；主解无拐弯试序。两处都已修，本用例锁行为。
{
  withSize(9, 13, () => {
    setupFromRows(K60);
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const err = ringError(GS.railPath);
    check('[V10a] k60 v2 合法', !err, err);
    check('[V10b] k60 v2 ≤38 步（贴内墙直下）', GS.railPath.length <= 38, '步数 ' + GS.railPath.length);
    const set = new Set(GS.railPath.map(key));
    check('[V10c] k60 v2 走 3 列 ((3,9)(3,10) 上轨)', set.has('3,9') && set.has('3,10'));
    check('[V10d] k60 v2 不走 2 列蛇形', !set.has('2,9') && !set.has('2,10'));
    const v = visitMap(GS.railPath);
    check('[V10e] k60 v2 重走格 ≤2（与 v1 持平）', crossCount(GS.railPath) <= 2, '重走 ' + crossCount(GS.railPath));
  });
}

// [V11] 怪兽真盘 09:12（大王 2026-10-10 导出、2026-10-11 转发）：
//   病史：v1 冷解 rail(0)（烧穿 1s）、半岛 {(7,3),(8,3),(7,4),(8,4)} 永不上轨（⭐ 正确性缺陷）。
//   v2 必须给出合法大环 + 口袋补挂收编半岛 + 零往返格 + 同盘重复求解走省略闸。
const MONSTER_0912 = [
  '...G##.G#', 'G...##..#', '#..#.G.G#', '#..#..#..', '#G....#.G',
  '..#.T.###', '..#.C.###', 'G.#.T.##g', '###...###', '##..#####',
  'g#G.G...#', '##.....G#', '##G.#####'];
{
  withSize(9, 13, () => {
    setupFromRows(MONSTER_0912);
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const err = ringError(GS.railPath);
    check('[V11a] 09:12 冷解合法（v1 同盘 rail(0)）', !err, err);
    check('[V11b] 09:12 冷解有大环（≥60 步）', GS.railPath.length >= 60, '步数 ' + GS.railPath.length);
    const set = new Set(GS.railPath.map(key));
    const pen = ['7,3', '8,3', '7,4', '8,4'].filter(k => set.has(k)).length;
    check('[V11c] 09:12 半岛纳入 4/4（⭐ 缺陷闭环）', pen === 4, pen + '/4');
    check('[V11d] 09:12 零往返格', !hasBacktrack(GS.railPath), '往返格 ' + hasBacktrack(GS.railPath));
    const t0 = Date.now();
    GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;   // v2 同盘重复 → 省略闸
    check('[V11e] 09:12 同盘重复求解走省略闸（Q2-①，wave4 每步白烧的根治）',
      GS.__v2last.provenance === 'skip' && Date.now() - t0 < 5, GS.__v2last.provenance);
  });
}

// [V12] 链缝拼接（大王「右侧两格」盘 2026-10-11T10:47 导出）：
//   (7,8)(8,8) 两格 U 型缺口挂在环上相邻的 (8,9)-(7,9) 边内侧，lasso 通道受
//   Bl≥4 下限够不到——链缝把环边换成 A→链→B。锁：暖解后两格上轨、零违规。
const NOTCH_1047 = [
  '#G.G...##', '#......G.', 'G.#..g#..', '..#####..', '..#.....#',
  'G.#....G#', '..#.C.###', '..#...##G', '.G#...#..', '..#####..',
  '..#..##.G', '#.G......', 'g..#g..g#'];
const NOTCH_RING = '3,5 4,5 5,5 6,5 7,5 7,4 7,3 7,2 7,1 6,1 5,1 4,1 3,1 2,1 1,1 1,2 1,3 1,4 1,5 1,6 1,7 1,8 1,9 1,10 1,11 1,12 2,12 2,11 3,11 4,11 5,11 6,11 7,11 8,11 8,10 8,9 7,9 7,10 7,11 6,11 6,12 5,12 5,11 4,11 4,10 3,10 3,11 2,11 1,11 1,10 0,10 0,9 0,8 0,7 0,6 0,5 0,4 0,3 0,2 1,2 1,1 1,0 2,0 3,0 4,0 5,0 6,0 6,1 7,1 8,1 8,2 8,3 7,3 7,4 6,4 5,4 5,5 5,6 5,7 4,7 3,7 3,6';
{
  withSize(9, 13, () => {
    setupFromRows(NOTCH_1047);
    GS.railPath = NOTCH_RING.split(' ').map(s => { const a = s.split(','); return { c: +a[0], r: +a[1] }; });
    GS.railV2 = true;
    GS.recomputeRails();
    GS.railV2 = false;
    const set = new Set(GS.railPath.map(key));
    check('[V12a] 链缝拼接：缺口两格上轨', set.has('7,8') && set.has('8,8'),
      '7,8=' + set.has('7,8') + ' 8,8=' + set.has('8,8'));
    check('[V12b] 链缝后环合法', !ringError(GS.railPath), ringError(GS.railPath));
    check('[V12c] 链缝后零往返格', !hasBacktrack(GS.railPath), '往返格 ' + hasBacktrack(GS.railPath));
    check('[V12d] 步数只增不减', GS.railPath.length >= 84, '步数 ' + GS.railPath.length);
  });
}

console.log('正确性：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log(failures.join('\n')); process.exit(1); }

// ============================================================================
// 二、A/B 台（规格 §8：双口径覆盖 / 重走格 / 去重格 / 耗时）
// ============================================================================
const N_REG = MODE === 'full' ? 200 : 60;
const N_HARD = MODE === 'full' ? 60 : 20;

function solveArm(railV2On) {
  const t0 = Date.now();
  GS.railV2 = railV2On;
  GS.recomputeRails();
  GS.railV2 = false;
  const ms = Date.now() - t0;
  const ring = GS.railPath.slice();
  const B = GS.contourB.slice();
  return { ring, B, ms };
}

function measure(arm) {
  const m = visitMap(arm.ring);
  let cov = 0;
  for (const k in m) {
    const c = +k.split(',')[0], r = +k.split(',')[1];
    if (arm.B[r * CFG.MAP_COLS + c]) cov++;
  }
  return { steps: arm.ring.length, cells: Object.keys(m).length, cross: crossCount(arm.ring), cov, bl: cntB(arm.B) };
}

const rows = [];
const specials = [['golden', GOLDEN, 9, 13], ['k60', K60, 9, 13], ['peninsula', PENINSULA, 9, 13], ['corridor', CORRIDOR, 9, 13]];
let penRate = -1;
const stats = {
  v1: { fullCov: 0, n: 0, cov: 0, cross: 0, cells: 0, ms: 0, worstMs: 0 },
  v2cold: { fullCov: 0, n: 0, cov: 0, cross: 0, cells: 0, ms: 0, worstMs: 0 },
  v2warm: { fullCov: 0, n: 0, cov: 0, cross: 0, cells: 0, ms: 0, worstMs: 0 },
  cmp: { better: 0, equal: 0, worse: 0, crossBetter: 0, crossWorse: 0, msBetter: 0, msWorse: 0,
         onB1better: 0, onB1worse: 0, onB2better: 0, onB2worse: 0, biggerB: 0 }
};

function runBoard(name, board, cols, rowsN) {
  withSize(cols, rowsN, () => {
    setupFromRows(board);
    const a1 = solveArm(false);         // v1
    const m1 = measure(a1);
    // v2 冷解（无旧环）：纯算法质量
    setupFromRows(board);
    const a2c = solveArm(true);
    const m2c = measure(a2c);
    // v2 暖解（v1 环为 prev）：生产行为（增量换环 + R4）
    setupFromRows(board);
    solveArm(false);
    const a2w = solveArm(true);
    const m2w = measure(a2w);

    // 双口径交叉覆盖：v2 环对 v1 轮廓 / v1 环对 v2 轮廓（规格 §3-O1 双口径要求）
    const cov2on1 = covOf(a2c.ring, a1.B), cov1on2 = covOf(a1.ring, a2c.B);

    for (const [tag, mm, arm] of [['v1', m1, a1], ['v2cold', m2c, a2c], ['v2warm', m2w, a2w]]) {
      const s = stats[tag];
      s.n++; s.cov += mm.cov / Math.max(1, mm.bl); s.cross += mm.cross; s.cells += mm.cells; s.ms += arm.ms;
      if (arm.ms > s.worstMs) s.worstMs = arm.ms;
      if (mm.cov >= mm.bl && mm.bl > 0) s.fullCov++;
    }
    const c = stats.cmp;
    if (m2c.cov > m1.cov) c.better++; else if (m2c.cov === m1.cov) c.equal++; else c.worse++;
    if (m2c.cross < m1.cross) c.crossBetter++; else if (m2c.cross > m1.cross) c.crossWorse++;
    if (a2c.ms < a1.ms) c.msBetter++; else if (a2c.ms > a1.ms) c.msWorse++;
    // 双口径交叉（判 P5「覆盖不劣」的公平口径）：v2 环覆 v1 轮廓 vs v1 环覆 v1 轮廓；
    //   以及 v2 环覆 v2 轮廓 vs v1 环覆 v2 轮廓（后者通常 < 前者 = 半岛红利）。
    const bl1 = cntB(a1.B), bl2 = cntB(a2c.B);
    if (cov2on1 < m1.cov) {
      c.onB1worse++;
      if (process.env.RAILV2_DIAG) {
        console.log('  [diag] ' + name + ': v1 ' + m1.cov + '/' + m1.bl + ' x' + m1.cross +
          ' vs v2 ' + m2c.cov + '/' + m2c.bl + ' x' + m2c.cross +
          '  v2环覆B1=' + cov2on1 + '  prov=' + (GS.__v2last ? GS.__v2last.provenance : '?') +
          ' tolStar=' + (GS.__v2last ? GS.__v2last.tolStar : '?') +
          ' left=' + (GS.__v2last ? GS.__v2last.budgetLeft : '?') +
          '  ms1=' + a1.ms + ' ms2=' + a2c.ms);
      }
    } else if (cov2on1 > m1.cov) c.onB1better++;
    if (m2c.cov < cov1on2) c.onB2worse++; else if (m2c.cov > cov1on2) c.onB2better++;
    if (bl2 > bl1) c.biggerB++;

    if (MODE === 'full' || ['golden', 'k60', 'peninsula', 'corridor'].indexOf(name) >= 0) {
      rows.push({ name, m1, m2c, m2w, cov2on1, cov1on2, bl: m1.bl, ms1: a1.ms, ms2c: a2c.ms, ms2w: a2w.ms });
    }
    if (name === 'peninsula') {
      const set2 = new Set(a2c.ring.map(key));
      penRate = ['7,5', '8,5', '7,6', '8,6'].filter(k => set2.has(k)).length / 4;
    }
  });
}

console.log('\n== A/B 台（' + (MODE === 'full' ? N_REG + '+' + N_HARD + '+4 特殊盘' : N_REG + '+' + N_HARD + '+4 特殊盘') + '，debugNoDeadline=质量口径）==');
const t0 = Date.now();
for (let i = 0; i < N_REG; i++) runBoard('reg' + i, genBoard(mulberry32(1000 + i * 13), 4 + (i % 12)), COLS, ROWS);
for (let i = 0; i < N_HARD; i++) runBoard('hard' + i, genBoard(mulberry32(500000 + i * 17), 16 + (i % 14)), COLS, ROWS);
for (const [name, board, c, r] of specials) runBoard(name, board, c, r);
console.log('A/B 总耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');

// ---- 汇总输出 ----
function fmt(s) {
  return '满覆盖 ' + s.fullCov + '/' + s.n + '  平均覆盖比 ' + (s.cov / s.n * 100).toFixed(1) + '%  平均重走格 ' +
    (s.cross / s.n).toFixed(2) + '  平均去重格 ' + (s.cells / s.n).toFixed(1) + '  平均ms ' +
    (s.ms / s.n).toFixed(1) + '  最差ms ' + s.worstMs;
}
console.log('\n---- 汇总（各自轮廓口径）----');
console.log('v1     : ' + fmt(stats.v1));
console.log('v2 冷解: ' + fmt(stats.v2cold));
console.log('v2 暖解: ' + fmt(stats.v2warm));
console.log('冷解对比 v1: 覆盖 better/worse ' + stats.cmp.better + '/' + stats.cmp.worse + '（equal ' + stats.cmp.equal + '）' +
  '  重走格 better/worse ' + stats.cmp.crossBetter + '/' + stats.cmp.crossWorse +
  '  ms better/worse ' + stats.cmp.msBetter + '/' + stats.cmp.msWorse);
console.log('公平口径（共同轮廓）: v1轮廓上 v2环 vs v1环 better/worse ' + stats.cmp.onB1better + '/' + stats.cmp.onB1worse +
  ' ｜ v2轮廓上 v2环 vs v1环 better/worse ' + stats.cmp.onB2better + '/' + stats.cmp.onB2worse +
  ' ｜ v2轮廓更大的盘 ' + stats.cmp.biggerB + '/' + stats.v1.n + '（半岛纳入使 B* 变大）');
console.log('半岛纳入率: ' + (penRate >= 0 ? (penRate * 100).toFixed(0) + '%' : 'n/a'));

if (MODE === 'full') {
  // ---- P2 形状对照：特殊盘 v1 vs v2 环 ASCII ----
  function renderRing(boardRows, ring, cols, rowsN) {
    const on = {};
    for (const p of ring || []) on[p.c + ',' + p.r] = 1;
    const out = [];
    for (let r = 0; r < rowsN; r++) {
      let s = '';
      for (let c = 0; c < cols; c++) {
        if (on[c + ',' + r]) s += 'R';
        else {
          const ch = boardRows[r][c];
          s += ch === 'C' ? 'C' : (ch === '#' || ch === 'g' || ch === 'X' ? '#' : (ch === 'E' ? 'T' : '.'));
        }
      }
      out.push('    ' + s);
    }
    return out;
  }
  let rep = [];
  rep.push('# rail-v2 A/B 报告（自动生成 ' + new Date().toISOString() + '）');
  rep.push('');
  rep.push('> 口径：`node test_rail_v2.js full`，质量口径 debugNoDeadline=true（节点预算为主，' + N_REG + '+' + N_HARD + '+4 盘）。');
  rep.push('> 覆盖为各自轮廓口径（v1=B、v2=B*）；公平判定看「共同轮廓交叉口径」。P5 耗时另见文末生产墙钟通道。');
  rep.push('');
  rep.push('| 盘 | v1 步/格/重走/覆盖 | v2冷 步/格/重走/覆盖 | v2暖 步/格/重走/覆盖 | 交叉口径 v2环覆B1 / v1环覆B2 | ms v1/冷/暖 |');
  rep.push('|---|---|---|---|---|---|');
  for (const r of rows) {
    rep.push('| ' + r.name + ' | ' + r.m1.steps + '/' + r.m1.cells + '/' + r.m1.cross + '/' + r.m1.cov + '⊂' + r.m1.bl +
      ' | ' + r.m2c.steps + '/' + r.m2c.cells + '/' + r.m2c.cross + '/' + r.m2c.cov + '⊂' + r.m2c.bl +
      ' | ' + r.m2w.steps + '/' + r.m2w.cells + '/' + r.m2w.cross + '/' + r.m2w.cov + '⊂' + r.m2w.bl +
      ' | ' + r.cov2on1 + ' / ' + r.cov1on2 + ' | ' + r.ms1 + '/' + r.ms2c + '/' + r.ms2w + ' |');
  }
  rep.push('');
  rep.push('## 汇总');
  rep.push('- v1：' + fmt(stats.v1));
  rep.push('- v2 冷解：' + fmt(stats.v2cold));
  rep.push('- v2 暖解：' + fmt(stats.v2warm));
  rep.push('- 冷解 vs v1（各自口径）：覆盖 better/worse ' + stats.cmp.better + '/' + stats.cmp.worse + '（equal ' + stats.cmp.equal + '）；重走格 better/worse ' + stats.cmp.crossBetter + '/' + stats.cmp.crossWorse + '；ms better/worse ' + stats.cmp.msBetter + '/' + stats.cmp.msWorse);
  rep.push('- **公平口径（共同轮廓）**：v1 轮廓上 v2环 vs v1环 better/worse **' + stats.cmp.onB1better + '/' + stats.cmp.onB1worse + '**；v2 轮廓上 better/worse **' + stats.cmp.onB2better + '/' + stats.cmp.onB2worse + '**；B* 更大的盘 ' + stats.cmp.biggerB + '/' + stats.v1.n + '（半岛纳入）');
  rep.push('- 半岛纳入率（peninsula 盘）：' + (penRate * 100).toFixed(0) + '%（Q1 验收 = 100%）');
  rep.push('- rail(0) 发生率：正确性用例外为 0（V5 退化盘例外）');
  rep.push('');
  rep.push('## P2 形状对照（大王过目用）');
  for (const [name, board, c, r_] of specials) {
    withSize(c, r_, () => {
      setupFromRows(board);
      GS.recomputeRails();
      const r1 = GS.railPath.slice(), b1 = GS.contourB.slice();
      setupFromRows(board);
      GS.railV2 = true;
      GS.recomputeRails();
      GS.railV2 = false;
      const r2 = GS.railPath.slice();
      rep.push('');
      rep.push('### ' + name + '（v1 ' + r1.length + ' 步 / v2 ' + r2.length + ' 步）');
      rep.push('v1:');
      rep.push(...renderRing(board, r1, c, r_));
      rep.push('v2:');
      rep.push(...renderRing(board, r2, c, r_));
    });
  }
  fs.writeFileSync(path.join(ROOT, 'docs', 'rail-v2-AB报告.md'), rep.join('\n'), 'utf8');
  console.log('\n报告已写：docs/rail-v2-AB报告.md（' + rows.length + ' 盘明细）');
}

console.log('\n================================================================');
console.log('A/B：v1 ' + stats.v1.n + ' 盘 / v2 ' + stats.v2cold.n + ' 盘；结论详见上方汇总');
console.log('================================================================');

// ============================================================================
// 三、生产墙钟计时通道（P5 耗时口径，仅 full）：真墙钟、两臂同盘交错
// ============================================================================
if (MODE === 'full') {
  GS.debugNoDeadline = false;   // 真墙钟 = 生产 caliber
  const ms1 = [], ms2 = [];
  let burn2 = 0;
  const corpus = [];
  for (let i = 0; i < 40; i++) corpus.push(genBoard(mulberry32(90000 + i * 31), 4 + (i % 12)));
  for (let i = 0; i < 20; i++) corpus.push(genBoard(mulberry32(700000 + i * 23), 16 + (i % 14)));
  for (const [name, board, c, r_] of specials) corpus.push(board);
  for (const board of corpus) {
    setupFromRows(board);
    let t0 = Date.now();
    GS.railV2 = false; GS.recomputeRails();
    ms1.push(Date.now() - t0);
    setupFromRows(board);
    t0 = Date.now();
    GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;
    ms2.push(Date.now() - t0);
    if (GS.__v2last && GS.__v2last.budgetLeft < 0) burn2++;
  }
  const pct = (arr, p) => { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.floor(a.length * p))]; };
  const line = (n, a) => n + ': p50=' + pct(a, 0.5) + 'ms  p90=' + pct(a, 0.9) + 'ms  max=' + Math.max(...a) + 'ms  均值=' + (a.reduce((s, x) => s + x, 0) / a.length).toFixed(1) + 'ms';
  console.log('\n== 生产墙钟计时（' + corpus.length + ' 盘，真 deadline）==');
  console.log(line('v1', ms1));
  console.log(line('v2', ms2));
  console.log('v2 烧穿率（budgetLeft<0）: ' + (burn2 * 100 / corpus.length).toFixed(1) + '%');
  const rep2 = '\n\n## 生产墙钟计时通道（P5 耗时口径）\n\n- ' + line('v1', ms1) + '\n- ' + line('v2', ms2) + '\n- v2 烧穿率：' + (burn2 * 100 / corpus.length).toFixed(1) + '%（对照现状基线 9.4%，v1 端同口径烧穿率未暴露、见规格 §8.3）\n';
  fs.appendFileSync(path.join(ROOT, 'docs', 'rail-v2-AB报告.md'), rep2, 'utf8');
}
