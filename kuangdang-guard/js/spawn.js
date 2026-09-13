// 怪物出生与创建（夜晚击杀暂不给奖励、不给经验）
window.SPAWN = {};

SPAWN.createMonster = function (lvl) {
  var cell = GS.envCells[Math.floor(Math.random() * GS.envCells.length)];
  return {
    type: 'monster',
    x: CFG.ccx(LAY, cell.c),
    y: CFG.ccy(LAY, cell.r),
    hp: lvl.hp,
    hpMax: lvl.hp,
    dmg: lvl.dmg,
    speed: lvl.speed * LAY.cell,   // 像素/秒
    targetBuild: null,             // 当前要攻击的建筑（无则奔向镇中心）
    attackCd: 0,
    dead: false,
    born: 0
  };
};

// 挑选怪物当前攻击目标：最近的建筑（车站无敌跳过），否则镇中心
SPAWN.pickTarget = function (m) {
  var best = null, bd = Infinity;
  for (var k = 0; k < GS.buildings.length; k++) {
    var b = GS.buildings[k];
    if (b.invincible) continue;
    var bx = CFG.ccx(LAY, b.c), by = CFG.ccy(LAY, b.r);
    var d = (m.x - bx) * (m.x - bx) + (m.y - by) * (m.y - by);
    if (d < bd) { bd = d; best = b; }
  }
  var cx = CFG.ccx(LAY, GS.core.c), cy = CFG.ccy(LAY, GS.core.r);
  var cd = (m.x - cx) * (m.x - cx) + (m.y - cy) * (m.y - cy);
  if (!best || cd < bd) best = GS.core;
  return best;
};