// 全局游戏状态：地块地形 / 经济建筑 / 动态铁轨环 / 三选一
window.GS = {};

GS.newGame = function () {
  GS.gold = 120;

  GS.buildings = [];

  // grid[r][c] = { t: 'blank'|'rubble', gold: 是否金币地块, harvested: 本圈是否已收过, b: building|null }
  GS.grid = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var row = [];
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      // 开局除内区外全部废墟（大王定案 2026-09-21 第二批）：空白只来自
      // 3×5 内区、金币地块（placeGoldInit 会清成 blank）和玩家清理。
      row.push({ t: 'rubble', gold: false, harvested: false, b: null });
    }
    GS.grid.push(row);
  }

  // 开局地形（大王定案 2026-09-21）：
  //   ① 内区 3×5（宽 3、高 5，含镇中心）—— 无障碍，全部清为 blank；
  //   ② 外圈：5×7（宽 5、高 7，同一中心）减去内区 —— 全部障碍物（废墟），
  //      保证开局铁轨只能在内区里、且必须先清理才能长出去；
  //   ③ 其余格也全部是废墟（初始空白只保留内区 + 金币地块）。
  var cC = Math.floor(CFG.MAP_COLS / 2);
  var cR = Math.floor(CFG.MAP_ROWS / 2);
  for (var dr2 = -3; dr2 <= 3; dr2++) {
    for (var dc2 = -2; dc2 <= 2; dc2++) {
      if (!CFG.inBounds(cC + dc2, cR + dr2)) continue;
      var inner = Math.abs(dr2) <= 2 && Math.abs(dc2) <= 1;   // 内区 3×5
      GS.grid[cR + dr2][cC + dc2].t = inner ? 'blank' : 'rubble';
    }
  }
  var core = { type: 'core', c: cC, r: cR };
  GS.grid[cR][cC].b = core;
  GS.buildings.push(core);
  GS.core = core;

  GS.placeGoldInit(CFG.GOLD_TILES);

  GS.train = { index: 0, frac: 0 };

  GS.selToken = null;      // 当前使用的工具：{kind:'shape',si,cells} | {kind:'econ'}
  GS.offer = [];

  GS.recomputeRails();
  GS.nextOffer(false);
};

// 开局撒金币地块（大王定案 2026-09-21，v0.6.12 修订）：不再预置经济建筑，改为 10 个金币地块。
//   · **金币地块视为初始有障碍物**（v0.6.12 大王定案）：格子上就是废墟 + 一枚金币
//     （t 保持 'rubble'，只置 gold 标记）。所以开局**不可铺轨、列车不能通过**，
//     要先用清理形状把它清成空地（金币保留）之后，才照旧可铺轨 / 驶入 +5。
//     外观仍是 v0.6.7 定案的样子（空白底 + 金币图标），见 renderer.js。
//   · 落点限制：只避开 5×7 初始障碍圈（含内区）—— 那一圈必须"全部是障碍物"，
//     且金币太贴镇中心也没有"长出去收钱"的动力。
//   · 分布（v0.6.6）：**最远点采样** —— 每放一个新金币，先随机抽 K 个合法候选点，
//     挑"离已有金币的最小距离"最大的那个落子。纯随机容易扎堆，这样 10 个金币
//     会均匀摊满全场。第一枚没有参照物，纯随机。
//   · 每圈结算见 transport.js：驶入 +CFG.GOLD_RATE，一圈只算一次，跑完一圈重置。
GS.placeGoldInit = function (n) {
  var cC = Math.floor(CFG.MAP_COLS / 2), cR = Math.floor(CFG.MAP_ROWS / 2);
  GS.goldTiles = [];
  var K = 30;                       // 每枚金币的候选点抽样数
  var placed = 0, guard = 0;
  while (placed < n && guard++ < 100) {
    var best = null, bestScore = -1;
    for (var k = 0; k < K; k++) {
      var c = Math.floor(Math.random() * CFG.MAP_COLS);
      var r = Math.floor(Math.random() * CFG.MAP_ROWS);
      if (Math.abs(c - cC) <= 2 && Math.abs(r - cR) <= 3) continue;   // 5×7 初始圈内不放
      var cell = GS.grid[r][c];
      if (cell.gold || cell.b) continue;
      // 候选打分：到所有已放金币的最近距离（平方即可，免开方）
      var dmin = Infinity;
      for (var g = 0; g < GS.goldTiles.length; g++) {
        var dc = c - GS.goldTiles[g].c, dr = r - GS.goldTiles[g].r;
        var d2 = dc * dc + dr * dr;
        if (d2 < dmin) dmin = d2;
      }
      if (dmin > bestScore) { bestScore = dmin; best = { c: c, r: r }; }
    }
    if (!best) continue;            // 这一轮没抽到合法点，换一批重来（guard 兜底）
    var bc = GS.grid[best.r][best.c];
    bc.gold = true;                 // 注意：**不动 t** —— 金币埋在废墟里，需清理才能用
    bc.harvested = false;
    bc.flash = 0;
    GS.goldTiles.push(best);
    placed++;
  }
};

// ============================================================================
// 铁轨：围绕镇中心、沿「已清空空白区的外轮廓」走一圈的 **单线大环**（欧拉回路版）
// ============================================================================
//
// 【一句话】铁轨就是你把地清成什么样，它就沿着这块地的外边界绕一圈。
//
// --- 几何约定 ---------------------------------------------------------------
//   0) 可铺轨格：已清空为 blank、且不压任何建筑（含镇中心）。
//   1) 主体 U：从镇中心四邻出发、只走可铺轨格做 4 连通洪水。玩家的铁轨只能长在自己
//      清出来的地上，所以 U 就是"你的工地"。
//   2) 削脖子 thinNeck：反复删掉 U 里的 1 格宽通道与死胡同，每轮只保留含镇中心的连通块，
//      结果是"处处至少 2 格宽、且包含镇中心"的那块地。
//      1 格宽的判据 = 「U 邻居恰好 2 个」**且**「删掉它 U 就不连通（割点）」—— 两条缺一不可：
//        · 只看"邻居恰好 2 个" → 会把 2x2 方块里的格误杀（删掉后剩下 3 格照样连通）；
//        · 只看"割点"          → 会把 45° 斜切角误杀（那种格有 4 个 U 邻居，该走十字，属规则 5）。
//   3) 洞 F：不接触地图边界、且不在 U 里的连通块（含镇中心自己那一格、被围住的废墟）。
//      铁轨绕外圈走、不绕内部这些小洞，洞里的废墟格**永远不会**被压上铁轨。
//   4) 外轮廓 B = ∂U：U 里那些"四邻有一个既不在 U 也不在 F（或出界）"的可铺轨格 —— 环的骨架。
//   5) 补格 H：U 内、不是 B、但挨着 B 的可铺轨格。轮廓在"外扩一格 / 收窄一格"的拐点会错开
//      半格，直接连会断链，需要拿它们垫桥。
//   6) 求解：在 A = B ∪ H 上找一条**覆盖 B 格、围住镇中心**的闭合走线：
//        · 主求解（①~④）：闭合迹（= 欧拉回路）—— 每条边最多走一次（= 不许在同一格往返）
//        · 每格度数必为偶数（网格里即 2 或 4）→ 自动排除死端(1) 与丁字(3)
//        · 每格最多访问 2 次（2 次 = 十字）；优先"每格一次"的干净解，无解才放开十字
//        · 先试 0 补格 → 1 补格 → …（补格上限逐级放宽，见 closedTrail 的 hLimit）；
//          容差 tol = 允许放弃的轮廓格数（tol=0 = 必须全覆盖）
//   6b) ⑤ 往返支线（v0.8.0，大王拍板）：主解之后追加一趟**每边 ≤2 次**的闭合走线
//        —— 第 2 次必须与第 1 次反向（= 进去绕一圈原路出来，列车全程朝前开、不倒车）。
//        用途：收编"挂在单条桥边上"的半岛组件（闭合迹数学上围不进它们，只能放弃）。
//        只有覆盖数**严格大于**主解才采纳 —— 无支线机会的盘面零行为变更。见 spurSolver。
//   7) 兜底三级（见 solveWithLadder）：① 容差阶梯 → ② 圈空间精确枚举 → ③ 剥层。
//      完整的推导与实测数据在 docs/设计规格.md §2、docs/铁轨bug诊断-001.md §9。
//
// --- ⚠️ 三个量必须分清（v0.6.18 定案，别再混）--------------------------------
//   讨论铁轨"长短"时，这三个数字经常被混着说，但它们互不相等：
//     · **步数** = GS.railPath 的**序列长度**（含重复经过的格），也就是导出文本里
//                  `rail(N)` 的那个 N。玩家说"铁轨多长"通常指这个。
//     · **格数** = **去重后**的格数（同一格被走两次只算一格）。
//     · **十字** = 环上被走 **≥2 次** 的格数（度数 4 的格）；
//                  其余格都是被走 1 次（度数 2）。
//   恒有关系：步数 ≥ 格数；步数 − 格数 = 十字数（每个十字多走一次）。
//   （v0.8.0 往返支线走线同样满足：每格最多 2 次 ⇒ 多走的步数恰 = 十字数，
//     其中"桥头十字"是 T 岔（度 3）——往返支线引进的新形态，渲染见 renderer.js。）
//   例：大王 2026-09-23 那张盘面，修复前是 **24 步 / 22 格 / 2 十字**，
//       修复后是 **22 步 / 22 格 / 0 十字** —— 格数没变、只是消掉了两个十字。
//   写测试/报 bug 时请**指名是哪一个量**，不要只说"环长/长度"（历史上因这个混过一轮）。
//
// --- 为什么输出永远不会有"斜线"和"重叠" -------------------------------------
//   GS.railPath 始终是一个**有序序列**，列车按它一格一格跑：相邻两格严格正交相邻、
//   首尾相接。十字格只是有 4 条边，自然画出两条交叉的线，不需要任何特殊绘制，
//   也不可能出现非正交的段。
//
// --- 单调性 -----------------------------------------------------------------
//   外轮廓只随"清得更多"而外扩，所以环只会长大。finalRing 里再加一道保险：
//   上一帧的环若仍合法、且**对当前轮廓的覆盖格数**比新解多，才沿用上一帧的环
//   （比较口径是覆盖数而非环长 —— v0.6.4 修订，详见 finalRing 注释）。
//
// --- 十字直行优先（v0.6.10）--------------------------------------------------
//   十字格 = 环里被走过 2 次的格（在环上带 4 条边）。它在环上的"进边 → 出边"
//   配对决定列车是**直穿**还是**拐弯**：旧版配对由 Hierholzer 的取边顺序决定，
//   经常是拐弯，玩家看到的就是"火车在十字路口拐弯"。
//   局部改一处配对必然把单环劈成两个环（数学事实：交换两条出边即分成两环），
//   所以这里对所有十字的配对做**组合枚举**（每个十字 3 种配对，XMAX=6 →
//   最多 3^6 = 729 种），在"仍是单环"的方案里挑拐弯数最少的；全直行能成环就
//   第一次命中（绝大多数盘面）。
//   ⚠️ 环长与格子集合完全不变（同一条边集，只改经过十字时的走法），所以覆盖数、
//      围核心、单调性等性质都不受影响。
// --- 扩张提示 ---------------------------------------------------------------
//   GS.railGrowHints 已整套移除（原实现对每个候选格各跑一遍完整求解器，是重算里最贵的一块）。
//   出口保留为空数组，UI 侧无需改动。
// 两格（a、b）是否经由 x「直行通过」：相对 x 对称 ⇒ 共线穿过（= 对边 / 不拐弯）。
//   相邻格只差 1，所以"坐标差之和为 0"就等价于"方向相反"。
//   ⚠️ 这是**唯一**一处直行判据：straightenRing 的配对打分与 GS.countTurns 的拐弯统计都用它。
function isStraightThrough(a, b, x) {
  return (a.c - x.c) + (b.c - x.c) === 0 && (a.r - x.r) + (b.r - x.r) === 0;
}

