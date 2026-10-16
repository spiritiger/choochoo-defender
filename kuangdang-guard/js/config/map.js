// 地图布局与网格 / 俄罗斯方块清理形状
window.CFG = {
  CANVAS_W: 390,
  CANVAS_H: 844,
  HUD_H: 52,
  FOOTER_H: 148,      // v1.6.39 大王令：232→148（#status 提示行退役 + 区域压缩）；
                      //   白天 fieldH 642 ⇒ cell 仍由宽度瓶颈决定恒 41，白天布局几何不变
  MAP_COLS: 9,        // v1.3.6 曾改 7，同日回退：7×11 上 5×7 圈占全图 45%，金币全挤外圈贴边，体验差
  MAP_ROWS: 13,       // （同上，回退 9×13）
  TRAIN_SPEED: 2.6,   // 格/秒
  ECON_RATE: 6,       // 列车每经过一次贴轨经济建筑 +6 金币
  GOLD_RATE: 10,      // 列车驶入金币地块 +10 金币（v1.6.23 大王令 5→10；十字格一圈只算一次）
  MINT_BONUS: 5,      // 每座【铸币所】使**全场**金币价值 +5（大王拍板：多座叠加）
  GAS_RANGE: 1,       // 【加油站】作用半径（格，切比雪夫）：1 ⇒ 3×3
  GAS_STEP: 1,        // 每座覆盖车头的【加油站】+1 倍速（大王拍板：**求和**不连乘，两座 = 3×）
  // 【军工厂】（v1.6.35 大王令）：范围 = **上下左右各 1 格**（曼哈顿 ≤1，十字 5 格，非 3×3）
  FACTORY_BASE: 0.20, // 每座军工厂：车厢攻击 +20%（全局、叠加，与铸币所同款口径）
  FACTORY_ADJ: 0.10,  // 聚集加成：每有一对相互在十字范围内的军工厂，额外 +10%（按对计一次）
                      //   （⇒ 总加成 = 20%×座数 + 10%×相邻对数；1 座 20%、两座相邻 50%、两座远离 40%）
  GOLD_TILES: 10,     // 开局金币地块数量（v1.6.24 大王令 14→10；沿革：10 → 7(v0.6.14) → 14(v0.6.15) → 7(v1.3.6 随 7×11) → 14 回退 → 10）
  HEART_TILES: 5,     // 开局爱心地块数量（v1.6.22 大王令：5 枚）
  HEART_HEAL: 2,      // 每枚爱心送到站台回血点数（v1.6.22）
  HEART_OUTER: 4,     // 其中落在「地图最外一圈」的枚数，其余落 5×7 之外的中圈（大王令"外圈占比更高"）
  RES_GAP: 2,         // 资源格最小间距（切比雪夫）：金币与爱心共用一套撒点规则，3×3 邻域内不许有第二枚
  CORE_HP: 100,       // 镇中心初始血量（v1.4.8 大王令 60→100；跨波继承不重置，归零失败）
  STATION_BONUS: 10   // 到站交付额外 +10 金币（v1.3-rc 拍板 ④："站台一定提供 10 金币"）
};

CFG.inBounds = function (c, r) { return c >= 0 && c < CFG.MAP_COLS && r >= 0 && r < CFG.MAP_ROWS; };

// 场地区高度（HUD/底部面板为 HTML，画布仅覆盖此区域）
CFG.fieldH = function () { return CFG.CANVAS_H - CFG.HUD_H - CFG.FOOTER_H; };
// 作战拉远可视高（v1.6.38 大王令"作战时镜头拉远，底部UI不可见"）：
//   画布物理上一直 = HUD 以下全部（792），白天只是被 footer（absolute）盖住下部；
//   夜晚 footer 隐藏 ⇒ 全画布可见，地图用 battleLayout 重算居中。
CFG.battleFieldH = function () { return CFG.CANVAS_H - CFG.HUD_H; };

