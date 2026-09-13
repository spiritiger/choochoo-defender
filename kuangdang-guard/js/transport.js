// 运输模块：列车装载生产囤货 -> 运到车站售金（强调列车长/主角作用）
window.TRANS = {};

TRANS.serviceCell = function (cell) {
  var n = GS.neighbors(cell.c, cell.r);
  for (var i = 0; i < n.length; i++) {
    var b = GS.buildingAt(n[i][0], n[i][1]);
    if (!b || b.invincible) continue;
    if (b.type === 'mine') {
      // 装载：受载货容量上限限制
      var load = Math.min(UNIT.train.cargoCap - GS.train.cargo, b.stock);
      if (load > 0) { GS.train.cargo += load; b.stock -= load; }
    } else if (b.type === 'station') {
      // 交付售金
      if (GS.train.cargo > 0) {
        GS.gold += GS.train.cargo * BUILD.DEF.station.sellValue;
        GS.train.cargo = 0;
      }
    }
  }
};