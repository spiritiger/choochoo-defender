// 诊断：大王试玩盘（2026-10-11T09:14 导出）"多余十字"确认
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.window = sandbox; sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS; GS.debugNoDeadline = true;

const ROWS = [
  '###g..###', '##....#.G', 'G...g....', '..###..##', '.G#...###',
  '..#...#g#', '..#.C.###', '.G#...##g', '..#...###', '#..#####g',
  'G..#g####', '...######', '#G.##g##g'];

function setup(rows) {
  GS.grid = []; GS.goldTiles = [];
  for (let r = 0; r < 13; r++) {
    const row = [];
    for (let c = 0; c < 9; c++) {
      const ch = rows[r][c];
      const isGold = ch === 'G' || ch === 'g';
      row.push({ t: (ch === '#' || ch === 'X' || ch === 'g') ? 'rubble' : 'blank', gold: isGold, harvested: false,
                 b: ch === 'C' ? { type: 'core', c: c, r: r } : null });
      if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
    }
    GS.grid.push(row);
  }
  GS.buildings = [GS.core];
  GS.railPath = []; GS.railSet = {}; GS.railRect = null; GS.railGrowHints = [];
  GS.__v2cache = null;
}
function stat(ring, B) {
  const v = {}; let cov = 0;
  for (const p of ring) { const k = p.c + ',' + p.r; v[k] = (v[k] || 0) + 1; if (B[p.r * 9 + p.c]) cov++; }
  let cross = 0; for (const k in v) if (v[k] >= 2) cross++;
  let bn = 0; for (let i = 0; i < B.length; i++) bn += B[i] ? 1 : 0;
  return { steps: ring.length, cells: Object.keys(v).length, cross: cross, cov: cov, bl: bn };
}
function badCells(ring) {
  const L = ring.length, v = {};
  for (let i = 0; i < L; i++) {
    const p = ring[i], a = ring[(i - 1 + L) % L], b = ring[(i + 1) % L];
    (v[p.c + ',' + p.r] = v[p.c + ',' + p.r] || []).push([(a.c - p.c) + ',' + (a.r - p.r), (b.c - p.c) + ',' + (b.r - p.r)]);
  }
  const bads = [];
  for (const k in v) {
    for (const x of v[k]) if (x[0] === x[1]) bads.push(k + '掉头');
    if (v[k].length >= 2) {
      const s = new Set();
      for (const x of v[k]) { s.add(x[0]); s.add(x[1]); }
      if (s.size <= 2) bads.push(k + '往返');
    }
  }
  return bads;
}

setup(ROWS); GS.recomputeRails();
const r1 = GS.railPath.slice(), B1 = GS.contourB.slice();
console.log('v1 :', JSON.stringify(stat(r1, B1)), '违规:', badCells(r1).join(',') || '无');

setup(ROWS); GS.railV2 = true; GS.recomputeRails(); GS.railV2 = false;
const r2 = GS.railPath.slice();
console.log('v2 :', JSON.stringify(stat(r2, GS.contourB)), '违规:', badCells(r2).join(',') || '无', 'prov=' + GS.__v2last.provenance);

// 穷举 v2 搜索空间：字典序最优合法环
const KIT = sandbox.makeRailSolverKit(9, 13, 4, 6);
const id = KIT.id;
const usable = new Uint8Array(117);
for (let r = 0; r < 13; r++) for (let c = 0; c < 9; c++) {
  const cell = GS.grid[r][c];
  usable[id(c, r)] = (cell.t === 'blank' && !cell.b) ? 1 : 0;
}
const PROT = new Uint8Array(117);
for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
  if (CFG.inBounds(4 + dc, 6 + dr)) PROT[id(4 + dc, 6 + dr)] = 1;
KIT.setPROT(PROT);
const U2 = KIT.floodU(usable); KIT.thinNeck(U2); KIT.keepCoreComponent(U2); KIT.pruneU(U2);
const F = KIT.computeF(U2);
const bd = KIT.boundaryOf(U2, F, usable), B = bd.B, Bl = bd.Bl;
const H = KIT.helpersOf(U2, B, usable);
for (let i = 0; i < 117; i++) {
  if (!U2[i] || B[i] || H[i] || !usable[i]) continue;
  const c = i % 9, r = (i - c) / 9;
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nc = c + dc, nr = r + dr;
    if (CFG.inBounds(nc, nr) && F[id(nc, nr)]) { H[i] = 1; break; }
  }
}
const A = new Uint8Array(117);
for (let i = 0; i < 117; i++) if (B[i] || H[i]) A[i] = 1;
let best = null; const seen = new Set();
for (let si = 0; si < Bl.length; si++) {
  for (let tol = 0; tol <= 6; tol++) {
    for (const ki of [0, 1, 2, 4, 8, 16]) {
      for (const cb of [[1, 0, false], [1, 0, true], [2, 8, false], [2, 8, true]]) {
        const bud = { left: 3000000, deadline: 1e15 };
        const idx = KIT.closedTrail(B, Bl, H, A, bud, ki, cb[0], cb[1], tol, si, 2, cb[2], 0);
        if (!idx) continue;
        const rg = KIT.ringOf(idx);
        if (!KIT.enclosesCore(rg)) continue;
        if (badCells(rg).length) continue;
        const st = KIT.ringStats(rg, B);
        const key = rg.map(p => p.c + ',' + p.r).join(' ');
        if (seen.has(key)) continue;
        seen.add(key);
        if (!best || KIT.ringBetter(st, best.st)) best = { st: st, key: key };
      }
    }
  }
}
console.log('穷举(' + seen.size + '个不同合法解) 最优:', JSON.stringify({ cov: best.st.cov, cross: best.st.cross, cells: best.st.cells }),
  '步数=' + best.key.split(' ').length);
console.log('最优走线:', best.key);
