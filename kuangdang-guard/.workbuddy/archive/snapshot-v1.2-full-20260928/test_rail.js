// ============================================================================
// 铁轨算法回归测试（Node 直接跑，不需要浏览器）
//   node test_rail.js
//
// 铁轨模型 v0.6：沿「已清空空白区 U 的外轮廓」走一圈的**欧拉式单线大环**
//   · 规则 3：先削掉 U 里的 1 格宽脖子（U 邻居恰好 2 个 + 割点）
//   · 规则 5：允许十字交叉（同一格最多走 2 次 = 度数 ≤4），主解每条边只走一次
//   · v0.8.0 往返支线：主解之后追加"每边 ≤2 次、第 2 次必反向"的支线解，
//     只有覆盖数严格更大才采纳（挂在单条桥边上的半岛组件由此收编）
//   · v0.8.2 桥边约束：双走（重数 2）的边必须是搜索图的桥边（割边）——
//     非桥边双走不产生新覆盖，只会织辫子（10:42 盘教训：44步/7十字 → 36步/2十字）
//   · 优先「每格只走一次」的干净方案，无解才放开十字
//
// 覆盖：
//   1) 黄金用例 —— 大王的 26 格「外轮廓大环」，必须逐格一致
//   2) 开局 3x3 —— 必须是一个 8 格小环
//   3) 边界情况 —— 全空白 / 全废墟 / 1 格宽走廊
//   4) 随机地图压力 —— 200 张，环必须合法或干脆为空
//   5) 细脖子局面 —— 一片带 1 格宽脖子的零散空白区，环必须合法（长度只记录）
//      ⚠️ 这张盘面**不是**大王截图那张，v0.6.1 下也能解出 22 格环，盖不住缩圈 bug；
//         真正的截图盘面见 [10]。
//   6) 单调性 —— 只清不建时，环不会缩水
//   7) 顺序生长 —— 在同一张图上连续清格，环不应中途塌缩
//   8) 台阶/斜切角 —— 外轮廓 1 格错位的盘面，必须解出大环而不是塌成核心小环
//  10) 缩圈 bug 真实盘面 —— 2026-09-20 截图逐格还原；v0.6.1 塌成 8 格，v0.6.2 必须是 ≥20 格大环
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;

// ---- 在沙箱里加载游戏的 CFG + GS（window 指向沙箱自身，模拟浏览器全局） ----
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS, ENG = sandbox.ENG;   // ENG 供 [11] 的相接口径断言用
GS.debugNoDeadline = true;   // 测试确定性：跳过 400ms 墙钟（防重负载下偶发掐断求解）

// 地图尺寸与镇中心坐标（v0.6.14 起按 CFG 派生，别再写死 11×15 / 7,5）
const COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS;
const CC = Math.floor(COLS / 2), CR = Math.floor(ROWS / 2);

// ---- 测试工具 ----
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; }
  else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  ✗ ' + name + (detail ? '  → ' + detail : '')); }
}

// 支持字符：'#'=废墟 '.'=空地 'C'=镇中心 'E'=经济建筑
//           'G'=金币地块（已清出=空地+金币）'g'=金币地块（仍在废墟中）（与游戏内导出按钮一致）
function setupFromRows(rows) {
  GS.grid = [];
  GS.goldTiles = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
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
}

function key(p) { return p.c + ',' + p.r; }

// 同一格出现几次（1 = 普通通行格，2 = 十字）
function visitMap(ring) {
  const m = {};
  for (const p of ring) { const k = key(p); m[k] = (m[k] || 0) + 1; }
  return m;
}
// 十字数 = 出现 ≥2 次的格数
function crossCount(ring) {
  const m = visitMap(ring);
  let n = 0;
  for (const k in m) if (m[k] >= 2) n++;
  return n;
}
// ---- ⚠️ 三个量的口径（v0.6.18 明确，别再混；详见 state.js 顶部同名小节）----
//   steps(ring) = ring.length        —— 步数（序列长度，含重复经过的格）＝导出 rail(N) 的 N
//   cells(ring) = 去重后的格数
//   crossCount  = 被走 ≥2 次的格数（十字）
//   关系：steps ≥ cells；steps − cells = crossCount
//   ⚠️ 断言里写 `GS.railPath.length` 时，文案请说"步数"，别说"格数/环长"——
//      过去的用例正因措辞含糊，把两者混过一轮（v0.6.17 那轮）。
function stepsOf(ring) { return ring ? ring.length : 0; }
function cellsOf(ring) {
  const m = visitMap(ring || []);
  return Object.keys(m).length;
}

