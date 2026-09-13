// 主引擎：昼夜切换、经济、列车、怪物、战斗、胜负
window.ENG = {};

ENG.init = function () {
  GS.newGame();
  var cC = Math.floor(CFG.MAP_COLS / 2);
  var cR = Math.floor(CFG.MAP_ROWS / 2);
  ENG.place('core', cC, cR);
  GS.core = GS.buildingAt(cC, cR);
  ENG.place('station', 3, 3); // 车站：铁轨内圈、紧邻铁轨、无敌
  GS.offer = BUILD.pickOffer(3);
};

ENG.place = function (type, c, r) {
  var def = BUILD.DEF[type];
  if (!def) return false;
  if (!CFG.inBounds(c, r)) return false;
  if (CFG.isTrack(c, r)) return false;
  if (GS.buildingAt(c, r)) return false;
  if (def.buildable) {
    var zone = CFG.zoneAt(c, r);
    if (!BUILD.canPlace(def, zone, GS.adjRail(c, r))) return false;
    if (GS.gold < def.cost) return false;
    GS.gold -= def.cost;
  } else if (type !== 'core' && type !== 'station') {
    return false; // 只允许核心/车站这类特殊通过
  }
  var b = {
    type: type, shape: def.shape, c: c, r: r,
    hp: def.hpMax, hpMax: def.hpMax,
    invincible: !!def.invincible,
    stock: def.stockCap ? 0 : 0,
    timer: 0, cd: 0,
    def: def
  };
  GS.grid[r][c].b = b;
  GS.buildings.push(b);
  return true;
};

ENG.currentLevel = function () { return LEVELS[GS.nightIndex]; };

ENG.enterNight = function () {
  if (GS.phase !== 'day') return;
  GS.phase = 'night';
  GS.spawned = 0;
  GS.spawnTimer = 0;
  GS.townHp = GS.core.hp;
  GS.selOffer = null;
  GS.status = '';
};

ENG.endNight = function () {
  if (GS.nightIndex >= LEVELS.total - 1) {
    GS.result = 'win';
    return;
  }
  GS.nightIndex++;
  GS.phase = 'day';
  GS.dayCount++;
  GS.selOffer = null;
  GS.offer = BUILD.pickOffer(3);
  GS.status = '进入第 ' + (GS.nightIndex + 1) + ' 白昼';
};

ENG.update = function (dt) {
  if (GS.result) return;
  GS.time += dt;
  ENG.tickEconomy(dt);
  ENG.tickTrain(dt);
  if (GS.phase === 'night') {
    ENG.tickSpawn(dt);
    ENG.tickCombat(dt);
    if (GS.phase === 'night' && GS.spawned >= ENG.currentLevel().count && GS.monsters.length === 0) {
      ENG.endNight();
    }
  }
  ENG.tickProjectiles(dt);
  ENG.tickSteam(dt);
  ENG.cleanup();
  if (GS.core && GS.core.hp <= 0) GS.result = 'lose';
};

// ---- 经济：日夜都生产 ----
ENG.tickEconomy = function (dt) {
  for (var k = 0; k < GS.buildings.length; k++) {
    var b = GS.buildings[k];
    if (b.type !== 'mine' || b.invincible || b.hp <= 0) continue;
    b.timer += dt;
    var interval = b.def.produceInterval;
    while (b.timer >= interval && b.stock < b.def.stockCap) {
      b.stock++;
      b.timer -= interval;
    }
  }
};

// ---- 列车：行驶 + 运输(装载/售金) + 蒸汽加速 + 开火 ----
ENG.tickTrain = function (dt) {
  var tr = GS.train;
  var boilerCount = 0;
  for (var kb = 0; kb < GS.buildings.length; kb++) {
    if (GS.buildings[kb].type === 'boiler' && GS.buildings[kb].hp > 0) boilerCount++;
  }
  var mul = (GS.steam > 0 ? UNIT.train.boostMult : 1) * (1 + 0.12 * boilerCount);
  var step = UNIT.train.speed * mul * dt;
  tr.frac += step;
  var n = GS.railPath.length;
  while (tr.frac >= 1) {
    tr.frac -= 1;
    tr.index = (tr.index + 1) % n;
    TRANS.serviceCell(GS.railCell(tr.index));
  }
  // 列车自动开火（夜晚）
  tr.fireCd -= dt;
  if (GS.phase === 'night' && tr.fireCd <= 0) {
    var p = ENG.trainPos();
    var t = ENG.findMonster(p.x, p.y, UNIT.train.range);
    if (t) { ENG.shoot(p.x, p.y, t, UNIT.train.damage); tr.fireCd = UNIT.train.fireCooldown; }
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
    y: CFG.ccy(LAY, a.r) + (CFG.ccy(LAY, b.r) - CFG.ccy(LAY, a.r)) * f,
    from: a, c: b
  };
};