// 画布内地图布局（day/battle 共用一个几何内核，只有可视高/格子尺寸不同）
//   maxCell（v1.6.39）：可选格子尺寸上限 —— 作战拉远时**真缩小**格子（不是只平移），
//   地图变小居中、四周留出荒野带，敌人从地图边缘冒出 = "从城镇外杀进来"。
CFG._layout = function (fieldH, maxCell) {
  var availW = CFG.CANVAS_W - 16;
  var availH = fieldH - 24;   // v1.3.6：留白 64 → 24（9×13 下格子 38 → 41px，地图更饱满）
  var cell = Math.floor(Math.min(availW / CFG.MAP_COLS, availH / CFG.MAP_ROWS));
  if (maxCell) cell = Math.min(cell, maxCell);   // v1.6.39 拉远缩小上限
  var w = cell * CFG.MAP_COLS;
  var h = cell * CFG.MAP_ROWS;
  return {
    cell: cell,
    x: Math.floor((CFG.CANVAS_W - w) / 2),
    y: Math.floor((fieldH - h) / 2),
    w: w, h: h
  };
};
CFG.layout = function () { return CFG._layout(CFG.fieldH(), CFG.BUILD_CELL); };
// 白天建造布局格子上限（v1.6.53 大王令"建造区域稍微缩小一点点，避免侧面的预警
//   UI 遮挡地块"）：cell 41→**37**（地图 333×481，左右荒野各 ~28px）—— 侧向降级
//   预警（小圈 sr≈10 + 边距）恰好落在荒野带内，不压地块。沿革：此前由宽度瓶颈
//   决定恒 41（v1.6.40 起 fieldH 642 上下也不缺）。
CFG.BUILD_CELL = 37;
// 作战布局（v1.6.39 大王二令"不是平移，要缩小；敌人从城镇外的荒野冒出来"；
//   v1.6.42 大王三令"荒野应该更大而非环绕一圈"）：cell 由 41 压到 **28**
//   （9×13：372×533 → 252×364，缩小 32%），地图在全画布（792）居中，
//   上下各留 ~214px、左右 ~69px 大片荒野 —— "城镇"只是荒野包围中的一块被
//   围墙圈起来的地，怪从地图边缘（荒野深处）生成杀进来。renderer 画荒野暗角
//   + 城镇边界描边 + 全荒野撒草石（REND.wilderness），过渡动画由 main.js CAM 驱动。
CFG.BATTLE_CELL = 28;
CFG.battleLayout = function () { return CFG._layout(CFG.battleFieldH(), CFG.BATTLE_CELL); };
CFG.ccx = function (L, c) { return L.x + c * L.cell + L.cell / 2; };
CFG.ccy = function (L, r) { return L.y + r * L.cell + L.cell / 2; };
CFG.pickCell = function (L, mx, my) {
  var c = Math.floor((mx - L.x) / L.cell);
  var r = Math.floor((my - L.y) / L.cell);
  return CFG.inBounds(c, r) ? { c: c, r: r } : null;
};

// 俄罗斯方块清理形状（v0.6.9 大王定案）：**矩形**，面积 4/6/8 三档等概率。
// 流程 = 等概率选面积 → 等概率选拆法 → 随机横竖朝向。名字记作「宽×高」
//   （2×3 与 3×2 是同一个形状的两种朝向，`GS.cardSig` 会把它们归成同一"尺寸家族"）。
// ⚠️ 目前每档**只有一种拆法**，所以 randomShape 里"选拆法"那步实际恒取第 0 项 ——
//    这不是 bug，是**刻意保留的数组结构**：将来想给某档加第二种拆法，
//    只需在这里补一行，randomShape 不用动。别把它简化成标量。
CFG.SHAPE_SIZES = [4, 6, 8];
CFG.SHAPE_RECTS = {
  4: [[2, 2]],
  6: [[2, 3]],
  8: [[2, 4]]
};

// 随机生成一个清理形状：{ name, cells }，cells 已归一化（最小坐标归 0）
// 可选传 size（4/6/8）指定面积档位；不传则三档等概率随机。
CFG.randomShape = function (size) {
  if (size === undefined) size = CFG.SHAPE_SIZES[Math.floor(Math.random() * CFG.SHAPE_SIZES.length)];
  var opts = CFG.SHAPE_RECTS[size];
  var rc = opts[Math.floor(Math.random() * opts.length)];
  var w = rc[0], h = rc[1];
  if (Math.random() < 0.5) { var t = w; w = h; h = t; }    // 随机横竖
  var cells = [];
  for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) cells.push([c, r]);
  return { name: w + '×' + h, cells: cells };
};