// 环的合法性（v0.6 欧拉版 → v0.8.0 往返支线版）：
//   能铺轨 / 相邻正交 / **每条边最多走 2 次、且第 2 次必须与第 1 次反向**
//   （= 往返支线：进桥绕一圈原路出桥，列车全程不倒车；同向重走仍非法） /
//   每格最多走 2 次（边使用次数 ≤4）/ 整体连通（只有一条走线）/ 把镇中心围在里面
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
    if (edges[e] > 2) return '同一条边走了 ' + edges[e] + ' 次（上限 2）' + e;
    const dk = ka + '>' + kb;
    if (directed[dk]) return '同向重走同一条边（违反往返必反向）' + dk;
    directed[dk] = 1;
  }

  const vm2 = visitMap(ring);
  for (const k in vm2) {
    if (vm2[k] * 2 > 4) return '格 ' + k + ' 度数 ' + (vm2[k] * 2) + ' 超过 4（走了 ' + vm2[k] + ' 次）';
  }

  // 连通性：边集必须连成一片（否则是多个环）
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
  for (const k of keys) if (!seen[k]) return '不连通（分成多片）';

  // 围住镇中心：把环当墙，从地图边界 4 连通泛洪，看镇中心还通不通到外面
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
  for (let c = 0; c < COLS; c++) { push(c, 0); push(c, ROWS - 1); }
  for (let r = 0; r < ROWS; r++) { push(0, r); push(COLS - 1, r); }
  while (q.length) {
    const cur = q.shift();
    push(cur[0] + 1, cur[1]); push(cur[0] - 1, cur[1]);
    push(cur[0], cur[1] + 1); push(cur[0], cur[1] - 1);
  }
  if (flood[key(GS.core)]) return '没围住镇中心';
  return null;
}

function gridText(title, f) {
  const L = [title, '     ' + Array.from({ length: COLS }, (_, c) => String(c % 10)).join(' ')];
  for (let r = 0; r < ROWS; r++) {
    let s = 'r' + String(r).padStart(2, ' ') + '  ';
    for (let c = 0; c < COLS; c++) s += f(c, r) + ' ';
    L.push(s);
  }
  return L.join('\n');
}

console.log('='.repeat(64));
console.log('铁轨算法回归测试（v0.8.0 往返支线版）');
console.log('='.repeat(64));

// ---------------------------------------------------------------------------
// 1) 黄金用例：大王画的 26 格外轮廓大环
//    这条走的是「每格只走一次」的哈密顿分支（补格 5 个、十字 0 个），必须逐格一致
// ---------------------------------------------------------------------------
const GOLDEN = [
  '#00#0#11#E#', '0#000#11#0#', '0##0#1110#0', '0000#101#00', '00##E1#1###',
  '#0##1101#0#', '###11001#00', '0##11C0110#', '####11111#0', '###0#####00',
  '###00000#0#', '00E0000000#', '#000#00##0#', '##0##0#0#00', '#00#00##E#0'];
console.log('\n[1] 黄金用例：大王的 26 格「外轮廓大环」');
{
  const t = Date.now();
  setupFromRows(GOLDEN);
  GS.recomputeRails();
  const ms = Date.now() - t;

  const expect = [], got = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (GOLDEN[r][c] === '1') expect.push(c + ',' + r);
  for (const p of GS.railPath) got.push(key(p));
  const gset = new Set(got);

  // 黄金用例是 26 格的外轮廓大环：此处 26 格恰好无十字 → 步数 == 格数 == 26
  check('步数 = 26（该盘面无十字，故步数=格数）', stepsOf(GS.railPath) === 26,
    '实际 ' + stepsOf(GS.railPath) + ' 步 / ' + cellsOf(GS.railPath) + ' 格');
  check('逐格与大王一致', expect.length === got.length && expect.every(k => gset.has(k)),
    '缺 ' + expect.filter(k => !gset.has(k)).join(' ') + ' / 多 ' + got.filter(k => expect.indexOf(k) < 0).join(' '));
  check('环合法（正交/无往返/围住镇中心）', !ringError(GS.railPath), ringError(GS.railPath));
  check('无十字（干净外轮廓）', crossCount(GS.railPath) === 0, '十字 ' + crossCount(GS.railPath) + ' 个');
  console.log('    耗时 ' + ms + 'ms，十字 ' + crossCount(GS.railPath) + ' 个');
  console.log('    ' + gridText('【输出】O=铁轨', (c, r) => GOLDEN[r][c] === '1' ? 'O' : (GOLDEN[r][c] === '#' ? '#' : (GOLDEN[r][c] === 'E' ? 'E' : (GOLDEN[r][c] === 'C' ? 'C' : '.')))));
}

// ---------------------------------------------------------------------------
// 2) 开局：只有镇中心 3x3
// ---------------------------------------------------------------------------
console.log('\n[2] 开局局面（只有 3x3 空白）');
{
  const rows = [];
  for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += '#'; rows.push(s.split('')); }
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) rows[CR + dr][CC + dc] = '0';
  rows[CR][CC] = 'C';
  setupFromRows(rows.map(a => a.join('')));
  GS.recomputeRails();
  check('开局环 8 步（3x3 外圈，无十字故步数=格数）', stepsOf(GS.railPath) === 8,
    '实际 ' + stepsOf(GS.railPath) + ' 步 / ' + cellsOf(GS.railPath) + ' 格');
  check('开局环合法', !ringError(GS.railPath), ringError(GS.railPath));
}

