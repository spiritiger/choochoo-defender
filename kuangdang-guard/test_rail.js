// JScript (cscript) harness replicating buildOutline to debug rail path.
// Run: cscript //nologo test_rail.js [all|fixed|stress|real]
var MODE = (WScript.Arguments.length > 0) ? String(WScript.Arguments(0)) : "all";
var W, H, cleared;

var PRUNED = [];
function inb(c, r) { return c >= 0 && c < W && r >= 0 && r < H; }
function interior(c, r) { return inb(c, r) && PRUNED[r][c]; }
function outFlood() {
  // outside = non-PRUNED cells 4-reachable from border
  var out = []; for (var r = 0; r < H; r++) { out.push([]); for (var c = 0; c < W; c++) out[r].push(false); }
  var st = [];
  for (var r = 0; r < H; r++) for (var c = 0; c < W; c++)
    if (!PRUNED[r][c] && (r === 0 || c === 0 || r === H - 1 || c === W - 1)) { out[r][c] = true; st.push([r, c]); }
  var d4 = [[1,0],[-1,0],[0,1],[0,-1]];
  while (st.length) { var p = st.pop(); for (var k = 0; k < 4; k++) { var nr = p[0]+d4[k][0], nc = p[1]+d4[k][1]; if (nr<0||nr>=H||nc<0||nc>=W) continue; if (PRUNED[nr][nc] || out[nr][nc]) continue; out[nr][nc]=true; st.push([nr,nc]); } }
  return out;
}
function external(c, r, out) { return !inb(c, r) || (!cleared[r][c] && out[r][c]); }
function leftCell(px, py, ux, uy) { var lx = uy, ly = -ux; var cx = px + ux*0.5 + lx*0.5; var cy = py + uy*0.5 + ly*0.5; return [Math.floor(cx), Math.floor(cy)]; }
function rightCell(px, py, ux, uy) { var lx = uy, ly = -ux; var cx = px + ux*0.5 - lx*0.5; var cy = py + uy*0.5 - ly*0.5; return [Math.floor(cx), Math.floor(cy)]; }

function buildOutline(out) {
  var sc = -1, sr = -1, rr, cc, done = false;
  for (rr = 0; rr < H && !done; rr++) for (cc = 0; cc < W && !done; cc++) if (interior(cc, rr)) { sc = cc; sr = rr; done = true; }
  if (sc < 0) return [];
  var outList = [];
  var px = sc + 1, py = sr, ux = -1, uy = 0;
  var guard = 0, maxIt = W*H*20 + 200;
  do {
    var lc = leftCell(px, py, ux, uy);
    var last = outList[outList.length - 1];
    if (!last || last[0] !== lc[0] || last[1] !== lc[1]) outList.push([lc[0], lc[1]]);
    var nx = px + ux, ny = py + uy;
    var cands = [[ux,uy],[uy,-ux],[-uy,ux]];   // crossroad: straight first, then left, then right
    var chosen = null;
    for (var i = 0; i < 3 && !chosen; i++) {
      var dux = cands[i][0], duy = cands[i][1];
      var li = leftCell(nx, ny, dux, duy);
      if (!interior(li[0], li[1])) continue;
      var ri = rightCell(nx, ny, dux, duy);
      if (!external(ri[0], ri[1], out)) continue;
      chosen = cands[i];
    }
    if (!chosen) chosen = [ux, uy];
    px = nx; py = ny; ux = chosen[0]; uy = chosen[1];
  } while (!(px === sc + 1 && py === sr && ux === -1 && uy === 0) && guard++ < maxIt);
  return outList;
}

