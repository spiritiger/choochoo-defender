// 全局游戏状态：地块地形 / 经济建筑 / 动态铁轨环 / 三选一
window.GS = {};

GS.newGame = function () {
  GS.gold = 120;

  GS.buildings = [];

  // grid[r][c] = { t: 'blank'|'rubble', b: building|null }
  GS.grid = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var row = [];
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      row.push({ t: (Math.random() < 0.45 ? 'rubble' : 'blank'), b: null });
    }
    GS.grid.push(row);
  }

  // 中央镇中心，连同其十字邻格一并清空，形成初始连通空白区
  var cC = Math.floor(CFG.MAP_COLS / 2);
  var cR = Math.floor(CFG.MAP_ROWS / 2);
  for (var dr = -1; dr <= 1; dr++) {
    for (var dc = -1; dc <= 1; dc++) {
      if (CFG.inBounds(cC + dc, cR + dr)) GS.grid[cR + dr][cC + dc].t = 'blank';
    }
  }
  var core = { type: 'core', c: cC, r: cR };
  GS.grid[cR][cC].b = core;
  GS.buildings.push(core);
  GS.core = core;

  GS.placeEconInit(4);

  GS.train = { index: 0, frac: 0 };

  GS.selToken = null;      // 当前使用的工具：{kind:'shape',si,cells} | {kind:'econ'}
  GS.offer = [];

  GS.recomputeRails();
  GS.nextOffer(false);
};

// 开局预置若干经济建筑（距镇中心较远，默认隔在废墟后需清理连通）
GS.placeEconInit = function (n) {
  var cC = Math.floor(CFG.MAP_COLS / 2), cR = Math.floor(CFG.MAP_ROWS / 2);
  var placed = 0, attempts = 0;
  while (placed < n && attempts < 500) {
    attempts++;
    var c = Math.floor(Math.random() * CFG.MAP_COLS);
    var r = Math.floor(Math.random() * CFG.MAP_ROWS);
    var cell = GS.grid[r][c];
    if (cell.b || cell.t !== 'blank') continue;
    if (Math.max(Math.abs(c - cC), Math.abs(r - cR)) < 3) continue;
    var b = { type: 'econ', c: c, r: r, rate: CFG.ECON_RATE, flash: 0 };
    cell.b = b;
    GS.buildings.push(b);
    placed++;
  }
};