// ---------------------------------------------------------------------------
// 3) 边界情况
// ---------------------------------------------------------------------------
console.log('\n[3] 边界情况');
{
  // 全空白
  const all = [];
  for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += '0'; all.push(s); }
  const a = all.map(s => s.split('')); a[CR][CC] = 'C';
  setupFromRows(a.map(x => x.join('')));
  GS.recomputeRails();
  check('全空白 → 合法环', !ringError(GS.railPath), ringError(GS.railPath));
  console.log('    全空白 步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + crossCount(GS.railPath) + ' 个');

  // 全废墟（只有镇中心，四周没空白）
  const b = [];
  for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += '#'; b.push(s); }
  const b2 = b.map(s => s.split('')); b2[CR][CC] = 'C';
  setupFromRows(b2.map(x => x.join('')));
  GS.recomputeRails();
  check('全废墟 → 无环且不报错', stepsOf(GS.railPath) === 0, '实际 ' + stepsOf(GS.railPath));

  // 3x3 + 1 格宽走廊（走廊会被规则 3 削掉，环应保持核心那 8 格）
  const c = [];
  for (let r = 0; r < ROWS; r++) { let s = ''; for (let k = 0; k < COLS; k++) s += '#'; c.push(s); }
  const c2 = c.map(s => s.split(''));
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) c2[CR + dr][CC + dc] = '0';
  c2[CR][CC] = 'C';
  for (let k = 1; k <= 3; k++) c2[CR][k] = '0';
  setupFromRows(c2.map(x => x.join('')));
  GS.recomputeRails();
  check('3x3 + 1格宽走廊 → 环仍合法', !ringError(GS.railPath), ringError(GS.railPath));
  check('1 格宽走廊被削掉、环 = 核心 8 步', stepsOf(GS.railPath) === 8,
    '实际 ' + stepsOf(GS.railPath) + ' 步 / ' + cellsOf(GS.railPath) + ' 格');
  console.log('    步数 = ' + stepsOf(GS.railPath) + '（走廊 1 格宽，规则 3 提前削掉，符合预期）');
}

// ---------------------------------------------------------------------------
// 4) 随机地图压力
// ---------------------------------------------------------------------------
console.log('\n[4] 随机地图压力（200 张，45% 废墟）');
{
  let noRing = 0, total = 0, maxMs = 0, bad = 0, withCross = 0, crossSum = 0;
  for (let iter = 0; iter < 200; iter++) {
    const rows = [];
    for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += (Math.random() < 0.45 ? '#' : '0'); rows.push(s); }
    const A = rows.map(s => s.split(''));
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) A[CR + dr][CC + dc] = '0';
    A[CR][CC] = 'C';
    setupFromRows(A.map(x => x.join('')));
    const t = Date.now();
    GS.recomputeRails();
    const ms = Date.now() - t;
    total += ms; if (ms > maxMs) maxMs = ms;
    if (!GS.railPath.length) { noRing++; continue; }
    const err = ringError(GS.railPath);
    if (err) { bad++; if (bad <= 3) console.log('    ✗ 非法环: ' + err); }
    const cc = crossCount(GS.railPath);
    if (cc > 0) { withCross++; crossSum += cc; }
  }
  check('随机地图无非法环', bad === 0, bad + ' 张非法');
  console.log('    无环 ' + noRing + '/200，平均 ' + (total / 200).toFixed(1) + 'ms，最大 ' + maxMs + 'ms');
  console.log('    含十字的局面 ' + withCross + '/200，平均十字 ' + (withCross ? (crossSum / withCross).toFixed(1) : 0) + ' 个');
}

// ---------------------------------------------------------------------------
// 5) 细脖子局面（大王截图的真实盘面）
//    地形是一条带 1 格宽脖子的零散空白区。环必须合法；长度只记录、不断言，
//    这样能直接看见"规则 3 削掉脖子之后剩下多大一块"。
// ---------------------------------------------------------------------------
console.log('\n[5] 细脖子局面（截图盘面）');
{
  const SHOT = [
    '###..#..##.', '.#..#...#..', '###E###..##', '#.##..##.#.', '...#..##.##',
    '#...#.#...#', '#..#...#...', '..#..C..E.E', '#.#.....#..', '.###..#.###',
    '#.....#..#.', '..#..###...', '##...#.###.', '###E.#..#.#', '#.#.##.#...'];
  setupFromRows(SHOT);
  GS.recomputeRails();
  check('细脖子局面 → 环合法', !ringError(GS.railPath), ringError(GS.railPath));
  check('扩张提示已移除（GS.railGrowHints 恒为空数组）',
    Array.isArray(GS.railGrowHints) && GS.railGrowHints.length === 0,
    '实际 ' + JSON.stringify(GS.railGrowHints));
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + crossCount(GS.railPath) + ' 个'
    + '（规则 3 会先削掉 1 格宽脖子，剩下的就是"处处 ≥2 格宽"那块地）');
  console.log('    ' + gridText('【输出】O=铁轨 #=废墟 .=空白', (c, r) =>
    GS.railSet[c + ',' + r] ? 'O' : (SHOT[r][c] === '#' ? '#' : (SHOT[r][c] === 'E' ? 'E' : ' '))));
}

