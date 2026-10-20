// 全局游戏状态：地块地形 / 经济建筑 / 动态铁轨环 / 三选一
window.GS = {};

GS.newGame = function () {
  GS.gold = 30;   // v1.3.1：初始金币 120 → 30（大王拍板；开局空地仅 2 格，清废墟成为前期核心决策）

  GS.buildings = [];

  // grid[r][c] = { t: 'blank'|'rubble', gold: 是否金币地块, heart: 是否爱心地块,
  //                harvested: 本圈是否已收过（金币/爱心共用一个标记，二者互斥）, b: building|null }
  GS.grid = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var row = [];
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      // 开局除内区外全部废墟（大王定案 2026-09-21 第二批）：空白只来自
      // 3×5 内区、金币/爱心地块（place*Init 只置标记、不动 t）和玩家清理。
      row.push({ t: 'rubble', gold: false, heart: false, harvested: false, b: null });
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

  // 开局资源格撒点（v1.6.22b 统一规则，大王令"爱心和金币都使用一套规则"）：
  //   先爱心（落点带受限，先放掉）、后金币（全区，后放铺开）；两者共用
  //   `GS._placeResource`（最远点采样 + 最小间距 CFG.RES_GAP），互相拉开不贴身。
  //   放不满会整体重试（见 GS.placeResourceInit）。
  GS.goldTiles = [];
  GS.heartTiles = [];
  GS.placeResourceInit();

  // 列车（v0.9.2）：cargo = 车上堆的金币（规则 6，到站才交付）。
  //   v1.6.22：hearts = 车上堆的爱心数（同款"到站才交付"，交付时回血）。
  //   v1.6.25：picked = **拾取流水**（每次拾取 push 一枚 'gold'|'heart'）——只服务
  //     车头屁股货堆的渲染（renderer.js），**不参与任何数值计算**；cargo / hearts
  //     才是数值权威。到站交付时随 deliver 一并清空（一"圈"一堆）。
  //   站台由 recomputeRails 末尾的 STATION.solve 解出，这里先清空。
  GS.train = { index: 0, frac: 0, cargo: 0, hearts: 0, picked: [] };
  // 交付飘字队列（v1.6.32 大王令"交付时飘字，包括生命和金币"）：**纯表现**，
  //   每条 = { kind:'gold'|'heal', text, x, y, t, ttl }。ENG 生成/衰减、REND 绘制。
  GS.floats = [];
  // 粒子层（v1.6.43 大王令 B/E：怪死亡特效 + 爆炸视觉共用地基）。**纯表现**：
  //   每枚 = { kind:'ring'|'puff'|'spark', x, y, ... }（画布像素）。ENG 生成/衰减、REND 绘制。
  GS.fx = [];
  GS.station = null;
  if (typeof CLOCK !== 'undefined') CLOCK.reset();   // 新局回到白天

  // 塔防迭代（v1.3-rc）：塔/怪权威列表 + 镇中心血量（跨波继承）+ 失败旗。
  //   ⚠️ 数值来源 CFG.CORE_HP（config/map.js）—— 此处不能引用 FOES（加载序在后）。
  //   TOWERS/FOES 的数组重置由 ENG.restart 统一调 reset（本函数保持模块无关）。
  GS.towers = [];
  GS.foes = [];
  // 固定刷怪点（v1.6.50 大王令）：GS.nextSpawns = 下一波点位（白天预警画它），
  //   FOES.prepareNext 生成（newGame/波末/FOES.reset 三处触发，此处守卫兜底）。
  GS.nextSpawns = null;
  if (typeof FOES !== 'undefined' && FOES.prepareNext) FOES.prepareNext();
  GS.coreMaxHP = CFG.CORE_HP;
  GS.coreHP = CFG.CORE_HP;
  GS.gameOver = false;
  // 关卡模式通关旗（v1.7.0 §14.62）：新局一律未通关；GS.mode/levelIdx 是元状态不在此清
  GS.levelDone = false;
  // v1.4 卡牌大改：牌库（[{kind:'shape',shape}|{kind:'hero',elem}]）
  // ⚠️ GS.wagons 独立车厢列表已退役（v1.4.1 大王纠偏"车厢是独立作战单位"）：
  //   车厢 = GS.towers 的镜像投影（每座英雄塔一节同元素同星车厢，见 engine.js ENG.WAGON）
  GS.deck = [];
  // v1.4.4（大王拍板 2026-10-08）：抽卡价格线性递增，每次 +5；v1.4.8 首抽 10→5。
  //   公式唯一入口 = GS.drawCost()；GS.drawCount = 本局已付钱抽卡的次数（新局清零，
  //   三选一弹层里放弃/选卡都不退钱也不计数，只在实际扣费时 +1）。
  GS.drawCount = 0;
  // 2026-10-18 大王令：本局**首次三选一**保底 ≥1 张清理形状卡（cards.js 读它，发牌后置 true）
  GS.__offerSeen = false;
  // v1.6.34 词条系统（exp.js / affixes.js）：经验三态 + 地面物三类。
  //   exp = 当前经验；expTaken = 已获得词条数（决定阈值 10+10n）；expPending = 待发牌数。
  //   ⚠️ 状态放 GS（加载序在前）⇒ 新局直接重置，不依赖 exp.js 是否已加载。
  GS.exp = 0; GS.expTaken = 0; GS.expPending = 0;
  GS.mines = []; GS.fireZones = []; GS.frostZones = [];   // 地雷 c1 / 烈焰 c4 / 霜痕 i3
  GS.bullets = [];                                        // 车厢弹丸（v1.8n：机枪/火炮/闪电追踪弹）
  // v1.6.36 大王令"词条选中即全场生效，不需要装备"：**全局词条集合**（id → 1）。
  //   选中即 gainAffix 进这里，对场上所有对应塔型的车厢生效；不进牌库、不落塔。
  GS.playerAffixes = {};
  // v1.6.37 大王令"抽词条卡牌的时候，游戏需要暂停"：**全局暂停旗** ——
  //   词条三选一弹出时置 true（main.js 跳过 ENG.update：昼夜/刷怪/列车/战斗全停，
  //   渲染照常画静止画面），选卡关层即恢复。普通抽卡不暂停（白天本就停车）。
  GS.paused = false;
  // v1.4.5：撤销点（最近一次形状卡清理的 was 快照 + 被消耗的卡），新局清零。
  //   由 UI.settleClean 成功时打包，ENG.undoShape 消费后置 null。
  GS.undoClean = null;

  GS.recomputeRails();
  // v1.6 求解后台化：新局作废飞行中的异步结果（指纹守卫之外的双保险）。
  //   newGame 的开局环保持同步算（12 格小环毫秒级，且列车/渲染立即可用）。
  if (typeof SOLVER_ASYNC !== 'undefined') SOLVER_ASYNC.invalidate();
  // v1.3-rc：三选一退役，nextOffer 已随 v1.6.57 代码精简移除（原文见归档 js-before-cleanup-20261015/cards.js）。
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
  // v1.6.92 精简：挂到 GS 供 solver-async 分片合并复用 —— 此前 solver-async 按定义
  //   复刻了一份 betterSt（⚠️"口径变更两处必须同步改"的漂移隐患），现统一走这里
  //   （worker 内跑同份 state 源码，同样自动带上，双端单一定义）。
  GS.ringBetter = ringBetter;

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
GS.railV2 = true;    // 转正（2026-10-11 大王令）：rail-v2 为默认求解器。回退开关 = 控制台 GS.railV2 = false（v1 链冻结保留为回退路径，test_rail.js 63 用例持续锁其行为）
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
// ▍十字对重接（2026-10-11 大王试玩盘反馈）：环上相邻两格 A、B 各被走 2 次、
//   环序呈 A₁…B₁…[B₂ A₂]（B 的第 2 次紧跟 A 的第 2 次）且两格皆 4 口真十字时，
//   把 A₁→B₁ 之间与 B₁→B₂ 之间的两条通道重接：A₁…P1…B₁ → 反向 P2 → A₂ 的后继，
//   丢弃 A₂（大王手工指出的左下口袋走法：西圈→南下绕南圈反向→接东侧，
//   省 2 步、消 2 个真十字、覆盖不变）。三道闸：全量合法性+H5b、覆盖不降、
//   十字严格减少。找不到该形态或闸不过则原样返回。
function ringDecrossPair(ringIn, KIT, B) {
  var seq = ringIn, round, i, n;
  for (round = 0; round < 8; round++) {
    n = seq.length; if (n < 8) break;
    var vis = {};
    for (i = 0; i < n; i++) { var k = seq[i].c + ',' + seq[i].r; (vis[k] = vis[k] || []).push(i); }
    var keys = Object.keys(vis).filter(function (k) { return vis[k].length === 2; });
    var applied = false;
    for (var ka = 0; ka < keys.length && !applied; ka++) {
      for (var kb = 0; kb < keys.length && !applied; kb++) {
        if (ka === kb) continue;
        var pa = keys[ka].split(','), pb = keys[kb].split(',');
        if (Math.abs(+pa[0] - +pb[0]) + Math.abs(+pa[1] - +pb[1]) !== 1) continue;   // 两格相邻
        for (var ai2 = 0; ai2 < 2 && !applied; ai2++) {
          for (var bj2 = 0; bj2 < 2 && !applied; bj2++) {
            // A = keys[ka]（其第 2 次访问在后），B = keys[kb]；环序 A₁…B₁…B₂A₂ 无回绕
            var A = vis[keys[ka]], Bv = vis[keys[kb]];
            var a2i = A[ai2], a1i = A[1 - ai2];
            var b2i = Bv[bj2], b1i = Bv[1 - bj2];
            if ((b2i + 1) % n !== a2i) continue;
            if (!(a1i < b1i && b1i < b2i && b2i < a2i)) continue;
            var succ = seq[(a2i + 1) % n];
            var P1 = seq.slice(a1i + 1, b1i);                    // A₁→B₁ 之间
            var P2 = seq.slice(b1i + 1, b2i);                    // B₁→B₂ 之间（内部通道）
            if (!P2.length) continue;
            var rp2 = P2.slice().reverse();
            if (Math.abs(rp2[rp2.length - 1].c - succ.c) + Math.abs(rp2[rp2.length - 1].r - succ.r) !== 1) continue;
            var out = seq.slice(0, a1i + 1).concat(P1, [seq[b1i]], rp2, seq.slice(a2i + 1));
            if (!KIT.ringOkFull(out) || ringHasBacktrackCell(out)) continue;
            var so = KIT.ringStats(out, B), ss = KIT.ringStats(seq, B);
            if (so.cov < ss.cov || so.cross >= ss.cross) continue;
            seq = out; applied = true;
          }
        }
      }
    }
    if (!applied) break;
  }
  return seq;
}

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

  // 并行分片合并契约（v1.6 solver-async）：worker 解完读 GS.ringStatsOf 算终环三量回传，
  //   主线程按 ringBetter 合并取最优。
  //   ⚠️⚠️ 必须挂在**本函数**里（v1.6.28 修复）：v1.6.9 rail-v2 转正后本函数成了默认路径，
  //     而此前只有 v1 函数挂了这个钩子 ⇒ v2 下 GS.ringStatsOf 恒 undefined ⇒ worker 胶水
  //     `GS.ringStatsOf ? … : null` 恒得 null ⇒ onResult 的「失败片过滤」`!r.st` 把**每一片
  //     都丢掉** ⇒ best=null ⇒ 主线程静默保留旧环 —— 真浏览器里表现为「清了格子/撤销后
  //     铁轨一动不动」（诊断盘 2026-10-13：车尾下方清出 2×2，rail 仍是开局 12 格环）。
  //     同步路径（newGame / file:// 降级 / 强制刷新）不经 worker，故一直正常 —— 这是
  //     该 bug 藏了这么久的原因：**只有 http + Worker 这条链会触发**。
  //   ⚠️ 位置不能动：必须在**任何 early return 之前**（skip 闸 / 退化盘分支都会提前 return），
  //     否则 worker 第一发就可能读到 undefined。
  GS.ringStatsOf = function (ring) { return KIT.ringStats(ring, GS.contourB); };

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
  // v1.6.69：强刷丢 prev 走冷解——暖解增量通道费时（实报盘暖解 3s 封顶仅 66 步，
  //   冷解 2s 即达最优 62），且"刷新"语义本就是推倒重来；旧环仍留在 GS.railPath，
  //   若本次真一无所得（理论不会，R3 保底）也不至于比之前更糟。
  var prev = GS.forceRefresh ? null : prevRingValid();

  // —— 烧穿省略闸：同指纹 + 上轮已完成全量求解 + 输出字段未被别路覆盖 ⇒ 原样保留 ——
  // ⚠️ 闸门契约补全（2026-10-11 转正轮 test_rules 实锤）：「同指纹已解过 ⇒ 输出
  //   仍在」必须包含站台已解——newGame 不清 railPath 且开局盘指纹与上局末态相同
  //   时（都只剩 3×5 内区可铺），旧闸误跳过 ⇒ 站台 null ⇒ 发车/夜晚全灭。
  //   GS.station 为空即输出不完整，不跳，走全量。
  // ⚠️ v1.6.65 病灶修复（大王实报"强制刷新也不能解决"）：**forceRefresh 必须旁路本闸**——
  //   实机链路：某次清理后 worker 400ms 墙钟掐断 → anytime 保底劣环写入 __v2cache
  //   （fp/railLen 齐备）→ 大王按强制刷新：指纹未变 + 旧环仍 valid + railLen 相同
  //   ⇒ 闸直接 return，0ms 原样保留 ⇒ 刷新形同虚设（重放脚本实锤：skip 0ms / 环未动）。
  //   修复后：forceRefresh 无视省略闸真重算（墙钟本就由 noDeadline 放开）。
  var stComplete = (typeof STATION === 'undefined') || !!GS.station;   // 环境感知：没加载站台模块的沙箱不适用此闸
  if (!GS.railFast && !GS.forceRefresh && stComplete && GS.__v2cache && GS.__v2cache.fp === fp && prev &&
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
  // ▍v2 补格 = 两层（v1 口径）∪ 洞邻格（2026-10-11 大王 k60 反馈轮补丁）：
  //   贴着内部废墟墙（洞 F）的清空格直接算补格——铁轨允许贴内墙走。病根：
  //   只按外轮廓距离铺层时，"贴内墙的紧通道"格距外轮廓可能 3~4 层深（k60 的
  //   (3,9)：墙 (4,9)(4,10) 是洞不算外面，穷举 220 解被迫全走 2 列蛇形 40 步；
  //   加洞邻 1 格后 38 步最优解直接在定档步命中）。盲区家族（档案 1.1/1.2）第
  //   三次发作的根治方向是 A=U（P3），洞邻格是精准小补丁。
  var H = KIT.helpersOf(U2, B, usable), s1;
  for (s1 = 0; s1 < N; s1++) {
    if (!U2[s1] || B[s1] || H[s1] || !usable[s1]) continue;
    var sc1 = colOf(s1), sr1 = rowOf(s1);
    for (var d1 = 0; d1 < 4; d1++) {
      var nc1 = sc1 + RAIL_DC[d1], nr1 = sr1 + RAIL_DR[d1];
      if (CFG.inBounds(nc1, nr1) && F[id(nc1, nr1)]) { H[s1] = 1; break; }
    }
  }
  var A = new Uint8Array(N);
  var hcount = 0;
  for (s1 = 0; s1 < N; s1++) { if (B[s1] || H[s1]) A[s1] = 1; if (H[s1]) hcount++; }
  var hCap = hcount < 16 ? hcount : 16;

  // —— 统一锦标赛（D2；si=0 定容差档 → 全起点择优，与 v1 主解同构）——
  // v1.6.68 大王拍板 A 案：主池墙钟 500→1000ms（劣环侦察 2026-10-15：语料 84 盘
  //   99% 在 500ms 已达无墙钟质量、提预算零收益；尾部难盘（9×13 实报盘）
  //   500ms=74 步劣环 → 1000ms=64 步（-10）→ 2000ms=62 步最优。1000ms 档实测
  //   最差 ~1s ≈ 改前 500ms 档实际最差（墙钟只在探测间检查，本来就超）⇒
  //   冻结增量≈0 而尾部盘大半收益。C 案（检测劣环后台自动换环）已立待办。
  var V2_MAIN_MS = GS.__v2msOverride || (GS.railFast ? 90 : 1000), V2_EXACT_MS = 250;   // __v2msOverride=预算侦察旋钮（默认不设 ⇒ 走本档）
  // v1.6.69 统一墙钟口径（强刷封顶）：debugNoDeadline=测试/质量口径真无墙钟；
  //   forceRefresh=强刷封顶 3000ms——侦查实锤 2000ms 已达实报盘最优（§14.45），
  //   原 1e15 无墙钟在病盘可冻 30s 级；常规路径按各自配额。
  function v2Deadline(ms) {
    if (GS.debugNoDeadline) return 1e15;
    if (GS.forceRefresh) return Date.now() + 3000;
    return Date.now() + ms;
  }
  // 主池节点 = 450 万（对齐 v1 全链四级预算总量 ~3×150万；hard6 实测：单池 150 万在
  //   1.67M 节点处的解被截断、烧穿落核心环，×10 则命中同 v1 的 52 步满覆盖）。
  //   生产端 700ms 墙钟仍是硬顶，此值只放宽无墙钟口径（测试/强刷）的搜索上限。
  var V2_NODES = GS.__v2nodesOverride || GS.__v2testNodes || 4500000;   // override=调参旋钮 / test=确定性烧穿用例
  function freshV2(ms) {
    return { left: V2_NODES, deadline: v2Deadline(ms) };
  }
  var bud = freshV2(V2_MAIN_MS);
  var main = null, mainSt = null, tolStar = -1, hitKi = -1;

  // ▍搜索结构 v2.1：单通道 anytime + 跳步定档（大王 2026-10-11 拍板「上」）：
  //   旧结构（v1 镜像）= 容差 × 补格双阶梯逐级线性爬，每级无解付一次指数阶
  //   "不可能证明"，烧穿前可能颗粒无收。新结构三点：
  //     · **便宜端优先**：乐观探测 (tol=0,ki=0) 一步命中常规盘；未中则 ki 按
  //       0,1,2,4,8,…cap 跳步（可行性对 ki 单调 ⇒ 跳步不漏解），昂贵的高档
  //       探测只剩两三次——首版"宽档二分"实测反劣（84 盘均 174→578ms：宽档
  //       DFS 空间巨大，连可行探测都慢），教训 = 探测点必须放便宜端；
  //     · **anytime**：每个可行探测的环都进 ringBetter 择优（只进不出），
  //       预算内任意时刻手里都有合法环；
  //     · 命中后 bisect 精化最小 ki，再跑全起点锦标赛（分片 + 双闸早停，不变）。
  //   快速车道/双车道方案作废（v1 历史形态；大王"算法角度有没有解"之问的正解）。
  // ▍探测点三态（2026-10-11 reg127 实锤补丁）：st=0 无解（下界）/ st=1 干净环 /
  //   st=2 脏环（有解但首命中带掉头/往返，被 H5b 拒——**仍是可行上界**，不能当无解，
  //   否则单调跳步会在高补格档被脏首命中骗成"整档无解"，烧穿落保底——reg127：
  //   v1 线性爬 2.1s 满覆盖 vs v2 gallop 6s 颗粒无收）。脏命中先试 flip 换半搜索空间。
  function probePoint(si, tol, ki, bd) {
    var bb = bd || bud;
    var idx = KIT.closedTrail(B, Bl, H, A, bb, ki, 1, 0, tol, si, 2, false, 0);
    if (idx) {
      var rg0 = KIT.ringOf(idx);
      if (KIT.enclosesCore(rg0) && !ringHasBacktrackCell(rg0)) return { st: 1, ring: rg0, ki: ki };
    }
    if (bb.left < 0) return { st: 0 };
    var idx2 = KIT.closedTrail(B, Bl, H, A, bb, ki, 2, 8, tol, si, 2, false, 0);
    if (idx2) {
      var rg2 = KIT.ringOf(idx2);
      if (KIT.enclosesCore(rg2) && !ringHasBacktrackCell(rg2)) return { st: 1, ring: rg2, ki: ki };
      // 脏首命中（掉头/往返）：先 flip 换半搜索空间赌干净；赌不到把脏环带回交
      // 「洗环通道」——v1 的 ⑥⑦ 后处理本来就是干这个的（reg127 实锤：v1 兜底
      // 拿到 58 步脏环洗成 48 步干净环；在探测口枪毙脏环 = 把原料当垃圾）
      var idx3 = bb.left >= 0 ? KIT.closedTrail(B, Bl, H, A, bb, ki, 2, 8, tol, si, 2, true, 0) : null;
      if (idx3) {
        var rg3 = KIT.ringOf(idx3);
        if (KIT.enclosesCore(rg3) && !ringHasBacktrackCell(rg3)) return { st: 1, ring: rg3, ki: ki };
      }
      return { st: 2, ring: rg2, ki: ki };
    }
    return { st: 0 };
  }
  var dirtyBest = null, dirtyBestSt = null;
  function absorb(h) {   // anytime 择优（干净环只进不出；脏环另池记录，供洗环通道）
    if (!h) return false;
    if (h.st === 2) {
      var ds = KIT.ringStats(h.ring, B);
      if (!dirtyBest || KIT.ringBetter(ds, dirtyBestSt)) { dirtyBest = h.ring; dirtyBestSt = ds; }
      return false;
    }
    if (h.st !== 1) return false;
    var st = KIT.ringStats(h.ring, B);
    if (!main || KIT.ringBetter(st, mainSt)) { main = h.ring; mainSt = st; hitKi = h.ki; return true; }
    return false;
  }

  // ① 乐观探测：最紧档直接命中（常规盘一步收工，与旧版开销持平）
  var opt = probePoint(0, 0, 0);
  if (opt.st === 1) { absorb(opt); tolStar = 0; hitKi = 0; }
  // ② 跳步定档：tol 逐档，档内 ki 按 2 的幂跳步（0,1,2,4,8,16,…）；三态处理（无解=下界、
  //    干净=命中、脏=可行上界→向下二分找干净档；全脏也定档，让 ③ 的全起点去找干净环）。
  //    ⚠️ 2026-10-12「能满没满」修复轮定稿：**保留本跳步原样**——它是常规盘的快车道，且
  //    跳步点命中都便宜。它有一个已知弱点：会**跨过中间窄可解窗口**（hard78 满覆盖解在
  //    k14，跳步只探 0,1,2,4,8,16；而 k16 是搜索空间膨胀点，硬烧 450 万预算）——该弱点
  //    **交由 ③b 兜底（已改为「便宜端快跳 + 二分」）找回**，不在主跳步里动（曾试过把本跳步
  //    改成「快跳+二分」，结果 hard67 反而退化：其窗口在顶档 k13..k16 且命中 0 节点，而
  //    中间 k12 是 1135 万节点的昂贵无解坑，二分首个探测恰踩坑 → 全链落 peel 只剩 19/45）。
  //    ⇒ 分工：主跳步管「顶档便宜」的盘（hard67 直接命中 k16），③b 管「顶档昂贵、窗口
  //    在中间」的盘（hard78）。代价剖面见 ③b 处注释。
  var dirtyOnly = false;
  if (!main) {
    var steps = [0, 1, 2, 4, 8, 16, 32, 64, 128], tp, kp;
    outer:
    for (tp = 0; tp <= 6; tp++) {
      if (bud.left < 0) break;
      var prevInfeasible = (tp === 0) ? 0 : -1;
      for (kp = 0; kp < steps.length; kp++) {
        var ki2 = steps[kp];
        if (ki2 > hCap) ki2 = hCap;
        if (ki2 <= prevInfeasible) continue;
        var pp = probePoint(0, tp, ki2);
        if (pp.st === 1) {
          absorb(pp);
          var bLo = prevInfeasible + 1, bHi = ki2, clean = -1;
          while (bLo < bHi && bud.left >= 0) {
            var bMid = (bLo + bHi) >> 1;
            var pb = probePoint(0, tp, bMid);
            absorb(pb);
            if (pb.st === 1) { clean = bMid; bHi = bMid; }
            else if (pb.st === 2) bHi = bMid;
            else bLo = bMid + 1;
          }
          tolStar = tp; hitKi = (clean >= 0 ? clean : ki2);
          break outer;
        }
        if (pp.st === 2) {
          absorb(pp);
          var dLo = prevInfeasible + 1, dHi = ki2, dClean = -1;
          while (dLo < dHi && bud.left >= 0) {
            var dMid = (dLo + dHi) >> 1;
            var pd = probePoint(0, tp, dMid);
            absorb(pd);
            if (pd.st === 1) { dClean = dMid; dHi = dMid; }
            else if (pd.st === 2) dHi = dMid;
            else dLo = dMid + 1;
          }
          tolStar = tp; hitKi = (dClean >= 0 ? dClean : dLo);
          if (dClean < 0) dirtyOnly = true;   // 该档只有脏解：定档进 ③，让别的起点找干净环
          break outer;
        }
        prevInfeasible = ki2;
        if (ki2 >= hCap) break;
      }
    }
  }
  // ③b 兜底定档（主排程烧穿仍无干净环时触发；reg127 补丁 + 2026-10-12「能满没满」修复）：
  //    独立小预算（150ms / 450 万节点），只在烧穿盘触发（~10%），常规盘零开销。
  //    ▍为什么必须存在（2026-10-12 定稿）：主跳步 ② 会跨过中间窄可解窗口，本通道就是
  //    把那个窗口找回来的地方。tol0 逐 k 代价剖面（每档独立预算，单位万节点）：
  //      hard78 : 无解带 k0..k13【k12=237,k13=653】 可行 k14=168（k15=488,k16=1372）
  //      hard250: 无解带 k0..k10【k10=80】          可行 k11=46
  //      hard260: 无解带 k0..k9 【k9=52】           可行 k10=18
  //      hard356: 无解带 k0..k8 【k8=8】            可行 k9=9
  //    ⇒「无解证明」代价随 k 指数上升、「可行档命中」普遍便宜。故：
  //      ① 便宜端快跳 0,1,2,4,8（单调 ⇒ 都无解则 ≤8 全无解，代价极低）；
  //      ② 主池二分 (8,hCap] 求最小可行档——天然跳过昂贵中间无解档（hard78 只探
  //         k12(237万)+k14(168万)≈405万，不见 k13）；护栏=预算耗尽即停、保留已得最小档，
  //         故 k60 那类便宜盘的"最小档精化"照常跑到（38 步 3 列环依赖它）。
  //    ⚠️ 与旧码差别（旧=最宽 tol 降序 + hCap 降序 + 遇 null 即 break）：tol 改**从窄到宽**
  //       （先要高质量）、ki 改**便宜端快跳+二分**（不再先烧昂贵顶档）、且**不因单个 null
  //       直接 break**（null 可能是预算耗尽的**假无解**、非真下界；单调性只对"真无解"成立）。
  //    ⚠️ hard67 顶档便宜（窗口 k13..k16、命中 0 节点）**不走本通道**——它中间 k12 是 1135 万
  //       节点坑，二分首个探测会踩；这类盘由主跳步 ② 直接命中顶档解决（分工明确）。
  if (!main && bud.left < 0) {
    var dbN = GS.__v2testNodes ? GS.__v2testNodes : V2_NODES;
    var db = { left: dbN, deadline: v2Deadline(150) };
    outerFallback:
    for (var dt = 0; dt <= 6 && db.left >= 0 && !main; dt++) {
      var dlo = 0, dhi = hCap, dfound = -1, dfDirty = false, dfi, dfk;
      var dfast = [0, 1, 2, 4, 8];
      for (dfi = 0; dfi < dfast.length; dfi++) {
        dfk = dfast[dfi];
        if (dfk > dhi) break;
        if (dfk < dlo) continue;
        var dpf = probePoint(0, dt, dfk, db);
        absorb(dpf);
        if (dpf.st !== 0) { dfound = dfk; dfDirty = (dpf.st === 2); dhi = dfk - 1; break; }
        dlo = dfk + 1;
        if (db.left < 0) break;
      }
      while (db.left >= 0 && dlo <= dhi) {
        var dmid = (dlo + dhi) >> 1;
        var dpm = probePoint(0, dt, dmid, db);
        absorb(dpm);
        if (dpm.st !== 0) { dfound = dmid; dfDirty = (dpm.st === 2); dhi = dmid - 1; }
        else dlo = dmid + 1;
      }
      if (dfound >= 0) { tolStar = dt; hitKi = dfound; dirtyOnly = dfDirty; break outerFallback; }
    }
  }
  // ③c 高限补搜（2026-10-12 hard59 实锤；HMAX_CAP=16 会挡死"满覆盖解需要 >16 个辅助格"的盘）：
  //    仅当现有最优**仍不满覆盖**时触发 —— 常规盘 cov 已满、hard78 快搜已满 ⇒ **零开销**。
  //    用独立预算，在 (hCap, hCapHi] 上**从顶档 hCapHi 往下**探（tol 从 0 升，tol=0 返回的环
  //    必然满覆盖）。为什么从顶往下：tol=0 逐 k 代价剖面（si=0，每档独立 6M）——
  //      hard59 : k14/15/16 无解(1.39/2.45/4.06M)、**k17/k18 各烧穿 6M**、**k19..k32 全 cov30 且命中 0.00~0.03M**
  //      hard78 : k14/15 cov41(1.68/4.88M)、**k16..k27 全烧穿 6M**、**k28..k32 又 cov41(0.01~1.94M)**
  //    ⇒ 高段的中间是"昂贵坑"，但**真正的顶档自由度最大、命中几乎免费**（两盘皆然）。
  //      故**从顶往下探**；⚠️ 不可从低往高（一头扎进 k17/k18 或 k16..k27 的坑，hard59 实锤）。
  //    ⚠️ 也不可在 ② 里用二分并把上界抬到 hCapHi（首个 mid 会落进那个坑，致 hard78 退化）。
  //    命中即收（并定档交 ④）；预算耗尽即停。实测 hard59：本通道在 (tol0,k32) 一步命中、重新满覆盖。
  if (!GS.railFast && (!main || !mainSt || mainSt.cov < Bl.length)) {
    var hCapHi = hcount < 32 ? hcount : 32;
    if (hCapHi > hCap && Bl.length >= 4) {
      var hb = freshV2(250);
      // 从顶档 hCapHi 逐档下探**并逐个 absorb 择优**（降档命中几乎免费 ⇒ 顺带把更省的环挑出来）；
      // 止步条件用单调性：一旦某档"真无解"（st=0 且预算没耗尽）⇒ 更低档全无解，止步该 tol；
      // 预算耗尽也止步。命中过的 tol 即定档（hitKi 取让 main 变好的那一档）。
      var hBestK = -1, hBestTol = -1;
      outerHi:
      for (var ht = 0; ht <= 6; ht++) {
        for (var hk = hCapHi; hk > hCap; hk--) {
          if (hb.left < 0) break outerHi;
          var ph = probePoint(0, ht, hk, hb);
          if (ph.st !== 0) {
            if (absorb(ph)) { hBestK = hk; hBestTol = ht; }
            continue;
          }
          break;   // st=0：真无解（单调 ⇒ 更低档全无解）或预算耗尽 → 止步该 k 降档
        }
        if (hBestK >= 0) break outerHi;
      }
      if (hBestK >= 0) { tolStar = hBestTol; hitKi = hBestK; dirtyOnly = false; }
    }
  }
  // ④ 择优：定档位全起点锦标赛（分片跳格 + 双闸早停；dirtyOnly 时 main 可能为空，
  //    锦标赛本身就是在全起点里猎干净环）
  if (tolStar >= 0 && (main || dirtyOnly)) {
    var bestRing = main, bestSt2 = mainSt, si;
    for (si = 1; si < Bl.length; si++) {
      if (bud.left < 0) break;
      if (GS.__shard && si % GS.__shard.n !== GS.__shard.k) continue;
      if (bestSt2 && bestSt2.cross === 0 && bestSt2.cov >= Bl.length) break;   // 双闸早停（v1.5 同款）
      var h3 = probePoint(si, tolStar, hitKi);
      if (h3.st === 1) {
        var st3 = KIT.ringStats(h3.ring, B);
        if (!bestSt2 || KIT.ringBetter(st3, bestSt2)) { bestRing = h3.ring; bestSt2 = st3; }
      }
    }
    main = bestRing; mainSt = bestSt2;
  }

  // —— 洗环通道（2026-10-11 reg127 补丁）：全档无干净环但有脏环时，把最优脏环
  //    过一遍 ⑥trim → straighten → ⑦reweave（v1 的后处理流水线，⑦ 的立项理由
  //    就是"DFS 首命中脏环"），洗干净（合法 + H5b + 围核心）才收，洗不干净就扔。
  //    常规盘 main 直接命中，本通道零开销。
  var laundered = false;
  if (!main && dirtyBest) {
    var lau = KIT.trimDetours(dirtyBest, B);
    lau = GS.straightenRing(lau);
    lau = KIT.reweaveTwins(lau, B);
    // 掉头格手术：…p,a,x,a,q… 的戳进段剪除（x=单访同口进出，本就非法；trim 剪不动
    // ——x 常是轮廓格；剪掉少 2 步、环仍闭合）。reg127 实锤：脏环唯一脏点是 (4,12)
    // 掉头，前三道工序全洗不掉，手术一刀干净（v1 同盘靠 ④剥层，v2 手术保不缩圈）。
    var cut = true;
    while (cut && lau.length >= 6) {
      cut = false;
      for (var li = 0; li < lau.length; li++) {
        var lx = lau[li], la = lau[(li - 1 + lau.length) % lau.length], lb = lau[(li + 1) % lau.length];
        if (la.c === lb.c && la.r === lb.r && Math.abs(lx.c - la.c) + Math.abs(lx.r - la.r) === 1) {
          lau.splice(li, 2);
          cut = true;
          break;
        }
      }
    }
    if (KIT.ringOkFull(lau) && !ringHasBacktrackCell(lau)) {
      main = lau; mainSt = KIT.ringStats(lau, B); tolStar = -1; laundered = true;
    }
  }

  // —— 剥层终落（v1 ④ 镜像，hard161 实锤补丁）：所有通道颗粒无收时，逐层剥掉
  //    外轮廓（PROT 保护）换可解性——缩一点远好于贴身环（hard161：v1 靠剥层
  //    拿 50 步 39/39，v2 无剥层塌到 9/39，且与预算无关）。输出口径不变：
  //    覆盖仍按原 B* 统计（v1 同款——剥层只动求解区域，不动 contourB）。
  //    常规盘 main 直接命中，本通道零开销。
  if (!main && !GS.railFast) {
    var U3 = new Uint8Array(U2), pl, peeled = null, peeledWon = false;
    var pbud = { left: V2_NODES, deadline: v2Deadline(250) };
    peel:
    for (pl = 0; pl < 25 && pbud.left >= 0; pl++) {
      var bdP = KIT.boundaryOf(U3, KIT.computeF(U3), usable), delN = 0, ps;
      for (ps = 0; ps < N; ps++) if (bdP.B[ps] && !PROT[ps]) { U3[ps] = 0; delN++; }
      if (!delN) break;
      KIT.keepCoreComponent(U3); KIT.pruneU(U3);
      var F3 = KIT.computeF(U3);
      var bd3 = KIT.boundaryOf(U3, F3, usable);
      if (bd3.Bl.length < 4) break;
      var H3 = KIT.helpersOf(U3, bd3.B, usable), A3 = new Uint8Array(N);
      for (ps = 0; ps < N; ps++) if (bd3.B[ps] || H3[ps]) A3[ps] = 1;
      // v1 ④ 同款内圈：tol=TOL_MAX 单档 + ki 从 0 线性升（剥过的图小、便宜端优先；
      //   首版 tol0..6 全扫把预算烧在无解证明上，被迫多剥几层、环缩过头——hard161 实锤）
      var cap3 = 0, ps2;
      for (ps2 = 0; ps2 < N; ps2++) if (H3[ps2]) cap3++;
      if (cap3 > 16) cap3 = 16;
      for (var pk3 = 0; pk3 <= cap3 && pbud.left >= 0; pk3++) {
        var pi3 = KIT.closedTrail(bd3.B, bd3.Bl, H3, A3, pbud, pk3, 1, 0, 6, 0, 2, false, 0) ||
                  KIT.closedTrail(bd3.B, bd3.Bl, H3, A3, pbud, pk3, 2, 8, 6, 0, 2, false, 0);
        if (pi3) {
          var rgP = KIT.ringOf(pi3);
          if (KIT.enclosesCore(rgP) && !ringHasBacktrackCell(rgP)) { peeled = rgP; break peel; }
          if (pbud.left < 0) break;
        }
      }
    }
    if (peeled) { main = peeled; mainSt = KIT.ringStats(peeled, B); tolStar = -1; peeledWon = true; }
  }

  // —— 精确裁判（D6）：主解不完美才跑；快速档跳过 ——
  var exact = null;
  if (!GS.railFast) {
    var perfect = mainSt && mainSt.cov >= Bl.length && mainSt.cross === 0;
    if (!perfect && Bl.length >= 4) exact = KIT.bestRingExact(U2, F, usable, freshV2(V2_EXACT_MS));
  }

  // —— 终选（R4）：prev 覆盖不少于新解 ⇒ 沿用 prev（并列也沿用，规格口径）——
  var ring = null, ringSt = null, prov = 'none';
  if (main) { ring = main; ringSt = mainSt; prov = laundered ? 'laundry' : (peeledWon ? 'peel' : 'main'); }
  if (exact) {
    var eSt = KIT.ringStats(exact, B);
    if (!ring || KIT.ringBetter(eSt, ringSt)) { ring = exact; ringSt = eSt; prov = 'exact'; }
  }
  if (prev) {
    var pSt = KIT.ringStats(prev, B);
    if (!ring || !KIT.ringBetter(ringSt, pSt)) { ring = prev; ringSt = pSt; prov = 'prev'; }
  }
  if (!ring && bottom) { ring = bottom; ringSt = KIT.ringStats(bottom, B); prov = 'core'; }

  // —— 口袋补挂（2026-10-11 怪兽真盘复刻补丁；⑤支线的 v2 化）：主搜索在巨型盘上
  //    烧穿前常摸不到"贴边死角"的往返支线（09:12 真盘实锤：半岛 0/4、cov 48/53）。
  //    对每个未覆盖轮廓口袋，用独立小预算在「口袋∪挂点」的局部小图上搜一条
  //    从挂点出发、盖满口袋的闭合小走线，拼接进主环（挂点与口袋口各成 T 字岔）。
  //    采纳铁闸 = 拼接环合法（含 H5b 零往返/掉头）且覆盖数严格增加——⑤ 的
  //    "严格更优才替换"语义原样保留。railFast 预览跳过（同 v1 ⑤）。
  function pocketAttach(ringIn) {
    if (!ringIn || ringIn.length < 8 || GS.railFast) return ringIn;
    var onRing = {}, vis2 = {}, pi;
    for (pi = 0; pi < ringIn.length; pi++) {
      var pk = ringIn[pi].c + ',' + ringIn[pi].r;
      onRing[pk] = 1; vis2[pk] = (vis2[pk] || 0) + 1;
    }
    var uncovered = [];
    for (pi = 0; pi < Bl.length; pi++) if (!onRing[colOf(Bl[pi]) + ',' + rowOf(Bl[pi])]) uncovered.push(Bl[pi]);
    if (!uncovered.length) return ringIn;
    // 未覆盖轮廓格按邻接连通分组成口袋
    var seenP = new Uint8Array(N), pockets = [], ui, uj;
    for (ui = 0; ui < uncovered.length; ui++) {
      var s0 = uncovered[ui];
      if (seenP[s0]) continue;
      var st = [s0], comp = [];
      seenP[s0] = 1;
      while (st.length) {
        var p = st.pop(), pc2 = colOf(p), pr2 = rowOf(p);
        comp.push(p);
        for (var pd = 0; pd < 4; pd++) {
          var qc = pc2 + RAIL_DC[pd], qr = pr2 + RAIL_DR[pd];
          if (!CFG.inBounds(qc, qr)) continue;
          var q = id(qc, qr);
          if (B[q] && !onRing[qc + ',' + qr] && !seenP[q]) { seenP[q] = 1; st.push(q); }
        }
      }
      pockets.push(comp);
    }
    var improved = true, result = ringIn;
    while (improved) {
      improved = false;
      onRing = {}; vis2 = {};
      for (pi = 0; pi < result.length; pi++) {
        var pk2 = result[pi].c + ',' + result[pi].r;
        onRing[pk2] = 1; vis2[pk2] = (vis2[pk2] || 0) + 1;
      }
      for (var po = 0; po < pockets.length && !improved; po++) {
        var comp2 = pockets[po];
        if (!comp2.length) continue;
        var stillUncovered = 0;
        for (uj = 0; uj < comp2.length; uj++) if (!onRing[colOf(comp2[uj]) + ',' + rowOf(comp2[uj])]) stillUncovered++;
        if (!stillUncovered) continue;
        // ▍路径拼缝（小口袋专用，2026-10-11 大王「右侧两格」反馈）：口袋是一条链、
        //   两端各邻接环上**相邻**的两格 A、B 时，把环边 A→B 换成 A→链→B——
        //   换入整条口袋的覆盖、零重访零 T 字。lasso 通道受 closedTrail 的 Bl≥4
        //   下限够不到 1~3 格小口袋（右侧 (7,8)(8,8) 两格实锤）。先试拼缝（便宜、
        //   零重访），不成再走 lasso。单格口袋同适用（两端接同一对相邻环格）。
        (function () {
          var degIn = {}, zi2, dk2;
          for (zi2 = 0; zi2 < comp2.length; zi2++) degIn[comp2[zi2]] = 0;
          for (zi2 = 0; zi2 < comp2.length; zi2++) {
            var zc3 = colOf(comp2[zi2]), zr3 = rowOf(comp2[zi2]);
            for (var zd3 = 0; zd3 < 4; zd3++) {
              var znc3 = zc3 + RAIL_DC[zd3], znr3 = zr3 + RAIL_DR[zd3];
              if (!CFG.inBounds(znc3, znr3)) continue;
              var q3 = id(znc3, znr3);
              if (degIn.hasOwnProperty(String(q3))) degIn[q3]++;
            }
          }
          var ends2 = [];
          for (dk2 in degIn) if (degIn[dk2] <= 1) ends2.push(+dk2);
          if (comp2.length === 1 || ends2.length === 2) {
            var eA = comp2.length === 1 ? comp2[0] : ends2[0];
            var eB = comp2.length === 1 ? comp2[0] : ends2[1];
            var chain = [eA], curC = eA, prevC = -1;
            // ⚠️ 上限护栏（2026-10-12 崩盘修复）：首命中 walk 只看 prevC、无 visited——
            //   口袋分量若含环/分叉，walk 会无限回溯把 chain 撑到爆（hard160 真墙钟盘
            //   实锤：RangeError: Invalid array length）。合法链长恰 = comp2.length，
            //   一旦超过即非法，直接止步（下方 `chain.length === comp2.length` 校验兜住）。
            while (curC !== eB && chain.length <= comp2.length) {
              var nxt = -1, cc3 = colOf(curC), cr3 = rowOf(curC);
              for (var zd4 = 0; zd4 < 4; zd4++) {
                var znc4 = cc3 + RAIL_DC[zd4], znr4 = cr3 + RAIL_DR[zd4];
                if (!CFG.inBounds(znc4, znr4)) continue;
                var q4 = id(znc4, znr4);
                if (q4 !== prevC && q4 !== curC && degIn.hasOwnProperty(String(q4))) { nxt = q4; break; }
              }
              if (nxt < 0) break;
              chain.push(nxt); prevC = curC; curC = nxt;
            }
            if (curC === eB && chain.length === comp2.length) {
              function ringAdjOf(z) {
                var c = colOf(z), r = rowOf(z), outR = [];
                for (var d5 = 0; d5 < 4; d5++) {
                  var nc5 = c + RAIL_DC[d5], nr5 = r + RAIL_DR[d5];
                  if (!CFG.inBounds(nc5, nr5)) continue;
                  var k5 = nc5 + ',' + nr5;
                  if (onRing[k5] && vis2[k5] === 1) outR.push(k5);
                }
                return outR;
              }
              var adjA = ringAdjOf(eA), adjB = ringAdjOf(eB);
              var posMap = {};
              for (var pi2 = 0; pi2 < result.length; pi2++) {
                var k6 = result[pi2].c + ',' + result[pi2].r;
                if (posMap[k6] === undefined) posMap[k6] = pi2;
              }
              function cellsOf(arr) {
                var out = [], ci5;
                for (ci5 = 0; ci5 < arr.length; ci5++) out.push({ c: colOf(arr[ci5]), r: rowOf(arr[ci5]) });
                return out;
              }
              for (var aa = 0; aa < adjA.length && !improved; aa++) {
                for (var bb = 0; bb < adjB.length && !improved; bb++) {
                  if (adjA[aa] === adjB[bb]) continue;
                  var pA = posMap[adjA[aa]], pB = posMap[adjB[bb]];
                  if (pA === undefined || pB === undefined) continue;
                  var L = result.length;
                  var outS = null;
                  if (pB === (pA + 1) % L) {
                    outS = result.slice(0, pA + 1).concat(cellsOf(chain), result.slice(pB));
                  } else if (pA === (pB + 1) % L) {
                    outS = result.slice(0, pB + 1).concat(cellsOf(chain.slice().reverse()), result.slice(pA));
                  }
                  if (!outS) continue;
                  if (KIT.ringOkFull(outS) && !ringHasBacktrackCell(outS) &&
                      KIT.ringStats(outS, B).cov > KIT.ringStats(result, B).cov) {
                    result = outS; improved = true;
                  }
                }
              }
            }
          }
        })();
        if (improved) continue;
        // 局部图 A_loc = 口袋（必须覆盖）∪ 连接格（可走、非必须）∪ 挂点 M（环上单访格）。
        //   ▍连接格语义修正（2026-10-11 大王试玩盘反馈轮）：旧版把邻接可用格也塞进
        //   必须覆盖清单——口袋旁挂一个死端格（如 (1,4)）时，任何走线都被迫进去掉头，
        //   整袋被 H5b 拒收，4 个本可合法绕环的格子陪葬。修法：连接格只进 A_loc 不进
        //   覆盖清单，且剔除本地死端连接格（在「口袋∪挂点∪连接格」里邻居 <2 的——
        //   它不提供任何通路，只会诱导掉头走线）。
        var Aloc = new Uint8Array(N), Blloc = [], mi, mj;
        for (uj = 0; uj < comp2.length; uj++) { Aloc[comp2[uj]] = 1; Blloc.push(comp2[uj]); }
        var connCand = [];
        for (uj = 0; uj < comp2.length; uj++) {
          var zc = colOf(comp2[uj]), zr = rowOf(comp2[uj]);
          for (var zd = 0; zd < 4; zd++) {
            var znc = zc + RAIL_DC[zd], znr = zr + RAIL_DR[zd];
            if (!CFG.inBounds(znc, znr)) continue;
            var zn = id(znc, znr);
            if (usable[zn] && !onRing[znc + ',' + znr] && !Aloc[zn]) { Aloc[zn] = 1; connCand.push(zn); }
          }
        }
        // 剔除本地死端连接格（迭代到稳定：叶子上摘）
        for (var cpass = 0; cpass < 8; cpass++) {
          var dropped = 0;
          for (var ci3 = 0; ci3 < connCand.length; ci3++) {
            var zn2 = connCand[ci3];
            if (!Aloc[zn2]) continue;
            var zc2 = colOf(zn2), zr2 = rowOf(zn2), nbA = 0;
            for (var zd2 = 0; zd2 < 4; zd2++) {
              var znc2 = zc2 + RAIL_DC[zd2], znr2 = zr2 + RAIL_DR[zd2];
              if (CFG.inBounds(znc2, znr2) && Aloc[id(znc2, znr2)] && id(znc2, znr2) !== zn2) nbA++;
            }
            if (nbA <= 1) { Aloc[zn2] = 0; dropped++; }   // 悬挂叶/孤立 → 摘掉
          }
          if (!dropped) break;
        }
        // 挂点候选：环上单访格、与 A_loc 相邻
        var mCands = [];
        for (mi = 0; mi < result.length; mi++) {
          var M = result[mi];
          if (vis2[M.c + ',' + M.r] !== 1) continue;
          var ok = false;
          for (var md = 0; md < 4 && !ok; md++) {
            var mc = M.c + RAIL_DC[md], mr = M.r + RAIL_DR[md];
            if (CFG.inBounds(mc, mr) && Aloc[id(mc, mr)]) ok = true;
          }
          if (ok) mCands.push(M);
        }
        for (mj = 0; mj < mCands.length && !improved; mj++) {
          var M2 = mCands[mj];
          var Bl2 = [id(M2.c, M2.r)].concat(Blloc);
          var Bloc = new Uint8Array(N), Hloc = new Uint8Array(N);
          for (var bi2 = 0; bi2 < Bl2.length; bi2++) Bloc[Bl2[bi2]] = 1;
          Aloc[id(M2.c, M2.r)] = 1;      // 挂点本身必须可走（走线从它出发）
          var bud2 = freshV2(150);
          // ▍干净走线优先 + 容差阶梯（2026-10-11 大王撤销盘反馈）：mv1 干净优先、
          //   mv2 放开；容差 0/4/8/…/口袋大小 逐档爬（每档切一片节点，防一档无解
          //   证明独吞）。**命中≠采纳**：每档命中先试拼接，拼接闸（合法+H5b+覆盖
          //   严格增）不过就继续爬下一档——顶档常命中「覆盖 0 的垃圾走线」，旧版
          //   break 后整袋丢弃（28 格吊灯口袋里东侧 4 格的 6 步合法套环陪葬）。
          var tolLadder = [0, 4, 8, 12, 16, 20, 24, 28, 40, 56, 80, 128];
          var pbNodes = 1500000;   // 口袋通道总节点配额
          for (var tl = 0; tl < tolLadder.length && pbNodes > 0 && !improved; tl++) {
            var ptol = tolLadder[tl];
            if (ptol > stillUncovered) ptol = stillUncovered;
            var tierBud = { left: Math.min(pbNodes, 250000), deadline: bud2.deadline };
            var idx2 = KIT.closedTrail(Bloc, Bl2, Hloc, Aloc, tierBud, 0, 1, 0, ptol, 0, 2, false, 1) ||
                         KIT.closedTrail(Bloc, Bl2, Hloc, Aloc, tierBud, 0, 2, 8, ptol, 0, 2, false, 1);
            pbNodes -= (Math.min(pbNodes, 250000) - Math.max(0, tierBud.left));
            if (!idx2) { if (ptol >= stillUncovered) break; continue; }
            var walk = KIT.ringOf(idx2);      // 从 M2 出发的闭合小走线
            var out = [], spliced = false;
            for (var ri = 0; ri < result.length; ri++) {
              out.push(result[ri]);
              if (result[ri] === M2) {
                for (var wi = 1; wi < walk.length; wi++) out.push(walk[wi]);
                out.push(M2);
                spliced = true;
              }
            }
            if (spliced && KIT.ringOkFull(out) && !ringHasBacktrackCell(out) &&
                KIT.ringStats(out, B).cov > KIT.ringStats(result, B).cov) {
              result = out; improved = true;
            }
            if (ptol >= stillUncovered) break;
          }
          Aloc[id(M2.c, M2.r)] = 0;      // 试完还原，不影响下一候选的 Aloc 语义
        }
      }
    }
    return result;
  }
  var ringPA = pocketAttach(ring);
  if (ringPA && ringPA !== ring) { ring = ringPA; ringSt = KIT.ringStats(ring, B); prov = 'pocket+' + prov; }

  // —— 后处理（D5；快速档跳过，与 v1 同哲学）——
  if (!GS.railFast && ring && ring.length >= 4) {
    ring = KIT.trimDetours(ring, B);
    ring = GS.straightenRing(ring);
    ring = KIT.reweaveTwins(ring, B);
    // 十字对重接（2026-10-11 大王试玩盘反馈）：相邻双 4 口真十字的「连接格回溯」
    //   形态重接（西圈→反向南圈→东侧式），存量环（如逐步演化保留下来的）自愈。
    //   v1 链不接（冻结）；三道闸：合法性+H5b / 覆盖不降 / 十字严格减。
    ring = ringDecrossPair(ring, KIT, B);
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

// ============================================================================
// 导入地图（v1.6.67 大王令）：把 UI.exportMap 的导出文本还原成盘面 —— 复刻
// 查看路径问题的逆向通道。**只还原导出文本里有的字段**（含 check 校验行），
// deck/词条/经验等导出未覆盖的保持当前会话不变；昼夜晚钟相位不在导出里，
// 导入沿用当前相位。
// 成功返回 null，失败返回错误文案（弹层提示用）。失败时**盘面原地不动**。
// ============================================================================
GS.importMap = function (text) {
  var L = String(text || '').split(/\r?\n/);
  var i, m;
  // —— 头部：KDG-MAP v1 ——
  if (!L.length || L[0].indexOf('KDG-MAP v1') !== 0) return '不是地图数据（缺 KDG-MAP v1 头）';
  // —— 定位图例行与 13 行 ASCII 地图 ——
  var iLegend = -1;
  for (i = 0; i < L.length; i++) if (L[i].indexOf('图例:') === 0) { iLegend = i; break; }
  if (iLegend < 0 || iLegend + CFG.MAP_ROWS >= L.length) return '缺图例行或地图行数不足';
  // —— rail 行（声明数 vs 实列数 + check 行首尾格，丢格当场报） ——
  var rail = null;
  for (i = 0; i < L.length; i++) {
    m = L[i].match(/^rail\((\d+)\): ?(.*)$/);
    if (m) {
      var decl = +m[1];
      var parts = m[2] ? m[2].trim().split(' ') : [];
      if (parts.length && parts[parts.length - 1] === '') parts.pop();
      if (parts.length !== decl) return 'rail 序列不完整（声明 ' + decl + ' 项，实列 ' +
        parts.length + ' 项）——复制时丢了内容，请重新导出';
      rail = [];
      for (var q = 0; q < parts.length; q++) {
        var pr = parts[q].split(',');
        rail.push({ c: +pr[0], r: +pr[1] });
      }
      break;
    }
  }
  if (!rail) return '缺 rail 行';
  // check 行（v1.6.66+ 才有，旧导出没有则跳过）：首尾格 + 步数三重校验
  for (i = 0; i < L.length; i++) {
    m = L[i].match(/^check: rail=(\d+) head=(\S+) tail=(\S+)$/);
    if (m) {
      if (+m[1] !== rail.length) return 'check 校验不符（rail=' + m[1] + ' vs 实列 ' + rail.length + '）';
      var hd = m[2].split(','), tl = m[3].split(',');
      if (+hd[0] !== rail[0].c || +hd[1] !== rail[0].r ||
          +tl[0] !== rail[rail.length - 1].c || +tl[1] !== rail[rail.length - 1].r) {
        return 'check 首尾格不符——rail 序列被截断或改动，请重新导出';
      }
      break;
    }
  }
  // 正交性 + 闭合（含末→首回绕）：坏环直接拒收
  for (i = 0; i < rail.length; i++) {
    var a = rail[i], b2 = rail[(i + 1) % rail.length];
    if (Math.abs(a.c - b2.c) + Math.abs(a.r - b2.r) !== 1) {
      return 'rail 序列第 ' + i + '→' + ((i + 1) % rail.length) + ' 步非正交，数据损坏';
    }
  }
  // —— towers / foes 等键值行 ——
  var kv = {};
  for (i = 0; i < L.length; i++) {
    m = L[i].match(/^(towers|foes|train|station|cargo|hearts|gold|nextSpawns): (.*)$/);
    if (m) kv[m[1]] = m[2];
  }
  // —— 重建网格：'#'废墟 '.'空地 C/E/T/M/F/A 建筑 G/g 金币 H/h 爱心 ——
  var grid = [], buildings = [], towers = [], core = null, tset = {};
  if (kv.towers && kv.towers !== '') {
    var tarr = kv.towers.split(' ');
    for (i = 0; i < tarr.length; i++) {
      var tm = tarr[i].match(/^(\d+),(\d+):(\w+?)(\d)(?:\+(\S+))?$/);
      if (!tm) return 'towers 行格式不识别：' + tarr[i];
      tset[tm[1] + ',' + tm[2]] = tm;   // elem/star/affix 待网格扫到 T 时取用
    }
  }
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var rowS = L[iLegend + 1 + r];
    if (rowS.length !== CFG.MAP_COLS) return '地图第 ' + (r + 1) + ' 行长度 ' +
      rowS.length + ' ≠ ' + CFG.MAP_COLS;
    var row = [];
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var cell = { t: 'rubble', gold: false, heart: false, harvested: false, b: null };
      var ch = rowS.charAt(c);
      if (ch === '.') cell.t = 'blank';
      else if (ch === 'G') { cell.t = 'blank'; cell.gold = true; }
      else if (ch === 'g') cell.gold = true;                          // 仍埋废墟
      else if (ch === 'H') { cell.t = 'blank'; cell.heart = true; }
      else if (ch === 'h') cell.heart = true;
      else if (ch === 'C') {
        cell.t = 'blank';
        core = { type: 'core', c: c, r: r };
        cell.b = core; buildings.push(core);
      } else if (ch === 'T') {
        cell.t = 'blank';
        var ts = tset[c + ',' + r];
        if (!ts) return '地图 (' + c + ',' + r + ') 有塔但 towers 行缺记录';
        delete tset[c + ',' + r];
        // 对齐 TOWERS.placeAt 的字段全集（此处不引 TOWERS，保持 state 模块无关）
        var t = { type: 'tower', elem: ts[3], star: +ts[4], cd: 0, c: c, r: r, flash: 0,
                  affix: ts[5] || null, wcd: 0, streak: 0, lastT: null, chargeT: 0 };
        cell.b = t; towers.push(t);
      } else if (ch === 'M' || ch === 'F' || ch === 'A' || ch === 'S') {
        cell.t = 'blank';
        // v1.8u 十三令（§14.84）：A=猛攻坊 / S=疾速坊；旧地图 'A'（军工厂）静默迁移为猛攻坊
        var bt = (ch === 'M') ? 'mint' : (ch === 'F') ? 'gas' : (ch === 'A') ? 'atk' : 'asp';
        var bl = { type: bt, c: c, r: r, flash: 0 };
        cell.b = bl; buildings.push(bl);
      } else if (ch !== '#') {
        return '地图第 ' + (r + 1) + ' 行含不识别字符：' + ch;
      }
      row.push(cell);
    }
    grid.push(row);
  }
  for (var k2 in tset) return 'towers 行的塔 ' + k2 + ' 在地图上无对应 T 格';
  if (!core) return '地图缺镇中心 C';
  // —— 站台（导入原文，不重解：复刻要和导出严格一致） ——
  var st = null;
  if (kv.station && kv.station !== '-') {
    var sm = kv.station.match(/^(\d+),(\d+)@(\d+)$/);
    if (!sm) return 'station 行格式不识别';
    st = { c: +sm[1], r: +sm[2], index: +sm[3] };
  }
  // —— 刷怪态（怪本身不复活：foes 行只有数量，路径排查不需要怪） ——
  var wave = 0, coreHP = CFG.CORE_HP, coreMaxHP = CFG.CORE_HP;
  if (kv.foes) {
    var fm = kv.foes.match(/^(\d+) wave: (\d+) coreHP: (\d+)\/(\d+)$/);
    if (!fm) return 'foes 行格式不识别';
    coreHP = +fm[3]; coreMaxHP = +fm[4]; wave = +fm[2];
  }
  var nextSpawns = null;
  if (kv.nextSpawns && kv.nextSpawns !== '') {
    nextSpawns = [];
    var ns = kv.nextSpawns.split(' ');
    for (i = 0; i < ns.length; i++) {
      var nm = ns[i].match(/^(-?[\d.]+),(-?[\d.]+)×(\d+)$/);
      if (!nm) return 'nextSpawns 项格式不识别：' + ns[i];
      nextSpawns.push({ c: +nm[1], r: +nm[2], count: +nm[3] });
    }
  }
  // —— 全部落账（至此再无失败路径，盘面整体替换） ——
  GS.grid = grid; GS.buildings = buildings; GS.core = core;
  GS.towers = towers; GS.foes = [];
  // 资源块列表从网格标记重建（transport/engine 按列表遍历，置空 = 导入盘永远捡不了）
  GS.goldTiles = []; GS.heartTiles = [];
  for (var rg = 0; rg < CFG.MAP_ROWS; rg++) {
    for (var rc = 0; rc < CFG.MAP_COLS; rc++) {
      if (grid[rg][rc].gold) GS.goldTiles.push({ c: rc, r: rg });
      if (grid[rg][rc].heart) GS.heartTiles.push({ c: rc, r: rg });
    }
  }
  GS.railPath = rail; GS.station = st;
  GS.train = { index: (kv.train && kv.train !== '-') ? +kv.train.split(',')[0] : 0,
               frac: (kv.train && kv.train !== '-') ? +kv.train.split(',')[1] : 0,
               cargo: kv.cargo ? +kv.cargo : 0,
               hearts: kv.hearts ? +kv.hearts : 0, picked: [] };
  GS.gold = kv.gold ? +kv.gold : 0;
  GS.coreHP = coreHP; GS.coreMaxHP = coreMaxHP;
  GS.gameOver = false;
  GS.fx = []; GS.floats = []; GS.undoClean = null;
  GS.mines = []; GS.fireZones = []; GS.frostZones = [];
  GS.bullets = [];                                        // 车厢弹丸（v1.8n）
  GS.nextSpawns = nextSpawns;
  FOES.wave = wave; FOES.active = false; FOES.pending = 0; FOES.spawnCd = 0;
  FOES.spawnQueue = []; FOES.waveSpawns = null; FOES.fadeSpawns = null;
  // 求解缓存全作废：防 skip 闸/异步飞行结果拿旧指纹坑新盘
  GS.__v2cache = null;
  if (typeof SOLVER_ASYNC !== 'undefined' && SOLVER_ASYNC.invalidate) SOLVER_ASYNC.invalidate();
  if (typeof LOG !== 'undefined') LOG.add('import', { railLen: rail.length, wave: wave });
  return null;
};

