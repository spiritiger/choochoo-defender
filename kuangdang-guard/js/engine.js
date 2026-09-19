// 主引擎：清理/建造、列车跑圈发钱
window.ENG = {};

ENG.init = function () { GS.newGame(); };

// ---- 清理工具：用形状覆盖格清空废墟 ----
ENG.applyShape = function (oc, or_, cells) {
  var rubbleCount = 0;
  var pts = [];
  for (var i = 0; i < cells.length; i++) {
    var c = oc + cells[i][0], r = or_ + cells[i][1];
    if (!CFG.inBounds(c, r)) return '形状超出地图';
    var cell = GS.grid[r][c];
    if (cell.b) return '范围内已有建筑';
    pts.push({ c: c, r: r });
    if (cell.t === 'rubble') rubbleCount++;
  }
  if (rubbleCount === 0) return '形状内没有废墟';
  for (var j = 0; j < pts.length; j++) GS.grid[pts[j].r][pts[j].c].t = 'blank';
  GS.recomputeRails();
  return true;
};

// ---- 建造经济建筑（需已清空空白格 + 紧贴铁轨） ----
ENG.placeEcon = function (c, r) {
  var cell = GS.grid[r][c];
  if (cell.t !== 'blank') return '这里是废墟，先清理';
  if (GS.onRail(c, r)) return '铁轨地块，不可建造';
  if (cell.b) return '已有建筑';
  if (!GS.railNeighbor(c, r)) return '需紧贴铁轨';
  var b = { type: 'econ', c: c, r: r, rate: CFG.ECON_RATE, flash: 0 };
  cell.b = b;
  GS.buildings.push(b);
  GS.recomputeRails();
  return true;
};

ENG.update = function (dt) {
  // 经济建筑收款闪光衰减
  for (var kf = 0; kf < GS.buildings.length; kf++) {
    var bf = GS.buildings[kf];
    if (bf.flash > 0) bf.flash -= dt;
  }
  ENG.tickTrain(dt);
};

// ---- 列车：沿铁轨环行驶，经过贴轨经济建筑发钱 ----
ENG.tickTrain = function (dt) {
  var tr = GS.train;
  var n = GS.railPath.length;
  if (!n) return;
  tr.frac += CFG.TRAIN_SPEED * dt;
  while (tr.frac >= 1) {
    tr.frac -= 1;
    tr.index = (tr.index + 1) % n;
    TRANS.serviceCell(GS.railCell(tr.index));
  }
};

ENG.trainAngle = function () {
  var a = GS.railCell(GS.train.index);
  var b = GS.railCell(GS.train.index + 1);
  return Math.atan2(CFG.ccy(LAY, b.r) - CFG.ccy(LAY, a.r), CFG.ccx(LAY, b.c) - CFG.ccx(LAY, a.c));
};
ENG.trainPos = function () {
  var a = GS.railCell(GS.train.index);
  var b = GS.railCell(GS.train.index + 1);
  var f = GS.train.frac;
  return {
    x: CFG.ccx(LAY, a.c) + (CFG.ccx(LAY, b.c) - CFG.ccx(LAY, a.c)) * f,
    y: CFG.ccy(LAY, a.r) + (CFG.ccy(LAY, b.r) - CFG.ccy(LAY, a.r)) * f
  };
};
