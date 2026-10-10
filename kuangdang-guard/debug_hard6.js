// 临时诊断：hard6 盘 v2 内部量（B* 大小 / 精确枚举维数 / 预算放大是否救回）
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.window = sandbox; sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js', 'js/solver-async.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS;
GS.debugNoDeadline = true;

// mulberry32 / genBoard 与 test_rail_v2.js 同实现
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS, CC = 4, CR = 6;
function genBoard(rng, clears) {
  const g = [];
  for (let r = 0; r < ROWS; r++) g.push(new Array(COLS).fill('#'));
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
function setup(rows) {
  GS.grid = []; GS.goldTiles = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const ch = rows[r][c];
      row.push({ t: ch === '#' ? 'rubble' : 'blank', gold: false, harvested: false,
                 b: ch === 'C' ? { type: 'core', c: c, r: r } : null });
      if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
    }
    GS.grid.push(row);
  }
  GS.buildings = [GS.core];
  GS.railPath = []; GS.railSet = {}; GS.railRect = null; GS.railGrowHints = [];
  GS.__v2cache = null;
}

const board = genBoard(mulberry32(500000 + 6 * 17), 16 + (6 % 14));
console.log('盘面:');
for (const row of board) console.log('  ' + row);

// v1 解 + 轮廓大小
setup(board);
GS.recomputeRails();
console.log('v1: ' + GS.railPath.length + '步');
let b1 = 0; for (let i = 0; i < GS.contourB.length; i++) b1 += GS.contourB[i] ? 1 : 0;
console.log('|B1|=' + b1);

// v2 探针：看 B* / removed / 半岛
setup(board);
GS.railProbeOn = true;
GS.railV2 = true;
GS.recomputeRails();
console.log('v2 冷解: ' + GS.railPath.length + '步  last=' + JSON.stringify({ p: GS.__v2last.provenance, tol: GS.__v2last.tolStar, left: GS.__v2last.budgetLeft }));
let b2 = 0; for (let i = 0; i < GS.contourB.length; i++) b2 += GS.contourB[i] ? 1 : 0;
console.log('|B*|=' + b2);
console.log(GS.railProbeText());

// 预算放大实验：1500 万节点是否能救回
setup(board);
GS.railV2 = true;
GS.__v2nodesOverride = 15000000;
GS.recomputeRails();
GS.__v2nodesOverride = 0;
console.log('v2 预算×10: ' + GS.railPath.length + '步  last=' + JSON.stringify({ p: GS.__v2last.provenance, tol: GS.__v2last.tolStar, left: GS.__v2last.budgetLeft }));