// 覆盖数：环压住「当前轮廓位图 GS.contourB」里多少个格（十字重复经过只计一次）。
// 这是反缩水的正确度量（v0.6.4）：旧环是否留用、新环是否换上，都以此为准 ——
// 「步数」口径是错的：区域长大後旧环不合身但更长，按长度比会一直压过更贴合的新解
// （2026-09-21 大王导出盘面复现：旧 58 步环覆盖 43/85，一直压着 56 步 46/85 的新解）。
function contourCovTest(ring) {
  const seen = {}; let cov = 0;
  for (const p of ring) {
    const z = p.r * COLS + p.c;
    if (GS.contourB[z] && !seen[z]) { seen[z] = 1; cov++; }
  }
  return cov;
}

// ---------------------------------------------------------------------------
// 6) 单调性：只清不建，环的「轮廓覆盖数」不下降
//    （覆盖数口径：换环只允许发生在新环覆盖数 ≥ 旧环覆盖数时；
//      旧版按「步数」比较，会保留更长但早已不合身的旧环 —— 已废弃）
// ---------------------------------------------------------------------------
console.log('\n[6] 单调性（只清废墟，覆盖数不下降）');
{
  let regress = 0, updated = 0, steps = 0;
  for (let iter = 0; iter < 60; iter++) {
    const rows = [];
    for (let r = 0; r < ROWS; r++) { let s = ''; for (let c = 0; c < COLS; c++) s += (Math.random() < 0.55 ? '#' : '0'); rows.push(s); }
    const A = rows.map(s => s.split(''));
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) A[CR + dr][CC + dc] = '0';
    A[CR][CC] = 'C';
    setupFromRows(A.map(x => x.join('')));
    GS.recomputeRails();
    for (let step = 0; step < 4; step++) {
      // 随机清掉一格废墟（不动建筑、不动铁轨所在格）
      const cand = [];
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (GS.grid[r][c].t === 'rubble' && !GS.grid[r][c].b) cand.push({ c: c, r: r });
      if (!cand.length) break;
      const pick = cand[Math.floor(Math.random() * cand.length)];
      GS.grid[pick.r][pick.c].t = 'blank';
      const keep = GS.railPath.slice();
      GS.recomputeRails();                       // 重算后 GS.contourB 即清完后的新轮廓
      steps++;
      const covRef = contourCovTest(keep);       // 旧环在新轮廓上的覆盖数
      const covNew = contourCovTest(GS.railPath);
      if (covNew < covRef) {
        regress++;
        if (regress <= 3) console.log('    ✗ 清 (' + pick.c + ',' + pick.r + ') 后覆盖数 ' + covRef + ' 降到 ' + covNew);
      }
      if (GS.railPath.length !== keep.length) updated++;
    }
  }
  check('只清不建时覆盖数不下降', regress === 0, regress + ' 次下降');
  console.log('    覆盖数口径下发生换环的步数: ' + updated + ' / ' + steps);
}

// ---------------------------------------------------------------------------
// 7) 顺序生长：玩家一格一格清，环只能长不能塌
// ---------------------------------------------------------------------------
console.log('\n[7] 顺序生长不塌陷');
{
  setupFromRows(GOLDEN);
  GS.recomputeRails();
  const len0 = GS.railPath.length;
  const seq = [[8, 5], [8, 6], [8, 1], [8, 3], [3, 5], [8, 0], [8, 4], [2, 5]];
  let collapsed = 0, illegal = 0;
  const trace = [len0], covTrace = [contourCovTest(GS.railPath)];
  for (const pair of seq) {
    const c = pair[0], r = pair[1];
    if (GS.grid[r][c].t !== 'rubble') continue;
    GS.grid[r][c].t = 'blank';
    const keep = GS.railPath.slice();
    GS.recomputeRails();
    const len = GS.railPath.length;
    trace.push(len);
    const covRef = contourCovTest(keep), covNew = contourCovTest(GS.railPath);
    covTrace.push(covNew);
    const err = ringError(GS.railPath);
    if (err) { illegal++; console.log('    ✗ 清 (' + c + ',' + r + ') 后环非法: ' + err); }
    if (covNew < covRef) { collapsed++; console.log('    ✗ 清 (' + c + ',' + r + ') 后覆盖数从 ' + covRef + ' 降到 ' + covNew); }
  }
  check('顺序清格时覆盖数不塌陷', collapsed === 0, collapsed + ' 次塌陷');
  check('顺序清格时环始终合法', illegal === 0, illegal + ' 次非法');
  console.log('    步数轨迹: ' + trace.join(' → '));
  console.log('    覆盖数轨迹: ' + covTrace.join(' → '));
}

