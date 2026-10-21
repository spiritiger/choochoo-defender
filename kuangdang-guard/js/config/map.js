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
  GOLD_RATE: 5,       // 列车驶入金币地块 +5 金币（2026-10-18 大王令 10→5；十字格一圈只算一次）
  MINT_BONUS: 1,      // 每覆盖一座【铸币所】，覆盖金币格拾取**枚数** +1（1枚→2枚，金额=枚数×GOLD_RATE；v1.8u 三拍板「数量+1 非价值+1」，§14.82）
  // 【经验】波次总经验表（v1.8v 大王令 2026-10-20，§14.90；沿革 v1.8u 四拍板）：击杀经验 =
  //   波总额按本波怪数均分（EXP.killGain）；w>10 封顶取最后一项（关卡模式 LEVEL_WAVES=10）。
  //   设计口径：前 2 波合计 3300 < L1→L2 的 3500（不够升级）；第 3~10 波每波恰升 1 级，
  //   10 波打完到 L9（累计 39700，落在 [36400, 42300) 区间内）。
  WAVE_EXP: [1500, 1800, 3500, 3800, 4100, 4400, 4700, 5000, 5300, 5600],
  MINT_RANGE: 1,      // 【铸币所】作用半径（格，切比雪夫）：1 ⇒ 3×3（v1.8u 大王令「与加油站一致」，与 GAS_RANGE 同值独立）
  GAS_RANGE: 1,       // 【加油站】作用半径（格，切比雪夫）：1 ⇒ 3×3
  GAS_STEP: 1,        // 每座覆盖车头的【加油站】+1 倍速（大王拍板：**求和**不连乘，两座 = 3×）
  // 【消耗提速】（v1.8y 大王拍板 2026-10-21，替换 §14.91 资源点方案；**同日改版**——
  //   大王拍板「每次抽卡进度+1、每 4 抽 1 级、最多 8 级」）：
  //   进度源 = GS.drawCount（本局已付费抽卡次数），抽满 4 抽跨一档 → 列车永久提速
  //   一档（每档 +SPEND_SPEED_STEP），档数 = 表长，全拿封顶 +80%（1.8×）。
  //   与加油站提速、奖励时间快进独立乘区相乘。造塔走同一扣费入口 GS.spendGold
  //   但不动 drawCount ⇒ 重算幂等、不计进度（仅抽卡计次，大王拍板）。
  SPEND_SPEED_TIERS: [4, 8, 12, 16, 20, 24, 28, 32],   // 累计抽卡次数阈值（每 4 抽一档）
  SPEND_SPEED_STEP: 0.10,   // 每跨一档 +10% 车速
  // 【猛攻坊/疾速坊】（v1.8u 十三令，§14.84 大王令）：军工厂（FACTORY_*）退役。
  //   猛攻坊 = 同行**左右各一格**的车厢建筑攻击 +100%/座；疾速坊 = 同列**上下各一格**
  //   的车厢建筑攻速 +100%/座——均**求和非连乘**、无上限；攻速消费 = 间隔 ÷(1+加成)
  //   （+300% ⇒ ÷4 = 间隔 −75%，大王锚点）。查询式口径与 GAS_STEP 同族。
  AUX_ATK: 1.0,       // 每座【猛攻坊】：左右邻格车厢攻击 +100%
  AUX_ASP: 1.0,       // 每座【疾速坊】：上下邻格车厢攻速 +100%（间隔 ÷(1+加成)）
  GOLD_TILES: 10,     // 开局金币地块数量（v1.6.24 大王令 14→10；沿革：10 → 7(v0.6.14) → 14(v0.6.15) → 7(v1.3.6 随 7×11) → 14 回退 → 10）
  HEART_TILES: 5,     // 开局爱心地块数量（v1.6.22 大王令：5 枚）
  HEART_HEAL: 2,      // 每枚爱心送到站台回血点数（v1.6.22）
  HEART_OUTER: 4,     // 其中落在「地图最外一圈」的枚数，其余落 5×7 之外的中圈（大王令"外圈占比更高"）
  RES_GAP: 2,         // 资源格最小间距（切比雪夫）：金币与爱心共用一套撒点规则，3×3 邻域内不许有第二枚
  CORE_HP: 100,       // 镇中心初始血量（v1.4.8 大王令 60→100；跨波继承不重置，归零失败）
  STATION_BONUS: 5    // 到站交付额外 +5 金币（2026-10-18 大王令 10→5；v1.3-rc 拍板 ④"站台一定给金币"）
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