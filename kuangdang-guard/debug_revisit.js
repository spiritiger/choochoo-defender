// 诊断：重走格的形态分析——每个被走 2 次的格，两次通行各用了哪些口（N/E/S/W），
// 总口数 =2 ⇒ 往返格（大王 2026-10-11 判非法）；=3 ⇒ T 岔；=4 ⇒ 十字。
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.window = sandbox; sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS;
GS.debugNoDeadline = true;

const ROWS = CFG.MAP_ROWS, COLS = CFG.MAP_COLS;
function setup(rows) {
  GS.grid = []; GS.goldTiles = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const ch = rows[r][c];
      row.push({ t: (ch === '#' || ch === 'X' || ch === 'g') ? 'rubble' : 'blank', gold: ch === 'G' || ch === 'g',
                 harvested: false, b: ch === 'E' ? { type: 'econ', c, r } : (ch === 'C' ? { type: 'core', c, r } : null) });
      if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
    }
    GS.grid.push(row);
  }
  GS.buildings = [GS.core];
  GS.railPath = []; GS.railSet = {}; GS.railRect = null; GS.railGrowHints = [];
  GS.__v2cache = null;
}
const DIR = { '1,0': 'E', '-1,0': 'W', '0,1': 'S', '0,-1': 'N' };

function analyze(tag, ring) {
  const L = ring.length;
  const visits = {};   // key -> [{in,out}, ...]
  for (let i = 0; i < L; i++) {
    const p = ring[i], a = ring[(i - 1 + L) % L], b = ring[(i + 1) % L];
    const k = p.c + ',' + p.r;
    (visits[k] = visits[k] || []).push({ in: DIR[(a.c - p.c) + ',' + (a.r - p.r)], out: DIR[(b.c - p.c) + ',' + (b.r - p.r)] });
  }
  console.log('== ' + tag + '：' + L + ' 步 ==');
  for (const k of Object.keys(visits)) {
    if (visits[k].length < 2) continue;
    const ports = new Set();
    for (const v of visits[k]) { ports.add(v.in); ports.add(v.out); }
    const shape = ports.size <= 2 ? '★往返格(非法)' : (ports.size === 3 ? 'T岔' : '十字');
    console.log('  格(' + k + ') 走' + visits[k].length + '次  各次[' +
      visits[k].map(v => v.in + '→' + v.out).join(' | ') + ']  总口数=' + ports.size + '  → ' + shape);
  }
}

const K60 = ['g###g####','######g##','#g######g','#########','#g#...#g#','......###','G...C.###','#...E.#g#','#G....###','....#...#','G...#G..#','#....###g','#...G####'];
const PENINSULA = ['#########','#########','#########','#########','#########','###...#..','###.C....','###...###','#########','#########','#########','#########','#########'];

setup(K60);
GS.railV2 = false; GS.recomputeRails();
analyze('k60 · v1（现行算法）', GS.railPath);
setup(K60);
GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;
analyze('k60 · v2（新算法）', GS.railPath);

setup(PENINSULA);
GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;
analyze('死角盘 · v2（新算法）', GS.railPath);
console.log('  v2 走线: ' + GS.railPath.map(p => p.c + ',' + p.r).join(' '));