function trimNeedles(cells) {
  var changed = true;
  while (changed && cells.length > 2) {
    changed = false; var m = cells.length; var del = {};
    for (var i = 0; i < m; i++) {
      var prev = cells[(i-1+m)%m], next = cells[(i+1)%m];
      if (prev[0] === next[0] && prev[1] === next[1]) { del[i] = true; changed = true; }
    }
    if (!changed) break;
    var nxt = [];
    for (var j = 0; j < m; j++) if (!del[j]) nxt.push(cells[j]);
    cells = nxt;
  }
  // merge consecutive dup
  if (cells.length > 1) { var mg = [cells[0]]; for (var q = 1; q < cells.length; q++) if (cells[q][0]!==mg[mg.length-1][0]||cells[q][1]!==mg[mg.length-1][1]) mg.push(cells[q]); cells = mg; }
  return cells;
}
function smoothDiag(cells, out) {
  var res = [];
  for (var i = 0; i < cells.length; i++) {
    var A = cells[i], B = cells[(i+1)%cells.length];
    res.push(A);
    if (Math.abs(A[0]-B[0]) === 1 && Math.abs(A[1]-B[1]) === 1) {
      var c1 = [A[0], B[1]], c2 = [B[0], A[1]], br = null;
      if (cleared[c1[1]] && cleared[c1[1]][c1[0]]) br = c1;
      else if (cleared[c2[1]] && cleared[c2[1]][c2[0]]) br = c2;
      if (!br) continue;   // bridge only on a blank cell — never place rail on rubble
      if (br[0]===A[0]&&br[1]===A[1]) continue;
      if (br[0]===B[0]&&br[1]===B[1]) continue;
      res.push(br);
    }
  }
  return res;
}

