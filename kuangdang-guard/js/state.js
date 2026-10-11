// 全局游戏状态：地块地形 / 经济建筑 / 动态铁轨环 / 三选一
window.GS = {};

GS.newGame = function () {
  GS.gold = 30;   // v1.3.1：初始金币 120 → 30（大王拍板；开局空地仅 2 格，清废墟成为前期核心决策）

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

  // 列车（v0.9.2）：cargo = 车上堆的金币（规则 6，到站才交付）。
  //   站台由 recomputeRails 末尾的 STATION.solve 解出，这里先清空。
  GS.train = { index: 0, frac: 0, cargo: 0 };
  GS.station = null;
  if (typeof CLOCK !== 'undefined') CLOCK.reset();   // 新局回到白天

  // 塔防迭代（v1.3-rc）：塔/怪权威列表 + 镇中心血量（跨波继承）+ 失败旗。
  //   ⚠️ 数值来源 CFG.CORE_HP（config/map.js）—— 此处不能引用 FOES（加载序在后）。
  //   TOWERS/FOES 的数组重置由 ENG.restart 统一调 reset（本函数保持模块无关）。
  GS.towers = [];
  GS.foes = [];
  GS.coreMaxHP = CFG.CORE_HP;
  GS.coreHP = CFG.CORE_HP;
  GS.gameOver = false;
  // v1.4 卡牌大改：牌库（[{kind:'shape',shape}|{kind:'hero',elem}]）
  // ⚠️ GS.wagons 独立车厢列表已退役（v1.4.1 大王纠偏"车厢是独立作战单位"）：
  //   车厢 = GS.towers 的镜像投影（每座英雄塔一节同元素同星车厢，见 engine.js ENG.WAGON）
  GS.deck = [];
  // v1.4.4（大王拍板 2026-10-08）：抽卡价格线性递增，每次 +5；v1.4.8 首抽 10→5。
  //   公式唯一入口 = GS.drawCost()；GS.drawCount = 本局已付钱抽卡的次数（新局清零，
  //   三选一弹层里放弃/选卡都不退钱也不计数，只在实际扣费时 +1）。
  GS.drawCount = 0;
  // v1.4.5：撤销点（最近一次形状卡清理的 was 快照 + 被消耗的卡），新局清零。
  //   由 UI.settleClean 成功时打包，ENG.undoShape 消费后置 null。
  GS.undoClean = null;

  GS.selToken = null;      // 当前使用的工具：{kind:'shape',si,cells} | {kind:'econ'}
  GS.offer = [];

  GS.recomputeRails();
  // v1.6 求解后台化：新局作废飞行中的异步结果（指纹守卫之外的双保险）。
  //   newGame 的开局环保持同步算（12 格小环毫秒级，且列车/渲染立即可用）。
  if (typeof SOLVER_ASYNC !== 'undefined') SOLVER_ASYNC.invalidate();
  // v1.3-rc：三选一退役（拍板分叉 ①），不再自动发牌。nextOffer 保留不调用（回退保险）。
  // GS.nextOffer(false);
};

