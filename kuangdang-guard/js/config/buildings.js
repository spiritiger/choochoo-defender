// 建筑数据：特殊 + 基础四类（迷你版子集）；强化词条搁置
window.BUILD = {};

BUILD.DEF = {
  core: {
    id:'core', name:'镇中心', cost:0, hpMax:100, shape:'core',
    zones: [], buildable:false
  },
  station: {
    id:'station', name:'车站', cost:0, hpMax:100000, shape:'station',
    invincible:true, buildable:false, zones:[CFG.ZONE.INNER], sellValue:3
  },
  turret: {
    id:'turret', name:'炮台', cost:40, hpMax:60, shape:'turret', buildable:true,
    zones:[CFG.ZONE.OUTER, CFG.ZONE.INNER, CFG.ZONE.TOWN],
    damage:12, range:132, cooldown:0.95,
    ammoMax:30, ammoPerCargo:8   // 弹药原型：开火消耗，列车补货转为弹药
  },
  mine: {
    id:'mine', name:'矿机', cost:60, hpMax:50, shape:'mine', buildable:true,
    zones:[CFG.ZONE.INNER, CFG.ZONE.TOWN],
    stockCap:8, produceInterval:1.0, needsRail:true
  },
  boiler: {
    id:'boiler', name:'锅炉', cost:50, hpMax:40, shape:'boiler', buildable:true,
    zones:[CFG.ZONE.INNER, CFG.ZONE.TOWN], speedMul:1.12
  }
};

BUILD.unlocked = ['turret', 'mine', 'boiler'];

BUILD.get = function (id) { return BUILD.DEF[id]; };

// 三选一（不重复）
BUILD.pickOffer = function (n) {
  var pool = BUILD.unlocked.slice();
  var out = [];
  while (out.length < n && pool.length) {
    var i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
};

BUILD.canPlace = function (def, zone, adjRail) {
  if (!def || !def.buildable) return false;
  if (def.zones.indexOf(zone) < 0) return false;
  if (def.needsRail && !adjRail) return false;
  return true;
};