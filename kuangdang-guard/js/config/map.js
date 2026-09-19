// 地图布局与网格 / 俄罗斯方块清理形状
window.CFG = {
  CANVAS_W: 390,
  CANVAS_H: 844,
  HUD_H: 52,
  FOOTER_H: 232,
  MAP_COLS: 11,
  MAP_ROWS: 15,
  TRAIN_SPEED: 2.6,   // 格/秒
  ECON_RATE: 6   // 列车每经过一次贴轨经济建筑 +6 金币
};

CFG.inBounds = function (c, r) { return c >= 0 && c < CFG.MAP_COLS && r >= 0 && r < CFG.MAP_ROWS; };

// 场地区高度（HUD/底部面板为 HTML，画布仅覆盖此区域）
CFG.fieldH = function () { return CFG.CANVAS_H - CFG.HUD_H - CFG.FOOTER_H; };

// 画布内地图布局
CFG.layout = function () {
  var fieldH = CFG.fieldH();
  var availW = CFG.CANVAS_W - 16;
  var availH = fieldH - 64;
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

// 俄罗斯方块形状（清理工具作用范围）
CFG.SHAPES = [
  { name: '长条', cells: [[0, 0], [1, 0], [2, 0], [3, 0]] },
  { name: '方块', cells: [[0, 0], [1, 0], [0, 1], [1, 1]] },
  { name: 'L 形', cells: [[0, 0], [1, 0], [2, 0], [0, 1]] },
  { name: 'T 形', cells: [[0, 0], [1, 0], [2, 0], [1, 1]] },
  { name: 'Z 形', cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  { name: '直角', cells: [[0, 0], [1, 0], [1, 1]] }
];