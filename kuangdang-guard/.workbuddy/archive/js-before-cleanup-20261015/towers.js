// ============================================================================
// 塔模块 —— **v1.6.34 塔型替换**（大王拍板 2026-10-13：英雄卡元素 → 4 塔型）
//
// 沿革：v1.3-rc 冰火雷毒四元素（只做数值差异）→ v1.6.34 **移植 DIY 塔防的 4 塔型**：
//   · 箭塔 arrow / 炮塔 cannon / 魔法塔 magic / 寒冰塔 ice（数值方案 A「等 DPS 包络」）；
//   · **字段名仍是 `elem`**（避免全库改名），只是**取值域**从 fire/ice/thunder/poison
//     换成 arrow/cannon/magic/ice —— 现有元素特效**并入塔型**：
//     火→炮塔灼烧、毒→魔法塔中毒、冰→寒冰塔减速、雷→箭塔高频。
//
// 数值方案 A（**等 DPS 包络**，不动我们的平衡基准）：四种塔**只在"伤害×攻速"的乘积内取舍**
//   （都 ≈0.833 基准/秒），靠范围 / 特效 / 射程换差异。表在 `TOWERS.TYPES`，调优只动它。
//   ⚠️ **车头（ENG.trainCombat）不变**（仍 8+4w 撞击式），只改**车厢**（ENG.wagonCombat）。
//
// 依附（v1.6.34 词条系统，见 affixes.js）：塔对象带 `affix` 字段（该塔装的那 1 条词条 id，
//   无则 null）。**每座塔上限 1 条**（大王拍板"每个塔的词条只能选1次"）。
//
// 存储：塔 = 建筑格模型第三种类型 `cell.b = {type:'tower', elem, star, cd, c, r, affix}`，
//   占位判定（placeEcon 的"已有建筑"、铁轨求解的障碍判定）自动生效；
//   `GS.towers` 数组是权威列表（渲染/攻击遍历用），与格子互为镜像。
//
// 依赖：GS / CFG（state.js）。被 engine.js 每帧调 TOWERS.update(dt)。
// 测试沙箱友好：不引用 CLOCK/FOES/STATION/REND。
// ============================================================================
window.TOWERS = {};

// 四塔型数值表（**方案 A：等 DPS 包络**，2026-10-13 大王拍板）
//   · dmgMul  伤害倍率（基准 = 8+4×wave，见 ENG.WAGON.dmg）
//   · interval 攻击间隔秒        · range 射程（格，欧氏）
//   · targets  1 = 单体；'aoe' = 命中格 3×3 内全体（cannon）
//   · effect   'none' | 'burn'（灼烧 2s）| 'poison'（中毒 4s）| 'slow'（减速 1.5s）
//   ▍DPS 包络：箭 1.0/1.2=0.833 · 炮 2.5/3.0=0.833（AOE）· 魔法 2.0/2.4=0.833 · 冰 0.8/1.0=0.800
//   ▍配色沿用旧元素色板（3 色复用 + 魔法换紫），避免与金币黄/城墙橙/怪红撞脸。
TOWERS.TYPES = {
  arrow:  { id: 'arrow',  name: '箭塔',   color: '#f7d94c', dmgMul: 1.0, interval: 1.2, range: 4.5, targets: 1,     effect: 'none'   },
  cannon: { id: 'cannon', name: '炮塔',   color: '#e8563f', dmgMul: 2.5, interval: 3.0, range: 6.3, targets: 'aoe', effect: 'burn'   },
  magic:  { id: 'magic',  name: '魔法塔', color: '#a855f7', dmgMul: 2.0, interval: 2.4, range: 5.4, targets: 1,     effect: 'poison' },
  ice:    { id: 'ice',    name: '寒冰塔', color: '#6ec6ff', dmgMul: 0.8, interval: 1.0, range: 3.6, targets: 1,     effect: 'slow'   }
};

TOWERS.typeOf = function (elem) { return TOWERS.TYPES[elem] || null; };
TOWERS.typeName = function (elem) { var t = TOWERS.TYPES[elem]; return t ? t.name : elem; };

TOWERS.CFG = {
  COST: 10,            // 抽塔价格（大王定案 10 金币/次）
  RANGE: 2.5,          // （旧字段，仅 __towerAtk_retired 用）
  // ⚠️ 旧元素数值表（仅 `__towerAtk_retired` 那个退役函数还引用）。**新塔型数值走
  //    `TOWERS.TYPES`**；这张表只为"退役函数万一被复活时不至于崩"而保留。
  STATS: {
    arrow:  { dmg: 12, rate: 1.2 },
    cannon: { dmg: 30, rate: 3.0 },
    magic:  { dmg: 24, rate: 2.4 },
    ice:    { dmg: 8,  rate: 1.0 }
  }
};

// 四塔型固定顺序（随机抽取 / 渲染色板都按这个序，保证稳定）
//   ⚠️ 名称保留 `ELEMS` 是**兼容别名**（大量旧引用读它），语义已是"塔型"。
TOWERS.ELEMS = ['arrow', 'cannon', 'magic', 'ice'];

TOWERS.randElem = function () {
  return TOWERS.ELEMS[Math.floor(Math.random() * TOWERS.ELEMS.length)];
};

// ---- 放置判定 ---------------------------------------------------------------
// 空地口径（拍板 ⑤）：空地 + 非铁轨 + 非金币格 + 无建筑。铁轨上放塔会堵列车路。
// ⚠️ v1.6.23：判据**上移到 `GS.isFreeSpot`**（塔 / 建筑卡共用一条，别再维护第二份）。
TOWERS.isFreeSpot = function (c, r) { return GS.isFreeSpot(c, r); };

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
  // affix = 该塔装的词条 id（v1.6.34，**每塔上限 1 条**，见 affixes.js）；wcd = 车厢攻击冷却
  var t = { type: 'tower', elem: elem, star: star, cd: 0, c: c, r: r, flash: 0,
            affix: null, wcd: 0, streak: 0, lastT: null, chargeT: 0 };
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
