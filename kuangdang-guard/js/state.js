// 全局游戏状态
window.GS = {};

GS.newGame = function () {
  GS.gold = 120;
  GS.nightIndex = 0;      // 0-based 当前轮次（0/1/2 = 3 夜）
  GS.phase = 'day';        // 'day' | 'night'
  GS.dayCount = 0;
  GS.townHp = BUILD.DEF.core.hpMax;
  GS.result = null;        // 'win' | 'lose'
  GS.time = 0;

  // grid[r][c] = { b: building|null, terrain: string|null, track: bool }
  GS.grid = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var row = [];
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      row.push({ b: null, terrain: null, track: CFG.isTrack(c, r) });
    }
    GS.grid.push(row);
  }

  GS.buildings = [];
  GS.monsters = [];
  GS.projectiles = [];

  GS.railPath = CFG.ringPath();
  GS.train = { index: 0, frac: 0, cargo: 0, fireCd: 0 };

  // 蒸汽加速
  GS.steam = 0;      // >0 加速中(秒)
  GS.steamCd = 0;

  GS.spawnTimer = 0;
  GS.spawned = 0;

  GS.envCells = CFG.envCells();
  GS.selOffer = null;   // 当前选中的建筑卡 id

  GS.offer = [];        // 当前三选一
  GS.status = '';

  GS.core = null;       // 镇中心建筑引用
};

GS.railCell = function (i) { return GS.railPath[i % GS.railPath.length]; };

GS.neighbors = function (c, r) {
  return [[c - 1, r], [c + 1, r], [c, r - 1], [c, r + 1]];
};

GS.buildingAt = function (c, r) {
  if (!CFG.inBounds(c, r)) return null;
  return GS.grid[r][c].b;
};

GS.adjRail = function (c, r) {
  var n = GS.neighbors(c, r);
  for (var i = 0; i < n.length; i++) {
    if (CFG.inBounds(n[i][0], n[i][1]) && CFG.isTrack(n[i][0], n[i][1])) return true;
  }
  return false;
};