// ---- 铁轨：围绕「连通镇中心的已清空空白区」外边界自动铺环 ----
GS.recomputeRails = function () {
  var cleared = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) cleared.push(new Array(CFG.MAP_COLS).fill(false));

  // 从镇中心向四周扩散空白（blank）连通区；建筑格视为障碍 —— 铁轨绝不穿过建筑（经济建筑/镇中心），
  // 轮廓会绕着建筑走。核心格本身是镇中心建筑，不标记为 cleared。
  var stack = [{ c: GS.core.c, r: GS.core.r }];
  while (stack.length) {
    var cur = stack.pop();
    var nb = GS.neighbors(cur.c, cur.r);
    for (var i = 0; i < nb.length; i++) {
      var c = nb[i][0], rr = nb[i][1];
      if (!CFG.inBounds(c, rr) || cleared[rr][c]) continue;
      var cell = GS.grid[rr][c];
      if (cell.t !== 'blank' || cell.b) continue;
      cleared[rr][c] = true;
      stack.push({ c: c, r: rr });
    }
  }

  // 先剔除“死端细颈”，再据此重算外部（否则轮廓会在死端/1格宽细颈上描出“去—返”往返或裁出斜线）。
  var pruned = GS.pruneDeadEnds(cleared);

  // “外部”= 从地图边界经 4-连通「非核心(pruned 之外)」可到达的外部。
  // 被清空区围住的废墟(内部洞)不算外部 —— 这样铁轨只描最外圈，不拉内部回环。
  var outside = [];
  for (var or0 = 0; or0 < CFG.MAP_ROWS; or0++) outside.push(new Array(CFG.MAP_COLS).fill(false));
  var ostk = [];
  for (var br = 0; br < CFG.MAP_ROWS; br++) for (var bc = 0; bc < CFG.MAP_COLS; bc++)
    if (!pruned[br][bc] && (br === 0 || bc === 0 || br === CFG.MAP_ROWS - 1 || bc === CFG.MAP_COLS - 1)) {
      outside[br][bc] = true; ostk.push([br, bc]);
    }
  var od4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  while (ostk.length) {
    var oc0 = ostk.pop();
    for (var od = 0; od < 4; od++) {
      var onr = oc0[0] + od4[od][0], onc = oc0[1] + od4[od][1];
      if (!CFG.inBounds(onc, onr) || pruned[onr][onc] || outside[onr][onc]) continue;
      outside[onr][onc] = true; ostk.push([onr, onc]);
    }
  }

  // 按外部边界轮廓描一圈（非欧拉遍历），得到贴最外缘的单条正交闭环：
  // 段段横竖、不长蛇、不穿过内部。
  GS.railPath = GS.buildOutline(pruned, outside, cleared);
  // 硬校验：闭环每步必须正交相邻（列车绝不走斜线、渲染绝不断笔、绝不跳格），
  // 且同一条无向边不得被走两次（否则列车来回往返）。任一不满足则退回正交欧拉回路兜底
  // （可能更长，但构造上每边恰走一次、永不斜线、永不出 ring 空白格）。
  var orthoOk = GS.railPath.length >= 4;
  var edgeSeen = {};
  for (var vi = 0; vi < GS.railPath.length && orthoOk; vi++) {
    var va = GS.railPath[vi], vb = GS.railPath[(vi + 1) % GS.railPath.length];
    if (Math.abs(va.c - vb.c) + Math.abs(va.r - vb.r) !== 1) { orthoOk = false; break; }
    var ka = va.c + ',' + va.r, kb = vb.c + ',' + vb.r;
    var ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
    if (edgeSeen[ek]) orthoOk = false; else edgeSeen[ek] = true;
  }
  if (!orthoOk) GS.railPath = GS.buildRailPath(GS.buildRing(cleared, outside));
  GS.railSet = {};
  GS.railPath.forEach(function (p) { GS.railSet[p.c + ',' + p.r] = true; });
};

// 沿「核心空白区」与外部(废墟/边界)交界的轮廓描一圈，输出段段正交的单条闭环。
// 铁轨落在最外一层核心格中心；内部废墟洞不会产生内圈；diag 用 oriCleared(全体空白)在角位补桥。
GS.buildOutline = function (cleared, outside, oriCleared) {
  var W = CFG.MAP_COLS, H = CFG.MAP_ROWS;
  var inb = function (c, r) { return c >= 0 && c < W && r >= 0 && r < H; };
  var interior = function (c, r) { return inb(c, r) && cleared[r][c]; };
  var external = function (c, r) { return !inb(c, r) || (!cleared[r][c] && outside[r][c]); };

  // 起点：最上、再最左的空白格
  var sc = -1, sr = -1;
  outer:
  for (var rr = 0; rr < H; rr++) {
    for (var cc = 0; cc < W; cc++) {
      if (interior(cc, rr)) { sc = cc; sr = rr; break outer; }
    }
  }
  if (sc < 0) return [];

  // 行列屏幕坐标下，朝 (ux,uy) 前进时的“左”法向。方向已选为使内部始终在行进左侧。
  function leftCell(px, py, ux, uy) {
    var lx = uy, ly = -ux;                 // 左法向
    var cx = px + ux * 0.5 + lx * 0.5;
    var cy = py + uy * 0.5 + ly * 0.5;
    return [Math.floor(cx), Math.floor(cy)];
  }
  function rightCell(px, py, ux, uy) {
    var lx = uy, ly = -ux;
    var cx = px + ux * 0.5 - lx * 0.5;
    var cy = py + uy * 0.5 - ly * 0.5;
    return [Math.floor(cx), Math.floor(cy)];
  }

  var out = [];
  var px = sc + 1, py = sr, ux = -1, uy = 0;   // 从起点格上方贴边，向西走，内部在左
  var guard = 0, maxIt = W * H * 20 + 200;
  do {
    var lc = leftCell(px, py, ux, uy);
    var last = out[out.length - 1];
    if (!last || last[0] !== lc[0] || last[1] !== lc[1]) out.push([lc[0], lc[1]]);
    var nx = px + ux, ny = py + uy;
    // 候选方向：优先直行，其次左转，最后右转（十字路口优先直行，不优先拐弯）。
    // 普通边界每步只有唯一合法方向，此排序只在自接触/交叉点起作用。
    var cands = [[ux, uy], [uy, -ux], [-uy, ux]];
    var chosen = null;
    for (var i = 0; i < cands.length && !chosen; i++) {
      var dux = cands[i][0], duy = cands[i][1];
      var li = leftCell(nx, ny, dux, duy);
      if (!interior(li[0], li[1])) continue;
      var ri = rightCell(nx, ny, dux, duy);
      if (!external(ri[0], ri[1])) continue;
      chosen = cands[i];
    }
    if (!chosen) chosen = [ux, uy];
    px = nx; py = ny; ux = chosen[0]; uy = chosen[1];
  } while (!(px === sc + 1 && py === sr && ux === -1 && uy === 0) && guard++ < maxIt);

  var cells = [];
  for (var k = 0; k < out.length; k++) cells.push({ c: out[k][0], r: out[k][1] });
  // 仅剔除“去—返”针状尖刺（只删来回折返，不留空隙）+ 对角角位补桥（只增不删）。
  // 不删其它格：删格会产生空隙，铁轨连线会跨过空隙里的废墟/反向折返。
  cells = GS.trimOutlineNeedles(cells);
  cells = GS.smoothDiagonals(cells, oriCleared);
  cells = GS.trimOutlineNeedles(cells);
  // 剪除「1格宽颈部叶瓣」造成的同边双向去返（真·往返）——合法单圈不受影响
  cells = GS.cutDoubledEdges(cells);
  cells = GS.trimOutlineNeedles(cells);
  cells = GS.smoothDiagonals(cells, oriCleared);
  cells = GS.trimOutlineNeedles(cells);
  // 最后兜底：任何残留的对角相邻格都删掉其一，保证绝不连出 45° 线段
  cells = GS.stripResidualDiagonals(cells);
  return cells;
};