ENG.tickSteam = function (dt) {
  if (GS.steam > 0) GS.steam -= dt;
  if (GS.steamCd > 0) GS.steamCd -= dt;
};

// ---- 出生 ----
ENG.tickSpawn = function (dt) {
  var lvl = ENG.currentLevel();
  GS.spawnTimer += dt;
  if (GS.spawned < lvl.count && GS.spawnTimer >= lvl.interval) {
    GS.monsters.push(SPAWN.createMonster(lvl));
    GS.spawned++;
    GS.spawnTimer = 0;
  }
};

// ---- 战斗：炮台 + 怪物推进/攻击 ----
ENG.findMonster = function (x, y, range) {
  var best = null, bd = range * range;
  for (var k = 0; k < GS.monsters.length; k++) {
    var m = GS.monsters[k];
    if (m.dead) continue;
    var d = (m.x - x) * (m.x - x) + (m.y - y) * (m.y - y);
    if (d <= bd) { bd = d; best = m; }
  }
  return best;
};

ENG.shoot = function (sx, sy, target, dmg) {
  GS.projectiles.push({ x: sx, y: sy, tx: target.x, ty: target.y, life: 0.16, max: 0.16 });
  target.hp -= dmg;
  if (target.hp <= 0) target.dead = true;
};

ENG.tickCombat = function (dt) {
  // 炮台
  for (var k = 0; k < GS.buildings.length; k++) {
    var b = GS.buildings[k];
    if (b.type !== 'turret' || b.hp <= 0 || b.invincible) continue;
    b.cd -= dt;
    if (b.cd <= 0) {
      var px = CFG.ccx(LAY, b.c), py = CFG.ccy(LAY, b.r);
      var t = ENG.findMonster(px, py, b.def.range);
      if (t) { ENG.shoot(px, py, t, b.def.damage); b.cd = b.def.cooldown; }
    }
  }
  // 怪物移动/攻击
  for (var i = 0; i < GS.monsters.length; i++) {
    var m = GS.monsters[i];
    if (m.dead) continue;
    if (!m.targetBuild || m.targetBuild.hp <= 0) m.targetBuild = SPAWN.pickTarget(m);
    var tb = m.targetBuild;
    var tx = CFG.ccx(LAY, tb.c), ty = CFG.ccy(LAY, tb.r);
    var dx = tx - m.x, dy = ty - m.y, dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > UNIT.monster.attackRange) {
      m.x += (dx / dist) * m.speed * dt;
      m.y += (dy / dist) * m.speed * dt;
    } else {
      m.attackCd -= dt;
      if (m.attackCd <= 0) {
        ENG.damageBuilding(tb, m.dmg);
        m.attackCd = UNIT.monster.attackCooldown;
      }
    }
  }
};

ENG.damageBuilding = function (b, dmg) {
  if (b.invincible || b.hp <= 0) return;
  b.hp -= dmg;
  if (b.type === 'core') GS.townHp = b.hp;
};

ENG.tickProjectiles = function (dt) {
  for (var k = 0; k < GS.projectiles.length; k++) GS.projectiles[k].life -= dt;
};

ENG.cleanup = function () {
  // 移除死亡建筑
  var aliveB = [];
  for (var k = 0; k < GS.buildings.length; k++) {
    var b = GS.buildings[k];
    if (b.hp <= 0 && !b.invincible) {
      GS.grid[b.r][b.c].b = null;
    } else {
      aliveB.push(b);
    }
  }
  GS.buildings = aliveB;
  // 移除死亡/越界怪物
  GS.monsters = GS.monsters.filter(function (m) { return !m.dead; });
  GS.projectiles = GS.projectiles.filter(function (p) { return p.life > 0; });
};