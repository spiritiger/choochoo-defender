// ============================================================================
// 诊断 002：大王 2026-09-29T08:30 导出盘 rail(60) —— (5,8)(6,8) 两个"多余十字"
// 跑法：node diag_002_cross.js
// 步骤：
//   A. 还原导出盘面，跑一次"干净重解"（清掉旧环），看求解器裸解是几步/几十字；
//   B. 把导出的 rail(60) 原样喂回去再 recompute，看"反缩水保险"是否沿用旧环；
//   C. 手工构造同覆盖、零十字的 58 步替代走线，逐项验证合法性（正交/每格≤2/
//      每边≤2/单闭环/围住镇中心），证明十字确实可避免。
// ============================================================================
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const sb = {}; sb.window = sb; sb.console = console;
vm.createContext(sb);
for (const f of ['js/config/map.js', 'js/state.js', 'js/station.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });
const CFG = sb.CFG, GS = sb.GS;
GS.debugNoDeadline = true;   // 关墙钟，结果可复现

// ---- 导出盘面 ----
const ROWS = [
  '.G.G#..G#',
  '....#...#',
  '##G..G###',
  'G........',
  '..#....G.',
  '###...###',
  '###.C.###',
  '#g#.....#',
  '###....G#',
  '#####..##',
  '#####.G##',
  '###g#..##',
  'g####G.#g'];
const EXPORT = '0,0 1,0 2,0 3,0 3,1 3,2 4,2 5,2 5,1 5,0 6,0 7,0 7,1 6,1 5,1 5,2 5,3 6,3 7,3 8,3 8,4 7,4 6,4 5,4 5,5 5,6 5,7 5,8 5,9 5,10 5,11 5,12 6,12 6,11 6,10 6,9 6,8 6,7 7,7 7,8 6,8 5,8 4,8 3,8 3,7 3,6 3,5 3,4 3,3 2,3 1,3 0,3 0,4 1,4 1,3 2,3 2,2 2,1 1,1 0,1'
  .split(' ').map(s => { const p = s.split(','); return { c: +p[0], r: +p[1] }; });
// 手工替代走线：同 54 格覆盖，本段 0 十字（南叶改配对：5,6→5,7→6,7→7,7→7,8→6,8→6,9，
// 底部 6,12→5,12 折返上 5 列，5,9→5,8→4,8 西行）
const ALT = ('0,0 1,0 2,0 3,0 3,1 3,2 4,2 5,2 5,1 5,0 6,0 7,0 7,1 6,1 5,1 5,2 5,3 6,3 7,3 8,3 8,4 7,4 6,4 5,4 5,5 5,6 5,7' +
  ' 6,7 7,7 7,8 6,8 6,9 6,10 6,11 6,12 5,12 5,11 5,10 5,9 5,8' +
  ' 4,8 3,8 3,7 3,6 3,5 3,4 3,3 2,3 1,3 0,3 0,4 1,4 1,3 2,3 2,2 2,1 1,1 0,1')
  .split(' ').map(s => { const p = s.split(','); return { c: +p[0], r: +p[1] }; });

function setupGrid() {
  GS.newGame();                        // 拿到初始 core/buildings 骨架
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
    const ch = ROWS[r][c], g = GS.grid[r][c];
    g.t = 'rubble'; g.gold = false; g.harvested = false; g.flash = 0;
    if (g.b && g.b.type !== 'core') g.b = null;
    if (ch === '.') g.t = 'blank';
    else if (ch === 'G') { g.t = 'blank'; g.gold = true; }
    else if (ch === 'g') { g.gold = true; }                       // 埋在废墟里
    else if (ch === 'C') g.t = 'blank';
  }
  GS.grid[6][4].b = GS.core;         // 'C' 在 (4,6)，newGame 的 core 就在这
}

// ---- 统计与合法性 ----
function analyze(p, label) {
  const vis = {}, edge = {};
  let ortho = true, closed = false;
  const adj = (a, b) => Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (!adj(a, b)) ortho = false;
    const k = a.c + ',' + a.r; vis[k] = (vis[k] || 0) + 1;
    const ek = i < p.length - 1
      ? [a.c + ',' + a.r + '|' + b.c + ',' + b.r, b.c + ',' + b.r + '|' + a.c + ',' + a.r]
      : null;
    if (ek) { edge[ek[0]] = 1; }
  }
  closed = adj(p[p.length - 1], p[0]);
  // 每格次数 / 每边次数（无向）
  let overCell = [], overEdge = [];
  const und = {};
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (!adj(a, b)) continue;
    const lo = [a.c, a.r, b.c, b.r].sort((x, y) => x - y).join(',');
    und[lo] = (und[lo] || 0) + 1;
  }
  for (const k in vis) if (vis[k] > 2) overCell.push(k);
  for (const k in und) if (und[k] > 2) overEdge.push(k + '×' + und[k]);
  // 单闭环：从 0 号走一圈必须恰好遍历全部步数
  let singleCycle = false;
  if (ortho && closed) {
    const walked = new Set(); let i = 0;
    do { walked.add(i); i = (i + 1) % p.length; } while (i !== 0 && walked.size < p.length);
    singleCycle = walked.size === p.length && adj(p[p.length - 1], p[0]);
    // 多次经过的格会打乱纯链式游走 —— 改用"度数连续性"判定：每个出现格度数(按边次)为 2/4（十字）或 T 岔桥边
  }
  // 重走格分类：度4（四方向全占=十字）vs 度3（T 岔）
  const dirset = {};
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (!adj(a, b)) continue;
    const k = a.c + ',' + a.r;
    dirset[k] = dirset[k] || {};
    dirset[k][(b.c - a.c) + ',' + (b.r - a.r)] = 1;
    const k2 = b.c + ',' + b.r;
    dirset[k2] = dirset[k2] || {};
    dirset[k2][(a.c - b.c) + ',' + (a.r - b.r)] = 1;
  }
  let cross = [], tj = [];
  for (const k in vis) {
    if (vis[k] < 2) continue;
    const dirs = Object.keys(dirset[k]).length;
    if (dirs >= 4) cross.push(k); else tj.push(k);
  }
  // 围住镇中心：铁轨当墙，从四边灌水，核心格不可达
  const rail = {}; for (const q of p) rail[q.c + ',' + q.r] = 1;
  const seen = {}, q = [];
  for (let c = 0; c < CFG.MAP_COLS; c++) { q.push([c, 0], [c, CFG.MAP_ROWS - 1]); }
  for (let r = 0; r < CFG.MAP_ROWS; r++) { q.push([0, r], [CFG.MAP_COLS - 1, r]); }
  while (q.length) {
    const [c, r] = q.pop(), k = c + ',' + r;
    if (c < 0 || c >= CFG.MAP_COLS || r < 0 || r >= CFG.MAP_ROWS || seen[k] || rail[k]) continue;
    seen[k] = 1; q.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  const encloses = !seen['4,6'];
  // 轮廓覆盖
  const B = GS.contourB || [];
  let tot = 0, cov = 0; const covSeen = {};
  for (let i = 0; i < B.length; i++) if (B[i]) tot++;
  for (const q2 of p) {
    const k = q2.c + ',' + q2.r;
    if (covSeen[k]) continue; covSeen[k] = 1;
    if (B[q2.r * CFG.MAP_COLS + q2.c]) cov++;
  }
  console.log('—— ' + label + ' ——');
  console.log('  步数=' + p.length + '  去重格=' + Object.keys(vis).length +
    '  正交=' + ortho + '  闭环=' + closed + '  围核心=' + encloses);
  console.log('  每格>2次: ' + (overCell.length ? overCell.join(' ') : '无') +
    '  每边>2次: ' + (overEdge.length ? overEdge.join(' ') : '无'));
  console.log('  十字(度4): ' + (cross.length ? cross.join(' ') : '无') +
    '   T岔(度3): ' + (tj.length ? tj.join(' ') : '无'));
  console.log('  轮廓覆盖: ' + cov + '/' + tot);
  return { steps: p.length, dedup: Object.keys(vis).length, cov, cross: cross.length };
}