// 删除残留的“对角相邻”铁轨步 —— 硬性保证绝不出现 45° 段、绝不踩废墟。
// smoothDiagonals 已在有空白角时补桥；这里处理「对角夹道（两补角皆废墟）」的死结：
// 不借废墟角、不跳对角，而是“切掉缺口”——删除导致对角的空白格（单删或双删），
// 让环绕过该死角，保持每步仍正交相邻。故渲染层永远不必借废墟角画 L。
GS.stripResidualDiagonals = function (cells) {
  // 严格正交相邻（dx+dy===1）：若把对角也算“相邻”，删格会级联吞掉整段阶梯、绕出错路
  var adj = function (a, b) {
    var dc = Math.abs(a.c - b.c), dr = Math.abs(a.r - b.r);
    return dc + dr === 1;
  };
  function delIdx(cells, idx) {
    var out = [];
    for (var j = 0; j < cells.length; j++) if (j !== idx) out.push(cells[j]);
    return out;
  }
  cells = cells.slice();
  var guarded = 0;
  while (cells.length > 3 && guarded++ < 2000) {
    var n = cells.length, acted = false;
    for (var i = 0; i < n; i++) {
      var A = cells[i], B = cells[(i + 1) % n];
      if (Math.abs(A.c - B.c) !== 1 || Math.abs(A.r - B.r) !== 1) continue;
      var P = cells[(i - 1 + n) % n], C = cells[(i + 2) % n];
      if (adj(A, C)) { cells = delIdx(cells, (i + 1) % n); acted = true; break; }   // 删 B，重连 P-A-C
      if (adj(P, B)) { cells = delIdx(cells, i); acted = true; break; }             // 删 A，重连 P-B-C
      if (adj(P, C)) {                                                              // 切缺口：删 A 与 B，路由 P-C
        var nxt = [];
        for (var j = 0; j < n; j++) { if (j === i || j === (i + 1) % n) continue; nxt.push(cells[j]); }
        cells = nxt; acted = true; break;
      }
      // 本处对角步无法局部修复：继续扫描后面的对角步，绝不因第一处卡死而放弃全部
    }
    if (!acted) break;
  }
  return cells;
};

