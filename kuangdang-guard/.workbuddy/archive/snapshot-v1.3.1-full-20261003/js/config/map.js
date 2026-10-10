// 地图布局与网格 / 俄罗斯方块清理形状
window.CFG = {
  CANVAS_W: 390,
  CANVAS_H: 844,
  HUD_H: 52,
  FOOTER_H: 232,
  MAP_COLS: 9,        // v1.3.6 曾改 7，同日回退：7×11 上 5×7 圈占全图 45%，金币全挤外圈贴边，体验差
  MAP_ROWS: 13,       // （同上，回退 9×13）
  TRAIN_SPEED: 2.6,   // 格/秒
  ECON_RATE: 6,       // 列车每经过一次贴轨经济建筑 +6 金币
  GOLD_RATE: 5,       // 列车驶入金币地块 +5 金币（十字格一圈只算一次）
  GOLD_TILES: 14,     // 开局金币地块数量（沿革：10 → 7(v0.6.14) → 14(v0.6.15) → 7(v1.3.6 随 7×11) → 14 回退）
  CORE_HP: 60,        // 镇中心初始血量（v1.3-rc 塔防迭代；跨波继承不重置，归零失败）
  STATION_BONUS: 10   // 到站交付额外 +10 金币（v1.3-rc 拍板 ④："站台一定提供 10 金币"）
};

CFG.inBounds = function (c, r) { return c >= 0 && c < CFG.MAP_COLS && r >= 0 && r < CFG.MAP_ROWS; };

// 场地区高度（HUD/底部面板为 HTML，画布仅覆盖此区域）
CFG.fieldH = function () { return CFG.CANVAS_H - CFG.HUD_H - CFG.FOOTER_H; };

// 画布内地图布局
CFG.layout = function () {
  var fieldH = CFG.fieldH();
  var availW = CFG.CANVAS_W - 16;
  var availH = fieldH - 24;   // v1.3.6：留白 64 → 24（9×13 下格子 38 → 41px，地图更饱满）
  var cell = Math.floor(Math.min(availW / CFG.MAP_COLS, availH / CFG.MAP_ROWS));
  var w = cell * CFG.MAP_COLS;
  var h = cell * CFG.MAP_ROWS;
  return {
    cell: cell,
    x: Math.floor((CFG.CANVAS_W - w) / 2),
    y: Math.floor((fieldH - h) / 2),
    w: w, h: h
  };
};
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