// v1.6.15（大王令 2026-10-10）：下一抽的价格 = 10 + 10 × 已抽次数
//   （首抽 10 → 20 → 30 → …，无上限封顶；沿革：v1.4.4 首抽 10 / v1.4.8 改 5 / 本次改回 10 起步步进 10）。
//   UI 层（按钮文案 / 禁用判断 / 扣费）一律走这里。
GS.drawCost = function () {
  return 10 + 10 * (GS.drawCount || 0);
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

// ============================================================================
// 求解器工具箱（v2 重构第一步 · 2026-10-11）：原先全部嵌在 recomputeRails
// 函数体内的闭包函数，机械提升为模块级工厂 —— 行为逐格不变（63 用例回归为闸）。
//   ▍为什么要提出来：v2（rail-v2 统一乘子图求解）与 v1 共用同一套几何/区域/搜索
//     原语；嵌套结构下 v2 只能整段复制（项目历史上"同一判据写两份"的病，
//     档案 2.1/代码注释反复警告过口径分叉），工厂化后唯一定义、两路共用。
//   ▍工厂每次 recompute 调用新建一个实例（闭包捕获 COLS/ROWS/core/PROT 当场值，
//     withSize 切尺寸天然兼容），函数体逐字符来自原嵌套实现，未做任何"顺手优化"。
//   ▍RAIL_DC/RAIL_DR 用模块级常量而非裸 DC/DR：避免污染 window 全局名
//     （原先 DC/DR 是 recomputeRails 的函数内 var，提出去若沿用旧名会变成
//     window.DC，与其它脚本的顶层变量有撞名风险）。
// ============================================================================
var RAIL_DC = [1, -1, 0, 0], RAIL_DR = [0, 0, 1, -1];
var RAIL_RANK_CAP = 19;   // 圈空间维数上限（原 RANK_CAP，bestRingExact 用；候选子图 2^19 封顶）

function makeRailSolverKit(COLS, ROWS, coreC, coreR) {
  var N = COLS * ROWS;
  var CORE_C = coreC, CORE_R = coreR;
  var DC = RAIL_DC, DR = RAIL_DR;
  var PROT = null;   // 晚绑定：调用方先建 kit 取 id/inB 铺位图，位图就绪后 setPROT 注入

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

  // ======================= 区域求法（原嵌套版逐字迁移） =======================

  // 1) 主体 U：从镇中心四邻出发的 4 连通洪水
  function floodU(um) {
    var U = new Uint8Array(N), st = [], d, nc, nr, q;
    for (d = 0; d < 4; d++) {
      nc = CORE_C + DC[d]; nr = CORE_R + DR[d];
      if (inB(nc, nr) && um[id(nc, nr)]) { q = id(nc, nr); U[q] = 1; st.push(q); }
    }
    // v1.6.7 兜底（§14.7）：镇中心四邻全是塔、起手种子为空时，取候选集的
    // **最大连通分量**作为 U（原语义"含镇中心的那块"已被塔隔断、不存在；
    // 最大块最可能围出含 core 的环——ouxk6f 局 54 环为证）。
    // 只在种子空时激活，正常局零开销。
    if (!st.length) {
      var seenF = new Uint8Array(N), best = null, bestN = 0, s1, dF;
      for (s1 = 0; s1 < N; s1++) {
        if (!um[s1] || seenF[s1]) continue;
        var stF = [s1], comp = [];
        seenF[s1] = 1;
        while (stF.length) {
          var pF = stF.pop(), pcF = colOf(pF), prF = rowOf(pF);
          comp.push(pF);
          for (dF = 0; dF < 4; dF++) {
            var ncF = pcF + DC[dF], nrF = prF + DR[dF];
            if (!inB(ncF, nrF)) continue;
            var qF = id(ncF, nrF);
            if (um[qF] && !seenF[qF]) { seenF[qF] = 1; stF.push(qF); }
          }
        }
        if (comp.length > bestN) { bestN = comp.length; best = comp; }
      }
      if (best) for (s1 = 0; s1 < best.length; s1++) U[best[s1]] = 1;
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
    // v1.6.7 兜底（§14.7）：core 四邻没有 U 格（种子为空）时，保留 U 的**最大连通
    // 分量**——只需把该分量的任一格作种子压入队列，下面的 BFS 自然铺满整块并保留，
    // 其余碎片照旧清除。与 floodU 兜底配套，同样只在盲区激活。
    if (tail === 0) {
      var seenK = new Int32Array(N), bestK = -1, bestN = 0, s2, d2;
      for (s2 = 0; s2 < N; s2++) {
        if (!U[s2] || seenK[s2]) continue;
        var stK = [s2], nK = 0;
        seenK[s2] = 1;
        while (stK.length) {
          var pK = stK.pop(); nK++;
          var pcK = colOf(pK), prK = rowOf(pK);
          for (d2 = 0; d2 < 4; d2++) {
            var ncK = pcK + DC[d2], nrK = prK + DR[d2];
            if (!inB(ncK, nrK)) continue;
            var qK = id(ncK, nrK);
            if (U[qK] && !seenK[qK]) { seenK[qK] = 1; stK.push(qK); }
          }
        }
        if (nK > bestN) { bestN = nK; bestK = s2; }
      }
      if (bestK >= 0) { keepStamp[bestK] = keepCs; keepQ[tail++] = bestK; }
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

  // 3c) 找 U 里的 1 格宽脖子（判据见 recomputeRails 文件头约定 2）
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

  // 5) 候选补格 H（v1.6.9 起铺两层）：第一轮邻轮廓；第二轮邻「轮廓 ∪ 第一轮」。
  //    ⚠️ 第二轮判据是"邻 H1"，绝不能把 H1 本体排除在候选外（历史实验踩过，
  //    右耳圈缺格断成树 ⇒ 端头禁令把 DFS 锁死在起点）。
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
    // 第二轮：非 B、非 H 的可铺轨格，邻 B 或邻 H 即收入
    var H2 = new Uint8Array(N), s1, sc1, sr1, d1, nc1, nr1, q1;
    for (s1 = 0; s1 < N; s1++) {
      if (!U[s1] || B[s1] || H[s1] || !um[s1]) continue;
      sc1 = colOf(s1); sr1 = rowOf(s1);
      for (d1 = 0; d1 < 4; d1++) {
        nc1 = sc1 + DC[d1]; nr1 = sr1 + DR[d1];
        if (!inB(nc1, nr1)) continue;
        q1 = id(nc1, nr1);
        if (B[q1] || H[q1]) { H2[s1] = 1; break; }
      }
    }
    for (s1 = 0; s1 < N; s1++) if (H2[s1]) H[s1] = 1;
    return H;
  }

  // ======================= 闭环求解（欧拉回路，原嵌套版逐字迁移） =======================
  // gate（v2 新增，第 13 参，缺省 = 旧行为逐分支不变）：端头禁令的"脖子门格"放行开关。
  //   旧禁令：经割边进入孤立边双分量（compIso=1）一律禁——本意是禁"死链"（进去只能
  //   原路折返整条链，链尾必产 deg=1 端头）。但**单点分量挂着环形分量**的脖子格
  //   （如 2×2 半岛的单格脖子：脖子两侧都是桥边、对面是环）是可以"去程穿过、
  //   绕环、回程反穿"的合法通道（该格两次经过、度 4、每边一去一回）——旧禁令
  //   把 P1（规格 §3-O1）要纳入的半岛整个挡死（debug_v2.js 实锤：全档 null、
  //   预算不烧，搜索在根部被剪）。
  //   gate=1 时 treeDead 精化：孤立分量 v 若存在**非孤立分量的邻居**（通向环形
  //   分量 = 脖子门格）→ 放行；纯走廊链（邻居全是孤立分量或无边）→ 仍禁。
  //   gate 缺省（v1 全链调用）时 treeDead ≡ compIso，行为逐分支等价（63 用例为闸）。
  function closedTrail(B, Bl, H, A, budget, hLimit, maxVisit, xmax, tol, startIdx, mm, flip, gate) {
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
    //   v1.0 端头禁令（大王 2026-09-28 拍板）：顺手给每个点标边双连通分量，
    //   compIso[c]=1 = 该分量是**孤立点**（大小 1 = 无环的"树分量"）。割边对面的
    //   树分量一律禁入 —— 进去只能原路折返整条链，链尾必产 deg=1 端头（尽头车挡），
    //   违背"列车全程朝前"（规则 5 v1.0）。组件含环 ⟺ 分量 ≥2 点 ⟺ compIso=0。
    var isBridge = null, compIso = null, compId = null;
    if (mm === 2) {
      isBridge = new Uint8Array(E);                  // 1 = 桥边（割边）
      compIso = new Uint8Array(N);                   // 1 = 该点所在边双分量是孤立点（无环）
      compId = new Int32Array(N).fill(-1);           // 点 → 边双分量编号（-1 = 未访问块，不判）
      var disc = new Int32Array(N).fill(-1), low = new Int32Array(N), tstamp = 0;
      // 根节点与 dfs 同式取（⚠️ 不能引用下面的 var start —— 它在这块之后才赋值，
      //   提前引用是 undefined，桥边表会全零：0721 盘半岛失收的实锤教训）。
      var rootN = (startIdx >= 0 && startIdx < Bl.length) ? Bl[startIdx] : Bl[0];
      var ptr2 = new Int32Array(N);
      var st2 = [rootN], pe = new Int32Array(N).fill(-1);
      var tstack = [rootN], cid = 0;                 // Tarjan 点栈：弹栈分组即边双分量
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
            tstack.push(wn);
            st2.push(wn); moved = true; break;
          }
        }
        if (!moved) {
          st2.pop();
          if (st2.length) {
            var par = st2[st2.length - 1];
            low[par] = Math.min(low[par], low[vn]);
            if (low[vn] > disc[par]) {
              isBridge[pe[vn]] = 1;                             // 割边判定
              // v1.0：弹出 vn 所在的边双分量（tstack 顶到 vn），仅 1 点 = 树尖/树链点
              var saw = 0;
              while (tstack.length) {
                var tz = tstack.pop();
                compId[tz] = cid; saw++;
                if (tz === vn) break;
              }
              if (saw === 1) compIso[cid] = 1;
              cid++;
            }
          }
        }
      }
      // 残留 tstack = root 所在分量（最后分组）；树的根也落到这里 → size 1 = 孤立
      if (tstack.length) {
        var lastIso = (tstack.length === 1) ? 1 : 0;
        while (tstack.length) compId[tstack.pop()] = cid;
        if (lastIso) compIso[cid] = 1;
      }
      // v2 gate：treeDead[w]=1 才禁入。孤立分量若有"非孤立分量邻居"（脖子门格，
      //   通向环形分量）→ 放行；无 gate 时与 compIso 完全一致（v1 行为不变）。
      var treeDead = compIso;                       // gate 缺省：直接沿用旧判定数组
      if (gate) {
        treeDead = new Uint8Array(N);
        for (var tv = 0; tv < N; tv++) {
          if (!A[tv] || compId[tv] < 0 || !compIso[compId[tv]]) continue;
          var tvc = colOf(tv), tvr = rowOf(tv), open = false;
          for (var td = 0; td < 4 && !open; td++) {
            var tnc = tvc + DC[td], tnr = tvr + DR[td];
            if (!inB(tnc, tnr)) continue;
            var tn = id(tnc, tnr);
            if (A[tn] && compId[tn] >= 0 && !compIso[compId[tn]]) open = true;   // 有环形邻居
          }
          treeDead[tv] = open ? 0 : 1;
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
        // v1.0 端头禁令：经割边进入"树分量"一律禁（v2 gate 下 treeDead 已精化，见函数头）
        if (mm === 2 && uc1 === 0 && isBridge[e1] === 1 && treeDead[w] === 1) continue;
        var grp = goBack ? (wantIdx >= 0 ? 2 : 1)
                         : ((wantIdx >= 0 && t2 === wantIdx) ? 0 : (wantIdx >= 0 ? 1 : 0));
        // v0.9 flip：直行/拐弯试序翻转（生成多样性 —— DFS 先命中先返回，直行优先会让
        //   "拐弯支里的更优解"永远搜不到；flip 跑一遍拐弯优先补上另一半搜索空间）。
        if (flip && !goBack && wantIdx >= 0) grp = (grp === 0 ? 1 : 0);
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
            // v1.0 端头禁令（与前进判据同口径，否则剪枝高估可达性）：禁经割边入树分量
            if (mm === 2 && uc4 === 0 && isBridge[e4] === 1 && treeDead[v4] === 1) continue;
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
              var nb5 = anbr[bd0 + t5];
              // （v0.8.4）start 豁免同上：走到起点 = 合法的收环动作，不是死格。
              //   v1.0 端头禁令同口径：割边对面的树分量不算出路（进得去出不来）。
              if (e5 >= 0 && (vis[nb5] < maxVisit || nb5 === start)) {
                if (uc5 === 0) {
                  if (!(mm === 2 && isBridge[e5] === 1 && treeDead[nb5] === 1)) { have = 1; break; }
                } else if (mm === 2 && uc5 === 1 && dirTo[e5] === bs && isBridge[e5] === 1) {
                  have = 1; break;
                }
              }
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

  // ======================= 围核 / 圈内 / 三量（原嵌套版逐字迁移） =======================

  // 环是否把镇中心围在里面：把环当墙，从地图边界 4 连通洪水，看镇中心还通不通到外面。
  // （比射线法稳：十字会产生回折多边形，射线法的奇偶规则在自交处容易误判。）
  // ▍通用工具（v0.6.21 抽出）：把 wall 当墙，从地图四边 4 连通洪水。
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
  //   口径见 recomputeRails 文件头「三个量」总纲：steps=序列长度、cells=去重格数、cross=被走 ≥2 次的格数。
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

  // 合法性复核（与 test_rail.js ringError 同口径）：正交 / 每格 ≤2 / 无向边 ≤2（第 2 次反向）/
  //   无同向重边 / 围住镇中心。⑥ trimDetours 与 ⑦ reweaveTwins 共用（v1.4.9 提升口径）。
  function ringOkFull(rr) {
    var L2 = rr.length, i2;
    if (L2 < 4) return false;
    var c2 = {}, e2 = {}, d2 = {};
    for (i2 = 0; i2 < L2; i2++) {
      var a2 = rr[i2], b2 = rr[(i2 + 1) % L2];
      if (Math.abs(a2.c - b2.c) + Math.abs(a2.r - b2.r) !== 1) return false;
      var ka2 = a2.c + ',' + a2.r, kb2 = b2.c + ',' + b2.r;
      var ek2 = ka2 < kb2 ? ka2 + '|' + kb2 : kb2 + '|' + ka2;
      e2[ek2] = (e2[ek2] || 0) + 1;
      if (e2[ek2] > 2) return false;                 // 无向边上限 2（第 2 次须反向，见下）
      var dk2 = ka2 + '>' + kb2;
      if (d2[dk2]) return false;                     // 同向重走同一条边 → 非法
      d2[dk2] = 1;
      c2[ka2] = (c2[ka2] || 0) + 1;
      if (c2[ka2] > 2) return false;                 // 每格最多走 2 次（度数 ≤4）
    }
    return enclosesCore(rr);
  }
  function trimDetours(ringIn, mark) {
    var seq = ringIn, round, i, k;
    var tried = {};                                    // 本轮试过且被否的候选 'i:k'
    for (round = 0; round < 400; round++) {
      var L = seq.length;
      if (L < 5) break;
      // 轮廓位图（双倍长度，便于环形取前缀和）+ 前缀和 pre[t] = 前 t 格的轮廓格数
      var mk = new Uint8Array(2 * L), pre = new Int32Array(2 * L + 1);
      for (i = 0; i < L; i++) mk[i] = mk[i + L] = mark[id(seq[i].c, seq[i].r)] ? 1 : 0;
      for (i = 0; i < 2 * L; i++) pre[i + 1] = pre[i] + mk[i];
      // 环上现有的无向边（闸 ① 用）
      var ecnt = {}, a, b, ek;
      for (i = 0; i < L; i++) {
        a = seq[i]; b = seq[(i + 1) % L];
        var ka = a.c + ',' + a.r, kb = b.c + ',' + b.r;
        ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
        ecnt[ek] = (ecnt[ek] || 0) + 1;
      }
      // 闸 ③ 的基准：当前圈内集合
      var inOld = innerCells(seq), inKeys = [];
      for (var kk in inOld) inKeys.push(kk);
      // 挑"削减格数最多"的候选：k = 环上步进，中间格数 = k-1
      var bi = -1, bk = 0;
      for (i = 0; i < L; i++) {
        for (k = 2; k <= L - 3; k++) {                 // 结果长度 = L-k+1 ≥ 4
          if (pre[i + k] - pre[i + 1] !== 0) break;    // 中间出现轮廓格 → 更远的 k 必然也含它
          if (k <= bk) continue;
          var p = seq[i], q = seq[(i + k) % L];
          if (Math.abs(p.c - q.c) + Math.abs(p.r - q.r) !== 1) continue;
          var kp = p.c + ',' + p.r, kq = q.c + ',' + q.r;
          var ne = kp < kq ? kp + '|' + kq : kq + '|' + kp;
          if (ecnt[ne]) continue;                      // 闸 ①
          if (tried[i + ':' + k]) continue;
          bk = k; bi = i;
        }
      }
      if (bi < 0) break;
      // 应用：摘掉 bi+1 … bi+bk-1，保留 bi 与 bi+bk，收一条直边
      var out = [seq[bi]], t;
      for (t = bk; t < L; t++) out.push(seq[(bi + t) % L]);
      var keepInner = true;
      if (ringOkFull(out)) {                           // 闸 ②
        var inNew = innerCells(out);                   // 闸 ③
        for (t = 0; t < inKeys.length; t++) {
          if (!inNew[inKeys[t]]) { keepInner = false; break; }
        }
      } else keepInner = false;
      if (keepInner) { seq = out; tried = {}; }
      else tried[bi + ':' + bk] = 1;
    }
    return seq;
  }

  // ---- ⑦ 相邻双十字重织（v1.4.9）：straightenRing 之后最后一道形状收尾 ----
  //   ▍病根（14:56 盘实锤）：主解 mm=2 的 DFS 首命中产出"相邻双十字"——两个相邻格各被走
  //   2 次、8 条关联边全用上，而同覆盖的干净走法存在。straightenRing 的十字配对只优化
  //   拐弯数且不改变边集，消不掉；择优字典序只在完整解之间比，管不到解内部形状。
  //   ⚠️ contourB 由调用方传入（v2 与 v1 各自的轮廓位图），闸 ③ 的 ringStats 口径不变。
  function reweaveTwins(ringIn, contourB) {
    var seq = ringIn, round, i;
    for (round = 0; round < 8; round++) {              // 贪心循环：可有多处独立双十字
      var n = seq.length;
      if (n < 6) break;
      var vis = {};
      for (i = 0; i < n; i++) {
        var k = seq[i].c + ',' + seq[i].r;
        (vis[k] = vis[k] || []).push(i);
      }
      var twins = [];
      for (var kk in vis) if (vis[kk].length === 2) twins.push(kk);
      var applied = false;
      for (var ai = 0; ai < twins.length && !applied; ai++) {
        for (var bi = 0; bi < twins.length && !applied; bi++) {
          if (ai === bi) continue;
          var pa = twins[ai].split(','), pb = twins[bi].split(',');
          if (Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) !== 1) continue;  // A、B 相邻
          var va = vis[twins[ai]], vb = vis[twins[bi]];
          // 4 种访问配对 [i1, i2, jb, ja]：要求 B 的某次访问紧跟 A 的某次访问（ja = jb+1）
          var combos = [
            [va[0], vb[0], vb[1], va[1]],
            [va[0], vb[1], vb[0], va[1]],
            [va[1], vb[0], vb[1], va[0]],
            [va[1], vb[1], vb[0], va[0]]
          ];
          for (var c4 = 0; c4 < 4 && !applied; c4++) {
            var i1 = combos[c4][0], i2 = combos[c4][1], jb = combos[c4][2], ja = combos[c4][3];
            if ((jb + 1) % n !== ja) continue;
            // 旋转到 ja+1 为起点：布局 [P4][A₁][P1][B₁][P2][B₂]，JA = n-1，无回绕分段
            var s = (ja + 1) % n;
            var I1 = (i1 - s + n) % n, I2 = (i2 - s + n) % n, JB = (jb - s + n) % n;
            if (I1 < 1 || I2 <= I1 || JB <= I2 || JB !== n - 2) continue;
            // ▍唯一几何前提：A₁ 的来路格与 B₁ 的去路格正交相邻
            var X = seq[(s + I1 - 1) % n], Y = seq[(s + I2 + 1) % n];
            if (Math.abs(X.c - Y.c) + Math.abs(X.r - Y.r) !== 1) continue;
            var nr = [], t;
            for (t = 0; t <= I1 - 1; t++) nr.push(seq[(s + t) % n]);       // P4（不含 A₁）
            for (t = I2 + 1; t <= JB; t++) nr.push(seq[(s + t) % n]);      // P2（含 B₂）
            for (t = I2 - 1; t >= I1 + 1; t--) nr.push(seq[(s + t) % n]);  // P1 反向（不含两端）
            nr.push(seq[(s + I1) % n]);                                    // A₁（保 1 次）
            if (!ringOkFull(nr)) continue;                                 // 闸 ①
            var inOld = innerCells(seq), inNew = innerCells(nr), ok2 = true;
            for (var k3 in inOld) if (!inNew[k3]) { ok2 = false; break; }
            if (!ok2) continue;                                            // 闸 ②
            var stO = ringStats(seq, contourB), stN = ringStats(nr, contourB);
            if (stN.cross >= stO.cross || stN.cov < stO.cov) continue;     // 闸 ③
            seq = nr; applied = true;
          }
        }
      }
      if (!applied) break;
    }
    return seq;
  }

  // ======================= 精确兜底：圈空间枚举（原嵌套版逐字迁移） =======================

  function bestRingExact(U, F, um, bud) {
    var bd = boundaryOf(U, F, um), B = bd.B, Bl = bd.Bl;
    if (Bl.length < 4) return null;
    var H = helpersOf(U, B, um);
    var i, r, c, u, z, k;

    // ---- 建图：顶点 = 轮廓 ∪ 补格；边 = 四邻相邻 ----
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

    // ---- 生成森林（BFS）→ 基本圈基 ----
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
    if (rank <= 0 || rank > RAIL_RANK_CAP) return null;      // 维数过大 → 放弃，退回剥层

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
    // 多目标择优的另两个分量（v0.6.17）：十字格数、用到的格数
    var bestCross = Infinity, bestCells = Infinity;
    var left = bud.left, deadline = bud.deadline || 1e15;

    // 深检查：偶度 + 连通 + 围住镇中心
    function fullCheck() {
      var start = -1, h1, t1, list2, z2, k2, v2;
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
      for (b1 = 0; b1 < verts.length; b1++) {
        if (deg[verts[b1]] > 0) { nv++; if (deg[verts[b1]] > 2) nc2++; }
      }
      if (cov < bestCov) return;
      if (cov === bestCov && nc2 > bestCross) return;
      if (cov === bestCov && nc2 === bestCross && nv >= bestCells) return;
      if (!fullCheck()) return;
      bestCov = cov; bestCross = nc2; bestCells = nv; bestEdges = inE.slice();
    }

    // 异或切换一条基本圈：圈上的边"在/不在"之间翻转（必须真异或，见原注释）。
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

    // ---- Hierholzer：把选中的偶度子图走成有序闭环 ----
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

  // 反缩水保险的覆盖数比较（原 contourCov，v0.6.4 口径）
  function contourCov(ring, B) {
    var seen = {}, cov = 0, i, z;
    for (i = 0; i < ring.length; i++) {
      z = id(ring[i].c, ring[i].r);
      if (B[z] && !seen[z]) { seen[z] = 1; cov++; }
    }
    return cov;
  }

  return {
    N: N, id: id, colOf: colOf, rowOf: rowOf, inB: inB, ringOf: ringOf,
    setPROT: function (p) { PROT = p; },
    floodU: floodU, computeF: computeF, pruneU: pruneU, normalize: normalize,
    keepCoreComponent: keepCoreComponent, neckCells: neckCells, thinNeck: thinNeck,
    boundaryOf: boundaryOf, helpersOf: helpersOf,
    closedTrail: closedTrail, bestRingExact: bestRingExact,
    floodFromBorder: floodFromBorder, coreEnclosed: coreEnclosed, enclosesCore: enclosesCore,
    innerCells: innerCells, ringStats: ringStats, ringBetter: ringBetter,
    ringOkFull: ringOkFull, contourCov: contourCov, trimDetours: trimDetours,
    reweaveTwins: reweaveTwins
  };
}

GS.recomputeRails = function () {
  var COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS, N = COLS * ROWS;
  var DC = RAIL_DC, DR = RAIL_DR;       // v2 重构：原函数内 var 提升为模块常量（防 window 撞名）
  var CORE_C = GS.core.c, CORE_R = GS.core.r;

  // —— v2 重构（机械拆解）：原嵌套函数已整体迁至模块级 makeRailSolverKit，
  //    这里只建实例 + 起别名，函数体逐字未动 ⇒ 行为逐格不变（63 用例回归为闸）。——
  var KIT = makeRailSolverKit(COLS, ROWS, CORE_C, CORE_R);
  var inB = KIT.inB, id = KIT.id, colOf = KIT.colOf, rowOf = KIT.rowOf, ringOf = KIT.ringOf;
  var floodU = KIT.floodU, computeF = KIT.computeF, pruneU = KIT.pruneU, normalize = KIT.normalize;
  var keepCoreComponent = KIT.keepCoreComponent, neckCells = KIT.neckCells, thinNeck = KIT.thinNeck;
  var boundaryOf = KIT.boundaryOf, helpersOf = KIT.helpersOf;
  var closedTrail = KIT.closedTrail, bestRingExact = KIT.bestRingExact;
  var floodFromBorder = KIT.floodFromBorder, coreEnclosed = KIT.coreEnclosed, enclosesCore = KIT.enclosesCore;
  var innerCells = KIT.innerCells, ringStats = KIT.ringStats, ringBetter = KIT.ringBetter;
  var ringOkFull = KIT.ringOkFull, contourCov = KIT.contourCov, trimDetours = KIT.trimDetours;

  // ---- 四个上限（数值都有实测依据，别随手调；RANK_CAP 随 bestRingExact 迁为模块常量 RAIL_RANK_CAP） ----
  var XMAX = 6;        // 十字格数上限：45° 斜切角一般 1 个就够，给 6 是留余量
  var HMAX_CAP = 16;   // 补格数（H）上限：避免在怪图上白烧预算（旧名 KMAX_CAP，v0.6.18 改名对齐语义）
  var TOL_MAX = 6;     // 容差阶梯上限：允许放弃的轮廓格数（6 是实测拐点，见设计规格 §2 步骤 7）
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
  // forceRefresh = 玩家点「强制刷新」时的一次性开关（v0.9.0，UI 侧用完即复位）：
  //   同样关掉墙钟，把三处时间闸（①700 / ②250 / ⑤150ms）一起放开，让求解器一直搜到
  //   节点预算耗尽为止 —— 极端"肥带"盘面在闸内搜不出覆盖全部的环时会沿用旧环（表现为
  //   "新清的地块铁轨没接过去"），这个开关就是让玩家主动用时间换正确性。
  //   ⚠️ 只放开**预算**，不放宽任何铺轨规则（正交/正交相邻/围住镇中心全照旧）。
  function freshBudget(ms) {
    var noDeadline = GS.debugNoDeadline || GS.forceRefresh;
    return { left: 1500000, deadline: noDeadline ? 1e15 : Date.now() + ms };
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
  KIT.setPROT(PROT);   // 削脖子（neckCells）的保护位图：位图就绪后注入工具箱（晚绑定）

  // 并行分片合并用（v1.6 solver-async）：worker 解完把终环的三量统计回传主线程，
  //   主线程按 ringBetter 同判据合并取最优。ringStats/ringBetter 已随 v2 机械拆解迁入
  //   makeRailSolverKit（模块级唯一定义，本函数开头起别名引用）；GS.ringStatsOf 仍在此
  //   挂到 GS 上 —— worker 胶水先调 recomputeRails 再读它 ⇒ 必然就绪。
  GS.ringStatsOf = function (ring) { return ringStats(ring, GS.contourB); };

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
    //   v1.0（大王 2026-09-28 拍板）：两趟 closedTrail 的 mm 全部 1→2 ——
    //   主解与⑤共用"分岔"许可（每边 ≤2 次、重走边限桥边、树分量禁入），
    //   实测满覆盖 75.8%→93.6%、真失败 23.8%→6.4%、中位 166→19ms（298 轮确定性盘）。
    for (ki = 0; ki <= hLimitCap; ki++) {
      if (budget.left < 0) break;
      hLimit = desc ? hLimitCap - ki : ki;
      idx = closedTrail(B, Bl, H, A, budget, hLimit, 1, 0, tol, 0, 2) ||
            closedTrail(B, Bl, H, A, budget, hLimit, 2, XMAX, tol, 0, 2);
      if (idx) { ring = ringOf(idx); if (enclosesCore(ring)) { hitKi = hLimit; break; } }
    }
    if (hitKi < 0) return null;                 // 连 si=0 都走不出环 → 交给下一级兜底
    // 定档那次的解直接进择优容器（省掉 si=0 在 k* 档的重跑）
    bestRing = ring; var m0 = ringStats(ring, B);
    bestCover = m0.cov; bestCross = m0.cross; bestCells = m0.cells;

    // ② 择优：在 k* 档上跑其余起点（si=0 已在 ① 里跑过）。
    //   ▍早停剪枝（v0.6.19 → v1.5 双闸收紧）：**十字 0 且满覆盖**才是字典序理论最优
    //     （①覆盖优先于②十字），两个条件都满足才不必再试剩下的起点。
    //     ⚠️ v1.5 之前只有 `bestCross === 0` 一条闸 —— 1846 盘（2026-10-08 sid 09:46）
    //        关墙钟口径实锤踩中：先命中"覆盖 70、0 十字"即收工，输出覆盖 70 < 满覆盖 72，
    //        违反字典序（真实玩法靠墙钟掐换档位侥幸没踩）。300 求解回合 A/B 实测收紧代价
    //        +0.1%（26748→26783ms、最差 1007→1010ms、超 700ms 盘数不变）——剩余起点
    //        每起点仅烧 0.5~2k 节点 + 墙钟硬闸兜底；输出差异 10/300：覆盖更高 2 / 更低 0。
    //   ▍起点全量（v1.1，大王 2026-09-28 14:48 盘拍板"别挑了，全试"）：
    //     旧 `START_TRIES=9` 是 mm=1 时代的实测拐点（2026-09-23 盘 42 起点只有 3 个能出十字 1）。
    //     mm=2 后解空间方差变大 —— 14:48 盘 36步/十字2 的更优解只在 si=21/23/24/26/28 出现，
    //     9 窗口全错过（择优判据 ringBetter 无罪，纯粹没试到）。201 盘三模式 A/B：
    //     全窗口 better 1 / worse 0 / same 200，均 4.6→4.9ms、最差 71→87ms ——
    //     每起点仅烧 0.5~2k 节点，与"每起点各爬完整阶梯"（15~47 万节点）差两个数量级，放心全试。
    //     "挑好起点排序"已证伪（6 种方位 + 角点优先全追不平或靠 n=1 巧合）。
    var startN = Bl.length;
    for (si = 1; si < startN; si++) {
      if (budget.left < 0) break;
      // ★ 并行分片跳格（v1.6）：GS.__shard={n,k} 时本调用只扫 si≡k (mod n) 的起点。
      //   ①定档（si=0）在所有分片里原样跑 ⇒ k* 各片一致，②的搜索空间按起点划分
      //   互不重叠、并起来恰为全量。shard=null（同步路径/单 worker）时一句不过 ⇒ 零行为变化。
      //   铁闸与早停双闸都在跳格判断之后原样生效。
      if (GS.__shard && si % GS.__shard.n !== GS.__shard.k) continue;
      if (bestCross === 0 && bestCover >= Bl.length) break;   // ★ 早停（v1.5 双闸）：十字 0 且满覆盖
      idx = closedTrail(B, Bl, H, A, budget, hitKi, 1, 0, tol, si, 2) ||
            closedTrail(B, Bl, H, A, budget, hitKi, 2, XMAX, tol, si, 2);
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
    // v0.9：起点上限放开到全量 Bl（旧 START_TRIES=9 是主解的量，对 spur 不够 ——
    //   五张问题盘的更优解都在 9 名之外的起点上）。
    //   ⚠️ 配套（s241 翻车教训）：预算必须随起点数放大 —— 全量起点 × 旧 150 万节点
    //   会在前几十个起点的"证明无解"上烧干，后面的起点（正解所在）轮不到
    //   （实测 s241：v0.8.4 11ms 找到 cov32，全量起点+旧预算 794ms found=false）。
    //   每起点一份 150 万，放大在**调用点**做（recomputeRails 里 `b.left = 150万 × 40`）；
    //   墙钟仍是硬闸（SPUR_BUDGET_MS = 150ms）。
    var startN = Bl.length;
    // ▍容差阶梯从 0 严格递升（与主解 ① 同哲学；v0.8.0 首版"单档 tolTop+首命中"实测教训）：
    //   有了折返自由后，DFS 的"首命中"解很邋遢 —— 0721 型半岛盘只拿到 cov14（满解是 cov18），
    //   E 型半岛盘甚至在 tolTop 单档上什么都搜不到。改成 t=0,1,…,tolTop 逐档试：
    //   t 档任何解都有 cov ≥ |Bl|−t，**先命中的档覆盖下界最高**；档内跑满多起点按
    //   ringBetter 择优（满覆盖零十字提前收工），命中一档就停（更松的档下界只会更低）。
    //   代价是低档"证明无解"的指数阶
    //   （主解 v0.6.19 两次翻车的同一坑）——由共用预算 + 250ms 墙钟兜底：
    //   烧穿 = 保留主解，无害降级（本级是增益通道，不是保底通道）。
    // ▍v0.9 十字递升阶梯（五张问题盘的根治术）：旧版单档 SPUR_XMAX=8 直接放开，
    //   DFS 生成侧大量产出"带多余十字的脏解"，择优只能在这批脏解里挑（13:16 的 44 步、
    //   13:50 的 36 步、14:28 的 52 步干净解全被埋没；XMAX=2 实验一击命中三张）。
    //   复刻主解"优先干净解"哲学：xcap 从 2 递升到 SPUR_XMAX。
    //   ⚠️ 循环层级（s68/p1022 翻车教训，34~39 秒还 found=false）：**起点在外、
    //     十字档在中、容差档在最内**。旧排法（xcap 最外）会让 x=2 档把全部起点的
    //     "低十字证明无解"指数阶烧完才升档 —— 单个起点 15~47 万节点 × 44 起点，
    //     6000 万预算都扛不住，而正解（某起点 × xcap=8）根本轮不到。
    //     起点在外 = 每个起点自己爬十字阶梯，首命中即该起点最优（与主解"每起点找
    //     自己的最小档"同构——spur 是增益通道，烧穿保留主解，可接受）。
    //   ⚠️ 容差仍卡死 tolTop（任何解 cov ≥ cov0+1 严格更优铁闸不变）。
    for (si = 0; si < startN; si++) {
      if (bud.left < 0) break;
      // ★ 并行分片跳格（v1.6）：与主解②同一把 GS.__shard 旋钮，语义相同。
      //   循环层级（起点外→十字中→容差内）与 v0.9 铁闸 `st.cov <= cov0 continue` 原样不动。
      if (GS.__shard && si % GS.__shard.n !== GS.__shard.k) continue;
      for (var xcap = 2; xcap <= SPUR_XMAX; xcap += 2) {
      for (t = 0; t <= tolTop; t++) {
        if (bud.left < 0) break;
        // v0.9：每档两遍 —— 常规（直行优先）+ flip（拐弯优先）。
        //   ⚠️ 不做"命中即停"早收工：五张问题盘实证，首个命中解常常不是最优
        //   （13:16 的 46 步解在后续起点里）。跑满档×flip，靠 ringBetter 择优，墙钟兜底。
        for (var fp = 0; fp < 2; fp++) {
          idx = closedTrail(B, Bl, H, A, bud, hLimitCap, 2, xcap, t, si, 2, fp === 1);
          if (!idx) continue;
          var ring = ringOf(idx);
          if (!enclosesCore(ring)) continue;
          var st = ringStats(ring, B);
          // ⚠️ v0.9 铁闸（不可拆）：spur 解只有「覆盖 > 主解」才有资格进择优池。
          //   低十字档常先命中"低覆盖干净解"；若放它进池，择优输出时它会把主解的
          //   高覆盖解顶掉（331 盘 A/B 实测 22 盘覆盖回归，s241 cov32→3）。
          //   采纳语义 = 严格更优才替换，一步都不能松。
          if (st.cov <= cov0) continue;
          if (!bestSt || ringBetter(st, bestSt)) { best = ring; bestSt = st; }
        }
      }
      }
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
  // GS.railFast（v1.4.11 预览快速档）：仅 UI.updateCleanPreview 拖拽预览期间短暂置 true。
  //   只砍耗时门槛，不碰求解逻辑本身 —— 主解墙钟 700→90ms（预览只要"大概形状"，
  //   超时拿次优/无环都只影响预览显示，松手结算仍走全量）。正常玩法永不置位。
  var ring = finalRing(region, usable, contourB, GS.railPath,
                       freshBudget(GS.railFast ? 90 : 700));
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
  //   ▍v1.2 闸门（大王拍板"动手"，2026-09-28）：主解已"满覆盖且 0 十字"时跳过 ②。
  //      依据：v1.1 基线 600 盘体检（常规 300 + 困难 300，真时钟），② 采纳 **0/600** ——
  //      mm=2 + 全起点择优后，① 的解已稳赢枚举路，② 只剩纯耗时（常规盘占总耗时 38%、最慢盘 147ms）。
  //      闸门 = cov ≥ |Bl| 且 cross === 0（ringStats 对 contourB 口径）；主解失败（ring=null）
  //      或不完美时 ② 照常跑，兜底职责不变。理论代价：② 在"格数更少"第三序上的胜出机会被放弃
  //      （600 盘实测零发生）—— 详见规格 v1.2 条目。
  var __blN = 0;
  for (var __q = 0; __q < contourB.length; __q++) __blN += contourB[__q];
  var __stMain = ring ? ringStats(ring, contourB) : null;
  var exact = GS.railFast ? null      // 预览快速档：跳过 ②（占总耗时大头，采纳 0/600）
            : ((__stMain && __stMain.cov >= __blN && __stMain.cross === 0) ? null
            : bestRingExact(region.U, region.F, usable, freshBudget(250)));
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
  var spur = GS.railFast ? null : spurSolver(usable, ring, (function () {   // 快速档跳过 ⑤（采纳 ~1%）
    // v0.9：节点上限随 spur 内部起点数放大（全量起点后单一 150 万会在"证明无解"上
    //   烧干，s241 实锤）。预算对象结构与 freshBudget 一致，仅 left 放大。
    var b = freshBudget(SPUR_BUDGET_MS);
    b.left = 1500000 * 40;      // 40 = 起点数典型上限（Bl ≤ 44），足够全量起点各分一份
    return b;
  })());
  var spurWon = false;
  if (spur && ringStats(spur, contourB).cov > (ring ? ringStats(ring, contourB).cov : -1)) {
    ring = spur;
    spurWon = true;
  }
  if (GS.debugProbe) {
    GS.debugStages = { mainMs: __p1 - __p0, exactMs: __p2 - __p1, spurMs: Date.now() - __p2,
                       spurWon: spurWon };
  }

  // v1.4.11b（大王令）：预览快速档跳过全部形状抛光（⑥/straighten/⑦）——它们只改
  //   路线长度与重复方式，不改覆盖格集合，预览不需要；正常玩法照旧全跑。
  if (!GS.railFast && ring && ring.length >= 4) ring = trimDetours(ring, contourB);

  // 十字直行优先（v0.6.10）：只重排经过十字的走法，环长与格子集合不变。
  //   ⚠️ 实测结论（300 张随机盘面 + 穷举交叉验证）：环在十字上的配对**几乎总是唯一**——
  //      能直行的本来就直行，剩下的是"8 字形相切"（直行会把单环劈成两条环），
  //      只能拐弯；而且这些十字本身是必需的（把 maxVisit 限制成"每格一次"后、
  //      即使把预算放大到 4000ms 也找不到一个无十字的环，47/47 全无解）。
  //      所以本函数是"能直行就直行"的最优选择器，不改变既有行为。
  if (!GS.railFast && ring && ring.length >= 4) ring = GS.straightenRing(ring);   // 快速档跳过（同上）

  // ---- ⑦ 相邻双十字重织（v1.4.9）：straightenRing 之后最后一道形状收尾 ----
  //   straighten 只重排配对不改变边集；双十字需要整段换边，只能在这里织掉。
  if (!GS.railFast && ring && ring.length >= 4) ring = KIT.reweaveTwins(ring, contourB);   // 快速档跳过（同上；工具箱签名带轮廓位图）

  // —— T1 世界观探针（规格 §5-T1）：输出块前捕获一次，空环/成环两分支都覆盖 ——
  if (GS.railProbeOn) {
    __railProbeCapture('v1', region.U, contourB, null, null, null, ring,
      ring ? ringStats(ring, contourB) : null, { provenance: 'v1-chain' });
  }
  if (!ring || ring.length < 4) {
    GS.railPath = [];
    GS.railSet = {};
    GS.railInner = {};          // 没有环 → 无"圈内"
    GS.railRect = null;
    GS.railGrowHints = [];
    GS.contourB = contourB;
    // 站台（v0.9.2，规则 3）：没有环 → 没有站台。守卫是必须的 —— test_rail.js 的
    // 沙箱只加载 map/state/engine，不加载 station.js。
    if (typeof STATION !== 'undefined') STATION.solve(GS.railPath);
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

  // 站台（v0.9.2，规则 3）：铁轨一变，站台随即重选（叠加在轨格上，不占新格）。
  //   守卫生效场景：test_rail.js 沙箱不加载 station.js。
  if (typeof STATION !== 'undefined') STATION.solve(GS.railPath);
};

// ============================================================================
// T1 世界观探针（规格 §5-T1，2026-10-11）：一键 dump 求解器世界观。
//   用法：GS.railProbeOn = true; GS.recomputeRails(); console.log(GS.railProbeText());
//   动机：档案 1.1/1.2 两起盲区病各耗半天，有探针十分钟破案（重构前性价比最高的工装）。
//   捕获点：v1 在输出块前（空环/成环双分支）；v2 在函数尾（含区域构成与终选来源）。
// ============================================================================
GS.railProbeOn = false;
GS.railProbeData = null;

function __railProbeCapture(mode, U, B, H, pen, rm, ring, st, extra) {
  var N = CFG.MAP_COLS * CFG.MAP_ROWS;
  function cp(a) { return a ? a.slice() : null; }
  GS.railProbeData = {
    mode: mode, U: cp(U), B: cp(B), H: cp(H),
    pen: cp(pen),            // v2：加回的块状半岛（含脖子通道，P1 判据命中）
    rm: cp(rm),              // v2：仍被削掉的一格宽走廊（P1 排除）
    ring: ring ? ring.slice() : null, st: st, extra: extra || {}
  };
}

GS.railProbeText = function () {
  var d = GS.railProbeData;
  if (!d) return '(no probe data — GS.railProbeOn = true 后再跑一次求解)';
  var COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS;
  var cnt = function (a) { var n = 0; if (a) for (var i = 0; i < a.length; i++) n += a[i] ? 1 : 0; return n; };
  var lines = [];
  var st = d.st || { cov: 0, cross: 0, cells: 0 };
  lines.push('== rail probe（' + d.mode + '）==');
  lines.push('|U|=' + cnt(d.U) + '  |B|=' + cnt(d.B) + '  |H|=' + cnt(d.H) +
             '  |半岛加回|=' + cnt(d.pen) + '  |走廊削除|=' + cnt(d.rm));
  lines.push('环: 步数=' + (d.ring ? d.ring.length : 0) + '  cov=' + st.cov + '/' + cnt(d.B) +
             '  重走格=' + st.cross + '  去重格=' + st.cells + '  来源=' + (d.extra.provenance || '?'));
  if (d.extra.note) lines.push(d.extra.note);
  lines.push('');
  var railSet = {};
  if (d.ring) for (var q = 0; q < d.ring.length; q++) railSet[d.ring[q].c + ',' + d.ring[q].r] = 1;
  for (var r = 0; r < ROWS; r++) {
    var s = '';
    for (var c = 0; c < COLS; c++) {
      var i = r * COLS + c, cell = GS.grid[r][c], ch;
      if (cell.b) ch = cell.b.type === 'core' ? 'C' : 'T';
      else if (railSet[c + ',' + r]) ch = 'R';
      else if (d.B && d.B[i]) ch = 'B';
      else if (d.H && d.H[i]) ch = 'h';
      else if (d.pen && d.pen[i]) ch = 'P';
      else if (d.rm && d.rm[i]) ch = 'x';
      else if (d.U && d.U[i]) ch = 'u';
      else ch = cell.t === 'rubble' ? '#' : '.';
      s += ch;
    }
    lines.push(s);
  }
  lines.push('图例: C镇中心 T建筑 R铁轨 B轮廓 h补格 P半岛加回 x走廊削除 u区域内 #废墟 .空地(区外)');
  return lines.join('\n');
};

// ============================================================================
// rail-v2：统一乘子图求解器（规格 docs/铁轨求解统一需求规格.md v0.2，2026-10-11）
//
//   ▍与 v1 的结构差异（设计方向 D1–D7，规格附录 A）
//     · 区域（D1+P1）：不再永久截肢块状半岛 —— thinNeck 照跑，但被削分量里
//       **含 2×2 块**（块状空地，P1 拍板 2026-10-11）的整分量加回；一格宽长走廊
//       （1 维链）仍排除。覆盖基准集 B* 因此含半岛轮廓格（09:12 盘正确性缺陷的根治）。
//     · 求解（D2）：单一 mm=2 乘子图通道（主解/⑤支线合一），xcap 阶梯 0/2/4/6/8
//       （0 = 干净解优先，继承旧 mv=1 哲学）× flip 双跑；「si=0 定容差档 → 全起点
//       择优 + 双闸早停」结构与 v1 主解同构（分片合并口径因此保持一致）。
//       补格不爬阶梯（hCap 直接给满，⑤ 的实证结论：爬阶梯的失败证明是指数阶白烧）。
//     · 保底（D3+R3）：进场先备好合法环（旧环复验 → 核心贴身环），锦标赛颗粒无收
//       也绝不 rail(0)（09:12 盘 p50=1005ms 输出空环的教训升格为硬需求）。
//     · 裁判（D6）：主解不完美时跑圈空间精确枚举（RAIL_RANK_CAP 封顶）。
//     · 终选（R4）：prev 环覆盖**不少于**新解即沿用（并列也沿用，规格 v0.2 口径；
//       注意 v1 代码是严格大于才沿用 —— v2 按 spec 文字执行，差异见 AB 报告）。
//     · 后处理（D5）：⑥trimDetours → straightenRing → ⑦reweaveTwins 全保留，mark=B*。
//   ▍预算（P4 拍板「按新结构重分配」）：主解 700ms/150 万节点 + 精确 250ms，
//     快速档（railFast 预览）90ms 且跳过裁判与后处理；debugNoDeadline/forceRefresh
//     语义与 v1 一致（R7）。
//   ▍烧穿省略闸（Q2-①）：同一盘面指纹 + 上轮已完成全量求解 ⇒ 结果确定性相同，
//     直接沿用现环（跳过全部搜索）。仅全量档判定与写入（快速档的烧穿不具代表性）。
//   ▍开关（规格 §8.4）：GS.railV2 默认 false = v1 链路行为零变化。
// ============================================================================
GS.railV2 = false;
GS.__v2cache = null;      // 烧穿省略闸缓存 {fp, railLen}（仅全量档写入）
GS.__v2testNodes = 0;     // 测试旋钮：非 0 时主解/裁判节点预算被压到该值（确定性烧穿用例）
GS.__v2last = null;       // 最近一次 v2 求解的观测数据（A/B 报告与测试用）

// ▍往返/掉头禁令（H5b，大王 2026-10-11 对照页反馈拍板）：
//   ① 掉头格：任何一次通行**同口进出**（进 W 出 W = 在这格里原地折返）——非法；
//   ② 往返格：被走 2 次的格，两趟合计口数 ≤2（W→E 去、E→W 回）——非法。
//   两条合并 ⇒ 任何"伸出去再原路退回"的支线（无论 1 格长还是多格长）全被否决，
//   唯一合法的双走形态 = T 字岔穿越（贴边死角经桥边进出，两端各 3 口）。
//   ⚠️ 只查①会漏（掉头格可能只走一次）；只查②会漏①——对照页反馈轮实锤：
//   v2 曾在单格脖子盘上产出 ...(5,5)→(5,6)→(6,6)→(5,6)→(5,7)... 的"戳一下就退"解。
//   v1 链路不受此禁令约束（legacy 冻结；k60 现行环的双走边两端均为 T 字岔，合规）。
function ringHasBacktrackCell(ring) {
  var L = ring.length, i, visits = {};
  for (i = 0; i < L; i++) {
    var p = ring[i], a = ring[(i - 1 + L) % L], b = ring[(i + 1) % L];
    var k = p.c + ',' + p.r;
    (visits[k] = visits[k] || []).push([a.c - p.c, a.r - p.r, b.c - p.c, b.r - p.r]);
  }
  for (var kk in visits) {
    var vs = visits[kk];
    for (i = 0; i < vs.length; i++) {
      if (vs[i][0] === vs[i][2] && vs[i][1] === vs[i][3]) return true;   // ① 同口进出 = 掉头
    }
    if (vs.length >= 2) {
      var ports = {};
      for (i = 0; i < vs.length; i++) {
        ports[vs[i][0] + ',' + vs[i][1]] = 1;
        ports[vs[i][2] + ',' + vs[i][3]] = 1;
      }
      var n = 0;
      for (var pk in ports) n++;
      if (n <= 2) return true;                                           // ② 往返格
    }
  }
  return false;
}

GS.recomputeRailsV2 = function () {
  var COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS, N = COLS * ROWS;
  var CORE_C = GS.core.c, CORE_R = GS.core.r;
  var KIT = makeRailSolverKit(COLS, ROWS, CORE_C, CORE_R);
  var id = KIT.id, colOf = KIT.colOf, rowOf = KIT.rowOf;
  var __t0 = Date.now();

  // 0) 可铺轨位图 + 保护位图
  var usable = new Uint8Array(N);
  for (var r0 = 0; r0 < ROWS; r0++) {
    for (var c0 = 0; c0 < COLS; c0++) {
      var cell0 = GS.grid[r0][c0];
      usable[id(c0, r0)] = (cell0.t === 'blank' && !cell0.b) ? 1 : 0;
    }
  }
  var PROT = new Uint8Array(N);
  for (var pr0 = -1; pr0 <= 1; pr0++) {
    for (var pc0 = -1; pc0 <= 1; pc0++) {
      if (KIT.inB(CORE_C + pc0, CORE_R + pr0)) PROT[id(CORE_C + pc0, CORE_R + pr0)] = 1;
    }
  }
  KIT.setPROT(PROT);

  // 盘面指纹（只看可铺轨位图；金币/装饰不影响解）
  var fp = [];
  for (var rr0 = 0; rr0 < ROWS; rr0++) {
    var s = '';
    for (var cc0 = 0; cc0 < COLS; cc0++) s += usable[id(cc0, rr0)] ? '1' : '0';
    fp.push(s);
  }
  fp = fp.join('|');

  // 旧环复验（保底环候选 A）：每格可铺 + 逐边正交 + 仍围核心
  function prevRingValid() {
    var pr = GS.railPath;
    if (!pr || pr.length < 4 || !KIT.enclosesCore(pr)) return null;
    if (ringHasBacktrackCell(pr)) return null;   // H5b：旧环含往返格（v1 产物）不得沿用
    for (var i = 0; i < pr.length; i++) {
      var a = pr[i], b = pr[(i + 1) % pr.length];
      if (!usable[id(a.c, a.r)] || Math.abs(a.c - b.c) + Math.abs(a.r - b.r) !== 1) return null;
    }
    return pr;
  }
  var prev = prevRingValid();

  // —— 烧穿省略闸：同指纹 + 上轮已完成全量求解 + 输出字段未被别路覆盖 ⇒ 原样保留 ——
  if (!GS.railFast && GS.__v2cache && GS.__v2cache.fp === fp && prev &&
      GS.__v2cache.railLen === GS.railPath.length) {
    GS.__v2last = { provenance: 'skip', ms: Date.now() - __t0, fp: fp };
    if (GS.railProbeOn) {
      __railProbeCapture('v2-skip', null, GS.contourB, null, null, null, GS.railPath,
        KIT.ringStats(GS.railPath || [], GS.contourB), { provenance: 'skip' });
    }
    return;
  }

  // —— 保底环候选 B：核心贴身环（3×3 外圈 8 格全可铺才有）——
  function coreRing() {
    var seq8 = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
    var out = [];
    for (var i = 0; i < 8; i++) {
      var c = CORE_C + seq8[i][0], r = CORE_R + seq8[i][1];
      if (!CFG.inBounds(c, r) || !usable[id(c, r)]) return null;
      out.push({ c: c, r: r });
    }
    return out;
  }
  var bottom = prev || coreRing();

  // —— 区域 v2（D1+P1）：完整泛洪 → 削脖子 → 块状半岛加回 ——
  var Ufull = KIT.floodU(usable);
  var U2 = new Uint8Array(Ufull);
  KIT.thinNeck(U2);
  KIT.keepCoreComponent(U2);
  KIT.pruneU(U2);
  var removed = [], i0;
  for (i0 = 0; i0 < N; i0++) if (Ufull[i0] && !U2[i0]) removed.push(i0);
  var penBlocked = new Uint8Array(N), rmCorridor = new Uint8Array(N);
  if (removed.length) {
    // 被削格按「在 Ufull 内相邻」分连通分量；含 2×2 块（P1 判据）的整分量加回
    var seenR = new Uint8Array(N), comps = [], ri, d, m;
    for (ri = 0; ri < removed.length; ri++) {
      var s0 = removed[ri];
      if (seenR[s0]) continue;
      var st = [s0], comp = [];
      seenR[s0] = 1;
      while (st.length) {
        var p = st.pop();
        comp.push(p);
        var pc = colOf(p), pr = rowOf(p);
        for (d = 0; d < 4; d++) {
          var nc = pc + RAIL_DC[d], nr = pr + RAIL_DR[d];
          if (!CFG.inBounds(nc, nr)) continue;
          var q = id(nc, nr);
          if (Ufull[q] && !U2[q] && !seenR[q]) { seenR[q] = 1; st.push(q); }
        }
      }
      comps.push(comp);
    }
    for (var ci = 0; ci < comps.length; ci++) {
      var cp2 = comps[ci], inC = new Uint8Array(N), block = false, m2, z, zc, zr;
      for (m2 = 0; m2 < cp2.length; m2++) inC[cp2[m2]] = 1;
      for (m2 = 0; m2 < cp2.length && !block; m2++) {
        z = cp2[m2]; zc = colOf(z); zr = rowOf(z);
        if (CFG.inBounds(zc + 1, zr) && CFG.inBounds(zc, zr + 1) && CFG.inBounds(zc + 1, zr + 1) &&
            inC[id(zc + 1, zr)] && inC[id(zc, zr + 1)] && inC[id(zc + 1, zr + 1)]) block = true;
      }
      // ▍挂接合法性（H5b 前移，2026-10-11 对照页反馈轮补丁）：块状分量还要存在
      //   **挂接边 (M,X) 两端各 ≥3 邻口**才加回——贴边死角（桥边两端 3 口）✓；
      //   窄脖子块（脖子格只有 2 口，收编必产往返/掉头格）不加回。否则这些格
      //   进入 B* 后永远覆盖不到，容差阶梯为"证明它们不可行"指数级烧预算，
      //   连本来毫秒级可解的干净环都被拖死（hard16 实锤：v1 5ms 满覆盖 vs
      //   v2 烧穿 450 万落保底环）。
      var attachable = false, ai2, aj2, d2, nn2;
      if (block) {
        for (ai2 = 0; ai2 < cp2.length && !attachable; ai2++) {
          z = cp2[ai2]; zc = colOf(z); zr = rowOf(z);
          for (d2 = 0; d2 < 4 && !attachable; d2++) {
            var ac = zc + RAIL_DC[d2], ar = zr + RAIL_DR[d2];
            if (!CFG.inBounds(ac, ar)) continue;
            var mid = id(ac, ar);
            if (inC[mid] || !U2[mid]) continue;          // 邻居须是主体（削脖后仍在 U2）
            // 挂接边 (M=mid, X=z)：两端各自在「主体∪分量」里的邻居数 ≥3
            var degM = 0, degX = 0;
            for (nn2 = 0; nn2 < 4; nn2++) {
              var w1 = id(ac + RAIL_DC[nn2], ar + RAIL_DR[nn2]);
              var w2 = id(zc + RAIL_DC[nn2], zr + RAIL_DR[nn2]);
              if (CFG.inBounds(ac + RAIL_DC[nn2], ar + RAIL_DR[nn2]) && (U2[w1] || inC[w1])) degM++;
              if (CFG.inBounds(zc + RAIL_DC[nn2], zr + RAIL_DR[nn2]) && (U2[w2] || inC[w2])) degX++;
            }
            if (degM >= 3 && degX >= 3) attachable = true;
          }
        }
      }
      if (attachable) { for (m = 0; m < cp2.length; m++) { U2[cp2[m]] = 1; penBlocked[cp2[m]] = 1; } }
      else { for (m = 0; m < cp2.length; m++) rmCorridor[cp2[m]] = 1; }
    }
  }
  var F = KIT.computeF(U2);
  var bd = KIT.boundaryOf(U2, F, usable), B = bd.B, Bl = bd.Bl;
  var H = KIT.helpersOf(U2, B, usable), A = new Uint8Array(N);
  var hcount = 0, s1;
  for (s1 = 0; s1 < N; s1++) { if (B[s1] || H[s1]) A[s1] = 1; if (H[s1]) hcount++; }
  var hCap = hcount < 16 ? hcount : 16;

  // —— 统一锦标赛（D2；si=0 定容差档 → 全起点择优，与 v1 主解同构）——
  var V2_MAIN_MS = GS.railFast ? 90 : 700, V2_EXACT_MS = 250;
  // 主池节点 = 450 万（对齐 v1 全链四级预算总量 ~3×150万；hard6 实测：单池 150 万在
  //   1.67M 节点处的解被截断、烧穿落核心环，×10 则命中同 v1 的 52 步满覆盖）。
  //   生产端 700ms 墙钟仍是硬顶，此值只放宽无墙钟口径（测试/强刷）的搜索上限。
  var V2_NODES = GS.__v2nodesOverride || GS.__v2testNodes || 4500000;   // override=调参旋钮 / test=确定性烧穿用例
  function freshV2(ms) {
    var noDeadline = GS.debugNoDeadline || GS.forceRefresh;
    return { left: V2_NODES, deadline: noDeadline ? 1e15 : Date.now() + ms };
  }
  var bud = freshV2(V2_MAIN_MS);
  var main = null, mainSt = null, tolStar = -1, hitKi = -1;

  // ▍搜索结构 = v1 主解镜像（2026-10-11 深夜 A/B 教训）：补格阶梯 0→cap 定档、
  //   档内 mv=1 干净解优先 → mv=2(×8) 放开、每档首命中即该起点结果、跨起点按
  //   ringBetter 择优。首版曾把 hCap 直接给满（⑤spur 的实证结论）+ xcap/flip 阶梯
  //   —— 84 盘 A/B 实锤 10 盘烧穿颗粒无收（v1 同盘 6~74ms 满覆盖）：无阶梯的大 A
  //   让 DFS 溺水，正是档案已证伪清单第 1 条（扩搜索空间 → 满覆盖反降）在 v2 重演。
  //   与 v1 的唯一差异：gate=1（脖子门格放行，P1 半岛通道）+ xmax 上限 8（含 T 岔）。
  function solveAt(si, tol, kiFixed) {
    var lo = 0, hi = hCap;
    if (kiFixed !== null && kiFixed !== undefined) { lo = kiFixed; hi = kiFixed; }
    for (var ki = lo; ki <= hi; ki++) {
      if (bud.left < 0) return null;
      var idx = KIT.closedTrail(B, Bl, H, A, bud, ki, 1, 0, tol, si, 2, false, 1) ||
                KIT.closedTrail(B, Bl, H, A, bud, ki, 2, 8, tol, si, 2, false, 1);
      if (idx) {
        var rg = KIT.ringOf(idx);
        if (KIT.enclosesCore(rg) && !ringHasBacktrackCell(rg)) return { ring: rg, ki: ki };
      }
    }
    return null;
  }

  // ① 定档：si=0 跑 tol × ki 双阶梯（各分片都跑 ⇒ 分片合并口径一致）
  for (var tol = 0; tol <= 6; tol++) {
    if (bud.left < 0) break;
    var hit = solveAt(0, tol, null);
    if (hit) { main = hit.ring; mainSt = KIT.ringStats(hit.ring, B); tolStar = tol; hitKi = hit.ki; break; }
  }
  // ② 择优：定档位全起点首命中 + ringBetter 锦标赛（分片跳格 + 双闸早停，v1 同款）
  if (main) {
    var bestRing = main, bestSt2 = mainSt, si;
    for (si = 1; si < Bl.length; si++) {
      if (bud.left < 0) break;
      if (GS.__shard && si % GS.__shard.n !== GS.__shard.k) continue;
      if (bestSt2.cross === 0 && bestSt2.cov >= Bl.length) break;   // 双闸早停（v1.5 同款）
      var h2 = solveAt(si, tolStar, hitKi);
      if (h2) {
        var st2 = KIT.ringStats(h2.ring, B);
        if (KIT.ringBetter(st2, bestSt2)) { bestRing = h2.ring; bestSt2 = st2; }
      }
    }
    main = bestRing; mainSt = bestSt2;
  }

  // —— 精确裁判（D6）：主解不完美才跑；快速档跳过 ——
  var exact = null;
  if (!GS.railFast) {
    var perfect = mainSt && mainSt.cov >= Bl.length && mainSt.cross === 0;
    if (!perfect && Bl.length >= 4) exact = KIT.bestRingExact(U2, F, usable, freshV2(V2_EXACT_MS));
  }

  // —— 终选（R4）：prev 覆盖不少于新解 ⇒ 沿用 prev（并列也沿用，规格口径）——
  var ring = null, ringSt = null, prov = 'none';
  if (main) { ring = main; ringSt = mainSt; prov = 'main'; }
  if (exact) {
    var eSt = KIT.ringStats(exact, B);
    if (!ring || KIT.ringBetter(eSt, ringSt)) { ring = exact; ringSt = eSt; prov = 'exact'; }
  }
  if (prev) {
    var pSt = KIT.ringStats(prev, B);
    if (!ring || !KIT.ringBetter(ringSt, pSt)) { ring = prev; ringSt = pSt; prov = 'prev'; }
  }
  if (!ring && bottom) { ring = bottom; ringSt = KIT.ringStats(bottom, B); prov = 'core'; }

  // —— 后处理（D5；快速档跳过，与 v1 同哲学）——
  if (!GS.railFast && ring && ring.length >= 4) {
    ring = KIT.trimDetours(ring, B);
    ring = GS.straightenRing(ring);
    ring = KIT.reweaveTwins(ring, B);
  }

  // —— 输出（与 v1 完全同一套 7 字段 + 站台重选）——
  if (!ring || ring.length < 4) {
    GS.railPath = [];
    GS.railSet = {};
    GS.railInner = {};
    GS.railRect = null;
    GS.railGrowHints = [];
    GS.contourB = B;
    if (typeof STATION !== 'undefined') STATION.solve(GS.railPath);
    GS.__v2last = { provenance: 'none', ms: Date.now() - __t0, tolStar: tolStar, budgetLeft: bud.left };
    if (GS.railProbeOn) __railProbeCapture('v2', U2, B, H, penBlocked, rmCorridor, null, null,
      { provenance: 'none(退化盘)', note: 'R3 例外：核心贴身环也不可铺' });
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
  GS.railInner = KIT.innerCells(ring);
  GS.railGrowHints = [];
  GS.contourB = B;
  if (typeof STATION !== 'undefined') STATION.solve(GS.railPath);

  // —— 烧穿省略闸缓存（仅全量档；写入即作废更早盘面的缓存）——
  if (!GS.railFast) GS.__v2cache = { fp: fp, railLen: GS.railPath.length };

  GS.__v2last = { provenance: prov, ms: Date.now() - __t0, tolStar: tolStar,
                  budgetLeft: bud.left, st: ringSt,
                  blN: Bl.length, pen: [], corridor: [] };
  if (GS.railProbeOn) {
    __railProbeCapture('v2', U2, B, H, penBlocked, rmCorridor, ring, ringSt,
      { provenance: prov, note: 'tolStar=' + tolStar + '  budgetLeft=' + bud.left +
        '  耗时=' + (Date.now() - __t0) + 'ms' });
  }
};

// —— v2 分发（规格 §8.4：默认 v1，开关翻转对 v1 路径零影响）——
GS.__recomputeRailsV1 = GS.recomputeRails;
GS.recomputeRails = function () {
  if (GS.railV2) return GS.recomputeRailsV2();
  return GS.__recomputeRailsV1();
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

// ⚠️【v1.3-rc 退役】三选一牌组随塔防迭代整体退役（拍板分叉 ①：建造全走
//   【抽塔】/【清理】两个按钮）。以下函数**冻结保留不调用** —— 无 git 环境
//   的回退保险（完整快照在 archive/snapshot-v1.2-full-20260928/），
//   test_rules.js 的既有用例也依赖它们。转正后如确认永不回退，可整体删除。
//
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

// ============================================================================
// v1.4 卡牌大改（规格 §14）：新三选一 + 牌库 + 车厢
//   · 形状卡 50% / 英雄卡 50% 独立抽三张，去重（形状按尺寸家族、英雄按元素）；
//   · 形状卡进牌库 ≤ GS.DECK_SHAPE_MAX 张（满了该位重抽为英雄卡）；
//   · 英雄卡卡面写明元素；辅助卡（kind:'aux'）留接口不进池；
//   · 抽卡收费在 UI 层（价格 = GS.drawCost()，v1.6.15 起线性递增 10/20/30…），这里只管发牌。
// ============================================================================
GS.DECK_SHAPE_MAX = 3;    // 牌库形状卡上限（大王拍板 ③：一次性消耗、攒≤3）

GS.pickHeroCard = function (elem) {
  return { kind: 'hero', id: ++GS._cardSeq, elem: elem || TOWERS.ELEMS[Math.floor(Math.random() * 4)] };
};

// 牌库里形状卡张数
GS.deckShapeCount = function () {
  var n = 0;
  for (var i = 0; i < GS.deck.length; i++) if (GS.deck[i].kind === 'shape') n++;
  return n;
};

// 三选一发牌（v1.4）：三张独立随机、互不重复
GS.drawCardOffer = function () {
  var cards = [], sigs = {};
  var guard = 0;
  while (cards.length < 3 && guard++ < 50) {
    var full = GS.deckShapeCount() >= GS.DECK_SHAPE_MAX;   // 满了不出形状卡
    var card;
    if (full || Math.random() < 0.5) {
      card = GS.pickHeroCard();
      if (sigs['hero:' + card.elem]) continue;             // 同元素英雄卡去重
      sigs['hero:' + card.elem] = 1;
    } else {
      card = GS.pickShapeCard();                           // 尺寸/横竖随机
      if (sigs['shape:' + GS.cardSig(card)]) continue;     // 尺寸家族去重
      sigs['shape:' + GS.cardSig(card)] = 1;
    }
    cards.push(card);
  }
  return cards;
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
