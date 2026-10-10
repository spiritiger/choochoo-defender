// ============================================================================
// 塔模块（v1.3-rc 临时迭代）—— 冰火雷毒四元素 · 单体攻击
//
// 大王拍板（2026-09-28，规格 §13）：
//   · 四种元素**第一期只做数值差异**（伤害/攻速），冰减速、毒 DOT 等机制后续再说；
//   · 【抽塔】10 金币 → 场上"空地"随机召唤 1 星塔（元素随机）；
//     空地口径 = t==='blank' && 无建筑 && 非金币格 && 非铁轨格（与 placeEcon 同口径去掉贴轨）；
//   · 合成：拖 A 到**同类同星** B 上 → **B 的位置**生成**随机元素** star+1 塔
//     （类型不继承），A 所在格空出；
//   · 星级无上限，伤害 ×star。
//
// 存储：塔 = 建筑格模型第三种类型 `cell.b = {type:'tower', elem, star, cd, c, r}`，
//   占位判定（placeEcon 的"已有建筑"、铁轨求解的障碍判定）自动生效；
//   `GS.towers` 数组是权威列表（渲染/攻击遍历用），与格子互为镜像。
//
// 依赖：GS / CFG（state.js）。被 engine.js 每帧调 TOWERS.update(dt)。
// 测试沙箱友好：不引用 CLOCK/FOES/STATION/REND。
// ============================================================================
window.TOWERS = {};

TOWERS.CFG = {
  COST: 10,            // 抽塔价格（大王定案 10 金币/次）
  RANGE: 2.5,          // 射程（格，塔中心到怪中心欧氏距离）
  // 元素数值表（v1.3-rc 第一期只做数值差异；调优只动这里）
  //   fire 均衡 / ice 低伤快速 / thunder 高伤慢速 / poison 中庸
  STATS: {
    fire:    { dmg: 12, rate: 1.0 },
    ice:     { dmg: 7,  rate: 0.8 },
    thunder: { dmg: 16, rate: 1.4 },
    poison:  { dmg: 9,  rate: 0.9 }
  }
};

// 四元素固定顺序（随机抽取 / 渲染色板都按这个序，保证稳定）
TOWERS.ELEMS = ['fire', 'ice', 'thunder', 'poison'];

TOWERS.randElem = function () {
  return TOWERS.ELEMS[Math.floor(Math.random() * TOWERS.ELEMS.length)];
};

// ---- 放置判定 ---------------------------------------------------------------
// 空地口径（拍板 ⑤）：空地 + 非铁轨 + 非金币格 + 无建筑。铁轨上放塔会堵列车路。
TOWERS.isFreeSpot = function (c, r) {
  if (!CFG.inBounds(c, r)) return false;
  var cell = GS.grid[r][c];
  if (cell.t !== 'blank') return false;   // 废墟/障碍不行
  if (cell.b) return false;               // 已有建筑（含塔、镇中心）
  if (cell.gold) return false;            // 金币格 = 资源格，不占用
  if (GS.onRail(c, r)) return false;      // 铁轨格不占（列车不做碰撞，视觉重叠即逻辑荒谬）
  return true;
};

// 全场可放塔的格子列表
TOWERS.freeSpots = function () {
  var out = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++)
    for (var c = 0; c < CFG.MAP_COLS; c++)
      if (TOWERS.isFreeSpot(c, r)) out.push({ c: c, r: r });
  return out;
};

// ---- 放置（召唤与合成的共同底层）--------------------------------------------
// 在 (c,r) 放一座指定 elem/star 的塔。调用方保证格子合法（此处不重复校验，
// 便于合成时"原地替换"不被 isFreeSpot 的 !cell.b 卡住）。
TOWERS.placeAt = function (c, r, elem, star) {
  var t = { type: 'tower', elem: elem, star: star, cd: 0, c: c, r: r, flash: 0 };
  GS.grid[r][c].b = t;
  GS.towers.push(t);
  return t;
};

// 移除塔（合成时源塔离场 / 重开清场用）：格子与数组两处同步清
TOWERS.remove = function (t) {
  var i = GS.towers.indexOf(t);
  if (i >= 0) GS.towers.splice(i, 1);
  var cell = GS.grid[t.r][t.c];
  if (cell.b === t) cell.b = null;
};

// ---- 抽塔（【抽塔】按钮）----------------------------------------------------
// 10 金币 → 随机合法空格 + 随机元素 1 星。成功返回 true，失败返回错误文案。
TOWERS.summon = function () {
  if (GS.gold < TOWERS.CFG.COST) {
    if (typeof LOG !== 'undefined') LOG.add('summonFail', { reason: '金币不足' });
    return '金币不足（需 ' + TOWERS.CFG.COST + '）';
  }
  var spots = TOWERS.freeSpots();
  if (!spots.length) {
    if (typeof LOG !== 'undefined') LOG.add('summonFail', { reason: '没有可用的空地' });
    return '没有可用的空地';
  }
  var p = spots[Math.floor(Math.random() * spots.length)];
  GS.gold -= TOWERS.CFG.COST;
  var t = TOWERS.placeAt(p.c, p.r, TOWERS.randElem(), 1);
  if (typeof LOG !== 'undefined') LOG.add('summon',
    { elem: t.elem, star: t.star, at: p.c + ',' + p.r, cost: TOWERS.CFG.COST });
  return true;
};

