// 运输模块：列车经过贴轨经济建筑 → 直接发金币
window.TRANS = {};

TRANS.serviceCell = function (cell) {
  var n = GS.neighbors(cell.c, cell.r);
  for (var i = 0; i < n.length; i++) {
    var b = GS.buildingAt(n[i][0], n[i][1]);
    if (!b || b.type !== 'econ') continue;
    GS.gold += b.rate;
    b.flash = 0.35;
  }
};