// ---------------------------------------------------------------------------
// 8) 台阶 / 斜切角：外轮廓在相邻两行错位一格的盘面
//    这是「哈密顿无解、必须靠十字」的那类形状（大王给的 011/111/110 就是最小例子）。
//    盘面：中间一条 4 格宽的竖长空地，上下两端各收窄一格 → 轮廓上出现两处 1 格台阶。
// ---------------------------------------------------------------------------
console.log('\n[8] 台阶 / 斜切角盘面');
{
  const STEP = [
    '###########', '###########', '###########', '######...##', '######....#',
    '######....#', '######....#', '######.C..#', '######....#', '######....#',
    '######...##', '###########', '###########', '###########', '###########'];
  setupFromRows(STEP);
  const t = Date.now();
  GS.recomputeRails();
  const ms = Date.now() - t;
  const err = ringError(GS.railPath);
  const cc = crossCount(GS.railPath);
  check('台阶盘面 → 环合法', !err, err);
  check('台阶盘面 → 解出大环（不塌成核心小环）', stepsOf(GS.railPath) > 8, '实际 ' + stepsOf(GS.railPath));
  console.log('    步数 ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + cc + ' 个，耗时 ' + ms + 'ms');
  const vmStep = visitMap(GS.railPath);
  console.log('    ' + gridText('【输出】O=铁轨 X=十字 #=废墟 .=空白', (c, r) => {
    const k = c + ',' + r;
    if (GS.railSet[k]) return vmStep[k] >= 2 ? 'X' : 'O';
    return STEP[r][c] === '#' ? '#' : (STEP[r][c] === 'C' ? 'C' : ' ');
  }));
}

// ---------------------------------------------------------------------------
// 9) 斜切角（真的需要十字的盘面）
//    这是从随机图里捞出来的真实局面，也是「哈密顿无解、必须欧拉」的实证：
//      r6  ##.#OOO##..
//      r7  .###OCO.###      C = 镇中心
//      r8  .OOOXOO#.#.      X = 十字，(4,8) 格度数 = 4
//      r9  #OOOO#...##
//    环从镇中心正下方 (4,7) 下来、左边 (3,8) 横过来、右下方 (4,9) 还要继续 ——
//    那个格必须"竖穿一次 + 横穿一次"，每格只走一次的哈密顿回路在这里无解。
// ---------------------------------------------------------------------------
console.log('\n[9] 斜切角盘面（必须用十字的实证）');
{
  const CROSSCASE = [
    '00000####00', '####0#00##0', '00###0#0###', '###00#00##0', '#00#000#000',
    '00##0####0#', '##0#000##00', '0###0C00###', '0000000#0#0', '#0000#000##',
    '#0#000###00', '0#000###000', '00#0#0###00', '0###00##0#0', '0###0000##0'];
  setupFromRows(CROSSCASE);
  const t = Date.now();
  GS.recomputeRails();
  const ms = Date.now() - t;
  const err = ringError(GS.railPath);
  const cc = crossCount(GS.railPath);
  check('斜切角盘面 → 环合法', !err, err);
  check('斜切角盘面 → 用到至少 1 个十字', cc >= 1, '十字 ' + cc + ' 个');
  // v0.6.10：十字上的通行方式由"直行优先"搜索决定（GS.straightenRing）。
  // 该盘面的十字是直穿的（穷举 3 种配对验证过：只有直行那一种能保持单环）。
  check('斜切角盘面 → 十字直行（拐弯数 0）', GS.countTurns(GS.railPath) === 0,
    '拐弯数 ' + GS.countTurns(GS.railPath));
  check('斜切角盘面 → 环只有一个（连通）', !err || err.indexOf('不连通') < 0, err);
  console.log('    步数 ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + cc + ' 个，耗时 ' + ms + 'ms');
  const vmCross = visitMap(GS.railPath);
  console.log('    ' + gridText('【输出】O=铁轨 X=十字 #=废墟 .=空白', (c, r) => {
    const k = c + ',' + r;
    if (GS.railSet[k]) return vmCross[k] >= 2 ? 'X' : 'O';
    return CROSSCASE[r][c] === '#' ? '#' : (CROSSCASE[r][c] === 'C' ? 'C' : ' ');
  }));
}

// ---------------------------------------------------------------------------
// 10) 缩圈 bug 的**真实**盘面（大王 2026-09-20 截图逐格还原）
//     ⚠️ 注意[5]那张盘面并不是这张 —— [5]的盘面在 v0.6.1 下本来就能解出 22 格大环，
//        所以它**盖不住**这个 bug。这张才是：容差阶梯 tol=0..6 全部无解，
//        v0.6.1 只能退回"剥层"，把清空区从 42 格削到镇中心附近、铁轨塌成 8 格小环。
//     v0.6.2 的「精确兜底」在同一张图上给出覆盖 21/32 轮廓格的 26 步大环（无十字，故步数=格数）。
//     断言用"步数"做代理：轮廓格数在 recomputeRails 内部，测试侧拿不到。
// ---------------------------------------------------------------------------
console.log('\n[10] 缩圈 bug 真实盘面（截图逐格还原）');
{
  const SHOTBUG = [
    '##.#.E....#', '.##......#.', '.##.###..##', '.#..#...#.#', '#.#.#.....#',
    '#.##....##.', '.###...#E..', '.....C.....', '..##.....##', '#..#....E#.',
    '...###..#.#', '.##..#....#', '####...###.', '##..###.##.', '#..#.E..#..'];
  setupFromRows(SHOTBUG);
  GS.recomputeRails();
  const err = ringError(GS.railPath);
  check('缩圈盘面 → 环合法', !err, err);
  check('缩圈盘面 → 解出大环（不塌成 8 步小环）', stepsOf(GS.railPath) >= 20,
    '实际 ' + stepsOf(GS.railPath) + ' 步（v0.6.1 只有 8 步）');
  const vmBug = visitMap(GS.railPath);
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + crossCount(GS.railPath) + ' 个'
    + '（v0.6.1 在这张盘面上只有 8 步）');
  console.log('    ' + gridText('【输出】O=铁轨 X=十字 #=废墟 .=空白', (c, r) => {
    const k = c + ',' + r;
    if (GS.railSet[k]) return vmBug[k] >= 2 ? 'X' : 'O';
    return SHOTBUG[r][c] === '#' ? '#' : (SHOTBUG[r][c] === 'C' ? 'C' : (SHOTBUG[r][c] === 'E' ? 'E' : ' '));
  }));
}

// ---------------------------------------------------------------------------
// 11) 金币格「在铁轨上 / 圈内」= 当前区域（v0.6.13，大王定案）
//     依据大王 2026-09-23 导出的真实地图：最右两列想放 2 宽形状，唯一够格的
//     第二个邻格就是 (8,8) 那枚**已铺轨的金币**。
//     旧口径一律排除金币 → 相接只有 1 → 被拒；新口径应放行。
//     反向断言：荒野里的孤立金币仍不算区域（防清飞地，v0.6.9b）。
//     ⚠️ v0.6.14：地图收成 9×13，原 11×15 盘面按同构平移（镇中心 (4,6)、内区 col3-5
//        row4-8、金币挖出后环贴着最右两列），断言结构不变。
// ---------------------------------------------------------------------------
console.log('\n[11] 金币格在铁轨上/圈内 → 算当前区域');
{
  const GOLDMAP = [
    '###g###g#',   // r0
    '#########',   // r1
    '#########',   // r2
    '#g#####.#',   // r3 (7,3) 邻接来源（在轨金币 (7,4) 的正上方）
    '###.....G',   // r4 大空地（列 3-7）；(7,4) 已铺轨的金币
    '###.....O',   // r5
    '###.C...O',   // r6 镇中心 (4,6)
    '###.....O',   // r7
    '##.G....O',   // r8 (3,8) 圈内金币
    '#g#####.#',   // r9
    '#########',   // r10
    '####g####',   // r11
    '#########'    // r12
  ];
  const S2 = [[0, 0], [1, 0], [0, 1], [1, 1]];    // 2×2
  setupFromRows(GOLDMAP);
  GS.recomputeRails();

  check('金币盘面 → 开局环合法', !ringError(GS.railPath), ringError(GS.railPath));
  check('(7,4) 已铺轨的金币 → 算区域', GS.onRail(7, 4) === true && GS.goldInRegion(7, 4) === true,
    '环上=' + GS.onRail(7, 4) + ' 步数=' + stepsOf(GS.railPath));
  check('(3,8) 圈内金币 → 算区域', GS.goldInRegion(3, 8) === true, 'railInner=' + !!GS.railInner['3,8']);
  check('(3,0) 荒野金币 → 不算区域', GS.goldInRegion(3, 0) === false);

  const ct = ENG.shapeContacts(7, 3, S2);          // 2×2 落最右两列、row3-4
  check('2×2 落最右两列 → 相接 ≥2（含在轨金币）', ct.count >= ENG.MIN_CONTACT, '相接 ' + ct.count);
  check('2×2 落最右两列 → 可放置', ENG.applyShape(7, 3, S2) === true);

  // 反面：荒野金币不能当落脚点 —— (2,0) 2×2 盖住荒野金币 (3,0)，四周全废墟
  setupFromRows(GOLDMAP);
  GS.recomputeRails();
  const bad = ENG.applyShape(2, 0, S2);
  check('荒野金币旁 → 仍被拒（防清飞地）',
    ENG.shapeContacts(2, 0, S2).count < ENG.MIN_CONTACT && bad !== true, String(bad));
  check('  被拒时地形不变（(2,0)/(3,0) 仍是废墟）',
    GS.grid[0][2].t === 'rubble' && GS.grid[0][3].t === 'rubble');
}

// ---------------------------------------------------------------------------
// 12) 起点敏感盘面：DFS 起点写死 Bl[0] 会多出 2 个十字（v0.6.20）
//     依据大王 2026-09-23 第二次导出（KDG-MAP v1 10:26:42）：
//       轮廓 42 格、补格 20 个，唯一有解档 hLimit=11。
//       逐起点实测：起点 (0,3)/(1,3)/(2,3) → 十字 1；Bl[0]=(2,0) 等 14 个 → 十字 3；
//       其余 25 个 → 十字 4。写死起点恰好选中了较差的那一类。
//     v0.6.18 在这张盘上解出 3 个十字（1,6 / 2,2 / 3,2）——大王指出左上两个是多余的。
//     v0.6.20（起点在最外层、k* 档内多起点按三级字典序择优）→ 十字 1，只剩 1,6。
//     穷举验证：A=B∪H 内所有合法欧拉环（632,674 个去重环）中最优就是十字 1（11 个解达到），
//     十字 0 确实不存在 ⇒ 断言"十字 ≤ 1"（而非 ==0）才是正确口径。
//     ⚠️ 断言选"十字数"而不是"步数"：步数是走法口径，会随起点变（54 vs 56 步），
//        而玩家关心的是"轨道有没有多余的交叉"。
// ---------------------------------------------------------------------------
console.log('\n[12] 起点敏感盘面（DFS 起点决定十字数）');
{
  const STARTSENS = [
    '##G.###g#',   // r0
    '##..#####',   // r1
    '....G.###',   // r2
    'G.....###',   // r3
    '###....G#',   // r4
    '#G......#',   // r5
    '....C...#',   // r6
    'G.#....G#',   // r7
    '###...###',   // r8
    '###....#g',   // r9
    '###G...##',   // r10
    '......G#g',   // r11
    'G...G####'];  // r12
  setupFromRows(STARTSENS);
  GS.recomputeRails();
  const err12 = ringError(GS.railPath);
  check('起点敏感盘面 → 环合法', !err12, err12);
  const cc12 = crossCount(GS.railPath);
  check('起点敏感盘面 → 十字 ≤ 1（写死 Bl[0] 时是 3）', cc12 <= 1, '实际 ' + cc12 + ' 个');
  check('起点敏感盘面 → 覆盖不缩水（步数 ≥ 50）', stepsOf(GS.railPath) >= 50,
    '实际 ' + stepsOf(GS.railPath) + ' 步');
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + cc12 + ' 个' + (cc12 ? '（v0.6.18 是 3 个）' : ''));
  const vm12 = visitMap(GS.railPath);
  console.log('    ' + gridText('【输出】O=铁轨 X=十字 #=废墟 .=空白 G=金币 g=金币(埋)', (c, r) => {
    const k = c + ',' + r;
    if (GS.railSet[k]) return vm12[k] >= 2 ? 'X' : 'O';
    return STARTSENS[r][c] === '#' ? '#' : (STARTSENS[r][c] === 'C' ? 'C' : STARTSENS[r][c]);
  }));
}