// Strip any residual diagonal-adjacent rail step so a true 45 deg segment is IMPOSSIBLE.
// At a diagonal pinch, borrow nothing and never place on rubble: first bridge on a blank
// corner if one exists (handled by smoothDiag); else CUT THE NOTCH — remove the offending
// blank cell so the loop routes around, keeping each remaining step orthogonally adjacent.
function adjPos(a, b) { var dx = Math.abs(a[0]-b[0]); var dy = Math.abs(a[1]-b[1]); return dx + dy === 1; }   // strictly orthogonal: diagonal rejoin cascades and eats cells
function delIdx(cells, idx) { var out = []; for (var j = 0; j < cells.length; j++) if (j !== idx) out.push(cells[j]); return out; }
function stripDiag(cells) {
  var guarded = 0;
  while (cells.length > 3 && guarded++ < 2000) {
    var n = cells.length, acted = false;
    for (var i = 0; i < n; i++) {
      var A = cells[i], B = cells[(i + 1) % n];
      if (!(Math.abs(A[0]-B[0]) === 1 && Math.abs(A[1]-B[1]) === 1)) continue;
      var P = cells[(i - 1 + n) % n], C = cells[(i + 2) % n];
      if (adjPos(A, C)) { cells = delIdx(cells, (i + 1) % n); acted = true; break; }   // remove B, reconnect P-A-C
      else if (adjPos(P, B)) { cells = delIdx(cells, i); acted = true; break; }        // remove A, reconnect P-B-C
      else if (adjPos(P, C)) {                                                          // cut the notch: remove A & B, route P-C
        var nxt = []; for (var j = 0; j < n; j++) { if (j === i || j === (i + 1) % n) continue; nxt.push(cells[j]); }
        cells = nxt; acted = true; break;
      }
      // unfixable here: keep scanning later diagonals, never give up on the whole list
    }
    if (!acted) break;
  }
  return cells;
}
function arrStr(a) {
  var s = "[";
  for (var i = 0; i < a.length; i++) { if (i) s += ","; s += "[" + a[i][0] + "," + a[i][1] + "]"; }
  return s + "]";
}
function backForth(cc) {
  var cnt = {}, dup = 0;
  for (var i = 0; i < cc.length; i++) {
    var A = cc[i], B = cc[(i+1)%cc.length];
    var ka = A[0]+","+A[1], kb = B[0]+","+B[1];
    var k = (ka < kb ? ka + "|" + kb : kb + "|" + ka);
    cnt[k] = (cnt[k]||0)+1;
  }
  for (var x in cnt) if (cnt[x] > 1) dup += (cnt[x]-1);
  return dup;
}
function pruneDeadEnds(cl) {
  var H = cl.length, W = cl[0].length;
  var mark = [];
  for (var r = 0; r < H; r++) { mark.push([]); for (var c = 0; c < W; c++) mark[r].push(cl[r][c]); }
  var d4 = [[1,0],[-1,0],[0,1],[0,-1]];
  var changed = true;
  while (changed) {
    changed = false;
    for (var r = 0; r < H; r++) for (var c = 0; c < W; c++) {
      if (!mark[r][c]) continue;
      var deg = 0;
      for (var d = 0; d < 4; d++) { var nr = r + d4[d][0], nc = c + d4[d][1];
        if (nr >= 0 && nr < H && nc >= 0 && nc < W && mark[nr][nc]) deg++; }
      if (deg <= 1) { mark[r][c] = false; changed = true; }
    }
  }
  return mark;
}
// Cut the smaller arc between two traversals of the same undirected edge (a reversal
// pair). This removes 1-wide-stem pendant detours that force outline to re-walk cells.
// The splice seam must stay orthogonally adjacent — if a cut would create a diagonal
// step / jump (renderer pen-break + train diagonal), skip the cut and keep the doubled edge.
function unCyc(cells) {
  function orthAdj2(a, b) { return Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) === 1; }
  function validCycle2(cs) {
    if (cs.length < 4) return false;
    for (var i = 0; i < cs.length; i++) if (!orthAdj2(cs[i], cs[(i+1)%cs.length])) return false;
    return true;
  }
  function dedup2(arr) {
    var out = [];
    for (var q = 0; q < arr.length; q++) {
      var cur = arr[q], prv = arr[(q-1+arr.length)%arr.length];
      if (!(cur[0]===prv[0] && cur[1]===prv[1])) out.push(cur);
    }
    return out;
  }
  var changed = true;
  while (changed && cells.length > 3) {
    changed = false;
    var n = cells.length;
    var first = {};   // undirected-edge key -> first segment index
    outer:
    for (var i = 0; i < n; i++) {
      var A = cells[i], B = cells[(i + 1) % n];
      var ka = A[0] + "," + A[1], kb = B[0] + "," + B[1];
      var key = (ka < kb) ? (ka + "|" + kb) : (kb + "|" + ka);
      var j = first[key];
      if (j === undefined) { first[key] = i; continue; }
      // doubled edge: segments at j and i. arcs: (j+1..i) size=i-j; rest wraps size=n-(i-j).
      var cutA = [], cutB = [];
      for (var t = 0; t <= j; t++) cutA.push(cells[t]);
      for (var t2 = i + 1; t2 < n; t2++) cutA.push(cells[t2]);
      for (var t3 = 0; t3 <= i; t3++) cutB.push(cells[t3]);
      for (var t4 = j + 1; t4 < n; t4++) cutB.push(cells[t4]);
      var mA = dedup2(cutA), mB = dedup2(cutB);
      var pick = null;
      if (i - j <= n - (i - j)) pick = validCycle2(mA) ? mA : (validCycle2(mB) ? mB : null);
      else pick = validCycle2(mB) ? mB : (validCycle2(mA) ? mA : null);
      if (!pick) break outer;   // seam unclean: keep the doubled edge, never splice a diagonal
      changed = true;
      cells = pick;
      break outer;
    }
  }
  return cells;
}

function trace(name, seed) {
  W = seed[0], H = seed[1];
  var rows = seed.slice(2);
  cleared = [];
  for (var r = 0; r < H; r++) { cleared.push([]); for (var c = 0; c < W; c++) cleared[r].push(rows[r].charAt(c) === '#'); }
  PRUNED = pruneDeadEnds(cleared);
  cleared = PRUNED;   // downstream (external / smoothDiag) operate on pruned grid
  var out = outFlood();
  var cells = buildOutline(out);
  // convert {c,r} to [c,r] then post-process
  var cc = [];
  for (var i2 = 0; i2 < cells.length; i2++) cc.push([cells[i2][0], cells[i2][1]]);
  cc = trimNeedles(cc);
  cc = smoothDiag(cc, out);
  cc = trimNeedles(cc);
  // cut 1-wide-stem pendant detours (reversal pairs) — fixes true back-and-forth
  cc = unCyc(cc);
  cc = trimNeedles(cc);
  cc = smoothDiag(cc, out);
  cc = trimNeedles(cc);
  // last-resort: never leave a true 45 deg step
  cc = stripDiag(cc);
  // report
  var errs = { diag: [], back: [] };
  for (var i = 0; i < cc.length; i++) {
    var A = cc[i], B = cc[(i+1)%cc.length];
    if (Math.abs(A[0]-B[0]) === 1 && Math.abs(A[1]-B[1]) === 1) errs.diag.push([A[0],A[1]]);
  }
  WScript.Echo("=== [" + name + "] WxH=" + W + "x" + H + " len=" + cc.length + " diagCorners=" + arrStr(errs.diag) + " backForth=" + backForth(cc));
  WScript.Echo("path=" + arrStr(cc));
}

