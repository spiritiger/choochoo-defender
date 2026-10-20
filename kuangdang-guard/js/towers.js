// ============================================================================
// 塔模块 —— **v1.8j 车厢改版**（大王拍板 2026-10-19：4 车厢重命名 + 攻击方式重定；v1.8k/l 数值微调）
//   · 机枪（arrow）/ 火炮（cannon）/ 冰环（ice）/ 闪电（magic），数值见 TYPES 表注释；
//   · **内部 id 仍是 arrow/cannon/magic/ice**（词条归属、存档、色板零迁移），只改展示名。
//
// 沿革：v1.3-rc 冰火雷毒四元素（只做数值差异）→ v1.6.34 **移植 DIY 塔防的 4 塔型**
//   （箭塔/炮塔/魔法塔/寒冰塔，字段名仍叫 `elem`）→ v1.8j 改名定稿如上。
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

// 四塔型数值表（**v1.8j 大王令车厢改版**：名称与攻击方式重定，等 DPS 包络基准不动）
//   · dmgMul  伤害倍率（基准 = 12×star 固定基数，见 ENG.WAGON.dmg；v1.6.79 起不随波次）
//   · interval 攻击间隔秒        · range 射程（格，欧氏；4.5=标准距离）
//   · dmgType 'phys' 物理 | 'magic' 魔法（展示口径；当前无抗性结算，见规格 §14.60）
//   · targets  1 = 单体；'aoe' = 命中点溅射 splash 半径圆内全体（cannon）；
//              'ring' = 以车厢自身为圆心、射程为半径的环内全体（ice）
//   · effect   'none' | 'slow'（减速 1.5s）—— burn/poison 已退役（灼烧 v1.8k、中毒 v1.8j）
//   ▍预期 DPS 口径（v1.8l 定稿，E[N]：火炮溅射 2 / 冰环 2.5 / 单体 1）：
//     机枪 10 · 火炮 15×2/3s=10 · 冰环 6.4×2.5/2s=8（减速效用找平，压到 10 以下）· 闪电 10
//   ▍v1.8j 拍板要点：火炮射程 6.3→4.5 回归标准、溅射 3×3 方块→半径 1.3 圆（大王报"AOE 太大"）；
//     闪电去中毒回归纯单体爆发；冰环改近距离环绕 AOE（减速保留，i 系词条依赖它）。
//   ▍v1.8k 微调：机枪 4 伤/0.4s（每发更小、响应更快）；火炮灼烧退役（遗留 DoT 干掉）。
//   ▍v1.8l 调平（预期 DPS 口径）：火炮 30→15/发（预期 20→10）；冰环 9.6→6.4/发（预期 12→8）——
//     间隔/射程/特效全不动，只降每发伤害。
//   ▍配色沿用旧元素色板，避免与金币黄/城墙橙/怪红撞脸。
TOWERS.TYPES = {
  arrow:  { id: 'arrow',  name: '机枪', color: '#f7d94c', dmgMul: 1/3, interval: 0.4, range: 4.5, targets: 1,     dmgType: 'phys',  effect: 'none' },
  cannon: { id: 'cannon', name: '火炮', color: '#e8563f', dmgMul: 1.25, interval: 3.0, range: 4.5, targets: 'aoe', splash: 1.3, dmgType: 'phys', effect: 'none' },
  ice:    { id: 'ice',    name: '冰环', color: '#6ec6ff', dmgMul: 8/15, interval: 2.0, range: 2.2, targets: 'ring',             dmgType: 'magic', effect: 'slow' },
  magic:  { id: 'magic',  name: '闪电', color: '#a855f7', dmgMul: 2.0, interval: 2.4, range: 4.5, targets: 1,     dmgType: 'magic', effect: 'none' }
};

// （2026-10-15 代码整理：TOWERS.typeOf(elem) 已删 —— 全项目 0 调用（取塔型历来
//   直取 TOWERS.TYPES[elem] 或走 typeName）；清理前版本见
//   .workbuddy/archive/js-before-code-tidy-20261015/）
TOWERS.typeName = function (elem) { var t = TOWERS.TYPES[elem]; return t ? t.name : elem; };

TOWERS.CFG = {
  COST: 10             // 抽塔价格（大王定案 10 金币/次）
};

// 四塔型固定顺序（随机抽取 / 渲染色板都按这个序，保证稳定）
//   ⚠️ 名称保留 `ELEMS` 是**兼容别名**（大量旧引用读它），语义已是"塔型"。
//   ▍v1.8j：顺序改为大王列举序 机枪→火炮→冰环→闪电。
TOWERS.ELEMS = ['arrow', 'cannon', 'ice', 'magic'];

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
//   提升对应车厢），**不再索敌开火**。旧塔攻击循环 `__towerAtk_retired` 已随
//   2026-10-18 死代码清理移除（原文见
//   .workbuddy/archive/retired-code-20261018/removed-code.md）；TOWERS.update
//   现在只维护连线衰减与闪光衰减。
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

// 怪被杀（foes.js 调）：hp<=0 的怪由 foes 自己移除，塔这边不用管。

// ---- 重开清场（ENG.init / 失败重开时调）--------------------------------------
TOWERS.reset = function () {
  GS.towers = [];
  TOWERS.beams = [];
};