// ---- A. 干净重解（不留旧环）----
setupGrid();
GS.railPath = [];
GS.recomputeRails();
const fresh = analyze(GS.railPath, 'A. 求解器裸解（清掉旧环后重算）');

// ---- B. 喂回导出的 rail(60)，看保险是否沿用 ----
setupGrid();
GS.railPath = EXPORT.slice();
GS.recomputeRails();
const sameAsExport = GS.railPath.length === EXPORT.length &&
  GS.railPath.every((q, i) => q.c === EXPORT[i].c && q.r === EXPORT[i].r);
console.log('\nB. 喂回 rail(60) 再重算 → 沿用旧环? ' + (sameAsExport ? '是（保险保住了带十字的旧环）' : '否，换成了新解'));
if (!sameAsExport) analyze(GS.railPath, 'B2. 保险后的环');

// ---- C. 手工替代走线 ----
setupGrid();
GS.railPath = [];
GS.recomputeRails();          // 先让 contourB 等内部量就位
console.log('');
const alt = analyze(ALT, 'C. 手工替代走线（同覆盖、目标 0 十字）');

console.log('\n==== 对照 ====');
console.log('导出 rail(60): 60 步 / 54 格 / 2 十字');
console.log('裸解        : ' + fresh.steps + ' 步 / ' + fresh.dedup + ' 格 / ' + fresh.cross + ' 十字');
console.log('手工替代    : ' + alt.steps + ' 步 / ' + alt.dedup + ' 格 / ' + alt.cross + ' 十字');

// ---- D. 真实墙钟（不关 deadline）：裸解是否被 700ms 预算掐成 60/2？----
console.log('\n==== D. 真实墙钟 × 15 次（debugNoDeadline 关闭） ====');
GS.debugNoDeadline = false;
const dist = {};
for (let i = 0; i < 15; i++) {
  setupGrid();
  GS.railPath = [];
  const t0 = Date.now();
  GS.recomputeRails();
  const ms = Date.now() - t0;
  const vis = {};
  for (const q of GS.railPath) { const k = q.c + ',' + q.r; vis[k] = (vis[k] || 0) + 1; }
  let cross = 0; const dirset = {};
  for (let j = 0; j < GS.railPath.length; j++) {
    const a = GS.railPath[j], b = GS.railPath[(j + 1) % GS.railPath.length];
    const k = a.c + ',' + a.r;
    dirset[k] = dirset[k] || {};
    dirset[k][(b.c - a.c) + ',' + (b.r - a.r)] = 1;
  }
  for (const k in vis) if (vis[k] >= 2 && Object.keys(dirset[k]).length >= 4) cross++;
  const key = GS.railPath.length + '步/' + cross + '十字';
  dist[key] = (dist[key] || 0) + 1;
  if (ms > 200) console.log('  第' + (i + 1) + '次: ' + key + '  耗时 ' + ms + 'ms ⚠️');
  else console.log('  第' + (i + 1) + '次: ' + key + '  耗时 ' + ms + 'ms');
}
console.log('  分布: ' + JSON.stringify(dist));