// test1: simple 3x3 block
if (MODE === "all" || MODE === "fixed") {
trace("test1",[5,5, ".....", ".###.", ".###.", ".###.", "....."]);
// test2: diagonal-cut staircase region
trace("test2",[6,6, "......", ".#....", ".##...", ".###..", ".####.", "......"]);
// test3: a C-shape (deep concavity opening up, blank is interior)
trace("test3",[7,6, "#######", "##....#", "#.....#", "#.....#", "#.....#", "#######"]);
// test4: L-shape (concave corner)
trace("test4",[6,6, "......", "......", "..####", "..####", "..####", "..####"]);
// test5: 1-wide vertical neck tip (dead end) — cause of 往返
trace("test5",[3,4, ".#.", ".#.", ".#.", ".#."]);
// test7: 2-wide dangling arm off a horizontal bar (peninsula -> U-detour)
trace("test7",[7,8, ".......", ".#####.", ".#####.", ".#####.", "..##...", "..##...", "..##...", "......."]);
// test8: two 2-wide arms (screenshot-like winding)
trace("test8",[11,9, "...........", ".########..", ".........#.", ".........#.", ".........#.", ".#####...#.", ".#####...#.", ".....##....", "..........."]);
// test9: donut-ish / concave with hole (must NOT over-shortcut)
trace("test9",[7,6, ".#####.", ".#...#.", ".#...#.", ".#...#.", ".#####.", "......."]);
// test10: 2x2 dead-end lobe hanging off a 2-high block via a 1-wide neck (真 去返)
trace("test10",[11,7, "...........", ".#########.", ".#########.", "........#..", "........##.", "........##.", "..........."]);
// test6: 1-wide neck with econ-like side bump
trace("test6",[5,7, "..#..", "..#..", "..#..", "..#..", "#.#..", "...#.", "....."]);
// test11: dumbbell — two 2x2 blocks linked by a 1-wide neck
trace("test11",[8,5, "........", ".##..##.", ".##..##.", "..#..#..", "........"]);
// test12: teardrop/lobe — 2x2 lobe hanging from a 2-high block by a 1-wide stem (screenshot-like)
trace("test12",[8,7, "........", ".#######", ".####...", "........", ".....###", ".....###", "........"]);
// test13: three pendants around one block (multiple stems)
trace("test13",[9,8, ".........", ".###.###.", ".###...##", "..#....#.", ".........", "...####..", "...####..", "........."]);

// test14: checkerboard diagonal pinch — two blanks touching only at a corner, both L-corners rubble.
// This is the exact "priority deadlock"; the loop must route around (cut the notch), never a 45°, never on rubble.
trace("test14",[6,6, "......", "..#...", "..#...", "...#..", "..#...", "......"]);
}