// 轮廓在部分拐角（如北→东）会输出“斜对角邻接”的两格，直接连线即成 45° 斜线。
// 这里在任意对角相邻的相邻格之间插入一个正交的桥接格（取已清空的空白格），把斜线补齐成 L 型折线。
GS.smoothDiagonals = function (cells, cleared) {
  if (cells.length < 3) return cells;
  var out = [];
  for (var i = 0; i < cells.length; i++) {
    var A = cells[i], B = cells[(i + 1) % cells.length];
    out.push(A);
    if (Math.abs(A.c - B.c) === 1 && Math.abs(A.r - B.r) === 1) {
      var c1 = { c: A.c, r: B.r };
      var c2 = { c: B.c, r: A.r };
      // 只在确为空白格的角位桥接：铁轨绝不压到废墟/建筑格（宁可留少见对角，也不上废墟）。
      var br = null;
      if (cleared && cleared[c1.r] && cleared[c1.r][c1.c]) br = c1;
      else if (cleared && cleared[c2.r] && cleared[c2.r][c2.c]) br = c2;
      if (!br) continue;   // 只在确为空白格的角位桥接：铁轨绝不压到废墟/建筑格
      // 桥接格必须与 A、B 均正交相邻且不与二者重复
      if (br.c === A.c && br.r === A.r) continue;
      if (br.c === B.c && br.r === B.r) continue;
      out.push(br);
    }
  }
  return out;
};

// 在闭合走线里剔除“针状尖刺”：任何前驱与后继是同一格的单元格即一根针，反复剔除至稳定。
GS.trimOutlineNeedles = function (cells) {
  var n = cells.length;
  if (n < 3) return cells;
  var changed = true;
  while (changed && cells.length > 2) {
    changed = false;
    var m = cells.length;
    var del = {};
    for (var i = 0; i < m; i++) {
      var prev = cells[(i - 1 + m) % m], cur = cells[i], next = cells[(i + 1) % m];
      if (prev.c === next.c && prev.r === next.r) { del[i] = true; changed = true; }
    }
    if (!changed) break;
    var nxt = [];
    for (var j = 0; j < m; j++) if (!del[j]) nxt.push(cells[j]);
    cells = nxt;
    // 合并相邻重复格，避免留下零长针尾
    if (cells.length > 1) {
      var merged = [cells[0]];
      for (var q = 1; q < cells.length; q++) {
        if (cells[q].c !== merged[merged.length - 1].c || cells[q].r !== merged[merged.length - 1].r) merged.push(cells[q]);
      }
      cells = merged;
    }
  }
  return cells;
};

// 剪除「往返」：闭合走线里同一条无向边被走两次（1格宽颈部往复），就在两次经过之间
// 去掉较小那段弧（p轮廓进叶瓣再原路退出的悬挂叶）。合法单圈没有重复边，不会受影响。
// 剪切接缝必须仍“每步正交相邻”：若剪完会拼出对角步/跨格跳变（渲染断笔、列车走斜线的根源），
// 则弃剪保留双向边 —— 双向往返只是难看，对角步才是真 bug。
GS.cutDoubledEdges = function (cells) {
  cells = cells.slice();
  function orthAdj(a, b) {
    return Math.abs(a.c - b.c) + Math.abs(a.r - b.r) === 1;
  }
  function validCycle(cs) {
    if (cs.length < 4) return false;
    for (var i = 0; i < cs.length; i++) {
      if (!orthAdj(cs[i], cs[(i + 1) % cs.length])) return false;
    }
    return true;
  }
  function cyclicDedup(arr) {
    var out = [];
    for (var q = 0; q < arr.length; q++) {
      var cur = arr[q], prv = arr[(q - 1 + arr.length) % arr.length];
      if (!(cur.c === prv.c && cur.r === prv.r)) out.push(cur);
    }
    return out;
  }
  var changed = true;
  while (changed && cells.length > 3) {
    changed = false;
    var n = cells.length;
    var first = {};
    outer:
    for (var i = 0; i < n; i++) {
      var A = cells[i], B = cells[(i + 1) % n];
      var ka = A.c + ',' + A.r, kb = B.c + ',' + B.r;
      var key = (ka < kb) ? (ka + '|' + kb) : (kb + '|' + ka);
      var j = first[key];
      if (j === undefined) { first[key] = i; continue; }
      // 同一条无向边两次经过：弧1 = (j+1..i) 长 i-j；弧2 = 环绕其余部分，长 n-(i-j)。
      var cutA = [];   // 去掉弧1（较小弧）
      for (var t = 0; t <= j; t++) cutA.push(cells[t]);
      for (var t2 = i + 1; t2 < n; t2++) cutA.push(cells[t2]);
      var cutB = [];   // 去掉弧2
      for (var t3 = 0; t3 <= i; t3++) cutB.push(cells[t3]);
      for (var t4 = j + 1; t4 < n; t4++) cutB.push(cells[t4]);
      var mA = cyclicDedup(cutA), mB = cyclicDedup(cutB);
      var pick = null;
      if (i - j <= n - (i - j)) pick = validCycle(mA) ? mA : (validCycle(mB) ? mB : null);
      else pick = validCycle(mB) ? mB : (validCycle(mA) ? mA : null);
      if (!pick) break outer;   // 接缝不干净则不剪，保留双向边
      changed = true;
      cells = pick;
      break outer;
    }
  }
  return cells;
};