// ---- 合成（拖 A 塔放到 B 塔上）----------------------------------------------
// 判据（大王定案）：同名（elem 相同）+ 同星（star 相同）。
// ⚠️ v1.4 改口径（规格 §14.1）：产物**继承原元素** —— 英雄卡时代成长要确定，
//   旧"元素全随机"拍板随 v1.3 随机落点召唤一起退役。
TOWERS.canMerge = function (src, dst) {
  return src && dst && src !== dst &&
         src.type === 'tower' && dst.type === 'tower' &&
         src.elem === dst.elem && src.star === dst.star;
};

TOWERS.merge = function (src, dst) {
  if (!TOWERS.canMerge(src, dst)) {
    if (typeof LOG !== 'undefined') LOG.add('mergeFail',
      { from: src && src.c >= 0 ? (src.c + ',' + src.r) : 'hand', to: dst ? (dst.c + ',' + dst.r) : null });
    return '需要同名同星的两座塔';
  }
  if (src.c >= 0) TOWERS.remove(src);       // 源塔离场（格子弹出、数组移除）
                                            // ⚠️ v1.6.10：手牌虚源（c=-1 占位）不在场，跳过离场
  // v1.4：元素继承不变（删旧 randElem 行）—— 同名卡攒出确定成长
  dst.star += 1;                            // 星级 +1
  dst.flash = 0.4;                          // 合成闪光（renderer 用）
  if (typeof LOG !== 'undefined') LOG.add('merge',
    { from: src.c >= 0 ? (src.c + ',' + src.r) : 'hand', to: dst.c + ',' + dst.r, elem: dst.elem, star: dst.star });
  return true;
};

// ---- 手牌直接合成（v1.6.10，大王令）------------------------------------------
// 英雄卡（手牌塔恒 1 星）拖到场上同名 1 星塔上松手 = 直接升星，免"先建塔再拖动"两步。
// 判据/执行**复用 canMerge/merge 单一路径**（幽灵源 c=-1 占位），杜绝两套口径漂移。
TOWERS.canMergeCard = function (elem, dst) {
  return TOWERS.canMerge({ type: 'tower', elem: elem, star: 1, c: -1, r: -1 }, dst);
};
TOWERS.mergeFromHand = function (elem, dst) {
  return TOWERS.merge({ type: 'tower', elem: elem, star: 1, c: -1, r: -1 }, dst);
};

// ---- 攻击（每帧）------------------------------------------------------------
// ⚠️ v1.4.2 大王纠偏："塔没有攻击能力，车厢才有" —— 塔 = 星级容器（合成升星
//   提升对应车厢），**不再索敌开火**。旧塔攻击循环冻结保留在下方 __towerAtk_retired
//   （无 VCS，留档可随时复活）；TOWERS.update 现在只维护连线衰减与闪光衰减。
TOWERS.beams = [];    // {ac,ar, bc,br, t}  t = 剩余显示秒（车头/车厢攻击连线共用）

TOWERS.update = function (dt) {
  // 攻击连线闪光衰减（白天也要衰减，残留连线不能冻住）
  for (var b = TOWERS.beams.length - 1; b >= 0; b--) {
    TOWERS.beams[b].t -= dt;
    if (TOWERS.beams[b].t <= 0) TOWERS.beams.splice(b, 1);
  }
  // 塔闪光衰减（合成闪光 renderer 用）—— 攻击 flash 已无来源，衰减照留防残留冻结
  for (var i = 0; i < GS.towers.length; i++) {
    if (GS.towers[i].flash > 0) GS.towers[i].flash -= dt;
  }
};

// ⚠️ 退役留档：旧"塔单体攻击"循环（v1.3-rc~v1.4.1）。复活要点：塔对象带
//   cd/flash 字段、TOWERS.CFG.STATS 提供元素伤害表、连线塞 TOWERS.beams。
TOWERS.__towerAtk_retired = function (dt) {
  if (GS.gameOver) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;
  var core = GS.core;
  for (var i = 0; i < GS.towers.length; i++) {
    var t = GS.towers[i];
    if (t.flash > 0) t.flash -= dt;
    t.cd -= dt;
    if (t.cd > 0) continue;
    var st = TOWERS.CFG.STATS[t.elem];
    // 选目标：射程内、离镇中心最近（直线冲的怪里最前面的）
    var best = null, bestD = Infinity;
    for (var j = 0; j < foes.length; j++) {
      var f = foes[j];
      var dx = f.c - t.c, dy = f.r - t.r;
      if (dx * dx + dy * dy > TOWERS.CFG.RANGE * TOWERS.CFG.RANGE) continue;
      var dc = f.c - core.c, dr = f.r - core.r;
      var dCore = dc * dc + dr * dr;
      if (dCore < bestD) { bestD = dCore; best = f; }
    }
    if (!best) continue;
    best.hp -= st.dmg * t.star;             // 星级倍率
    t.cd = st.rate;
    t.flash = 0.25;
    TOWERS.beams.push({ ac: t.c, ar: t.r, bc: best.c, br: best.r, t: 0.12 });
  }
};

// 怪被杀（foes.js 调）：hp<=0 的怪由 foes 自己移除，塔这边不用管。

// ---- 重开清场（ENG.init / 失败重开时调）--------------------------------------
TOWERS.reset = function () {
  GS.towers = [];
  TOWERS.beams = [];
};
