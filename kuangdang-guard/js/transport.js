// 运输模块：列车经过贴轨经济建筑 → 发金币；驶入金币地块 → 收一次金币（一圈只算一次）
window.TRANS = {};

TRANS.serviceCell = function (cell) {
  // 金币地块：列车驶入即收款。十字格一圈会被进入两次，harvested 标记保证**一圈只算一次**；
  // 跑完一圈由 resetGoldLap 统一重置（见 engine.js 的圈检测）。
  var g = GS.grid[cell.r][cell.c];
  if (g.gold && !g.harvested) {
    g.harvested = true;
    g.flash = 0.35;
    GS.gold += CFG.GOLD_RATE;
  }
  var n = GS.neighbors(cell.c, cell.r);
  for (var i = 0; i < n.length; i++) {
    var b = GS.buildingAt(n[i][0], n[i][1]);
    if (!b || b.type !== 'econ') continue;
    GS.gold += b.rate;
    b.flash = 0.35;
  }
};

// 一圈跑完：所有金币地块恢复可收状态（金币重置）
TRANS.resetGoldLap = function () {
  for (var i = 0; i < GS.goldTiles.length; i++) {
    var t = GS.goldTiles[i];
    GS.grid[t.r][t.c].harvested = false;
  }
};