// 迭代剔除「死端格」（正交 cleared 邻居 ≤1）与其级联下垂的细颈格。
// 死端/1格宽细颈会让轮廓描成“去—返”针状（往返）与裁角（斜线）——先剔除再描轮廓，路径即干净。
GS.pruneDeadEnds = function (cleared) {
  var H = cleared.length, W = H ? cleared[0].length : 0;
  var mark = [];
  for (var r = 0; r < H; r++) { mark.push([]); for (var c = 0; c < W; c++) mark[r].push(cleared[r][c]); }
  var d4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  var changed = true;
  while (changed) {
    changed = false;
    for (var r = 0; r < H; r++) {
      for (var c = 0; c < W; c++) {
        if (!mark[r][c]) continue;
        var deg = 0;
        for (var d = 0; d < 4; d++) {
          var nr = r + d4[d][0], nc = c + d4[d][1];
          if (nr >= 0 && nr < H && nc >= 0 && nc < W && mark[nr][nc]) deg++;
        }
        if (deg <= 1) { mark[r][c] = false; changed = true; }
      }
    }
  }
  return mark;
};

// 铁轨环候选格（仅供欧拉兜底）：连通空白区内贴「外部(废墟/边界)」的最外圈空白格。
// 剔除建筑格、被废墟从左右/上下正对夹住的「细脖子」格、悬垂末梢格（正交环邻居≤1，
// 否则欧拉回路会钻进末梢再倒出来形成插条蛇形）。
GS.buildRing = function (cleared, outside) {
  var eight = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
  var ring = [];
  for (var rr2 = 0; rr2 < CFG.MAP_ROWS; rr2++) {
    for (var c2 = 0; c2 < CFG.MAP_COLS; c2++) {
      if (!cleared[rr2][c2]) continue;          // 只在连通空白区里找
      if (GS.grid[rr2][c2].b) continue;         // 建筑格不是铁轨
      var edge = false;
      for (var e = 0; e < eight.length && !edge; e++) {
        var ec = c2 + eight[e][0], er = rr2 + eight[e][1];
        if (!CFG.inBounds(ec, er) || (outside[er] && outside[er][ec])) edge = true;
      }
      if (!edge) continue;
      var L = !CFG.inBounds(c2 - 1, rr2) || !cleared[rr2][c2 - 1];
      var R2 = !CFG.inBounds(c2 + 1, rr2) || !cleared[rr2][c2 + 1];
      var U = !CFG.inBounds(c2, rr2 - 1) || !cleared[rr2 - 1][c2];
      var D = !CFG.inBounds(c2, rr2 + 1) || !cleared[rr2 + 1][c2];
      if ((L && R2) || (U && D)) continue;
      ring.push({ c: c2, r: rr2 });
    }
  }
  var dirs4 = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  var keep = {};
  ring.forEach(function (p) { keep[p.c + ',' + p.r] = true; });
  var changed = true;
  while (changed) {
    changed = false;
    for (var li = 0; li < ring.length; li++) {
      var lp = ring[li];
      var lk = lp.c + ',' + lp.r;
      if (!keep[lk]) continue;
      var deg = 0;
      for (var ld = 0; ld < 4; ld++) {
        if (keep[(lp.c + dirs4[ld][0]) + ',' + (lp.r + dirs4[ld][1])]) deg++;
      }
      if (deg <= 1) { delete keep[lk]; changed = true; }
    }
  }
  return ring.filter(function (p) { return keep[p.c + ',' + p.r]; });
};

