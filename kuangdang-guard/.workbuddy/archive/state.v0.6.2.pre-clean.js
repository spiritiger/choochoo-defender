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

// ============================================================================
// 铁轨：围绕镇中心、沿「已清空空白区的外轮廓」走一圈的 **单线大环**（v0.6 欧拉版）
// ============================================================================
//
// 【一句话】铁轨就是你把地清成什么样，它沿着这块地的外沿绕一圈。
//
// ---------------------------------------------------------------------------
// v0.6 相对 v0.5 的两处改动（大王补充的规则 3 / 规则 5）
// ---------------------------------------------------------------------------
//
//  A) **允许十字交叉**（规则 5）。v0.5 求的是哈密顿回路（每格只走一次），
//     遇到「1 格台阶的 45° 斜切角」形状时**无解** —— 例如
//         0 1 1
//         1 1 1
//         1 1 0
//     这 7 格里中心格（1,1）是两条腿的唯一共用拐点，必须「竖穿一次 + 横穿一次」，
//     合计度数 4。哈密顿要求每格恰好贡献 2 条边，于是它只能留 2 条腿，另外两条腿
//     所在的格子再也接不回环上 → 判死。
//     现在改成在同样的候选图上求**欧拉回路**：每条边只走一次、每格度数必为偶数
//     （网格里即 2 或 4）、整体连通。于是同一格可以走两次 —— 那就是十字。
//     仍然**优先用「每格一次」的干净方案**，无解才逐步放开十字（见 XMAX）。
//
//  B) **把「削掉 1 格宽脖子」提到第一优先**（规则 3）。v0.5 是"先描圈、描不通才削"，
//     在到处是 1 格宽通道的盘面上会一路削到只剩镇中心 3×3（第 12 轮实测的观感问题）。
//     现在改成：先用图论意义上的"割点"把不可能成环的 1 格宽脖子**提前剪掉**，
//     再在剩下的「处处 ≥2 格宽」的区域上描圈。
//     注意判据用的是**割点**（删掉它 U 就不连通），不是"邻居恰好 2 个"——
//     后者会把「两侧恰好被建筑/废墟堵住的正常格」也误杀。绕一根 1 格宽的**废墟细墙**
//     完全合法（铁轨贴墙两侧走，是两列不同的格子，不算往返），规则里禁止的是
//     已清空区**自己**产生的 1 格宽通道。
//
// ---------------------------------------------------------------------------
// 几何约定（v0.5 起沿用）
// ---------------------------------------------------------------------------
//   0) 可铺轨格：已清空为 blank、且不压任何建筑（含镇中心）。
//   1) 主体 U：从镇中心四邻出发、只走可铺轨格做 4 连通洪水填充。玩家的铁轨只能长在
//      自己清出来的地上，所以 U 就是"你的工地"。
//   2) 削脖子：thinNeck —— 反复删掉 U 里的割点 + 死胡同，每轮只保留含镇中心的连通块。
//      结果是"处处至少 2 格宽、且包含镇中心"的那块地。
//   3) 洞 F：不接触地图边界、且不在 U 里的连通块（含镇中心自己那一格、被围住的废墟）。
//      铁轨绕外圈走，不绕内部这些小洞；洞里的废墟格**永远不会**被压上铁轨。
//   4) 外轮廓 B = ∂U：U 里那些"四邻有一个既不属于 U 也不属于 F"的可铺轨格 —— 环的骨架。
//   5) 补格 H：U 内、不是 B、但挨着 B 的可铺轨格。轮廓在"外扩一格 / 收窄一格"的拐点会
//      错开半格，直接连会断链，需要拿它们垫桥。
//   6) 求解：在 B ∪ H 上找一条**覆盖所有 B 格**的闭合迹（欧拉回路版）：
//        · 每条边最多走一次（= 不允许在同一格往返）
//        · 每格度数必为偶数（网格里即 2 或 4）→ 自动排除死端(1)和丁字(3)
//        · 每格最多访问 2 次（2 次 = 十字）
//        · 优先 0 补格 → 1 补格 → …；同补格数下优先 0 十字 → 放开到 XMAX 个十字
//        · 必须把镇中心围在里面（enclosesCore）
//   7) 兜底（三级）：① 容差阶梯 → ② **精确兜底**（圈空间枚举，从同一张图里挑覆盖最广的
//      偶度环，v0.6.2 新增）→ ③ 反复"剥掉最外一层"重试；
//      最坏保留上一帧的环 / 不设铁轨（不崩、不画脏）。
//
// ---------------------------------------------------------------------------
// 为什么输出永远不会有"斜线"和"重叠"
// ---------------------------------------------------------------------------
//   输出的 GS.railPath 仍然是一个**有序序列**，列车就按它一格一格跑：
//   相邻两格严格正交相邻、首尾相接。v0.6 只是把"每格只出现一次"放宽为
//   "每格最多出现两次"。画出来仍是折线，不可能出现非正交的段。
//   十字格会自然地画出两条交叉的线（它本来就有 4 条边），不需要任何特殊绘制。
//
// ---------------------------------------------------------------------------
// 单调性
// ---------------------------------------------------------------------------
//   外轮廓只随"清得更多"而外扩，所以环只会长大。为防兜底梯子偶发把环算小，
//   这里再加一道保险：新环更短、而上一帧的环仍然合法时，保留上一帧的环（铁轨不缩水）。
//
// ---------------------------------------------------------------------------
// 扩张提示
// ---------------------------------------------------------------------------
//   GS.railGrowHints 已整套移除（原实现对每个候选格各跑一遍完整求解器，是重算里最贵
//   的一块）。出口保留为空数组，UI 侧无需改动。
GS.recomputeRails = function () {
  var COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS, N = COLS * ROWS;
  var DC = [1, -1, 0, 0], DR = [0, 0, 1, -1];
  var CORE_C = GS.core.c, CORE_R = GS.core.r;

  function inB(cc, rr) { return CFG.inBounds(cc, rr); }
  function id(cc, rr) { return rr * COLS + cc; }

  // 十字预算上限：45° 斜切角一般 1 个十字就够，给 6 是留余量
  var XMAX = 6;
  // 补格预算上限：避免在怪图上白烧预算
  var KMAX_CAP = 16;
  // 容差阶梯上限：允许放弃的轮廓格数。
  //   为什么需要容差：外轮廓一出现台阶/凹角就会产生度数为奇数的格，若同时存在割边（独木桥），
  //   「覆盖全部轮廓格」在几何上无解（不是搜索不到，加时间/加预算都救不回来）。
  //   6 是实测拐点：tol<=6 时解出率 83.3%（tol<=0 只有 72.0%），再往上收益递减。
  //   详见 docs/设计规格.md v0.6.1 §2 求解步骤第 7 条 / docs/铁轨bug诊断-001.md §8.6。
  var TOL_MAX = 6;
  // 圈空间维数上限（v0.6.2 精确兜底用）：候选子图数 = 2^rank。
  //   19 → 最多 52.4 万候选，400 局实测最差的一个盘面也只跑 81ms，稳在 400ms 预算内。
  //   超过就跳过（退回旧版剥层），避免极端盘面把预算烧穿。
  var RANK_CAP = 19;

  // ---- 0) 可铺轨位图 ----
  var usable = new Uint8Array(N);
  for (var r0 = 0; r0 < ROWS; r0++) {
    for (var c0 = 0; c0 < COLS; c0++) {
      var cell0 = GS.grid[r0][c0];
      usable[id(c0, r0)] = (cell0.t === 'blank' && !cell0.b) ? 1 : 0;
    }
  }

  // 镇中心 3x3 邻域：削脖子 / 剥层时受保护，免得削到连小环都围不住
  var PROT = new Uint8Array(N);
  for (var pr0 = -1; pr0 <= 1; pr0++) {
    for (var pc0 = -1; pc0 <= 1; pc0++) {
      if (inB(CORE_C + pc0, CORE_R + pr0)) PROT[id(CORE_C + pc0, CORE_R + pr0)] = 1;
    }
  }

  // ======================= 一、区域求法 =======================

  // 1) 主体 U：从镇中心四邻出发的 4 连通洪水
  function floodU(um) {
    var U = new Uint8Array(N), st = [];
    for (var d = 0; d < 4; d++) {
      var nc = CORE_C + DC[d], nr = CORE_R + DR[d];
      if (inB(nc, nr) && um[id(nc, nr)] && !U[id(nc, nr)]) { U[id(nc, nr)] = 1; st.push(id(nc, nr)); }
    }
    while (st.length) {
      var p = st.pop(), pc = p % COLS, pr = (p - pc) / COLS;
      for (var d2 = 0; d2 < 4; d2++) {
        var qc = pc + DC[d2], qr = pr + DR[d2];
        if (!inB(qc, qr)) continue;
        var q = id(qc, qr);
        if (um[q] && !U[q]) { U[q] = 1; st.push(q); }
      }
    }
    return U;
  }

  // 2) 洞 F：所有"不接触地图边界、且不在 U 里"的连通块
  function computeF(U) {
    var F = new Uint8Array(N), seen = new Uint8Array(N);
    for (var s0 = 0; s0 < N; s0++) {
      if (U[s0] || seen[s0]) continue;
      var comp = [], st = [s0], touch = false;
      seen[s0] = 1;
      while (st.length) {
        var t = st.pop(); comp.push(t);
        var tc = t % COLS, tr = (t - tc) / COLS;
        for (var d2 = 0; d2 < 4; d2++) {
          var nc = tc + DC[d2], nr = tr + DR[d2];
          if (!inB(nc, nr)) { touch = true; continue; }
          var q = id(nc, nr);
          if (U[q] || seen[q]) continue;
          seen[q] = 1; st.push(q);
        }
      }
      if (!touch) for (var m = 0; m < comp.length; m++) F[comp[m]] = 1;
    }
    return F;
  }

  // 3) 剪死胡同：**只数 U 邻居**（洞格不铺轨，不能当成"有出路"）
  function pruneU(U) {
    var del = 0;
    for (var s0 = 0; s0 < N; s0++) {
      if (!U[s0]) continue;
      var sc = s0 % COLS, sr = (s0 - sc) / COLS, deg = 0;
      for (var d2 = 0; d2 < 4; d2++) {
        var nc = sc + DC[d2], nr = sr + DR[d2];
        if (!inB(nc, nr)) continue;
        if (U[id(nc, nr)]) deg++;
      }
      if (deg < 2) { U[s0] = 0; del++; }
    }
    return del;
  }

  // 反复「剪死胡同 + 重算洞」直到稳定；返回最终的洞 F
  function normalize(U) {
    var F = computeF(U);
    for (var pass = 0; pass < 30; pass++) {
      var a = pruneU(U);
      var F2 = computeF(U), b = 0, s0;
      for (s0 = 0; s0 < N; s0++) if (F2[s0] !== F[s0]) { F[s0] = F2[s0]; b++; }
      if (!a && !b) break;
    }
    return F;
  }

  // 3b) 只保留"含镇中心"的那块连通区（削脖子后可能有碎片掉队）
  var keepStamp = new Int32Array(N), keepQ = new Int32Array(N), keepCs = 0;
  function keepCoreComponent(U) {
    keepCs++;
    var head = 0, tail = 0, d, q, qc, qr;
    for (d = 0; d < 4; d++) {
      var nc = CORE_C + DC[d], nr = CORE_R + DR[d];
      if (!inB(nc, nr)) continue;
      q = id(nc, nr);
      if (U[q] && keepStamp[q] !== keepCs) { keepStamp[q] = keepCs; keepQ[tail++] = q; }
    }
    while (head < tail) {
      var p = keepQ[head++], pc = p % COLS, pr = (p - pc) / COLS;
      for (var d2 = 0; d2 < 4; d2++) {
        qc = pc + DC[d2]; qr = pr + DR[d2];
        if (!inB(qc, qr)) continue;
        q = id(qc, qr);
        if (U[q] && keepStamp[q] !== keepCs) { keepStamp[q] = keepCs; keepQ[tail++] = q; }
      }
    }
    var removed = 0;
    for (var s0 = 0; s0 < N; s0++) {
      if (U[s0] && keepStamp[s0] !== keepCs) { U[s0] = 0; removed++; }
    }
    return removed;
  }

  // 3c) 找 U 里的**1 格宽脖子**：判据 = 「U 邻居恰好 2 个」**且**「删掉它 U 就不连通」。
  //     两条缺一不可：
  //       · 只看"邻居恰好 2 个" → 会把 2x2 方块里的格误杀（它删掉后剩下 3 格照样连通）；
  //       · 只看"割点"          → 会把「对角交错的 2 格宽形状」误杀，例如大王给的
  //             0 1 1
  //             1 1 1
  //             1 1 0
  //         中心格确实是割点，但它有 4 个 U 邻居，属于"必须走两遍"的十字情形 ——
  //         那是规则 5 的管辖范围，不该被规则 3 削掉。
  var cutStamp = new Int32Array(N), cutQ = new Int32Array(N), cutCs = 0;
  function neckCells(U) {
    var res = [], total = 0, i;
    for (i = 0; i < N; i++) if (U[i]) total++;
    if (total < 4) return res;
    for (var s0 = 0; s0 < N; s0++) {
      if (!U[s0] || PROT[s0]) continue;
      var sc = s0 % COLS, sr = (s0 - sc) / COLS, deg = 0;
      for (var d = 0; d < 4; d++) {
        var nc = sc + DC[d], nr = sr + DR[d];
        if (inB(nc, nr) && U[id(nc, nr)]) deg++;
      }
      if (deg !== 2) continue;                    // 只可能是"一进一出"的单格通道
      var from = -1;
      for (i = 0; i < N; i++) if (U[i] && i !== s0) { from = i; break; }
      if (from < 0) continue;
      cutCs++;
      var head = 0, tail = 0, seen = 0;
      U[s0] = 0;                                  // 试删
      cutStamp[from] = cutCs; cutQ[tail++] = from; seen = 1;
      while (head < tail) {
        var p = cutQ[head++], pc = p % COLS, pr = (p - pc) / COLS;
        for (var d2 = 0; d2 < 4; d2++) {
          var qc = pc + DC[d2], qr = pr + DR[d2];
          if (!inB(qc, qr)) continue;
          var q = id(qc, qr);
          if (!U[q] || cutStamp[q] === cutCs) continue;
          cutStamp[q] = cutCs; cutQ[tail++] = q; seen++;
        }
      }
      U[s0] = 1;                                  // 还原
      if (seen < total - 1) res.push(s0);         // 剩下的没全连通 → 它是脖子
    }
    return res;
  }

  // 3d) 反复削 1 格宽脖子 + 死胡同，直到 U 处处 ≥2 格宽且仍含镇中心
  function thinNeck(U) {
    var totalDel = 0, pass;
    for (pass = 0; pass < 20; pass++) {
      var cut = neckCells(U), any = 0, i;
      for (i = 0; i < cut.length; i++) { U[cut[i]] = 0; any++; }
      var pr = pruneU(U);
      if (!any && !pr) break;
      totalDel += any + pr;
      keepCoreComponent(U);
    }
    return totalDel;
  }

  // 4) 外轮廓 B：U 里"四邻有一个既不属于 U 也不属于 F（或出界）"的可铺轨格
  //    ★ 只收可铺轨格 —— 洞里的废墟格绝不会出现在轮廓里
  function boundaryOf(U, F, um) {
    var B = new Uint8Array(N), Bl = [];
    for (var s0 = 0; s0 < N; s0++) {
      if (!U[s0] || !um[s0]) continue;
      var sc = s0 % COLS, sr = (s0 - sc) / COLS, isB = false;
      for (var d2 = 0; d2 < 4; d2++) {
        var nc = sc + DC[d2], nr = sr + DR[d2];
        if (!inB(nc, nr)) { isB = true; break; }
        var q = id(nc, nr);
        if (!U[q] && !F[q]) { isB = true; break; }
      }
      if (isB) { B[s0] = 1; Bl.push(s0); }
    }
    return { B: B, Bl: Bl };
  }

  // 5a) 候选补格 H：U 内、可铺轨、且挨着轮廓
  function helpersOf(U, B, um) {
    var H = new Uint8Array(N), Hl = [];
    for (var s0 = 0; s0 < N; s0++) {
      if (!U[s0] || B[s0] || !um[s0]) continue;
      var sc = s0 % COLS, sr = (s0 - sc) / COLS, nb = 0;
      for (var d2 = 0; d2 < 4; d2++) {
        var nc = sc + DC[d2], nr = sr + DR[d2];
        if (inB(nc, nr) && B[id(nc, nr)]) nb++;
      }
      if (nb >= 1) { H[s0] = 1; Hl.push(s0); }
    }
    return { H: H, Hl: Hl };
  }

  // ======================= 二、单线闭环求解（欧拉回路） =======================
  //
  //  在 A = B ∪ H 上找一条**闭合迹**：
  //    · 覆盖 B 格（至少访问一次）；**最多允许放弃 tol 个 B 格**（容差）
  //      tol=0 就是旧口径"必须覆盖全部轮廓格"；tol>0 只在几何上无解时才用得上。
  //    · 每条边最多走一次（同一格往返 = 重复同一条边，被禁）
  //    · 每格最多访问 maxVisit 次（1 = 哈密顿；2 = 允许十字）
  //    · 用到的 H 格不超过 kmax 个
  //    · 访问两次的格不超过 xmax 个（= 十字预算）
  //  返回节点索引序列（顺序即行车顺序、首尾相接）或 null。
  //
  //  budget = { left: 剩余搜索节点数, deadline: 最晚时刻(ms) }：
  //    节点数是主约束（保证同一局面结果可复现），时间只是防卡死的安全网。
  function closedTrail(B, Bl, H, A, budget, kmax, maxVisit, xmax, tol) {
    if (Bl.length < 4) return null;

    // 邻居表预先摊平（每个节点最多 4 个邻居），热循环里不再做取模/越界判断
    var anbr = new Int32Array(N * 4), acnt = new Uint8Array(N);
    var s0, d2;
    for (s0 = 0; s0 < N; s0++) {
      if (!A[s0]) continue;
      var sc = s0 % COLS, sr = (s0 - sc) / COLS, k = 0;
      for (d2 = 0; d2 < 4; d2++) {
        var nc = sc + DC[d2], nr = sr + DR[d2];
        if (!inB(nc, nr)) continue;
        var q = id(nc, nr);
        if (A[q]) anbr[s0 * 4 + k++] = q;
      }
      acnt[s0] = k;
    }

    // 给每条无向边分配一个 id（走边时不重复走同一条边）
    var eidOf = new Int32Array(N * 4);
    for (var z = 0; z < N * 4; z++) eidOf[z] = -1;
    var E = 0;
    for (var u0 = 0; u0 < N; u0++) {
      if (!A[u0]) continue;
      for (var t0 = 0; t0 < acnt[u0]; t0++) {
        var v0 = anbr[u0 * 4 + t0];
        if (v0 < u0) continue;                       // 每条边只分配一次
        eidOf[u0 * 4 + t0] = E;
        for (var t1 = 0; t1 < acnt[v0]; t1++) {
          if (anbr[v0 * 4 + t1] === u0) { eidOf[v0 * 4 + t1] = E; break; }
        }
        E++;
      }
    }

    // 起点固定取"最上、最左"的轮廓格 —— 保证同一局面每次算出同一条环（结果可复现）
    var start = Bl[0];
    for (var j = 1; j < Bl.length; j++) {
      var jc = Bl[j] % COLS, jr = (Bl[j] - jc) / COLS;
      var sc0 = start % COLS, sr0 = (start - sc0) / COLS;
      if (jr < sr0 || (jr === sr0 && jc < sc0)) start = Bl[j];
    }

    var usedEdge = new Uint8Array(E);
    var vis = new Uint8Array(N);
    var path = [start];
    vis[start] = 1;
    var needLeft = Bl.length - (B[start] ? 1 : 0);
    var helpersUsed = H[start] ? 1 : 0;   // 起点是补格的话也要算进预算
    var twiceUsed = 0;
    var found = null, left = budget.left || 20000, deadline = budget.deadline || 1e15;

    // 剪枝用的两个复用缓冲：stamp 记录"本轮 BFS 访问过"，bfsQ 是队列
    var stamp = new Int32Array(N), bfsQ = new Int32Array(N), curStamp = 0;

    function dfs(cur) {
      if (found) return;
      if (left-- < 0) return;
      if ((left & 1023) === 0 && Date.now() > deadline) { left = -1; return; }

      var base = cur * 4, cnt = acnt[cur], t2;
      var w, e1, isTwice;

      for (t2 = 0; t2 < cnt; t2++) {
        w = anbr[base + t2];
        e1 = eidOf[base + t2];
        if (e1 < 0 || usedEdge[e1]) continue;

        // 起点只作为"终点"出现一次：还没访问的轮廓格已不超过容差，且已经能接回起点 → 成环
        if (w === start) {
          if (needLeft <= tol && path.length >= 4) { found = path.slice(); return; }
          continue;
        }
        if (vis[w] >= maxVisit) continue;
        if (H[w] && vis[w] === 0 && helpersUsed >= kmax) continue;
        isTwice = (vis[w] >= 1);
        if (isTwice && twiceUsed >= xmax) continue;

        usedEdge[e1] = 1; vis[w]++; path.push(w);
        if (B[w] && vis[w] === 1) needLeft--;
        if (H[w] && vis[w] === 1) helpersUsed++;
        if (isTwice) twiceUsed++;

        // ---- 一次 BFS 同时做三道剪枝 ----
        //   A) 还没访问的轮廓格里，够不着的不能超过 tol 个（超过就说明注定要放弃太多格）
        //   B) 起点必须可达（否则回不去、闭合不了）
        //   C) 每个还没访问的轮廓格，至少要有一条"还能走的边"（否则进去出不来）；
        //      这种"死格"的个数只要没超过容差就允许继续（它们就是被放弃的那几个）
        curStamp++;
        var head = 0, tail = 0, reachB = 0, reachStart = false, ok = true;
        stamp[w] = curStamp; bfsQ[tail++] = w;
        while (head < tail) {
          var u = bfsQ[head++];
          if (u === start) reachStart = true;
          var ub = u * 4, uc = acnt[u];
          if (B[u] && vis[u] === 0) reachB++;
          for (var t4 = 0; t4 < uc; t4++) {
            var e4 = eidOf[ub + t4];
            if (e4 < 0 || usedEdge[e4]) continue;
            var v4 = anbr[ub + t4];
            if (stamp[v4] === curStamp || vis[v4] >= maxVisit) continue;
            stamp[v4] = curStamp; bfsQ[tail++] = v4;
          }
        }
        if (needLeft - reachB > tol || !reachStart) ok = false;

        if (ok) {
          var deadB = 0;                       // 已经"进去出不来"的未访问轮廓格个数
          for (var bi = 0; bi < Bl.length; bi++) {
            var bs = Bl[bi];
            if (vis[bs] > 0) continue;
            var bd0 = bs * 4, bc0 = acnt[bs], have = 0;
            for (var t5 = 0; t5 < bc0; t5++) {
              var e5 = eidOf[bd0 + t5];
              if (e5 >= 0 && !usedEdge[e5] && vis[anbr[bd0 + t5]] < maxVisit) { have = 1; break; }
            }
            if (!have) { deadB++; if (deadB > tol) { ok = false; break; } }
          }
        }

        if (ok) {
          dfs(w);
          if (found) return;                     // 成功就一路退出，不用还原现场
        }

        if (isTwice) twiceUsed--;
        if (H[w] && vis[w] === 1) helpersUsed--;
        if (B[w] && vis[w] === 1) needLeft++;
        vis[w]--;
        path.pop();
        usedEdge[e1] = 0;
      }
    }

    dfs(start);
    // 把剩余预算写回调用方 —— 否则每次调用都从满预算重新开始，
    // 真正起作用的只剩墙钟 deadline，结果会随机器快慢而变（不可复现）。
    budget.left = left;
    return found;
  }

  // 环是否把镇中心围在里面：把环当墙，从地图边界 4 连通洪水，看镇中心格还通不通到外面。
  // （比射线法稳：十字会产生回折多边形，射线法的奇偶规则在自交处容易误判。）
  var encStamp = new Int32Array(N), encQ = new Int32Array(N), encCs = 0;
  function enclosesCore(ring) {
    var wall = new Uint8Array(N), i;
    for (i = 0; i < ring.length; i++) wall[id(ring[i].c, ring[i].r)] = 1;
    encCs++;
    var head = 0, tail = 0, c, r, q;
    for (c = 0; c < COLS; c++) {
      if (!wall[id(c, 0)]) { q = id(c, 0); if (encStamp[q] !== encCs) { encStamp[q] = encCs; encQ[tail++] = q; } }
      if (!wall[id(c, ROWS - 1)]) { q = id(c, ROWS - 1); if (encStamp[q] !== encCs) { encStamp[q] = encCs; encQ[tail++] = q; } }
    }
    for (r = 0; r < ROWS; r++) {
      if (!wall[id(0, r)]) { q = id(0, r); if (encStamp[q] !== encCs) { encStamp[q] = encCs; encQ[tail++] = q; } }
      if (!wall[id(COLS - 1, r)]) { q = id(COLS - 1, r); if (encStamp[q] !== encCs) { encStamp[q] = encCs; encQ[tail++] = q; } }
    }
    while (head < tail) {
      var p = encQ[head++], pc = p % COLS, pr = (p - pc) / COLS;
      for (var d = 0; d < 4; d++) {
        var nc = pc + DC[d], nr = pr + DR[d];
        if (!inB(nc, nr)) continue;
        var q2 = id(nc, nr);
        if (wall[q2] || encStamp[q2] === encCs) continue;
        encStamp[q2] = encCs; encQ[tail++] = q2;
      }
    }
    return encStamp[id(CORE_C, CORE_R)] !== encCs;   // 镇中心没被淹到 → 被围住了
  }

  // 给定区域求环：轮廓 → 补格 → 闭合迹 → 必须围住镇中心
  //   tol = 允许放弃的轮廓格数（0 = 必须覆盖全部轮廓格，与旧版行为一致）
  function solveOnRegion(U, F, um, budget, tol) {
    var bd = boundaryOf(U, F, um), B = bd.B, Bl = bd.Bl;
    if (Bl.length < 4) return null;
    var H = helpersOf(U, B, um).H, A = new Uint8Array(N);
    var s0, hcount = 0;
    for (s0 = 0; s0 < N; s0++) {
      A[s0] = (B[s0] || H[s0]) ? 1 : 0;
      if (H[s0]) hcount++;
    }
    var kmaxCap = hcount < KMAX_CAP ? hcount : KMAX_CAP;

    // 补格数从 0 往上试；同一补格数下先试"每格只走一次"（无十字），
    // 无解才放开十字预算 —— 这就是"最小十字数"的落地方式。
    for (var kmax = 0; kmax <= kmaxCap; kmax++) {
      if (budget.left < 0) return null;
      var idx = closedTrail(B, Bl, H, A, budget, kmax, 1, 0, tol);
      if (!idx) idx = closedTrail(B, Bl, H, A, budget, kmax, 2, XMAX, tol);
      if (!idx) continue;
      var ring = [], k;
      for (k = 0; k < idx.length; k++) {
        var ck = idx[k] % COLS;
        ring.push({ c: ck, r: (idx[k] - ck) / COLS });
      }
      if (!enclosesCore(ring)) continue;
      return ring;
    }
    return null;
  }

  // 7) 最后手段兜底：削掉一层外轮廓（受保护格除外）
  //    ⚠️ v0.6.2 起由「容差阶梯 + 精确兜底」降级为**第三级**兜底。它会让 U 朝镇中心收缩、
  //    把环越缩越小 —— 这正是旧版"缩圈"的来源，所以只在前面两级都失败后才启用（见 solveWithLadder）。
  function peelOnce(U, F, um) {
    var bd = boundaryOf(U, F, um), B = bd.B, del = [];
    for (var s0 = 0; s0 < N; s0++) if (B[s0] && !PROT[s0]) del.push(s0);
    for (var m = 0; m < del.length; m++) U[del[m]] = 0;
    return del.length;
  }

  // 6b) 精确兜底（v0.6.2 新增）：容差阶梯也无解时，**先别急着剥层**，换一套算法把
  //     「同一张图上所有可能的闭合迹」里最优的那条找出来。
  //
  //     ▍为什么会出现 8 格小环（截图 bug 的根因）
  //       closedTrail 是「沿轮廓走一圈、中途不许分叉」的深度优先搜索。外轮廓一旦出现台阶/凹角，
  //       "一圈走完"在图上就不可行 —— DFS 推进 1 个节点就再也走不动，直接判无解。
  //       旧版此时退回「剥掉一层外轮廓」（peelOnce），让区域 U 朝镇中心收缩 28 格，
  //       环于是从应有的几十格塌成紧贴镇中心的 8 格。
  //       而同一张图上其实存在一条覆盖 21/32 轮廓格、全长 29 格的大环，只是它的形状不满足
  //       "单圈 DFS" 的约束，被 closedTrail 漏掉了 —— 这是**算法选错了**，不是真的无解。
  //
  //     ▍解法：圈空间（cycle space）枚举
  //       ① 一条闭合迹 ⟺ 取用的边构成的子图「连通」且「每个顶点度数为偶数」。
  //          网格图上度数只能是 2 或 4，"偶数"是自动满足的 —— 不必查。
  //       ② 所有"偶度子图" = 圈空间里的向量 = 若干**基本圈**做异或（对称差）的任意组合。
  //          基本圈 = 每条"非树边" + 它在生成森林上的唯一回路（生成树派生的圈基）。
  //          空间维数 rank = 边数 − 顶点数 + 连通块数（网格小图实测 ≤ 21，故封顶 RANK_CAP）。
  //       ③ 于是把 2^rank 种子图全枚举一遍，取「覆盖轮廓格最多、且连通、且围住镇中心」的解。
  //          先做一次 O(|轮廓|) 的覆盖率比较，覆盖率不够的直接丢掉 —— 多数候选到不了深检查。
  //       ④ 选中的子图天然偶度 + 连通，用 Hierholzer 走一遍即得有序闭环，可直接喂给渲染。
  //
  //     ▍代价（400 局实测）
  //       平均 3.6ms、最差 81ms；候选数与搜索预算全是定值 → 同一盘面结果可复现。
  //       命中：67 局"阶梯全败"里改善 56 局，覆盖轮廓格总数 323 → 884。
  //       剩下 8 局图上确实不存在任何围住镇中心的偶度环，仍退回第三级剥层。
  //       详见 docs/铁轨bug诊断-001.md §8.7。
  //
  //     bud = { left: 搜索节点预算, deadline: 最晚时刻(ms) }，与阶梯共用同一份预算。
  function bestRingExact(U, F, um, bud) {
    var bd = boundaryOf(U, F, um), B = bd.B, Bl = bd.Bl;
    if (Bl.length < 4) return null;
    var H = helpersOf(U, B, um).H;
    var i, r, c, u, z, k;

    // ---- 建图：顶点 = 轮廓 ∪ 补格；边 = 四邻相邻。邻接表存「顶点 → 边编号列表」----
    var inc = new Array(N), EA = [], EB = [], E = 0;
    for (i = 0; i < N; i++) inc[i] = null;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        u = id(c, r);
        if (!B[u] && !H[u]) continue;
        if (c + 1 < COLS && (B[u + 1] || H[u + 1])) {
          if (!inc[u]) inc[u] = [];
          if (!inc[u + 1]) inc[u + 1] = [];
          inc[u].push(E); inc[u + 1].push(E); EA.push(u); EB.push(u + 1); E++;
        }
        if (r + 1 < ROWS && (B[u + COLS] || H[u + COLS])) {
          if (!inc[u]) inc[u] = [];
          if (!inc[u + COLS]) inc[u + COLS] = [];
          inc[u].push(E); inc[u + COLS].push(E); EA.push(u); EB.push(u + COLS); E++;
        }
      }
    }
    function other(kk, vv) { return EA[kk] === vv ? EB[kk] : EA[kk]; }
    var verts = [];
    for (i = 0; i < N; i++) if (B[i] || H[i]) verts.push(i);
    if (verts.length < 4 || E < 4) return null;

    // ---- 生成森林（BFS）→ 基本圈基：每条非树边 + 它在树上的唯一回路 ----
    var parE = new Int32Array(N).fill(-1), parV = new Int32Array(N).fill(-1);
    var dep = new Int32Array(N).fill(-1), seen = new Uint8Array(N);
    var bfsq = new Int32Array(verts.length), comps = 0;
    for (i = 0; i < verts.length; i++) {
      var root = verts[i];
      if (seen[root]) continue;
      comps++; seen[root] = 1; dep[root] = 0;
      var head = 0, tail = 0; bfsq[tail++] = root;
      while (head < tail) {
        u = bfsq[head++];
        var lu = inc[u];
        if (!lu) continue;
        for (z = 0; z < lu.length; z++) {
          k = lu[z];
          var vv = other(k, u);
          if (!seen[vv]) { seen[vv] = 1; parE[vv] = k; parV[vv] = u; dep[vv] = dep[u] + 1; bfsq[tail++] = vv; }
        }
      }
    }
    var rank = E - verts.length + comps;
    if (rank <= 0 || rank > RANK_CAP) return null;

    var basis = [];
    for (k = 0; k < E; k++) {
      var ka = EA[k], kb = EB[k];
      if (parE[ka] === k || parE[kb] === k) continue;    // 树边不算基本圈
      var cyc = [k], x = ka, y = kb;
      while (dep[x] > dep[y]) { cyc.push(parE[x]); x = parV[x]; }
      while (dep[y] > dep[x]) { cyc.push(parE[y]); y = parV[y]; }
      while (x !== y) { cyc.push(parE[x]); x = parV[x]; cyc.push(parE[y]); y = parV[y]; }
      basis.push(cyc);
    }
    if (basis.length !== rank) return null;              // 理论不会发生，纯保险

    // ---- 穷举 2^rank 种子图，挑最优 ----
    var inE = new Uint8Array(E), deg = new Int32Array(N);
    var wall = new Uint8Array(N), flood = new Int32Array(N).fill(-1);
    var fq = new Int32Array(N), bq = new Int32Array(N), vis = new Int32Array(N).fill(-1);
    var stamp = 0, nB = Bl.length;
    var CORE = id(CORE_C, CORE_R);
    var bestCov = -1, bestEnc = -1, bestEdges = null;
    var left = bud.left, deadline = bud.deadline || 1e15;

    // 深检查：偶度 + 连通性 + 是否围住镇中心
    function fullCheck() {
      var start = -1, h1, t1, list2, z2, k2, v2;
      // 偶度是"能走成闭环"的第一前提。圈空间的异或构造本该天然满足（见下面 rec 的注释），
      // 但这里仍便宜地复核一遍 —— 一旦有奇度点，Hierholzer 只能走出一条"路"而非"环"。
      for (h1 = 0; h1 < verts.length; h1++) if (deg[verts[h1]] % 2 === 1) return -1;
      for (h1 = 0; h1 < verts.length; h1++) if (deg[verts[h1]] > 0) { start = verts[h1]; break; }
      if (start < 0) return -1;
      stamp++;
      h1 = 0; t1 = 0; bq[t1++] = start; vis[start] = stamp;
      while (h1 < t1) {
        u = bq[h1++];
        list2 = inc[u];
        if (!list2) continue;
        for (z2 = 0; z2 < list2.length; z2++) {
          k2 = list2[z2];
          if (!inE[k2]) continue;
          v2 = other(k2, u);
          if (vis[v2] !== stamp) { vis[v2] = stamp; bq[t1++] = v2; }
        }
      }
      for (h1 = 0; h1 < verts.length; h1++) {
        var v0 = verts[h1];
        if (deg[v0] > 0 && vis[v0] !== stamp) return -1;   // 不连通 → 走不成一条迹
      }
      // 墙 = 环经过的格；从地图四边洪水，镇中心还淹得到 → 没围住
      for (h1 = 0; h1 < N; h1++) wall[h1] = 0;
      var cells = 0;
      for (h1 = 0; h1 < verts.length; h1++) {
        var v1 = verts[h1];
        if (deg[v1] > 0) { wall[v1] = 1; cells++; }
      }
      var h2 = 0, t2 = 0, zz;
      for (c = 0; c < COLS; c++) {
        zz = id(c, 0); if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; }
        zz = id(c, ROWS - 1); if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; }
      }
      for (r = 0; r < ROWS; r++) {
        zz = id(0, r); if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; }
        zz = id(COLS - 1, r); if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; }
      }
      while (h2 < t2) {
        var p = fq[h2++], pc = p % COLS, pr = (p - pc) / COLS;
        if (pc > 0) { zz = p - 1; if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; } }
        if (pc < COLS - 1) { zz = p + 1; if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; } }
        if (pr > 0) { zz = p - COLS; if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; } }
        if (pr < ROWS - 1) { zz = p + COLS; if (!wall[zz] && flood[zz] !== stamp) { flood[zz] = stamp; fq[t2++] = zz; } }
      }
      if (flood[CORE] === stamp) return -1;
      return N - t2 - cells;                              // 围住的格子数，用作同覆盖率下的破平
    }

    function visit() {
      var cov = 0, b1;
      for (b1 = 0; b1 < nB; b1++) if (deg[Bl[b1]] > 0) cov++;
      if (cov < bestCov) return;                          // 便宜筛选：覆盖率不够，直接丢
      if (cov === bestCov && bestEdges) return;           // 同覆盖率且已有可行解 → 不必重复深检查
      var enc = fullCheck();
      if (enc < 0) return;
      if (cov > bestCov || (cov === bestCov && enc > bestEnc)) {
        bestCov = cov; bestEnc = enc; bestEdges = inE.slice();
      }
    }

    function rec(ci) {
      if (left-- < 0) return;
      if ((left & 4095) === 0 && Date.now() > deadline) { left = -1; return; }
      if (ci === rank) { visit(); return; }
      rec(ci + 1);
      if (left < 0) return;
      // ⚠️ 圈向量必须做**真异或**，不能"置 1 / 置 0"：基本圈之间会共用生成树的边，
      //    "置 1 → 置 0" 在共用边上会退化成**并集**，枚举出奇度子图、Hierholzer 走不成闭环。
      var cycle = basis[ci], z4;
      for (z4 = 0; z4 < cycle.length; z4++) {
        var ke = cycle[z4];
        if (inE[ke]) { inE[ke] = 0; deg[EA[ke]]--; deg[EB[ke]]--; }
        else { inE[ke] = 1; deg[EA[ke]]++; deg[EB[ke]]++; }
      }
      rec(ci + 1);
      // 异或的逆运算就是它自己 → 再异或一次即还原现场
      for (z4 = 0; z4 < cycle.length; z4++) {
        var kf = cycle[z4];
        if (inE[kf]) { inE[kf] = 0; deg[EA[kf]]--; deg[EB[kf]]--; }
        else { inE[kf] = 1; deg[EA[kf]]++; deg[EB[kf]]++; }
      }
    }
    rec(0);
    bud.left = left;
    if (!bestEdges) return null;

    // ---- Hierholzer：把选中的偶度子图走成有序闭环（与 closedTrail 的输出格式一致：
    //      首格是起点、末格与首格相邻，不重复收尾）----
    var chosen = bestEdges, cdeg = new Int32Array(N), ke2;
    for (ke2 = 0; ke2 < E; ke2++) if (chosen[ke2]) { cdeg[EA[ke2]]++; cdeg[EB[ke2]]++; }
    var st = -1;
    for (i = 0; i < verts.length; i++) if (cdeg[verts[i]] > 0) { st = verts[i]; break; }
    if (st < 0) return null;

    var ptr = new Int32Array(N), stack = [st], walk = [];
    while (stack.length) {
      var v3 = stack[stack.length - 1], lst3 = inc[v3], moved = false;
      while (lst3 && ptr[v3] < lst3.length) {
        var kk = lst3[ptr[v3]++];
        if (chosen[kk]) { chosen[kk] = 0; stack.push(other(kk, v3)); moved = true; break; }
      }
      if (!moved) walk.push(stack.pop());
    }
    walk.reverse();
    if (walk.length < 5 || walk[0] !== walk[walk.length - 1]) return null;
    walk.pop();                                          // 去掉重复的收尾起点

    var ring = [], wc;
    for (i = 0; i < walk.length; i++) {
      wc = walk[i] % COLS;
      ring.push({ c: wc, r: (walk[i] - wc) / COLS });
    }
    return enclosesCore(ring) ? ring : null;             // 最后一道保险
  }

  // 造区域：泛洪 → 削脖子（规则 3）→ 剪死胡同 → 算洞
  function makeRegion(um) {
    var U = floodU(um);
    thinNeck(U);
    keepCoreComponent(U);
    pruneU(U);
    var F = normalize(U);
    return { U: U, F: F };
  }

  // 主求解：三级兜底（预算整条梯子共用，避免极端局面卡顿）
  //   第一级（主）：容差阶梯。tol=0 先试 —— 此时与旧版主解**完全一致**（必须覆盖全部轮廓格）；
  //     无解才逐级放宽：放弃 1 格 → … → TOL_MAX 格。
  //     它只放宽"覆盖要求"、**不改动区域 U**，所以给出的环是"围着清空区外沿的大环"，不会缩水。
  //   第二级（v0.6.2 新增）：精确兜底 bestRingExact。阶梯失败 ≠ 真无解 —— closedTrail 只找得到
  //     "单圈 DFS 能走通"的环，轮廓形状一复杂就整个漏掉。这一级换用圈空间枚举，从同一张图里
  //     挑出**覆盖轮廓最广**的偶度环（实测能把 8 格小环换成覆盖 2/3 轮廓的大环）。
  //     它同样**不改动区域 U**，所以不会缩圈。
  //   第三级（最后手段）：连精确枚举都没找到（图上确实不存在围住镇中心的偶度环），或者圈空间
  //     维数超过 RANK_CAP，才退回旧版"逐个剥掉一层外轮廓"。
  //     剥层会让区域朝镇中心收缩、环变小（正是旧版"缩圈"的来源），所以只在前面都失败后启用 ——
  //     此时不剥也是无解，剥了至少还能给出一条环（不会比 v0.6 更差、也不会让盘面完全没铁轨）。
  function solveWithLadder(um, bud) {
    var reg = makeRegion(um), ring;
    for (var tol = 0; tol <= TOL_MAX; tol++) {
      if (bud.left < 0) return null;
      ring = solveOnRegion(reg.U, reg.F, um, bud, tol);
      if (ring) return ring;
    }
    if (bud.left >= 0) {                                  // 第二级：精确兜底
      ring = bestRingExact(reg.U, reg.F, um, bud);
      if (ring) return ring;
    }
    for (var b = 0; b < 25; b++) {                        // 第三级：剥层
      if (bud.left < 0) return null;
      if (!peelOnce(reg.U, reg.F, um)) break;
      keepCoreComponent(reg.U);
      pruneU(reg.U);
      reg.F = normalize(reg.U);
      ring = solveOnRegion(reg.U, reg.F, um, bud, TOL_MAX);
      if (ring) return ring;
    }
    return null;
  }

  // 完整求解：兜底梯子 + 「不缩水」保险
  function finalRing(um, prevRing, bud) {
    var ring = solveWithLadder(um, bud);
    var prev = null;
    if (prevRing && prevRing.length >= 4) {
      var okPrev = true;
      for (var i0 = 0; i0 < prevRing.length; i0++) {
        var pa = prevRing[i0], pb = prevRing[(i0 + 1) % prevRing.length];
        if (!um[id(pa.c, pa.r)] || Math.abs(pa.c - pb.c) + Math.abs(pa.r - pb.r) !== 1) { okPrev = false; break; }
      }
      if (okPrev) prev = prevRing;
    }
    if (prev && (!ring || ring.length < prev.length)) ring = prev;
    return ring;
  }

  // ======================= 三、求解 + 输出 =======================

  // 预算（v0.6.1 校准）：
  //   · 节点数 150 万 —— 主约束。实测最差盘面只用掉约 56 万，留 2.7 倍余量，正常局面碰不到。
  //   · 400ms 墙钟 —— 防极端局面卡死的安全网。**必须 ≥ 最差盘面的自然耗时（实测 333ms）**，
  //     否则墙钟会先于节点数触发、把该局面误判为无解；而且墙钟随机器快慢而变，结果不可复现。
  //     实测：200ms → 有 2 局被切断（满覆盖 287/400）；400ms → 288/400 且无盘面触顶。
  //   · 平均耗时约 9.4ms（与旧版持平），最差约 333ms。
  var ring = finalRing(usable, GS.railPath, { left: 1500000, deadline: Date.now() + 400 });

  if (!ring || ring.length < 4) {
    GS.railPath = [];
    GS.railSet = {};
    GS.railRect = null;
    GS.railGrowHints = [];
    return;
  }

  GS.railPath = ring;
  GS.railSet = {};
  var minC = ring[0].c, maxC = ring[0].c, minR = ring[0].r, maxR = ring[0].r;
  for (var i1 = 0; i1 < ring.length; i1++) {
    GS.railSet[ring[i1].c + ',' + ring[i1].r] = true;
    if (ring[i1].c < minC) minC = ring[i1].c;
    if (ring[i1].c > maxC) maxC = ring[i1].c;
    if (ring[i1].r < minR) minR = ring[i1].r;
    if (ring[i1].r > maxR) maxR = ring[i1].r;
  }
  GS.railRect = { c0: minC, r0: minR, c1: maxC, r1: maxR };

  // ---- 扩张提示：已按需求整体移除（出口保留为空数组，UI 侧无需改动）----
  GS.railGrowHints = [];
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