// ---------------------------------------------------------------------------
// [13] 单边半岛往返支线（v0.8.0，大王 2026-09-24 07:21 盘的骨架复刻）
//   右下 2×3 凸块挂在唯一桥边 (5,8)-(6,8) 上：闭合迹（每边 ≤1 次）数学上围不进去，
//   旧解只能放弃 6 格（rail(12)）；v0.8.0 支线"桥边走 2 次（反向）"把它收编。
//   理论最优 = 主环 12 + 桥边往返 2 + 半岛周环 6 = 20 步 / 18 格 / 2 十字（桥头 2 格）。
// ---------------------------------------------------------------------------
console.log('\n[13] 单边半岛往返支线（0721 盘骨架）');
{
  const PENIN = [
    '#########',
    '#########',
    '#########',
    '#########',
    '###...###',
    '###...###',
    '###.C.###',
    '###...###',
    '###.....#',
    '######..#',
    '######..#',
    '#########',
    '#########'];
  setupFromRows(PENIN);
  GS.recomputeRails();
  const err13 = ringError(GS.railPath);
  check('单边半岛 → 走线合法（每边 ≤2 次且往返必反向）', !err13, err13);
  check('单边半岛 → 半岛被收编（步数 ≥ 20）', stepsOf(GS.railPath) >= 20,
    '实际 ' + stepsOf(GS.railPath) + ' 步（旧版只能 rail(12)）');
  const cov13 = Object.keys(GS.railSet || {}).length;
  check('单边半岛 → 覆盖 18 格（12 主环 + 6 半岛）', cov13 === 18, '实际 ' + cov13 + ' 格');
  check('单边半岛 → 十字 = 2（桥头两格，不许多余折返）', crossCount(GS.railPath) === 2,
    '实际 ' + crossCount(GS.railPath) + ' 个');
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + crossCount(GS.railPath) + ' 个（旧版 rail(12)，放弃 6 格）');
}