// 用正交邻接图求欧拉回路：得到一条段段正交的闭合走线；
// “∞”形（两个环共用一个中心格）时中心格会被经过两次。
GS.buildRailPath = function (ring) {
  if (!ring.length) return [];
  var dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  var sKey = function (c, r) { return c + ',' + r; };
  var node = {};
  ring.forEach(function (p) { node[sKey(p.c, p.r)] = p; });

  var adj = {};
  ring.forEach(function (p) { adj[sKey(p.c, p.r)] = []; });
  for (var i = 0; i < ring.length; i++) {
    var p = ring[i];
    var k = sKey(p.c, p.r);
    for (var d = 0; d < 4; d++) {
      var nk = sKey(p.c + dirs[d][0], p.r + dirs[d][1]);
      if (node[nk] && adj[k].indexOf(nk) < 0) adj[k].push(nk);
    }
  }

  // 起点：有边的、最左再最上的铁轨格
  var startKey = null;
  ring.forEach(function (p) {
    var k = sKey(p.c, p.r);
    if (adj[k].length && (!startKey || p.c < node[startKey].c ||
      (p.c === node[startKey].c && p.r < node[startKey].r))) startKey = k;
  });
  if (!startKey) return [];

  function takeEdge(a, b) { var idx = adj[a].indexOf(b); if (idx >= 0) adj[a].splice(idx, 1); }

  var stack = [startKey], circuit = [], guard = 0;
  while (stack.length && guard++ < 200000) {
    var v = stack[stack.length - 1];
    if (adj[v].length) {
      var u = adj[v][adj[v].length - 1];
      takeEdge(v, u);
      takeEdge(u, v);
      stack.push(u);
    } else {
      circuit.push(v);
      stack.pop();
    }
  }
  if (circuit.length < 2) return [];
  circuit.reverse();
  var out = [];
  for (var j = 0; j < circuit.length; j++) {
    var m = node[circuit[j]];
    out.push({ c: m.c, r: m.r });
  }
  return out;
};

// ---- 三选一：清理形状 + 经济建筑 ----
GS.pickShapeCard = function () {
  var i = Math.floor(Math.random() * CFG.SHAPES.length);
  return { kind: 'shape', si: i, cells: CFG.SHAPES[i].cells };
};
// 非形状卡：经济建筑（无需再单独扣钱，只在抽牌出现时统一扣抽费）
GS.pickCard = function () {
  var r = Math.random();
  if (r < 0.7) return GS.pickShapeCard();
  return { kind: 'econ' };   // 列车经过 +金币
};
GS.offerCost = 15;   // 三选一「出现时」扣除的抽费
// pay=true 时在生成界面之际扣除金币；不足则返回 false 不换牌
GS.nextOffer = function (pay) {
  if (pay) {
    if (GS.gold < GS.offerCost) return false;
    GS.gold -= GS.offerCost;
  }
  GS.offer = [GS.pickShapeCard(), GS.pickCard(), GS.pickCard()];
  GS.selToken = null;
  return true;
};

// ---- 查询工具 ----
GS.neighbors = function (c, r) {
  return [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
};
GS.buildingAt = function (c, r) {
  if (!CFG.inBounds(c, r)) return null;
  return GS.grid[r][c].b;
};
GS.onRail = function (c, r) { return !!GS.railSet[c + ',' + r]; };
GS.railNeighbor = function (c, r) {
  var nb = GS.neighbors(c, r);
  for (var i = 0; i < nb.length; i++) {
    if (CFG.inBounds(nb[i][0], nb[i][1]) && GS.onRail(nb[i][0], nb[i][1])) return true;
  }
  return false;
};
GS.railCell = function (i) { return GS.railPath[i % GS.railPath.length]; };