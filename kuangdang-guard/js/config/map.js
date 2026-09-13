// 地图与地块（同心环规则，11x15 竖长）
window.CFG = {
  CANVAS_W: 390,
  CANVAS_H: 844,
  HUD_H: 52,
  FOOTER_H: 232,
  MAP_COLS: 11,
  MAP_ROWS: 15,
  ZONE: { ENV: 0, OUTER: 1, TRACK: 2, INNER: 3, TOWN: 4 },
  ZONE_NAME: ['外部环境', '铁轨外圈', '铁轨', '铁轨内圈', '城镇内部']
};

// 到最近边缘的同心层数（0=外部环境 ... >=4=城镇内部）
CFG.zoneAt = function (c, r) {
  var d = Math.min(c, CFG.MAP_COLS - 1 - c, r, CFG.MAP_ROWS - 1 - r);
  return d >= 4 ? CFG.ZONE.TOWN : d;
};
CFG.isTrack = function (c, r) { return CFG.zoneAt(c, r) === CFG.ZONE.TRACK; };
CFG.inBounds = function (c, r) { return c >= 0 && c < CFG.MAP_COLS && r >= 0 && r < CFG.MAP_ROWS; };

// 场地区高度（HUD/底部面板为 HTML，画布仅覆盖此区域）
CFG.fieldH = function () { return CFG.CANVAS_H - CFG.HUD_H - CFG.FOOTER_H; };

// 画布内地图布局（含 HUD/底部面板偏移）
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
    y: Math.floor((fieldH - h) / 2),   // 相对画布(地图区)左上角
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

// 铁轨闭环（铁路 = 区域 cols2..8 行 rows2..12 的外围一周）
CFG.ringPath = function () {
  var path = [];
  var cs = 2, ce = 8, rs = 2, re = 12;
  for (var c = cs; c <= ce; c++) path.push({ c: c, r: rs });
  for (var r = rs + 1; r <= re; r++) path.push({ c: ce, r: r });
  for (var c2 = ce - 1; c2 >= cs; c2--) path.push({ c: c2, r: re });
  for (var r2 = re - 1; r2 >= rs + 1; r2--) path.push({ c: cs, r: r2 });
  return path;
};

// 所有外部环境(含边缘)格子，供怪物出生
CFG.envCells = function () {
  var out = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++)
    for (var c = 0; c < CFG.MAP_COLS; c++)
      if (CFG.zoneAt(c, r) === CFG.ZONE.ENV) out.push({ c: c, r: r });
  return out;
};