// [14] 桥边约束（v0.8.2，大王 2026-09-24 10:42 盘的骨架复刻）
//   主环南缘已盖住走廊，唯一欠收 = 西侧 2×4 金币半岛（挂单桥边 (1,9)-(1,10)）。
//   v0.8.1 的 spur 会把三条非桥边各走两遍织成辫子（44 步/7 十字）；
//   v0.8.2 桥边约束后应为干净解：主环 + 西半岛环 + 桥边往返 = 36 步 / 2 十字。
// ---------------------------------------------------------------------------
console.log('\n[14] 桥边约束（10:42 盘骨架）');
{
  const B1042 = [
    '#g######g', '#########', '##g##g###', '#########',
    'g##...##g', '###...###', '..#.C.#g#', 'G.#...###',
    '..#...##g', '..#....##', '#G..G.G##', '#.....###', '#..G..#g#'];
  setupFromRows(B1042);
  GS.debugNoDeadline = true;
  GS.recomputeRails();
  const err14 = ringError(GS.railPath);
  check('桥边约束 → 走线合法', !err14, err14);
  check('桥边约束 → 西半岛被收编（覆盖 ≥ 30 格）', Object.keys(GS.railSet).length >= 30,
    '实际 ' + Object.keys(GS.railSet).length + ' 格');
  check('桥边约束 → 十字 ≤ 2（不织辫子）', crossCount(GS.railPath) <= 2,
    '实际 ' + crossCount(GS.railPath) + ' 个（v0.8.1 编织解 7 个）');
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + crossCount(GS.railPath) + ' 个（v0.8.1 编织解 44步/7十字）');
}