// ---- stress: random connected regions, verify NO diagonal step & NO back-and-forth in ANY case ----
function runGrid(name, cl) {
  W = cl[0].length; H = cl.length;
  cleared = cl;
  PRUNED = pruneDeadEnds(cleared);
  cleared = PRUNED;
  var out = outFlood();
  var cells = buildOutline(out);
  var cc = []; for (var i0 = 0; i0 < cells.length; i0++) cc.push([cells[i0][0], cells[i0][1]]);
  cc = trimNeedles(cc); cc = smoothDiag(cc, out); cc = trimNeedles(cc);
  cc = unCyc(cc); cc = trimNeedles(cc); cc = smoothDiag(cc, out); cc = trimNeedles(cc);
  cc = stripDiag(cc);
  var diag = [];
  for (var i = 0; i < cc.length; i++) {
    var A = cc[i], B = cc[(i + 1) % cc.length];
    if (Math.abs(A[0]-B[0]) === 1 && Math.abs(A[1]-B[1]) === 1) diag.push(A);
  }
  var bf = backForth(cc);
  return { cc: cc, diag: diag, bf: bf };
}
function gridConnected(cl) {
  var H = cl.length, W = cl[0].length, seen = [];
  for (var r = 0; r < H; r++) { seen.push([]); for (var c = 0; c < W; c++) seen[r].push(false); }
  var st = null;
  outer: for (var rr = 0; rr < H; rr++) for (var cc = 0; cc < W; cc++) if (cl[rr][cc]) { st = [rr, cc]; break outer; }
  if (!st) return true;
  var cnt = 0, q = [st]; seen[st[0]][st[1]] = true;
  while (q.length) { var p = q.pop(); cnt++; for (var d = 0; d < 4; d++) { var nr = p[0] + (d===0?1:d===1?-1:0), nc = p[1] + (d===2?1:d===3?-1:0); if (nr>=0&&nr<H&&nc>=0&&nc<W && !seen[nr][nc] && cl[nr][nc]) { seen[nr][nc] = true; q.push([nr,nc]); } } }
  var total = 0; for (var a = 0; a < H; a++) for (var b = 0; b < W; b++) if (cl[a][b]) total++;
  return cnt === total;
}
function genRegion(W, H, keep) {
  var cl = []; for (var r = 0; r < H; r++) { cl.push([]); for (var c = 0; c < W; c++) cl[r].push(true); }
  var order = []; for (var rr = 0; rr < H; rr++) for (var cc = 0; cc < W; cc++) order.push([cc, rr]);
  for (var i = order.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
  var target = Math.floor(W * H * keep);
  for (var k = 0; k < order.length && target < W * H; k++) {
    // count true
    var tc = 0; for (var a = 0; a < H; a++) for (var b = 0; b < W; b++) if (cl[a][b]) tc++;
    if (tc <= target) break;
    var x = order[k][0], y = order[k][1];
    var was = cl[y][x];
    cl[y][x] = false;
    if (!gridConnected(cl)) { cl[y][x] = was; }
  }
  return cl;
}
var BAD = 0, RUNS = 0;
if (MODE === "all" || MODE === "stress") {
for (var s = 0; s < 4; s++) {
  for (var w = 5; w <= 11; w += 2) for (var h = 5; h <= 11; h += 2) for (var it = 0; it < 3; it++) {
    var keep = 0.35 + (s * 0.15);
    var gl = genRegion(w, h, keep);
    var R = runGrid("s", gl);
    RUNS++;
    if ((R.diag.length || R.bf) && R.cc.length >= 4) {   // len<4 degenerate hair: game falls back to euler
      BAD++;
      WScript.Echo("BAD keep=" + keep + " WxH=" + w + "x" + h + " diag=" + arrStr(R.diag) + " backForth=" + R.bf + " len=" + R.cc.length);
    }
  }
}
WScript.Echo("STRESS total=" + RUNS + " bad=" + BAD);
}

// ---- REAL-MODE: faithful port of state.js recomputeRails + buildOutline on the ACTUAL
//      initial map (45% rubble, 3x3 core cleared, then BFS cleared region) ----
// Detects: (a) any diagonal-consecutive step in the final railPath,
//          (b) any renderer corner-borrow landing on a NON-blank cell.
function realGrid() {
  var W = 11, H = 15;
  var t = []; for (var r = 0; r < H; r++) { t.push([]); for (var c = 0; c < W; c++) t[r].push((Math.random() < 0.45) ? 0 : 1); } // 0=rubble 1=blank
  var cC = Math.floor(W / 2), cR = Math.floor(H / 2);
  for (var dr = -1; dr <= 1; dr++) for (var dc = -1; dc <= 1; dc++) if (cC + dc >= 0 && cC + dc < W && cR + dr >= 0 && cR + dr < H) t[cR + dr][cC + dc] = 1;
  // buildings: town center (core) + 4 initial econ buildings (chebyshev dist >= 3 from core)
  var b = []; for (var r2 = 0; r2 < H; r2++) { b.push([]); for (var c2 = 0; c2 < W; c2++) b[r2][c2] = 0; }
  b[cR][cC] = 1;
  var placed = 0, attempts = 0;
  while (placed < 4 && attempts < 500) {
    attempts++;
    var pc = Math.floor(Math.random() * W), pr = Math.floor(Math.random() * H);
    if (b[pr][pc] || !t[pr][pc]) continue;
    if (Math.max(Math.abs(pc - cC), Math.abs(pr - cR)) < 3) continue;
    b[pr][pc] = 1; placed++;
  }
  return { W: W, H: H, t: t, b: b };
  function R() { return Math.random; }
}
function realPort(g) {
  var W = g.W, H = g.H, t = g.t, bl = g.b;
  // 1) cleared = BFS blanks from core; building cells are obstacles, core cell itself unmarked
  //    (mirror of fixed state.js: rail never passes through buildings)
  var cleared = []; for (var r = 0; r < H; r++) { cleared.push([]); for (var c = 0; c < W; c++) cleared[r].push(false); }
  var cC = Math.floor(W / 2), cR = Math.floor(H / 2);
  var st = [[cC, cR]];
  while (st.length) { var cur = st.pop(); var nb = [[cur[0]-1,cur[1]],[cur[0]+1,cur[1]],[cur[0],cur[1]-1],[cur[0],cur[1]+1]];
    for (var i = 0; i < 4; i++) { var nx = nb[i][0], ny = nb[i][1];
      if (nx < 0 || nx >= W || ny < 0 || ny >= H || cleared[ny][nx]) continue;
      if (!t[ny][nx] || bl[ny][nx]) continue; cleared[ny][nx] = true; st.push([nx, ny]); } }
  var clearedF = cleared;
  // 2) prune
  var pruned = pruneDeadEnds(clearedF);
  // 3) outside
  var outside = []; for (var a = 0; a < H; a++) { outside.push([]); for (var b = 0; b < W; b++) outside[a].push(false); }
  var os = [];
  for (var br = 0; br < H; br++) for (var bc = 0; bc < W; bc++)
    if (!pruned[br][bc] && (br === 0 || bc === 0 || br === H - 1 || bc === W - 1)) { outside[br][bc] = true; os.push([br, bc]); }
  while (os.length) { var op = os.pop(); var n4 = [[op[0]+1,op[1]],[op[0]-1,op[1]],[op[0],op[1]+1],[op[0],op[1]-1]];
    for (var q = 0; q < 4; q++) { var orr = n4[q][0], occ = n4[q][1];
      if (orr < 0 || orr >= H || occ < 0 || occ >= W || pruned[orr][occ] || outside[orr][occ]) continue;
      outside[orr][occ] = true; os.push([orr, occ]); } }
  // 4) outline via harness buildOutline (uses global PRUNED/cleared). Set globals to full-cleared semantics
  //    to mirror state.js passing oriCleared=full for bridging.
  W2 = W; H2 = H; PRUNED = pruned; cleared = clearedF;
  var cells = buildOutlineApply(outside);
  var cc = []; for (var i2 = 0; i2 < cells.length; i2++) cc.push([cells[i2][0], cells[i2][1]]);
  cc = trimNeedles(cc); cc = smoothDiag(cc, outside); cc = trimNeedles(cc);
  cc = unCyc(cc); cc = trimNeedles(cc); cc = smoothDiag(cc, outside); cc = trimNeedles(cc);
  cc = stripDiag(cc);
  // 5) checks
  var diag = [];
  for (var i = 0; i < cc.length; i++) {
    var A = cc[i], B = cc[(i + 1) % cc.length];
    if (Math.abs(A[0]-B[0]) === 1 && Math.abs(A[1]-B[1]) === 1) diag.push(A);
  }
  // each step distance must be exactly 1: diagonal (=2) makes the train run a 45-deg line and the renderer break the pen; >2 is a jump
  var gap = [];
  for (var g1 = 0; g1 < cc.length; g1++) {
    var GA = cc[g1], GB = cc[(g1 + 1) % cc.length];
    var gd = Math.abs(GA[0]-GB[0]) + Math.abs(GA[1]-GB[1]);
    if (gd !== 1) gap.push([GA[0], GA[1], gd]);
  }
  // rail cells must never sit on a building cell (econ building / town center)
  var onB = [];
  for (var g2 = 0; g2 < cc.length; g2++) if (g.b[cc[g2][1]][cc[g2][0]]) onB.push(cc[g2]);
  // renderer corner-borrow sim: for each diagonal pair pick corner like renderer, report if non-blank
  var overRubble = [];
  for (var k = 0; k < cc.length; k++) {
    var a = cc[k], b = cc[(k + 1) % cc.length];
    if (Math.abs(a[0]-b[0]) !== 1 || Math.abs(a[1]-b[1]) !== 1) continue;
    var k1c = b[0], k1r = a[1], k2c = a[0], k2r = b[1];
    var kc = k1c, kr = k1r;
    if (!(t[k1r] && k1r < H && k1c < W && t[k1r][k1c] && !bl[k1r][k1c])) { kc = k2c; kr = k2r; }
    if (!(t[kr] && kr < H && kc < W && t[kr][kc] && !bl[kr][kc])) overRubble.push([[a[0],a[1]],[b[0],b[1]]]);
  }
  return { cc: cc, diag: diag, overRubble: overRubble, gap: gap, onB: onB };
}
var W2, H2;
function buildOutlineApply(out) {
  { var sc = -1, sr = -1, done = false, rr_, cc_;
    for (rr_ = 0; rr_ < H2 && !done; rr_++) for (cc_ = 0; cc_ < W2 && !done; cc_++) if (interior(cc_, rr_)) { sc = cc_; sr = rr_; done = true; }
    if (sc < 0) return [];
    var outL = [];
    var px = sc + 1, py = sr, ux = -1, uy = 0, guard = 0, maxIt = W2*H2*20 + 200;
    do {
      var lc = leftCell(px, py, ux, uy);
      var last = outL[outL.length - 1];
      if (!last || last[0] !== lc[0] || last[1] !== lc[1]) outL.push([lc[0], lc[1]]);
      var nx = px + ux, ny = py + uy;
      var cands = [[ux,uy],[uy,-ux],[-uy,ux]], chosen = null;   // crossroad: straight first
      for (var i = 0; i < 3 && !chosen; i++) { var dux = cands[i][0], duy = cands[i][1];
        var li = leftCell(nx, ny, dux, duy); if (!interior(li[0], li[1])) continue;
        var ri = rightCell(nx, ny, dux, duy); if (!external(ri[0], ri[1], out)) continue;
        chosen = cands[i]; }
      if (!chosen) chosen = [ux, uy];
      px = nx; py = ny; ux = chosen[0]; uy = chosen[1];
    } while (!(px === sc + 1 && py === sr && ux === -1 && uy === 0) && guard++ < maxIt);
    return outL;
  }
}
var REALBAD = 0, ERR = null;
if (MODE === "all" || MODE === "real") {
for (var ri = 0; ri < 150; ri++) {
  try {
    var g = realGrid();
    var R = realPort(g);
    if (R.diag.length || R.overRubble.length || R.gap.length || R.onB.length) {
      REALBAD++;
      if (REALBAD <= 30) WScript.Echo("REAL BAD diag=" + arrStr(R.diag) + " overRubble=" + arrStr(R.overRubble) + " gap=" + arrStr(R.gap) + " onB=" + arrStr(R.onB) + " len=" + R.cc.length);
    }
  } catch (e) { ERR = "it=" + ri + " " + (e && e.message ? e.message : String(e)); if (ERR.indexOf("firsttime") < 0) { WScript.Echo("ERR " + ERR); ERR = "firsttime"; } }
}
WScript.Echo("REAL total=150 bad=" + REALBAD);
}