GS.straightenRing = function (ring) {
  var L = ring.length, i, j, kk;
  if (L < 4) return ring;
  var keyOf = function (p) { return p.c + ',' + p.r; };

  // ① 找十字：恰好出现 2 次的格；出现 ≥3 次（退化盘面）或没有十字 → 原样返回
  var cnt = {}, cellOf = {};
  for (i = 0; i < L; i++) {
    kk = keyOf(ring[i]);
    cnt[kk] = (cnt[kk] || 0) + 1;
    cellOf[kk] = ring[i];
  }
  var crossKeys = [];
  for (kk in cnt) {
    if (cnt[kk] === 1) continue;
    if (cnt[kk] !== 2) return ring;
    crossKeys.push(kk);
  }
  if (!crossKeys.length) return ring;

  // ② 每个十字的 4 个邻居（环上前一格 / 后一格）；邻居有重复说明格子有回折 → 不动
  var crossNb = {};
  for (i = 0; i < L; i++) {
    var kc = keyOf(ring[i]);
    if (cnt[kc] !== 2) continue;
    (crossNb[kc] || (crossNb[kc] = [])).push(ring[(i + 1) % L], ring[(i - 1 + L) % L]);
  }
  for (j = 0; j < crossKeys.length; j++) {
    var n4 = crossNb[crossKeys[j]], seen = {};
    for (i = 0; i < n4.length; i++) seen[keyOf(n4[i])] = 1;
    if (Object.keys(seen).length !== 4) return ring;
  }

  // ③ 有向边索引（简单图欧拉环：每条有向边唯一）
  var edgeOf = {};
  for (i = 0; i < L; i++) {
    var ek = keyOf(ring[i]) + '>' + keyOf(ring[(i + 1) % L]);
    if (edgeOf[ek] !== undefined) return ring;      // 退化（同向边重复）→ 不动
    edgeOf[ek] = i;
  }

  // ④ 度数 2 的格的固定配对：从 A 进来就从 B 出去
  var basePartner = function () {
    var pm = {};
    for (i = 0; i < L; i++) {
      var k0 = keyOf(ring[i]);
      if (cnt[k0] !== 1) continue;
      var ka = keyOf(ring[(i - 1 + L) % L]), kb = keyOf(ring[(i + 1) % L]);
      if (ka === kb) return null;                   // 退化 → 放弃
      if (!pm[k0]) pm[k0] = {};
      pm[k0][ka] = kb; pm[k0][kb] = ka;
    }
    return pm;
  };
  // 沿配对走一圈，返回走过的边数（不等于 L 就说明劈成了多个环）
  var traceLen = function (pm) {
    var cur = 0, steps = 0, visited = {};
    while (true) {
      if (visited[cur]) return -1;                 // 提前回到起点 → 多环
      visited[cur] = 1;
      var u = keyOf(ring[cur]), v = keyOf(ring[(cur + 1) % L]);
      var out = pm[v] && pm[v][u];
      if (out === undefined) return -1;
      var nx = edgeOf[v + '>' + out];
      if (nx === undefined) return -1;
      cur = nx; steps++;
      if (cur === 0) break;
      if (steps > L) return -1;
    }
    return steps;
  };
  // 直行判定 = 顶层 isStraightThrough（只此一处定义，见其注释）

  // ⑤ 3 种配对：[[0,1],[2,3]] / [[0,2],[1,3]] / [[0,3],[1,2]]，每种得分 = 拐弯对数（0 或 2）
  var PAIRS = [[[0, 1], [2, 3]], [[0, 2], [1, 3]], [[0, 3], [1, 2]]];
  var K = crossKeys.length, total = 1;
  for (j = 0; j < K; j++) total *= 3;
  var bestPm = null, bestScore = Infinity;
  for (var combo = 0; combo < total; combo++) {
    var pm0 = basePartner();
    if (!pm0) return ring;
    var sc = 0, t = combo, okCombo = true;
    for (j = 0; j < K && okCombo; j++) {
      var oi = t % 3; t = (t - oi) / 3;
      var ck = crossKeys[j], n4b = crossNb[ck], Xc = cellOf[ck];
      if (!pm0[ck]) pm0[ck] = {};
      for (var q = 0; q < 2; q++) {
        var A = n4b[PAIRS[oi][q][0]], B = n4b[PAIRS[oi][q][1]];
        pm0[ck][keyOf(A)] = keyOf(B);
        pm0[ck][keyOf(B)] = keyOf(A);
        if (!isStraightThrough(A, B, Xc)) sc += 1;  // 这一对是拐弯
      }
      if (sc >= bestScore) okCombo = false;         // 剪枝：已经不如当前最优
    }
    if (!okCombo) continue;
    if (traceLen(pm0) === L) {
      bestScore = sc; bestPm = pm0;
      if (sc === 0) break;                          // 全直行且成单环 → 最优，收工
    }
  }
  if (!bestPm) return ring;                         // 找不到单环方案（极罕见）→ 原样

  // ⑥ 按选定配对重排环序（格子集合、环长不变）
  var seq = [], cur2 = 0, steps2 = 0;
  do {
    seq.push(ring[cur2]);
    var u2 = keyOf(ring[cur2]), v2 = keyOf(ring[(cur2 + 1) % L]);
    cur2 = edgeOf[v2 + '>' + bestPm[v2][u2]];
    steps2++;
  } while (cur2 !== 0 && steps2 <= L);
  return seq.length === L ? seq : ring;
};

// 统计环上"拐弯通过"的次数：只数被走过 ≥2 次的格（十字），
// 每次通行看"进边"与"出边"是否对边（对边 = 直行）。0 = 全程无拐弯。
GS.countTurns = function (ring) {
  if (!ring || ring.length < 4) return 0;
  var L = ring.length, i, cnt = {};
  for (i = 0; i < L; i++) { var k = ring[i].c + ',' + ring[i].r; cnt[k] = (cnt[k] || 0) + 1; }
  var t = 0;
  for (i = 0; i < L; i++) {
    var p = ring[i];
    if (cnt[p.c + ',' + p.r] < 2) continue;
    var a = ring[(i - 1 + L) % L], b = ring[(i + 1) % L];
    if (!isStraightThrough(a, b, p)) t++;
  }
  return t;
};