// [15] mv=1 起点豁免（v0.8.4，大王 2026-09-24 12:44 盘的骨架复刻）
//   v0.6.x 起 BFS 剪枝把 vis=1 的起点挡在队外 → maxVisit=1 档 reachStart 恒 false，
//   "优先每格一次的干净解"从未生效。此盘旧解 50步/2十字，干净解 48步/0十字 一直存在。
// ---------------------------------------------------------------------------
console.log('\n[15] mv=1 起点豁免（12:44 盘骨架）');
{
  const B1244 = [
    '###G..G##', '###....##', 'g##..G###', '###...###',
    '#G....##g', '#.....###', '###.C.###', '#G....##g',
    '#.......#', '####...G#', '..G..G###', 'G.....###', '####g###g'];
  setupFromRows(B1244);
  GS.debugNoDeadline = true;
  GS.recomputeRails();
  const err15 = ringError(GS.railPath);
  check('mv1豁免 → 走线合法', !err15, err15);
  check('mv1豁免 → 十字 = 0（干净解被搜到）', crossCount(GS.railPath) === 0,
    '实际 ' + crossCount(GS.railPath) + ' 个（修复前 2 个）');
  check('mv1豁免 → 步数 ≤ 48（50 步带十字的旧解不再出现）', stepsOf(GS.railPath) <= 48,
    '实际 ' + stepsOf(GS.railPath) + ' 步');
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，十字 ' + crossCount(GS.railPath) + ' 个（修复前 50步/2十字）');
}

// [46] 主解分岔原生化 + 端头禁令（v1.0，大王 2026-09-28 12:26 导出盘逐格复刻）
//   主环 12 格（内区轮廓）+ 桥边 (5,8)-(6,8) 挂 2×2 突起。v1.0 起主解 mm=2：
//   程序重放锤定 = 桥边走 2 次（一来一回），(5,8)(6,8) 双 T 岔（度 3），无十字无端头。
//   本用例同时锁三件事：①分岔收编照旧成立 ②无十字贴片（重走格全是 T 岔）③无端头（deg=1）。
// ---------------------------------------------------------------------------
console.log('\n[46] 主解分岔原生化 + 端头禁令（1226 盘逐格复刻）');
{
  const B1226 = [
    '#g#####g#', '#########', '####g####', '#########',
    'g##...##g', '###...###', '###.C.#g#', 'g##...##g',
    '###.....#', '######.G#', 'g#g######', '#####g##g', '#g#######'];
  setupFromRows(B1226);
  GS.recomputeRails();
  const err46 = ringError(GS.railPath);
  check('分岔原生化 → 走线合法（每边 ≤2 次且往返必反向）', !err46, err46);
  check('分岔原生化 → 与大王现场解逐格一致（rail 18 步）',
    stepsOf(GS.railPath) === 18 &&
    GS.railPath.map(p => p.c + ',' + p.r).join(' ') ===
      '3,4 4,4 5,4 5,5 5,6 5,7 5,8 6,8 7,8 7,9 6,9 6,8 5,8 4,8 3,8 3,7 3,6 3,5',
    '实际 rail(' + stepsOf(GS.railPath) + '): ' + GS.railPath.map(p => p.c + ',' + p.r).join(' '));
  // 格级形态：重走格 2 个且都是 T 岔（度 3），无十字（度 4）、无端头（度 1）
  {
    const nbr46 = {};
    for (let i = 0; i < GS.railPath.length; i++) {
      const a = GS.railPath[i], b = GS.railPath[(i + 1) % GS.railPath.length];
      const ka = a.c + ',' + a.r, kb = b.c + ',' + b.r;
      (nbr46[ka] = nbr46[ka] || new Set()).add(kb);
      (nbr46[kb] = nbr46[kb] || new Set()).add(ka);
    }
    let tj46 = 0, cross46 = 0, ends46 = 0;
    for (const k in nbr46) {
      if (nbr46[k].size === 3) tj46++;
      else if (nbr46[k].size === 4) cross46++;
      else if (nbr46[k].size === 1) ends46++;
    }
    check('分岔原生化 → T 岔 = 2（双 T 岔咽喉，贴片为分岔非十字）', tj46 === 2,
      '实际 ' + tj46 + ' 个');
    check('分岔原生化 → 十字贴片 = 0', cross46 === 0, '实际 ' + cross46 + ' 个');
    check('端头禁令 → 端头（度 1 尽头车挡）= 0', ends46 === 0, '实际 ' + ends46 + ' 个');
  }
  console.log('    步数 = ' + stepsOf(GS.railPath) + ' / 格数 ' + cellsOf(GS.railPath) +
    '，重走格 ' + (stepsOf(GS.railPath) - cellsOf(GS.railPath)) + ' 个（双 T 岔，无十字无端头）');
}

// ---------------------------------------------------------------------------
console.log('\n' + '='.repeat(64));
console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
console.log('='.repeat(64));
