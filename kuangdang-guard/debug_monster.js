// ============================================================================
// 怪兽真盘复刻（09:05 / 09:12，大王 2026-10-10 导出、2026-10-11 转发）
//   验证：①半岛收编 ②真墙钟耗时 ③冷解 rail(0) 风险（R3）④烧穿省略闸
//   node debug_monster.js
// ============================================================================
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.window = sandbox; sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS;

const BOARDS = [
  { name: '09:05（wave3，U 大开阔）', rows: [
      '...G##.G#', 'G...##..#', '#..#.G.G#', '#..#..#..', '#G....#.G',
      '..#.T.###', '..#.C.###', 'G.#...##g', '###...###', '##..#####',
      'g#G.g####', '##..###g#', '##G.#####'],
    rail: [[0,0],[1,0],[2,0],[3,0],[3,1],[2,1],[2,2],[2,3],[2,4],[3,4],[4,4],[4,3],[4,2],[5,2],[6,2],[7,2],[7,1],[7,0],[6,0],[6,1],[6,2],[5,2],[5,3],[5,4],[5,5],[5,6],[5,7],[5,8],[4,8],[3,8],[3,9],[3,10],[3,11],[3,12],[2,12],[2,11],[2,10],[2,9],[3,9],[3,8],[3,7],[3,6],[3,5],[3,4],[2,4],[1,4],[1,5],[1,6],[1,7],[0,7],[0,6],[0,5],[1,5],[1,4],[1,3],[1,2],[1,1],[0,1]] },
  { name: '09:12（wave4，+4 格 + 半岛）', rows: [
      '...G##.G#', 'G...##..#', '#..#.G.G#', '#..#..#..', '#G....#.G',
      '..#.T.###', '..#.C.###', 'G.#.T.##g', '###...###', '##..#####',
      'g#G.G...#', '##.....G#', '##G.#####'],
    pen: [[7,3],[8,3],[7,4],[8,4]],
    rail: [[0,0],[1,0],[2,0],[3,0],[3,1],[2,1],[2,2],[2,3],[2,4],[3,4],[4,4],[4,3],[4,2],[5,2],[6,2],[7,2],[7,1],[7,0],[6,0],[6,1],[6,2],[5,2],[5,3],[5,4],[5,5],[5,6],[5,7],[5,8],[4,8],[3,8],[3,9],[3,10],[4,10],[5,10],[6,10],[7,10],[7,11],[6,11],[5,11],[4,11],[3,11],[3,12],[2,12],[2,11],[2,10],[2,9],[3,9],[3,8],[3,7],[3,6],[3,5],[3,4],[2,4],[1,4],[1,5],[1,6],[1,7],[0,7],[0,6],[0,5],[1,5],[1,4],[1,3],[1,2],[1,1],[0,1]] }
];

function setup(rows) {
  GS.grid = []; GS.goldTiles = [];
  for (let r = 0; r < 13; r++) {
    const row = [];
    for (let c = 0; c < 9; c++) {
      const ch = rows[r][c];
      const isGold = ch === 'G' || ch === 'g';
      row.push({ t: (ch === '#' || ch === 'g') ? 'rubble' : 'blank', gold: isGold, harvested: false,
                 b: (ch === 'T' || ch === 'E') ? { type: ch === 'E' ? 'econ' : 'tower', c: c, r: r } : (ch === 'C' ? { type: 'core', c: c, r: r } : null) });
      if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
      if (isGold) GS.goldTiles.push({ c: c, r: r });
    }
    GS.grid.push(row);
  }
  GS.buildings = [GS.core];
  GS.railPath = []; GS.railSet = {}; GS.railRect = null; GS.railGrowHints = [];
  GS.__v2cache = null; GS.debugNoDeadline = false;   // 真墙钟 = 生产口径
}
function stats(tag, ring, B) {
  const v = {}; let cov = 0;
  for (const p of ring) { const k = p.c + ',' + p.r; v[k] = (v[k] || 0) + 1; if (B[p.r * 9 + p.c]) cov++; }
  let cross = 0; for (const k in v) if (v[k] >= 2) cross++;
  let bn = 0; for (let i = 0; i < B.length; i++) bn += B[i] ? 1 : 0;
  return tag + ': ' + ring.length + '步 / ' + Object.keys(v).length + '格 / 重走' + cross + ' / cov=' + cov + '/' + bn;
}
function hasBacktrack(ring) {
  const L = ring.length, v = {};
  for (let i = 0; i < L; i++) {
    const p = ring[i], a = ring[(i - 1 + L) % L], b = ring[(i + 1) % L];
    (v[p.c + ',' + p.r] = v[p.c + ',' + p.r] || []).push([a.c - p.c, a.r - p.r, b.c - p.c, b.r - p.r]);
  }
  for (const k in v) {
    for (const x of v[k]) if (x[0] === x[2] && x[1] === x[3]) return k;
    if (v[k].length >= 2) {
      const s = new Set();
      for (const x of v[k]) { s.add(x[0] + ',' + x[1]); s.add(x[2] + ',' + x[3]); }
      if (s.size <= 2) return k;
    }
  }
  return null;
}

for (const b of BOARDS) {
  console.log('\n===== ' + b.name + ' =====');
  // A. v1 冷解 ×5（真墙钟）
  let t1 = [];
  for (let i = 0; i < 5; i++) {
    setup(b.rows); const t0 = Date.now();
    GS.railV2 = false; GS.recomputeRails();
    t1.push(Date.now() - t0);
    if (i === 0) console.log('  v1 冷解 ' + stats('', GS.railPath, GS.contourB) + (GS.railPath.length === 0 ? '  ← rail(0)!' : ''));
  }
  t1.sort((x, y) => x - y);
  console.log('  v1 冷解耗时: ' + t1.join('/') + 'ms（中位 ' + t1[2] + '）');
  // B. v2 冷解 ×5（真墙钟）
  let t2 = [];
  for (let i = 0; i < 5; i++) {
    setup(b.rows); const t0 = Date.now();
    GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;
    t2.push(Date.now() - t0);
    if (i === 0) {
      console.log('  v2 冷解 ' + stats('', GS.railPath, GS.contourB) + (GS.railPath.length === 0 ? '  ← rail(0)!' : ''));
      console.log('       provenance=' + GS.__v2last.provenance + ' budgetLeft=' + GS.__v2last.budgetLeft + ' 往返格=' + (hasBacktrack(GS.railPath) || '无'));
      if (b.pen) {
        const s = new Set(GS.railPath.map(p => p.c + ',' + p.r));
        console.log('       半岛纳入: ' + b.pen.filter(p => s.has(p[0] + ',' + p[1])).length + '/4' + (s.has('7,3') ? '（含脖子边）' : ''));
      }
    }
  }
  t2.sort((x, y) => x - y);
  console.log('  v2 冷解耗时: ' + t2.join('/') + 'ms（中位 ' + t2[2] + '）');
  // C. v2 暖解（挂游戏内祖传环）+ 同盘重复求解（省略闸）
  setup(b.rows);
  GS.railPath = b.rail.map(x => ({ c: x[0], r: x[1] }));
  const t0 = Date.now();
  GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;
  const warmMs = Date.now() - t0;
  console.log('  v2 暖解（祖传环起步） ' + stats('', GS.railPath, GS.contourB) + '  ' + warmMs + 'ms  provenance=' + GS.__v2last.provenance);
  const t3 = Date.now();
  GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;   // 同盘重复（v2）→ 省略闸
  console.log('  v2 同盘重复求解: ' + (Date.now() - t3) + 'ms  provenance=' + GS.__v2last.provenance + '（应为 skip）');
}