GS.recomputeRails = function () {
  var COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS, N = COLS * ROWS;
  var DC = [1, -1, 0, 0], DR = [0, 0, 1, -1];
  var CORE_C = GS.core.c, CORE_R = GS.core.r;

  function inB(cc, rr) { return CFG.inBounds(cc, rr); }
  function id(cc, rr) { return rr * COLS + cc; }
  // 节点索引 ↔ 行列（热循环里仍手写展开，省一次函数调用）
  function colOf(i) { return i % COLS; }
  function rowOf(i) { return (i - i % COLS) / COLS; }
  // 节点索引序列 → {c,r} 序列（渲染与合法性检查要的口径）
  function ringOf(list) {
    var out = [], i, c;
    for (i = 0; i < list.length; i++) { c = list[i] % COLS; out.push({ c: c, r: (list[i] - c) / COLS }); }
    return out;
  }

  // ---- 五个上限（数值都有实测依据，别随手调） ----
  var XMAX = 6;        // 十字格数上限：45° 斜切角一般 1 个就够，给 6 是留余量
  var HMAX_CAP = 16;   // 补格数（H）上限：避免在怪图上白烧预算（旧名 KMAX_CAP，v0.6.18 改名对齐语义）
  var TOL_MAX = 6;     // 容差阶梯上限：允许放弃的轮廓格数（6 是实测拐点，见设计规格 §2 步骤 7）
  var RANK_CAP = 19;   // 圈空间维数上限：候选子图数 = 2^rank，19 → 最多 52.4 万；超了就跳过
  var START_TRIES = 9; // 起点试跑上限（v0.6.19）：解档内最多换这么多个起点（详见 solveOnRegion）
                       // ⚠️ 9 是实测拐点：大王 2026-09-23 那张盘 42 个起点里**只有 3 个**
                       //    （si=8/9/10，即 (0,3)(1,3)(2,3)）能出十字 1，前 9 个恰好覆盖；
                       //    再往上加到 12 只多花 200ms、结果不变（见 docs/铁轨bug诊断-001.md）。
  var SPUR_XMAX = 8;   // ⑤ 支线解的十字上限（v0.8.0）：每个往返桥边自带 2 个桥头十字
                       //    （进/出各多走一趟），普通十字盘面再叠 1~2 个 → 8 是宽裕上限。
  var SPUR_BUDGET_MS = 150;  // ⑤ 支线求解器独立墙钟（v0.8.0）。它是增益通道不是保底通道，
                       //    烧穿 = 保留主解，无正确性风险。
                       //    ▍150 vs 250 实测（同 60 张随机中后期盘）：采纳数相同（18/60），
                       //    avg 111→80ms、P90 298→198ms —— 多给的 100ms 一张盘都没多救回来，
                       //    白烧。搜索运行 21/60、均摊 +55ms（对照 25ms）、贴满墙钟 ≈1/3。
                       //    嫌卡先调这里；想多救极端盘再往上调。

  // 独立预算工厂（v0.6.5）：每一级兜底拿自己的新预算，上级烧穿不连坐下级。
  // debugNoDeadline = 测试用确定性开关（关墙钟，见 recomputeRails 末尾注释）。
  function freshBudget(ms) {
    return { left: 1500000, deadline: GS.debugNoDeadline ? 1e15 : Date.now() + ms };
  }

  // 0) 可铺轨位图：已清空为 blank 且不压建筑
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
    var U = new Uint8Array(N), st = [], d, nc, nr, q;
    for (d = 0; d < 4; d++) {
      nc = CORE_C + DC[d]; nr = CORE_R + DR[d];
      if (inB(nc, nr) && um[id(nc, nr)]) { q = id(nc, nr); U[q] = 1; st.push(q); }
    }
    while (st.length) {
      var p = st.pop(), pc = colOf(p), pr = rowOf(p);
      for (d = 0; d < 4; d++) {
        nc = pc + DC[d]; nr = pr + DR[d];
        if (!inB(nc, nr)) continue;
        q = id(nc, nr);
        if (um[q] && !U[q]) { U[q] = 1; st.push(q); }
      }
    }
    return U;
  }

  // 2) 洞 F：所有"不接触地图边界、且不在 U 里"的连通块
  function computeF(U) {
    var F = new Uint8Array(N), seen = new Uint8Array(N), s0, comp, st, touch, t, tc, tr, d, nc, nr, q;
    for (s0 = 0; s0 < N; s0++) {
      if (U[s0] || seen[s0]) continue;
      comp = []; st = [s0]; touch = false; seen[s0] = 1;
      while (st.length) {
        t = st.pop(); comp.push(t); tc = colOf(t); tr = rowOf(t);
        for (d = 0; d < 4; d++) {
          nc = tc + DC[d]; nr = tr + DR[d];
          if (!inB(nc, nr)) { touch = true; continue; }
          q = id(nc, nr);
          if (U[q] || seen[q]) continue;
          seen[q] = 1; st.push(q);
        }
      }
      if (!touch) for (t = 0; t < comp.length; t++) F[comp[t]] = 1;
    }
    return F;
  }

  // 3) 剪死胡同：**只数 U 邻居**（洞格不铺轨，不能当成"有出路"）
  function pruneU(U) {
    var del = 0, s0, sc, sr, d, nc, nr, deg;
    for (s0 = 0; s0 < N; s0++) {
      if (!U[s0]) continue;
      sc = colOf(s0); sr = rowOf(s0); deg = 0;
      for (d = 0; d < 4; d++) {
        nc = sc + DC[d]; nr = sr + DR[d];
        if (inB(nc, nr) && U[id(nc, nr)]) deg++;
      }
      if (deg < 2) { U[s0] = 0; del++; }
    }
    return del;
  }

  // 反复「剪死胡同 + 重算洞」直到稳定；返回最终的洞 F
  function normalize(U) {
    var F = computeF(U);
    for (var pass = 0; pass < 30; pass++) {
      var a = pruneU(U), F2 = computeF(U), b = 0, s0;
      for (s0 = 0; s0 < N; s0++) if (F2[s0] !== F[s0]) { F[s0] = F2[s0]; b++; }
      if (!a && !b) break;
    }
    return F;
  }

  // 3b) 只保留"含镇中心"的那块连通区（削脖子后可能有碎片掉队）
  var keepStamp = new Int32Array(N), keepQ = new Int32Array(N), keepCs = 0;
  function keepCoreComponent(U) {
    keepCs++;
    var head = 0, tail = 0, d, q, p, pc, pr, nc, nr, qc, qr;
    for (d = 0; d < 4; d++) {
      nc = CORE_C + DC[d]; nr = CORE_R + DR[d];
      if (!inB(nc, nr)) continue;
      q = id(nc, nr);
      if (U[q] && keepStamp[q] !== keepCs) { keepStamp[q] = keepCs; keepQ[tail++] = q; }
    }
    while (head < tail) {
      p = keepQ[head++]; pc = colOf(p); pr = rowOf(p);
      for (d = 0; d < 4; d++) {
        qc = pc + DC[d]; qr = pr + DR[d];
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

  // 3c) 找 U 里的 1 格宽脖子（判据见文件头约定 2）
  var cutStamp = new Int32Array(N), cutQ = new Int32Array(N), cutCs = 0;
  function neckCells(U) {
    var res = [], total = 0, i, s0;
    for (i = 0; i < N; i++) if (U[i]) total++;
    if (total < 4) return res;
    for (s0 = 0; s0 < N; s0++) {
      if (!U[s0] || PROT[s0]) continue;
      var sc = colOf(s0), sr = rowOf(s0), deg = 0, d;
      for (d = 0; d < 4; d++) {
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
        var p = cutQ[head++], pc = colOf(p), pr = rowOf(p);
        for (d = 0; d < 4; d++) {
          var qc = pc + DC[d], qr = pr + DR[d];
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

  // 3d) 反复削脖子 + 剪死胡同 + 丢弃掉队碎片，直到 U 处处 ≥2 格宽且仍含镇中心
  function thinNeck(U) {
    var totalDel = 0, pass, i;
    for (pass = 0; pass < 20; pass++) {
      var cut = neckCells(U), any = 0;
      for (i = 0; i < cut.length; i++) { U[cut[i]] = 0; any++; }
      var pr = pruneU(U);
      if (!any && !pr) break;
      totalDel += any + pr;
      keepCoreComponent(U);
    }
    return totalDel;
  }

  // 4) 外轮廓 B 与轮廓清单 Bl（清单按索引递增生成 → 天然"最上最左"在前）
  function boundaryOf(U, F, um) {
    var B = new Uint8Array(N), Bl = [], s0, sc, sr, d, nc, nr, q;
    for (s0 = 0; s0 < N; s0++) {
      if (!U[s0] || !um[s0]) continue;
      sc = colOf(s0); sr = rowOf(s0);
      for (d = 0; d < 4; d++) {
        nc = sc + DC[d]; nr = sr + DR[d];
        if (!inB(nc, nr)) { B[s0] = 1; break; }
        q = id(nc, nr);
        if (!U[q] && !F[q]) { B[s0] = 1; break; }
      }
      if (B[s0]) Bl.push(s0);
    }
    return { B: B, Bl: Bl };
  }

  // 5) 候选补格 H：U 内、可铺轨、且至少一个四邻是轮廓格
  function helpersOf(U, B, um) {
    var H = new Uint8Array(N), s0, sc, sr, d, nc, nr, nb;
    for (s0 = 0; s0 < N; s0++) {
      if (!U[s0] || B[s0] || !um[s0]) continue;
      sc = colOf(s0); sr = rowOf(s0); nb = 0;
      for (d = 0; d < 4; d++) {
        nc = sc + DC[d]; nr = sr + DR[d];
        if (inB(nc, nr) && B[id(nc, nr)]) nb++;
      }
      if (nb >= 1) H[s0] = 1;
    }
    return H;
  }

  // ======================= 二、闭环求解（欧拉回路） =======================
  //
  //  在 A = B ∪ H 上找一条闭合迹。输出 = 节点索引序列（顺序即行车顺序、首尾相接；
  //  末位就是起点，调用方按环处理）或 null。
  //
  //  budget = { left: 剩余搜索节点数, deadline: 最晚时刻(ms) }：
  //    节点数是主约束（保证同一局面结果可复现），时间只是防卡死的安全网。
  //
  //  ▍参数语义（v0.6.18 改名 + 补注释：只改命名与文档，行为逐格不变）
  //    hLimit   —— **本轮允许使用的补格（H）数量上限**。是"上限"不是"下限"：
  //                `helpersUsed >= hLimit` 时不许再踏入新的补格 → 用掉的总数 ≤ hLimit。
  //                配合调用方 `for (ki = 0; ki <= hLimitCap; ki++)` 逐级递升，
  //                实现的正是"补格数从 0 往上试、先试更省补格的走法"（首个命中即返回）。
  //                ⚠️ 别写成 `helpersUsed < hLimit`（下界）：那会让 ki≥1 的档位
  //                永远进不了第一个补格 → 约束整体失效。实测 300 张盘：
  //                上界 平均十字 0.157 / 补格 1.93；下界退化为 0.533 / 2.42。
  //    maxVisit —— 单格最大经过次数（1 = 每格只走一次「无十字」；2 = 允许十字）
  //    xmax     —— **十字格数量上限**（被走 ≥2 次的格数；只有 maxVisit=2 时才有意义）
  //    tol      —— 允许放弃的轮廓格数（容差）
  //    startIdx —— **DFS 起点在 Bl 里的下标**（v0.6.19 新增；不传 = 0 = 旧的"最上最左"）
  //                起点是搜索树的入口，不同入口能撞到的解不同（详见函数内起点注释）。
  //    mm       —— 边最大使用次数（v0.8.0 新增，默认按调用方显式传入）：
  //                1 = 每边最多走一次（旧口径，主求解 ①~④ 全用这个）；
  //                2 = 允许"往返"——同一条边可走第 2 次，但**必须与第 1 次方向相反**
  //                    （dirTo 记录第 1 次的终点，只有站在它上面才能折返回去）。
  //                    这正是"支线进出"的语义：进桥绕一圈原路出桥，列车全程朝前不倒车。
  //                    只有 ⑤ spurSolver 用 2。
  //
  //  ▍本函数产出的三个量（口径务必分清，详见 §13 与 docs/设计规范 §2）
  //    · 步数 = 返回序列的长度（含重复经过的格；对玩家 = 导出里的 `rail(N)`）
  //    · 格数 = **去重后**的格数
  //    · 十字 = 环上被走 **≥2 次**的格数
  function closedTrail(B, Bl, H, A, budget, hLimit, maxVisit, xmax, tol, startIdx, mm) {
    if (Bl.length < 4) return null;

    // 邻居表预先摊平（每个节点最多 4 个邻居），热循环里不再做取模/越界判断
    var anbr = new Int32Array(N * 4), acnt = new Uint8Array(N);
    var s0, d2;
    for (s0 = 0; s0 < N; s0++) {
      if (!A[s0]) continue;
      var sc = colOf(s0), sr = rowOf(s0), k = 0;
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

    // ▍桥边表（v0.8.2，仅 mm=2 计算）：Tarjan 边双连通，一次 DFS 标出所有割边。
    //   动机（10:42 盘）：⑤级若把非桥边走两遍，织出的"辫子解"不带来任何额外覆盖
    //   （非桥边两侧本来就有别的路连通），纯费步数。约束"重数 2 的边必须是桥边"
    //   = 支线只准用来收编"挂单桥的半岛"，正是 v0.8.0 立项的初衷。
    //   mm=1 时 isBridge 为 null，热路径零开销（主解行为不变）。
    //   显式栈版（迭代展开，避免深递归）：pe[v] = 进入 v 用的边 id（不走回头边）。
    var isBridge = null;
    if (mm === 2) {
      isBridge = new Uint8Array(E);                  // 1 = 桥边（割边）
      var disc = new Int32Array(N).fill(-1), low = new Int32Array(N), tstamp = 0;
      // 根节点与 dfs 同式取（⚠️ 不能引用下面的 var start —— 它在这块之后才赋值，
      //   提前引用是 undefined，桥边表会全零：0721 盘半岛失收的实锤教训）。
      var rootN = (startIdx >= 0 && startIdx < Bl.length) ? Bl[startIdx] : Bl[0];
      var ptr2 = new Int32Array(N);
      var st2 = [rootN], pe = new Int32Array(N).fill(-1);
      disc[rootN] = low[rootN] = tstamp++;
      while (st2.length) {
        var vn = st2[st2.length - 1];
        var nb = vn * 4, nc2 = acnt[vn], moved = false;
        while (ptr2[vn] < nc2) {
          var ei2 = eidOf[nb + ptr2[vn]];
          if (ei2 < 0) { ptr2[vn]++; continue; }
          var wn = anbr[nb + ptr2[vn]];
          if (ei2 === pe[vn]) { ptr2[vn]++; continue; }         // 不走回头边（重边另算）
          if (disc[wn] >= 0) {
            low[vn] = Math.min(low[vn], disc[wn]);              // 回边
            ptr2[vn]++;
          } else {
            pe[wn] = ei2; disc[wn] = low[wn] = tstamp++;
            st2.push(wn); moved = true; break;
          }
        }
        if (!moved) {
          st2.pop();
          if (st2.length) {
            var par = st2[st2.length - 1];
            low[par] = Math.min(low[par], low[vn]);
            if (low[vn] > disc[par]) isBridge[pe[vn]] = 1;      // 割边判定
          }
        }
      }
    }

    // ▍起点（v0.6.19 可指定）-----------------------------------------------
    //   旧版写死 `Bl[0]`（最上最左的轮廓格），理由是"结果可复现"。
    //   ⚠️ 但那是个真 bug：DFS 先命中先返回，**起点决定它沿哪条路搜** ——
    //      同一档位下其实存在多个解，撞到哪个全看起点。实测大王 2026-09-23 那张盘：
    //      起点 (0,3)/(1,3)/(2,3) → 2 十字；Bl[0]=(2,0) 等 14 个 → 3 十字；其余 25 个 → 4 十字。
    //      ⇒ 写死 Bl[0] 恰好选中了较差的那一类。
    //   现改为 startIdx 参数（Bl 数组下标）：默认仍是 0（保持旧行为），
    //   调用方 `solveOnRegion` 会逐个起点试、按三级字典序择优（见那里的注释）。
    var start = (startIdx >= 0 && startIdx < Bl.length) ? Bl[startIdx] : Bl[0];

    // 边使用模型（v0.8.0）：旧版 usedEdge 布尔 → usedCnt 计数 + dirTo 方向记录。
    //   mm=1 时判据退化为"用过就不能再走"，与旧版逐分支等价（A/B 已验证 0 差异）；
    //   mm=2 时，用过 1 次的边只有从 dirTo（第 1 次的终点）出发才能走第 2 次 —— 天然
    //   保证"第 2 次必与第 1 次反向"，不可能出现同向重走。
    var usedCnt = new Uint8Array(E);
    var dirTo = new Int32Array(E).fill(-1);    // 第 1 次使用的终点节点；-1 = 尚未使用
    var vis = new Uint8Array(N);
    var path = [start];
    vis[start] = 1;
    var needLeft = Bl.length - 1;               // 还没访问的轮廓格数（起点已访问，必在 B 里）
    var helpersUsed = H[start] ? 1 : 0;         // 起点是补格的话也要算进预算
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

      // ---- 直行优先（v0.6.16）----
      //   候选边里，与"来路方向"同向的那条（能从 cur 直着穿过去）先试，其余后试。
      //   目的：让求解器在同样能成环的前提下，优先产出一条"少拐弯"的环 —— 环长与
      //   覆盖格数完全不变（改的只是试边顺序，不动任何可行性判定）。
      //   来路方向 = cur - path[path.length-2]；直行边 = 与来路同向的那条（两格之差互为反向）。
      //   两层遍历：pass=0 先试直行边，pass=1 再试其余；DFS 先命中先返回。
      //   起点没有"来路"（path 长度 1）→ 不做区分，按原顺序试。
      var fromId = (path.length >= 2) ? path[path.length - 2] : -1;
      var wantIdx = -1;                              // 直行边的 t2 下标（-1 = 无）
      if (fromId >= 0) {
        // 从 from 走到 cur 的方向 = (cur - from)；要继续直行，就需要邻居 = cur + (cur - from)
        var dc = colOf(cur) - colOf(fromId), dr = rowOf(cur) - rowOf(fromId);
        var tc = colOf(cur) + dc, tr = rowOf(cur) + dr;
        if (inB(tc, tr)) {
          var tid = id(tc, tr);
          if (A[tid]) {
            for (t2 = 0; t2 < cnt; t2++) if (anbr[base + t2] === tid) { wantIdx = t2; break; }
          }
        }
      }

      // ---- 候选分组（v0.8.0）----
      //   桶 0 = 直行未用边；桶 1 = 其余未用边；桶 2 = 折返边（用过 1 次、反向退回，mm=2 专属）。
      //   · mm=1 时不存在桶 2，且"无直行边"时所有候选都落桶 0 —— 试边顺序与旧版
      //     两趟循环逐分支等价（A/B 固定种子盘 0 差异），主求解行为不变；
      //   · mm=2 时桶 2 排最后：能用没用过的边走就不走折返 —— 折返是"支线进出"的
      //     专用动作，放最后能显著减少"随手折返"的邋遢解（实测十字数大幅下降）。
      for (var pass = 0; pass < ((mm === 2) ? 3 : 2); pass++) {
      for (t2 = 0; t2 < cnt; t2++) {
        w = anbr[base + t2];
        e1 = eidOf[base + t2];
        if (e1 < 0) continue;
        var uc1 = usedCnt[e1];
        // 边可用性：没用过 → 可走；用过 1 次且 mm=2 且站在第 1 次终点上 → 只能折返（反向）。
        //   v0.8.2 桥边约束：折返（= 该边重数 2）只准发生在**桥边（割边）**上 ——
        //   非桥边两侧本来就连通，双走不产生新覆盖，只会把走线织成辫子（10:42 盘教训）。
        var goBack = (mm === 2 && uc1 === 1 && dirTo[e1] === cur && isBridge[e1] === 1);
        if (uc1 !== 0 && !goBack) continue;
        var grp = goBack ? (wantIdx >= 0 ? 2 : 1)
                         : ((wantIdx >= 0 && t2 === wantIdx) ? 0 : (wantIdx >= 0 ? 1 : 0));
        if (grp !== pass) continue;

        // 起点只作为"终点"出现一次：还没访问的轮廓格已不超过容差，且已经能接回起点 → 成环
        if (w === start) {
          if (needLeft <= tol && path.length >= 4) { found = path.slice(); return; }
          continue;
        }
        if (vis[w] >= maxVisit) continue;
        // 补格预算：hLimit 是本轮"允许用掉的补格数上限"（不是下限！见函数头说明）。
        // helpersUsed 从 0 起、只随踏入新补格 +1 → 达上限就不许再进新补格。
        // vis[w] === 0 表示 w 还没走过 → 这一步会新增一个补格，才需要判预算。
        if (H[w] && vis[w] === 0 && helpersUsed >= hLimit) continue;
        isTwice = (vis[w] >= 1);
        if (isTwice && twiceUsed >= xmax) continue;

        usedCnt[e1]++; if (uc1 === 0) dirTo[e1] = w; vis[w]++; path.push(w);
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
            if (e4 < 0) continue;
            var uc4 = usedCnt[e4];
            // 方向感知（v0.8.0）：没用过的边随便走；用过 1 次的边只有从第 1 次终点
            // 才能折返 —— 站在别的端点方向走不过去，剪枝必须如实反映，否则会高估可达性。
            //   v0.8.2：折返还必须是桥边（与前进判据同口径，否则剪枝高估可达性）。
            if (uc4 !== 0 && !(mm === 2 && uc4 === 1 && dirTo[e4] === u && isBridge[e4] === 1)) continue;
            var v4 = anbr[ub + t4];
            // ⚠️ v4 === start 必须豁免（v0.8.4 修）：起点 vis=1，若按 maxVisit 挡，
            //   maxVisit=1 档的 BFS 永远 reachStart=false → mv=1 调用全灭（探针实锤：
            //   每档只烧 1 个节点）。这个 bug 从 v0.6.x 就在 —— "优先每格一次的干净解"
            //   设计从未生效过，历史上的十字 0 解全是 mv=2 碰巧先命中的（12:44 盘因此
            //   出 50步/2十字，而 48步/0十字 的干净解一直在搜索空间里没人搜）。
            if (stamp[v4] === curStamp || (vis[v4] >= maxVisit && v4 !== start)) continue;
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
              var uc5 = e5 >= 0 ? usedCnt[e5] : 2;
              // （v0.8.4）start 豁免同上：走到起点 = 合法的收环动作，不是死格。
              if (e5 >= 0 && (vis[anbr[bd0 + t5]] < maxVisit || anbr[bd0 + t5] === start) &&
                  (uc5 === 0 || (mm === 2 && uc5 === 1 && dirTo[e5] === bs && isBridge[e5] === 1))) { have = 1; break; }
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
        usedCnt[e1]--; if (usedCnt[e1] === 0) dirTo[e1] = -1;
      }
      }   // ← end of pass loop（直行优先：第一轮直行边，第二轮其余）
    }

    dfs(start);
    // 把剩余预算写回调用方 —— 否则每次调用都从满预算重新开始，
    // 真正起作用的只剩墙钟 deadline，结果会随机器快慢而变（不可复现）。
    budget.left = left;
    return found;
  }

  // 环是否把镇中心围在里面：把环当墙，从地图边界 4 连通洪水，看镇中心还通不通到外面。
  // （比射线法稳：十字会产生回折多边形，射线法的奇偶规则在自交处容易误判。）
  // ▍通用工具（v0.6.21 抽出，原本 coreEnclosed / innerCells 各写了一遍）：
  //   把 wall 当墙，从地图四边 4 连通洪水。
  //   vis/cs 是"代际戳"（stamp）：每次调用 `cs++`，`vis[z] === cs` 即表示"本轮已访问"。
  //   复用同一组 vis/q 缓冲、靠递增的 cs 区分轮次 —— 省掉每次调用新分配。
  //   ⚠️ 调用方须保证 cs 单调递增（Int32 范围内）且 vis 初值为 0。
  function floodFromBorder(wall, vis, cs, q) {
    var head = 0, tail = 0, i, p, pc, pr;
    function put(z) { if (!wall[z] && vis[z] !== cs) { vis[z] = cs; q[tail++] = z; } }
    for (i = 0; i < COLS; i++) { put(id(i, 0)); put(id(i, ROWS - 1)); }
    for (i = 0; i < ROWS; i++) { put(id(0, i)); put(id(COLS - 1, i)); }
    while (head < tail) {
      p = q[head++]; pc = colOf(p); pr = rowOf(p);
      if (pc > 0) put(p - 1);
      if (pc < COLS - 1) put(p + 1);
      if (pr > 0) put(p - COLS);
      if (pr < ROWS - 1) put(p + COLS);
    }
  }

  var encStamp = new Int32Array(N), encQ = new Int32Array(N), encCs = 0;
  function coreEnclosed(wall) {
    encCs++;
    floodFromBorder(wall, encStamp, encCs, encQ);
    return encStamp[id(CORE_C, CORE_R)] !== encCs;   // 镇中心没被淹到 → 被围住了
  }
  function enclosesCore(ring) {
    var wall = new Uint8Array(N), i;
    for (i = 0; i < ring.length; i++) wall[id(ring[i].c, ring[i].r)] = 1;
    return coreEnclosed(wall);
  }

  // 铁轨"圈内"集合（v0.6.13）：把铁轨格当墙，从地图四边 4 向灌水；灌不到的格子就是被环围住的内部。
  //   用途：金币格若"在铁轨上或铁轨内"，就视为已开发区的一部分（清理相接判定用，见 engine.js isRegion）。
  //   返回 { 'c,r': 1 }（只含内部格，不含铁轨格自身——铁轨格由 GS.railSet 表达）。
  var inStamp = new Int32Array(N), inQ = new Int32Array(N), inCs = 0;
  function innerCells(ring) {
    var wall = new Uint8Array(N), i;
    for (i = 0; i < ring.length; i++) wall[id(ring[i].c, ring[i].r)] = 1;
    inCs++;
    floodFromBorder(wall, inStamp, inCs, inQ);
    var set = {};
    for (i = 0; i < N; i++) if (inStamp[i] !== inCs && !wall[i]) set[colOf(i) + ',' + rowOf(i)] = 1;
    return set;
  }

  // ▍环的「三个量」统计 + 三级字典序择优（v0.6.22 抽出为唯一定义）
  //   口径见文件头「三个量」总纲：steps=序列长度、cells=去重格数、cross=被走 ≥2 次的格数。
  //   cov = 环上属于轮廓位图 mark 的**去重**格数（mark 传 null 则不统计）。
  //   同一套判据原先写了两遍（solveOnRegion 的 measure/better、finalRing 的 covOfRing+shapeOf），
  //   合并到此处，避免"改了 A 忘了 B"导致两条择优路径口径分叉。
  function ringStats(rr, mark) {
    var vis = {}, cov = 0, cells = 0, cross = 0, i, pz;
    for (i = 0; i < rr.length; i++) { pz = id(rr[i].c, rr[i].r); vis[pz] = (vis[pz] || 0) + 1; }
    for (pz in vis) { cells++; if (vis[pz] >= 2) cross++; if (mark && mark[pz]) cov++; }
    return { cov: cov, cross: cross, cells: cells };
  }
  // 三级字典序：a 是否严格优于 b —— ① 覆盖轮廓格数越多越好 ② 十字数越少越好 ③ 去重格数越少越好
  //   ⚠️ **补格数不在字典序里**（v0.6.17 定案）：`hLimit` 阶梯只是"少用补格"的启发式手段。
  function ringBetter(a, b) {
    return a.cov > b.cov ||
      (a.cov === b.cov && a.cross < b.cross) ||
      (a.cov === b.cov && a.cross === b.cross && a.cells < b.cells);
  }

  // 6) 给定区域求环：轮廓 → 补格 → 闭合迹 → 必须围住镇中心
  //   tol  = 允许放弃的轮廓格数（0 = 必须覆盖全部轮廓格，与旧版行为一致）
  //   desc = true 时补格上限从大到小试（快速兜底用）：正常求解优先"最少补格"，逐级上升；
  //          但"证明 k-1 不可行"往往比"用 k 求出一个解"贵一个数量级（大图实测 100 万 vs 141 节点），
  //          预算烧穿后的抢救通道不在乎最小性，从大到小首个命中立即返回。
  function solveOnRegion(U, F, um, budget, tol, desc) {
    var bd = boundaryOf(U, F, um), B = bd.B, Bl = bd.Bl;
    if (Bl.length < 4) return null;
    var H = helpersOf(U, B, um), A = new Uint8Array(N);
    var s0, hcount = 0;
    for (s0 = 0; s0 < N; s0++) {
      A[s0] = (B[s0] || H[s0]) ? 1 : 0;
      if (H[s0]) hcount++;
    }
    var hLimitCap = hcount < HMAX_CAP ? hcount : HMAX_CAP;

    // ▍两阶段：先"定档"，再"档内多起点择优"（v0.6.19）
    //   ▍为什么不能"每个起点各跑一遍完整阶梯"（v0.6.19 的第二次翻车，实测数据）
    //     逐起点插桩量出：**单个起点跑完 0..hLimitCap 全部档要 15~47 万节点**
    //       si=0 18.3万 / si=2 36.6万 / si=3 46.7万 / si=8 21.1万（命中档都是 ki=11）
    //     ├ 12 个起点各跑一遍 = 300~560 万节点，**远超 150 万预算**
    //     └ 但其中 90% 是 `ki=0..10` 的"证明无解"白烧（指数阶，见诊断：0→9 档 ×2.5/档）
    //     ⇒ 改成两阶段：
    //         ① **定档**：只跑 `si=0` 一遍递升阶梯，得出"最小有解档 k*"（约 18 万节点）
    //         ② **择优**：在 k* 这一档上跑全部起点（约 60 万节点），按三级字典序取最优
    //       合计约 78 万 < 150 万。丢掉的是"每个起点各自找自己的最小档" —— 但那本来
    //       就不必要：实测 12 个起点的命中档**全是 ki=11**，档位是盘面属性、不是起点属性。
    //
    //   ▍三级字典序的全局择优容器（口径见 closedTrail 头）：
    //     ① 覆盖轮廓格数越多越好 ② 十字数越少越好 ③ 去重格数越少越好
    //     ⚠️ 补格数不在字典序里（v0.6.17 定案）。`ki` 阶梯只是"少用补格"的启发式手段。
    var bestRing = null, bestCover = -1, bestCross = 0, bestCells = 0;
    var si, ki, hLimit, idx, ring, hitKi = -1;

    // 三个量统计 / 三级字典序比较都用顶层共享实现（ringStats / ringBetter），别再各写一份。
    //   本轮择优覆盖轮廓位图 B（口径：环上属于 B 的去重格数）。

    // ① 定档：si=0 走一遍递升阶梯（desc 时反向），首个命中档即 k*
    for (ki = 0; ki <= hLimitCap; ki++) {
      if (budget.left < 0) break;
      hLimit = desc ? hLimitCap - ki : ki;
      idx = closedTrail(B, Bl, H, A, budget, hLimit, 1, 0, tol, 0, 1) ||
            closedTrail(B, Bl, H, A, budget, hLimit, 2, XMAX, tol, 0, 1);
      if (idx) { ring = ringOf(idx); if (enclosesCore(ring)) { hitKi = hLimit; break; } }
    }
    if (hitKi < 0) return null;                 // 连 si=0 都走不出环 → 交给下一级兜底
    // 定档那次的解直接进择优容器（省掉 si=0 在 k* 档的重跑）
    bestRing = ring; var m0 = ringStats(ring, B);
    bestCover = m0.cov; bestCross = m0.cross; bestCells = m0.cells;

    // ② 择优：在 k* 档上跑其余起点（si=0 已在 ① 里跑过）。
    //   ▍早停剪枝（v0.6.19）：**十字数 0 是理论最优**（环上每格恰好走一次），
    //     一旦拿到十字 0 就不必再试剩下的起点 —— `test_rail [4]` 里最大耗时 3519ms
    //     基本都出在"已经拿到十字 0 还在空跑 11 个起点"上。覆盖率是硬目标：
    //     只有在"已经满覆盖"（bestCover 已 == 轮廓总数）时才允许早停，避免丢掉更高覆盖的解。
    var startN = Bl.length < START_TRIES ? Bl.length : START_TRIES;
    for (si = 1; si < startN; si++) {
      if (budget.left < 0) break;
      if (bestCross === 0) break;               // ★ 早停：十字 0 已是最优
      idx = closedTrail(B, Bl, H, A, budget, hitKi, 1, 0, tol, si, 1) ||
            closedTrail(B, Bl, H, A, budget, hitKi, 2, XMAX, tol, si, 1);
      if (!idx) continue;
      ring = ringOf(idx);
      if (!enclosesCore(ring)) continue;
      var m = ringStats(ring, B);
      if (ringBetter(m, { cov: bestCover, cross: bestCross, cells: bestCells })) {
        bestRing = ring; bestCover = m.cov; bestCross = m.cross; bestCells = m.cells;
      }
    }
    return bestRing;
  }

  // 7) 最后手段兜底：削掉一层外轮廓（受保护格除外）
  //    ⚠️ 它会让 U 朝镇中心收缩、把环越缩越小 —— 这正是旧版"缩圈"的来源，
  //    所以只在「容差阶梯 + 精确枚举」都失败后才启用（见 solveWithLadder）。
  function peelOnce(U, F, um) {
    var bd = boundaryOf(U, F, um), B = bd.B, del = [];
    for (var s0 = 0; s0 < N; s0++) if (B[s0] && !PROT[s0]) del.push(s0);
    for (var m = 0; m < del.length; m++) U[del[m]] = 0;
    return del.length;
  }

  // 6b) 精确兜底（v0.6.2 新增）：容差阶梯也无解时**先别急着剥层**，换一套算法把
  //     「同一张图上所有可能的闭合迹」里最优的那条找出来。
  //
  //     ▍为什么会有 8 格小环（2026-09-20 截图 bug 的根因）
  //       closedTrail 是「沿轮廓走一圈、中途不许分叉」的深度优先搜索。外轮廓一旦出现台阶/
  //       凹角，"一圈走完"在这张图上就不可行 —— DFS 推进 1 个节点就再也走不动，直接判无解。
  //       旧版此时退回「剥掉一层外轮廓」，让区域朝镇中心收缩，环于是从应有的几十格塌成
  //       紧贴镇中心的 8 格。但同一张图上其实存在覆盖 2/3 轮廓的大环 —— 是**算法选错了**，
  //       不是真的无解。
  //
  //     ▍解法：圈空间（cycle space）枚举
  //       ① 一条闭合迹 ⟺ 取用的边构成的子图「连通」且「每个顶点度数为偶数」
  //          （网格图上度数只能是 2 或 4，"偶数"由构造自动满足，不必查）。
  //       ② 所有"偶度子图" = 若干**基本圈**做异或（对称差）的任意组合。基本圈 = 每条
  //          "非树边" + 它在生成森林上的唯一回路。维数 rank = 边数 − 顶点数 + 连通块数。
  //       ③ 于是把 2^rank 种子图全枚举一遍，取「覆盖轮廓格最多、且连通、且围住镇中心」的解。
  //          先做一次 O(|轮廓|) 的覆盖率比较，覆盖率不够的直接丢掉 —— 多数候选到不了深检查。
  //       ④ 选中的子图天然偶度 + 连通，用 Hierholzer 走一遍即得有序闭环，可直接喂给渲染。
  //
  //     ▍代价（400 局实测）：平均 3.6ms、最差 81ms，与阶梯共用同一份预算，结果可复现。
  //       命中：67 局"阶梯全败"里改善 56 局，覆盖轮廓格总数 323 → 884；
  //       剩下 8 局图上确实不存在围住镇中心的偶度环，仍退回剥层。
  //       详见 docs/铁轨bug诊断-001.md §9。
  function bestRingExact(U, F, um, bud) {
    var bd = boundaryOf(U, F, um), B = bd.B, Bl = bd.Bl;
    if (Bl.length < 4) return null;
    var H = helpersOf(U, B, um);
    var i, r, c, u, z, k;

    // ---- 建图：顶点 = 轮廓 ∪ 补格；边 = 四邻相邻。邻接表存「顶点 → 边编号列表」----
    //   v0.6.17：本函数现在挂在主求解路径上（双路择优），所以建图阶段也要尊重预算。
    //   建图是 O(N) 的一次扫描，正常情况下零点几毫秒；但如果外层预算已经耗尽（上一路
    //   烧穿了独立预算），就没必要白建一遍图 —— 直接放弃，让调用方保留 DFS 的解。
    var inc = new Array(N), EA = [], EB = [], E = 0;
    var earlyDeadline = bud.deadline || 1e15;
    var earlyLeft = bud.left || 0;
    if (earlyLeft <= 0 || Date.now() > earlyDeadline) return null;
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
    if (rank <= 0 || rank > RANK_CAP) return null;      // 维数过大 → 放弃，退回剥层

    var basis = [], cyc, x, y;
    for (k = 0; k < E; k++) {
      var ka = EA[k], kb = EB[k];
      if (parE[ka] === k || parE[kb] === k) continue;    // 树边不算基本圈
      cyc = [k]; x = ka; y = kb;
      while (dep[x] > dep[y]) { cyc.push(parE[x]); x = parV[x]; }
      while (dep[y] > dep[x]) { cyc.push(parE[y]); y = parV[y]; }
      while (x !== y) { cyc.push(parE[x]); x = parV[x]; cyc.push(parE[y]); y = parV[y]; }
      basis.push(cyc);
    }
    if (basis.length !== rank) return null;              // 理论不会发生，纯保险

    // ---- 穷举 2^rank 种子图，挑最优 ----
    var inE = new Uint8Array(E), deg = new Int32Array(N);
    var cwall = new Uint8Array(N), vis = new Int32Array(N).fill(-1);
    var bq = new Int32Array(N), nB = Bl.length;
    var stamp = 0, bestCov = -1, bestEdges = null;
    // 多目标择优的另两个分量（v0.6.17，见 visit() 注释）：十字格数、用到的格数
    var bestCross = Infinity, bestCells = Infinity;
    var left = bud.left, deadline = bud.deadline || 1e15;

    // 深检查：偶度 + 连通 + 围住镇中心
    function fullCheck() {
      var start = -1, h1, t1, list2, z2, k2, v2;
      // 圈空间的异或构造本该天然保证偶度（见 toggle 注释），这里仍便宜地复核一遍：
      // 一旦有奇度点，Hierholzer 只能走出一条"路"而非"环"。
      for (h1 = 0; h1 < verts.length; h1++) if (deg[verts[h1]] % 2 === 1) return false;
      for (h1 = 0; h1 < verts.length; h1++) if (deg[verts[h1]] > 0) { start = verts[h1]; break; }
      if (start < 0) return false;
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
        v2 = verts[h1];
        if (deg[v2] > 0 && vis[v2] !== stamp) return false;   // 不连通 → 走不成一条迹
      }
      // 墙 = 环经过的格；从地图四边洪水，镇中心还淹得到 → 没围住
      for (h1 = 0; h1 < N; h1++) cwall[h1] = 0;
      for (h1 = 0; h1 < verts.length; h1++) if (deg[verts[h1]] > 0) cwall[verts[h1]] = 1;
      return coreEnclosed(cwall);
    }

    function visit() {
      var cov = 0, b1, nv = 0, nc2 = 0;
      for (b1 = 0; b1 < nB; b1++) if (deg[Bl[b1]] > 0) cov++;
      // ---- 多目标择优（v0.6.17）----
      //   旧版只比"覆盖轮廓格数"：一旦拿到某覆盖率就立刻定案（`cov === bestCov && bestEdges`
      //   直接 return），于是同覆盖率下**第一条碰到的环**胜出 —— 而枚举顺序会让它常常是
      //   "带十字的那条"。大王 2026-09-23 报的"右下角不必要的十字"就是这条路径的产物：
      //   同一批 22 个格子里既有 24 步 2 十字的走法、也有 22 步 0 十字的走法，旧版取了前者。
      //   现在按字典序三级比较：① 覆盖轮廓格数（越大越好，守住"不缩水"）
      //                       ② 十字格数（越少越好 —— 度数 4 的格 = 被走 2 次）
      //                       ③ 用到的格数（越少越好）
      //   三者都不劣于当前最优才做深检查，因此枚举成本不增反降（多数候选被便宜比较挡掉）。
      for (b1 = 0; b1 < verts.length; b1++) {
        if (deg[verts[b1]] > 0) { nv++; if (deg[verts[b1]] > 2) nc2++; }
      }
      if (cov < bestCov) return;
      if (cov === bestCov && nc2 > bestCross) return;
      if (cov === bestCov && nc2 === bestCross && nv >= bestCells) return;
      if (!fullCheck()) return;
      bestCov = cov; bestCross = nc2; bestCells = nv; bestEdges = inE.slice();
    }

    // 异或切换一条基本圈：圈上的边"在/不在"之间翻转。
    // ⚠️ 必须是**真异或**，不能写成"置 1 / 置 0"：基本圈之间会共用生成树的边，
    //    "置 1 → 置 0"在共用边上会退化成**并集**，于是枚举出奇度子图 —— 那种东西
    //    物理上走不成闭环（Hierholzer 只能走出一条"路"）。异或的逆运算是它自己，故可原样还原。
    function toggle(cyc) {
      for (var q = 0; q < cyc.length; q++) {
        var ke = cyc[q], s = inE[ke] ? -1 : 1;
        inE[ke] = inE[ke] ? 0 : 1;
        deg[EA[ke]] += s; deg[EB[ke]] += s;
      }
    }
    function rec(ci) {
      if (left-- < 0) return;
      if ((left & 4095) === 0 && Date.now() > deadline) { left = -1; return; }
      if (ci === rank) { visit(); return; }
      rec(ci + 1);
      if (left < 0) return;
      toggle(basis[ci]);
      rec(ci + 1);
      toggle(basis[ci]);
    }
    rec(0);
    bud.left = left;
    if (!bestEdges) return null;

    // ---- Hierholzer：把选中的偶度子图走成有序闭环（输出格式与 closedTrail 一致：
    //      首格是起点，不重复收尾）----
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

    var ring = ringOf(walk);
    return enclosesCore(ring) ? ring : null;             // 最后一道保险
  }

  // 6c) ⑤ 往返支线求解器（v0.8.0，大王拍板："允许每边 ≤2 次、桥上双向、列车全程不倒车"）
  //   ▍解决什么：主求解（①~④）的铁轨是闭合迹（每边 ≤1 次），挂在**单条桥边**上的半岛
  //     组件数学上围不进去（进桥出桥是同一条边 = 要走 2 次），只能靠容差放弃。典型：
  //     大王 2026-09-24 07:21 盘，右下 2×3 凸块挂在唯一桥边 (5,8)-(6,8) 上，旧解 rail(12)
  //     放弃 6 格（割集论证见 docs/铁轨bug诊断-001.md）。
  //   ▍数学基础：把"每边 ≤2 次、第 2 次必反向"的闭合走线看成**乘子图**——每条边取重数
  //     1 或 2（重数 2 = 双向各一趟，格网上就是同一段轨道走个来回）。乘子图连通 + 全偶度
  //     ⟺ 存在欧拉回路 ⟺ 列车沿它跑一圈全程朝前、不倒车。支线进出 = 桥边重数 2，
  //     桥头两格各多走一趟 → 必为 2 个十字（渲染成 T 岔贴片，见 renderer.js）。
  //   ▍与主解的关系（无支线盘面零行为变更的三道保险）：
  //     · 现有四级链路一行不动（closedTrail 全部按 mm=1 跑，A/B 验证逐格 0 差异）；
  //     · 主解已盖满轮廓（cov0 ≥ |Bl|）时直接返回 null —— 覆盖数不可能再涨，常规盘面
  //       只花一次 O(N) 的 boundaryOf，零搜索开销；
  //     · 容差卡死 tol = |Bl| − cov0 − 1（封顶 TOL_MAX）：closedTrail 的闭包条件
  //       needLeft ≤ tol 保证**任何搜出来的走线 cov ≥ cov0 + 1**，天然"严格更优才采纳"，
  //       不存在同覆盖换解（那会搅动无支线盘面的既有结果）。
  //   ▍求解配置：maxVisit=2 + mm=2 一步到位（mm=2 下 maxVisit=1 数学上不可能闭合：
  //     折返边的两端各多一趟，端点必被访问 2 次）；补格上限直接给满 hLimitCap
  //     （不爬阶梯 —— "证明低档无解"是指数阶，v0.6.19 两次翻车的教训，这里没有必要）；
  //     多起点 + ringBetter（与主解同一套三级字典序）择优，满覆盖提前收工。
  //   ▍预算：独立墙钟 SPUR_BUDGET_MS=150ms（v0.6.5 "各级预算独立"原则）。它是增益通道
  //     不是保底通道，烧穿 = 保留主解，无正确性风险 —— 所以墙钟可以卡得比①级（700ms）紧。
  //     150 vs 250 实测采纳数相同，见 SPUR_BUDGET_MS 处注释。
  function spurSolver(um, curRing, bud) {
    var __s0 = GS.debugProbe ? Date.now() : 0;
    var reg = makeRegion(um);          // 重造干净区域：④ 剥层会原地改 U，不能用剥过的
    var bd = boundaryOf(reg.U, reg.F, um), B = bd.B, Bl = bd.Bl;
    if (Bl.length < 4) return null;
    var H = helpersOf(reg.U, B, um), A = new Uint8Array(N);
    var s0, hcount = 0;
    for (s0 = 0; s0 < N; s0++) { A[s0] = (B[s0] || H[s0]) ? 1 : 0; if (H[s0]) hcount++; }
    var hLimitCap = hcount < HMAX_CAP ? hcount : HMAX_CAP;
    var cov0 = curRing ? ringStats(curRing, B).cov : -1;
    if (cov0 >= Bl.length) return null;      // 已全覆盖：覆盖数不可能再涨，整趟搜索都省掉
    var tolTop = Bl.length - cov0 - 1;       // 阶梯顶档：任何解出的走线 cov ≥ cov0+1（严格更优才收）
    if (tolTop > TOL_MAX) tolTop = TOL_MAX;
    var best = null, bestSt = null, t, si, idx;
    var startN = Bl.length < START_TRIES ? Bl.length : START_TRIES;
    // ▍容差阶梯从 0 严格递升（与主解 ① 同哲学；v0.8.0 首版"单档 tolTop+首命中"实测教训）：
    //   有了折返自由后，DFS 的"首命中"解很邋遢 —— 0721 型半岛盘只拿到 cov14（满解是 cov18），
    //   E 型半岛盘甚至在 tolTop 单档上什么都搜不到。改成 t=0,1,…,tolTop 逐档试：
    //   t 档任何解都有 cov ≥ |Bl|−t，**先命中的档覆盖下界最高**；档内跑满多起点按
    //   ringBetter 择优（满覆盖零十字提前收工），命中一档就停（更松的档下界只会更低）。
    //   代价是低档"证明无解"的指数阶
    //   （主解 v0.6.19 两次翻车的同一坑）——由共用预算 + 250ms 墙钟兜底：
    //   烧穿 = 保留主解，无害降级（本级是增益通道，不是保底通道）。
    for (t = 0; t <= tolTop; t++) {
      if (bud.left < 0) break;
      for (si = 0; si < startN; si++) {
        if (bud.left < 0) break;
        idx = closedTrail(B, Bl, H, A, bud, hLimitCap, 2, SPUR_XMAX, t, si, 2);
        if (!idx) continue;
        var ring = ringOf(idx);
        if (!enclosesCore(ring)) continue;
        var st = ringStats(ring, B);
        if (!bestSt || ringBetter(st, bestSt)) { best = ring; bestSt = st; }
        // 提前收工：折返边两端各多走一趟 ⇒ 任何支线解 cross ≥ 2。拿到 cross ≤ 2 的解
        // 就已是"单桥干净往返"的理论最优（多桥盘在 tol=0 档拿不到 cross 2，不受影响），
        // 剩余起点不会更好，纯烧墙钟 —— 实测 9 起点全跑会让命中盘普遍贴满 250ms。
        if (bestSt.cross <= 2) break;
      }
      if (best) break;          // 本档已命中 → 收工（更松的档覆盖下界只会更低）
    }
    if (GS.debugProbe) GS.debugSpur = { cov0: cov0, blN: Bl.length, tolTop: tolTop,
                                        found: !!best, cov: bestSt ? bestSt.cov : -1,
                                        ms: Date.now() - __s0 };
    return best;
  }

  // 造区域：泛洪 → 削脖子（规则 3）→ 收尾（剪死胡同 + 丢弃掉队碎片）→ 算洞
  function makeRegion(um) {
    var U = floodU(um);
    thinNeck(U);
    keepCoreComponent(U);
    pruneU(U);
    return { U: U, F: normalize(U) };
  }

  // 主求解：四级兜底（v0.6.5 起**各级预算互相独立**，上级烧穿不连坐下级）
  //   ① 容差阶梯：tol=0 先试 —— 与旧版主解**完全一致**（必须覆盖全部轮廓格）；
  //      无解才逐级放宽到 TOL_MAX。它只放宽"覆盖要求"、**不改动区域 U**，
  //      所以给出的环始终围着清空区外沿，不会缩水。
  //   ② 快速兜底（v0.6.5 新增）：阶梯把预算烧穿时走这里。烧穿几乎总是死在"证明更小补格数
  //      不可行"的指数阶上（大图实测：k0..k11 的失败证明 ≈100 万节点，而 k16 的可行解
  //      141 个节点即命中）—— 所以补格数**从大到小**再试一遍，首个命中立即返回。
  //      环可能多垫几格补格，但合法、围核心、尽力全覆盖；只有烧穿的盘面才走到这里。
  //   ③ 精确枚举：阶梯失败 ≠ 真无解（原因见 bestRingExact 注释）。同样不动区域。
  //   ④ 剥层：图上确实不存在围住镇中心的偶度环（或维数超 RANK_CAP）时的最后手段，
  //      此时不剥也是无解，剥了至少还有一条环（不会比 v0.6 更差）。
  //   ⚠️ 旧版（v0.6.1–v0.6.4）②③④ 与 ① **共用同一份预算**：主搜索把 left 烧成负数后，
  //      循环里一句 `return null` 直接放弃整条链 → 铁轨停留旧环不动（用户盘面复现的正是这条链）。
  function solveWithLadder(reg, um, bud) {
    var ring, tol, b;
    for (tol = 0; tol <= TOL_MAX; tol++) {
      if (bud.left < 0) break;                          // 烧穿 → 交给下面几级接手
      ring = solveOnRegion(reg.U, reg.F, um, bud, tol);
      if (ring) return ring;
    }
    if (bud.left < 0) {                                 // ② 快速兜底：补格数从大到小
      var qb = freshBudget(150);
      for (var qt = 0; qt <= TOL_MAX; qt++) {
        ring = solveOnRegion(reg.U, reg.F, um, qb, qt, true);
        if (ring) return ring;
        if (qb.left < 0) break;
      }
    }
    var fb = freshBudget(250);                          // ③④ 共用的独立预算
    ring = bestRingExact(reg.U, reg.F, um, fb);         // ③ 精确枚举
    if (ring) return ring;
    for (b = 0; b < 25; b++) {                          // ④ 剥层
      if (fb.left < 0) break;
      if (!peelOnce(reg.U, reg.F, um)) break;
      keepCoreComponent(reg.U);
      pruneU(reg.U);
      reg.F = normalize(reg.U);
      ring = solveOnRegion(reg.U, reg.F, um, fb, TOL_MAX);
      if (ring) return ring;
    }
    return null;
  }

  // 「不缩水」保险：上一帧的环若仍然合法（每格可铺轨、相邻成环、围住镇中心），且
  // **对当前清空区轮廓的覆盖格数**比新解还多，才沿用旧环。
  // ⚠️ 比较标准必须是「轮廓覆盖数」而不是环长（v0.6.4 修订）：旧环是给更早、更小的清空区算的，
  //    区域长大之后它往往只剩一半轮廓贴合（玩家看到的"铁轨不跟着清空区走"、金币收不到），
  //    但它格式上更长——按长度比就会一直压过更合身的新解。按覆盖数比，新解更贴合时就正常换新；
  //    而剥层兜底给出的"缩水小环"覆盖数必然更低，仍会被旧环压住，反缩水的本意不受影响。
  function contourCov(ring, B) {
    var seen = {}, cov = 0, i, z;
    for (i = 0; i < ring.length; i++) {
      z = id(ring[i].c, ring[i].r);
      if (B[z] && !seen[z]) { seen[z] = 1; cov++; }
    }
    return cov;
  }
  function finalRing(reg, um, B, prevRing, bud) {
    var ring = solveWithLadder(reg, um, bud), prev = null;
    if (prevRing && prevRing.length >= 4) {
      var okPrev = enclosesCore(prevRing);          // 旧环必须仍围住镇中心（防陈化，见 contourCov 注释）
      if (okPrev) {
        for (var i0 = 0; i0 < prevRing.length; i0++) {
          var pa = prevRing[i0], pb = prevRing[(i0 + 1) % prevRing.length];
          if (!um[id(pa.c, pa.r)] || Math.abs(pa.c - pb.c) + Math.abs(pa.r - pb.r) !== 1) { okPrev = false; break; }
        }
        if (okPrev) prev = prevRing;
      }
    }
    if (prev && (!ring || contourCov(prev, B) > contourCov(ring, B))) ring = prev;
    return ring;
  }
  // ======================= 三、求解 + 输出 =======================

  // 预算：节点 150 万（主约束，实测最差盘面只用约 56 万，留 2.7 倍余量）+ 墙钟安全网。
  // ⚠️ 墙钟必须 ≥ 最差盘面的自然耗时：否则会**先于**节点数触发、把该局面误判为无解；
  //    而且墙钟随机器快慢而变，会造成结果不可复现（200ms 时实测有 2 局被切断）。
  // ▍①级墙钟 400 → 700ms（v0.6.20，大王 2026-09-24 拍板）
  //   起因：多起点择优（v0.6.19）把①级的计算量抬了几倍，400ms 在"起点敏感盘"上会被掐断 ——
  //   大王 2026-09-23 那张盘实测：400/500ms → 十字 3（等于没修）、600ms 临界不稳、
  //   700ms+ 才稳定出十字 1。大王选了这个（流畅性让位于正确性）。
  //   ⚠️ 前面那条"墙钟必须 ≥ 最差盘面自然耗时"的告诫在这里加倍成立：
  //     700ms 已经是"贴合最差自然耗时"的取值，**别再往下调**。
  //   ▍落地后的实测（300 张固定种子盘，真实墙钟，**不设** debugNoDeadline）：
  //       随机盘 200 张：平均 12.0ms / P90 15ms / P95 46ms / P99 397ms / max 484ms
  //       大轮廓盘 100 张：平均 40.4ms / P90 95ms / P99 356ms / max 356ms
  //       ⇒ 被 700ms 掐断 **0 张**。改前的悲观预估是"极端盘 ~0.65s"，实测远小于此 ——
  //         700ms 只抬高了一条几乎碰不到的安全网，日常耗时不变。
  //   ▍要动这个数：先临时写个墙钟量测脚本（照 test_rail.js 的 vm 沙箱加载方式），
  //     ⚠️ 且**不要**设 `GS.debugNoDeadline` —— 设了等于关掉墙钟，量到的全是自然耗时，
  //        根本看不到"被掐断"这个现象（v0.6.20 踩过）。
  var region = makeRegion(usable);
  var contourB = boundaryOf(region.U, region.F, usable).B;   // 当前轮廓位图（覆盖数比较 + 调试/测试用）
  // GS.debugNoDeadline：测试用确定性开关（跳过 700ms 墙钟，只留节点预算）——
  // 墙钟随机器负载波动，重负载下跑测试偶发把求解掐断、结果不可复现（2026-09-21 实测 1/42 次）。
  // GS.debugProbe：测试探针开关（v0.8.0）——置 true 时 recomputeRails 把各阶段耗时写进
  // GS.debugStages（main/exact/spur 的 ms + 支线是否被采纳）与 GS.debugSpur（支线搜索的
  // cov0/|Bl|/tolTop/耗时/是否命中）。只加 Date.now() 与对象赋值，不影响求解结果。
  var __p0 = GS.debugProbe ? Date.now() : 0;
  var ring = finalRing(region, usable, contourB, GS.railPath, freshBudget(700));
  var __p1 = GS.debugProbe ? Date.now() : 0;

  // ---- 双路择优（v0.6.17）------------------------------------------------------
  //   ① DFS 快速路径（finalRing → solveWithLadder → closedTrail）：快，但"先命中先返回"，
  //      不做择优，且 maxVisit=1 档常常搜不到那条更干净的环（大王 2026-09-23 盘面实证：
  //      补格上限 hLimit=0..4 五档全无解，直到放开十字才拿到 24 步 2 十字的那条）。
  //   ② 圈空间枚举（bestRingExact）：慢一点但全局最优，已升级为多目标（覆盖 → 十字 → 格数）。
  //   两条都跑，按同一套字典序择优，**硬约束**：
  //      · 覆盖率不得低于 ①（守住 v0.6.4「不缩水」的本意）
  //      · 十字数不得多于 ①（本例诉求）
  //      · 前两项相同时，格数更少者胜
  //   ⚠️ 为什么不能只用 ②：RANK_CAP=19 封顶 + 维数超限返回 null —— 300 张随机中后期盘实测
  //      ② 有 149/300 解不出环（大图上 rank 普遍超 19）。所以 ① 仍是主路径，② 只做"更优则替换"。
  //   ⚠️ 独立的 250ms 预算：不连坐 ① 的预算（v0.6.5 那条"预算连坐"教训的同一原则）。
  //      ② 的实测耗时（300 张随机中后期盘）：中位 1ms、P90 45ms、P99 122ms、最大 127ms
  //      → 250ms 留了近一倍余量，只有极端盘面才会被墙钟截断（截断即返回 null → 保留 ① 的解）。
  //   ▍口径提醒：下面比的是 **覆盖数 / 十字数 / 去重格数** 三个量，不是"步数"。详见 closedTrail 头。
  var exact = bestRingExact(region.U, region.F, usable, freshBudget(250));
  var __p2 = GS.debugProbe ? Date.now() : 0;
  if (exact && ring && ring.length >= 4) {
    // 覆盖数口径：环上用到的、属于当前轮廓（contourB）的**去重格数**。
    // 三个量统计与三级字典序比较都走顶层共享实现（ringStats / ringBetter）——
    //   与 solveOnRegion 的择优是**同一套判据**，口径改一处两边同步（原先各写一份）。
    var stA = ringStats(ring, contourB), stB = ringStats(exact, contourB);
    if (ringBetter(stB, stA)) ring = exact;   // exact 严格更优才替换（否则保留 ① 的解）
  }
  // ---- ⑤ 往返支线（v0.8.0）-----------------------------------------------------
  //   收编"挂在单条桥边上"的半岛组件：每边 ≤2 次（第 2 次反向 = 往返），列车不倒车。
  //   spurSolver 内部已保证"任何返回解的覆盖数严格 > 当前解"（容差卡死，见其注释），
  //   这里再按 contourB 口径复核一道双保险；无支线机会的盘面它在 cov0 检查处直接 null，
  //   结果与 v0.7.0 逐格一致。
  var spur = spurSolver(usable, ring, freshBudget(SPUR_BUDGET_MS));
  var spurWon = false;
  if (spur && ringStats(spur, contourB).cov > (ring ? ringStats(ring, contourB).cov : -1)) {
    ring = spur;
    spurWon = true;
  }
  if (GS.debugProbe) {
    GS.debugStages = { mainMs: __p1 - __p0, exactMs: __p2 - __p1, spurMs: Date.now() - __p2,
                       spurWon: spurWon };
  }
  // 十字直行优先（v0.6.10）：只重排经过十字的走法，环长与格子集合不变。
  //   ⚠️ 实测结论（300 张随机盘面 + 穷举交叉验证）：环在十字上的配对**几乎总是唯一**——
  //      能直行的本来就直行，剩下的是"8 字形相切"（直行会把单环劈成两条环），
  //      只能拐弯；而且这些十字本身是必需的（把 maxVisit 限制成"每格一次"后、
  //      即使把预算放大到 4000ms 也找不到一个无十字的环，47/47 全无解）。
  //      所以本函数是"能直行就直行"的最优选择器，不改变既有行为。
  if (ring && ring.length >= 4) ring = GS.straightenRing(ring);

  if (!ring || ring.length < 4) {
    GS.railPath = [];
    GS.railSet = {};
    GS.railInner = {};          // 没有环 → 无"圈内"
    GS.railRect = null;
    GS.railGrowHints = [];
    GS.contourB = contourB;
    return;
  }

  GS.railPath = ring;
  GS.railSet = {};
  var minC = ring[0].c, maxC = ring[0].c, minR = ring[0].r, maxR = ring[0].r, i1;
  for (i1 = 0; i1 < ring.length; i1++) {
    GS.railSet[ring[i1].c + ',' + ring[i1].r] = true;
    if (ring[i1].c < minC) minC = ring[i1].c;
    if (ring[i1].c > maxC) maxC = ring[i1].c;
    if (ring[i1].r < minR) minR = ring[i1].r;
    if (ring[i1].r > maxR) maxR = ring[i1].r;
  }
  GS.railRect = { c0: minC, r0: minR, c1: maxC, r1: maxR };
  GS.railInner = innerCells(ring);   // 环内集合（v0.6.13，见 innerCells 注释）
  GS.contourB = contourB;   // 当前清空区轮廓位图（按格 id 索引）——回归测试用它量「覆盖数」

  // ---- 扩张提示：已按需求整体移除（出口保留为空数组，UI 侧无需改动）----
  GS.railGrowHints = [];
};

// ---- 三选一：清理形状 + 经济建筑 ----
// v0.6.6：形状随机生成（CFG.randomShape），每张卡自带独立 id，
// 供 UI 高亮/刷新签名用（旧版用 CFG.SHAPES 下标 si，已废）。
GS._cardSeq = 0;
GS.pickShapeCard = function (size) {
  var sh = CFG.randomShape(size);
  return { kind: 'shape', id: ++GS._cardSeq, name: sh.name, cells: sh.cells };
};

// 卡牌去重签名（v0.6.11）：判断"两张卡是不是同一个选项"，也是去重规则的可执行定义。
//   · 形状按**尺寸家族**去重：只看外框两维（小的在前），所以 2×3 和 3×2
//     视为同一形状 —— 大王反馈"偶尔出现三个一样的形状选项"，把旋转也算重。
//   · 经济建筑只有一种，签名固定 'econ' → 最多出现一张。
GS.cardSig = function (card) {
  if (card.kind !== 'shape') return 'econ';
  var w = 0, h = 0;
  for (var i = 0; i < card.cells.length; i++) {
    if (card.cells[i][0] + 1 > w) w = card.cells[i][0] + 1;
    if (card.cells[i][1] + 1 > h) h = card.cells[i][1] + 1;
  }
  return Math.min(w, h) + 'x' + Math.max(w, h);
};

// 生成三选一牌组（**保证三个选项互不重复**，v0.6.11 大王定案）：
//   ① 牌型沿用旧概率——每张 30% 概率是经济建筑，但经济建筑**最多一张**（去重）；
//   ② 形状按面积档位洗牌后依次发放，所以**每张卡的尺寸家族都不一样**
//      （2×3 与 3×2 算同族，同一次抽牌不会同时出现）；
//   ③ 位置打散，但首位保持形状卡（与旧版体感一致）。
// 因为不存在"抽到重的就重抽"，经济卡的出现率与旧版一致（约 51% 的组合含经济卡），
// 也不会有任何重试循环。
GS.buildOffer = function () {
  var econN = (Math.random() < 0.3 ? 1 : 0) + (Math.random() < 0.3 ? 1 : 0);
  if (econN > 1) econN = 1;                       // 去重：经济建筑最多一张
  var shapeN = 3 - econN;                         // 至少 2 张形状卡
  // 面积档位洗牌（Fisher-Yates），按洗好的顺序发形状
  var fams = CFG.SHAPE_SIZES.slice();
  for (var i = fams.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = fams[i]; fams[i] = fams[j]; fams[j] = t;
  }
  var cards = [];
  for (var k = 0; k < shapeN; k++) cards.push(GS.pickShapeCard(fams[k % fams.length]));
  if (econN) cards.push({ kind: 'econ', id: ++GS._cardSeq });
  // 位置打散
  for (var s = cards.length - 1; s > 0; s--) {
    var q = Math.floor(Math.random() * (s + 1));
    var tmp = cards[s]; cards[s] = cards[q]; cards[q] = tmp;
  }
  if (cards[0].kind !== 'shape') {                // 首位换回形状卡
    for (var m = 1; m < cards.length; m++) {
      if (cards[m].kind === 'shape') {
        var tmp2 = cards[0]; cards[0] = cards[m]; cards[m] = tmp2;
        break;
      }
    }
  }
  return cards;
};

GS.offerCost = 15;   // 三选一「出现时」扣除的抽费
// pay=true 时在生成界面之际扣除金币；不足则返回 false 不换牌
GS.nextOffer = function (pay) {
  if (pay) {
    if (GS.gold < GS.offerCost) return false;
    GS.gold -= GS.offerCost;
  }
  GS.offer = GS.buildOffer();
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
GS.onRail = function (c, r) { return !!(GS.railSet && GS.railSet[c + ',' + r]); };
// 金币格是否"已并入当前区域"（v0.6.13 大王定案）：
//   · 在铁轨上 —— 火车天天碾过，它显然已经是开发区的一部分（能铺轨说明早清理过了）；
//   · 在铁轨圈内 —— 被环围在里面，同属开发区。
//   两者都不是（荒野里孤立的金币）→ 仍**不算**区域，保持 v0.6.9b 的"防清飞地"。
GS.goldInRegion = function (c, r) {
  var k = c + ',' + r;
  return !!(GS.railSet && GS.railSet[k]) || !!(GS.railInner && GS.railInner[k]);
};
GS.railNeighbor = function (c, r) {
  var nb = GS.neighbors(c, r);
  for (var i = 0; i < nb.length; i++) {
    if (CFG.inBounds(nb[i][0], nb[i][1]) && GS.onRail(nb[i][0], nb[i][1])) return true;
  }
  return false;
};
GS.railCell = function (i) { return GS.railPath[i % GS.railPath.length]; };
