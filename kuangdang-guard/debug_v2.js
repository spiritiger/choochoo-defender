// 临时诊断：半岛盘上手搭 v2 区域 + 逐档调 closedTrail，看往返解能否被搜出
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const sandbox = {}; sandbox.window = sandbox; sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS;
GS.debugNoDeadline = true;

const ROWS = [
  '#########', '#########', '#########', '#########', '#########',
  '###...#..', '###.C....', '###...###',
  '#########', '#########', '#########', '#########', '#########'];

GS.grid = [];
for (let r = 0; r < 13; r++) {
  const row = [];
  for (let c = 0; c < 9; c++) {
    const ch = ROWS[r][c];
    row.push({ t: ch === '#' ? 'rubble' : 'blank', gold: false, harvested: false,
               b: ch === 'C' ? { type: 'core', c: c, r: r } : null });
    if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
  }
  GS.grid.push(row);
}
GS.railPath = [];

const COLS = 9, N = COLS * 13, CORE_C = 4, CORE_R = 6;
const KIT = sandbox.makeRailSolverKit(COLS, 13, CORE_C, CORE_R);
const id = KIT.id, colOf = KIT.colOf, rowOf = KIT.rowOf;
const usable = new Uint8Array(N);
for (let r = 0; r < 13; r++) for (let c = 0; c < 9; c++) {
  const cell = GS.grid[r][c];
  usable[id(c, r)] = (cell.t === 'blank' && !cell.b) ? 1 : 0;
}
const PROT = new Uint8Array(N);
for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++)
  if (CFG.inBounds(CORE_C + dc, CORE_R + dr)) PROT[id(CORE_C + dc, CORE_R + dr)] = 1;
KIT.setPROT(PROT);

// v2 区域：full → thin → 块状半岛加回
const Ufull = KIT.floodU(usable);
const U2 = new Uint8Array(Ufull);
KIT.thinNeck(U2); KIT.keepCoreComponent(U2); KIT.pruneU(U2);
let removed = [];
for (let i = 0; i < N; i++) if (Ufull[i] && !U2[i]) removed.push(i);
console.log('removed by thin:', removed.map(i => colOf(i) + ',' + rowOf(i)).join(' '));
const inC = new Uint8Array(N);
for (const z of removed) inC[z] = 1;
for (const z of removed) U2[z] = 1;   // 手动全加回（诊断用）
const F = KIT.computeF(U2);
const bd = KIT.boundaryOf(U2, F, usable), B = bd.B, Bl = bd.Bl;
console.log('Bl(' + Bl.length + '):', Bl.map(i => colOf(i) + ',' + rowOf(i)).join(' '));
const H = KIT.helpersOf(U2, B, usable);
const A = new Uint8Array(N);
let hn = 0;
for (let i = 0; i < N; i++) { if (B[i] || H[i]) A[i] = 1; if (H[i]) hn++; }
console.log('|H|=' + hn);

function try1(hLimit, maxVisit, xmax, tol, si, mm, flip) {
  const bud = { left: 1500000, deadline: 1e15 };
  const t0 = Date.now();
  const idx = KIT.closedTrail(B, Bl, H, A, bud, hLimit, maxVisit, xmax, tol, si, mm, flip);
  const ms = Date.now() - t0;
  if (!idx) { console.log('h=' + hLimit + ' mv=' + maxVisit + ' x=' + xmax + ' tol=' + tol + ' si=' + si + ' mm=' + mm + ' flip=' + flip + ' → null (' + ms + 'ms, left=' + bud.left + ')'); return null; }
  const ring = KIT.ringOf(idx);
  const st = KIT.ringStats(ring, B);
  const enc = KIT.enclosesCore(ring);
  console.log('h=' + hLimit + ' mv=' + maxVisit + ' x=' + xmax + ' tol=' + tol + ' si=' + si + ' mm=' + mm + ' flip=' + flip +
    ' → ' + ring.length + '步 cov=' + st.cov + '/' + Bl.length + ' cross=' + st.cross + ' cells=' + st.cells +
    ' enc=' + enc + ' (' + ms + 'ms, left=' + bud.left + ')');
  const m = {};
  for (const p of ring) m[p.c + ',' + p.r] = (m[p.c + ',' + p.r] || 0) + 1;
  console.log('   走线: ' + ring.map(p => p.c + ',' + p.r + (m[p.c + ',' + p.r] >= 2 ? '*' : '')).join(' '));
  return ring;
}

console.log('\n-- mm=2 各 xcap 档（tol=0, si=0, hLimit=满） --');
for (const x of [0, 2, 4, 6, 8]) try1(99, 2, x, 0, 0, 2, false);
console.log('\n-- 对照：v1 姿势（mv=1→mv=2/x=6, mm=2, h=0） --');
try1(0, 1, 0, 0, 0, 2, false);
try1(0, 2, 6, 0, 0, 2, false);
console.log('\n-- 放宽容差（找半岛可解的最小 tol） --');
for (const t of [1, 2, 3, 4]) try1(99, 2, 8, t, 0, 2, false);
