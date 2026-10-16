// ============================================================================
// 塔型 / 词条 / 军工厂 回归（v1.6.34/35 新建）
//
//   ▍覆盖：
//     [T1] TOWERS.TYPES 四塔型数值（方案 A：等 DPS 包络，2026-10-13 大王拍板）
//     [T2] AFFIXES 20 条（每塔型 5 条，name/desc/land 齐全）
//     [T3] 附着 API：每塔上限 1 条 / 塔型匹配 / 只能装塔上
//     [T4] 车厢战斗按塔型取伤害/间隔/特效（arrow 基准 · cannon AOE · magic 中毒 · ice 减速）
//     [T5] 词条钩子（确定性条目：散射/易伤/地雷/烈焰/霜痕/击退/磁拉）
//     [T6] 军工厂加成（1 座 20%、相邻 50%、远离 40%）+ 战斗乘区
//     [T7] 经验系统（need 10/20/30 · add · consume）
//     [T8] 词条三选一发牌（3 张互异、已装的不出现）
//   ▍沙箱：state 之后的逻辑模块全载（无 DOM / 无 CLOCK / 无 RND）。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname);
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? '  <' + extra + '>' : '')); console.log('  ✗ ' + name + (extra ? '  <' + extra + '>' : '')); }
}

const sandbox = { console, Math, Array, Object, JSON, Date, parseInt, parseFloat,
                  isNaN, String, Number, Boolean, RegExp, Error };
sandbox.window = sandbox;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js', 'js/resources.js', 'js/cards.js',
                 'js/station.js', 'js/towers.js', 'js/affixes.js', 'js/exp.js',
                 'js/foes.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS, TOWERS = sandbox.TOWERS,
      AFFIXES = sandbox.AFFIXES, EXP = sandbox.EXP, ENG = sandbox.ENG,
      FOES = sandbox.FOES, TRANS = sandbox.TRANS;
GS.debugNoDeadline = true;
GS.newGame();

// 造一只放在指定坐标的怪（字段齐，能吃满战斗/词条链）
function mkFoe(c, r, hp) {
  return { c: c, r: r, hp: hp || 100, maxHp: hp || 100, speed: 0.2, cd: 0,
           slow: 0, burn: 0, poison: 0, slowHard: 0, freeze: 0, mine: 0, zoneSlow: 0,
           vuln: 0, vulnPct: 0, vulnT: 0, lock: null, lockT: 0, bumpCd: 0, hitFlash: 0 };
}
function wagonPos0() { return ENG.wagonPos(0); }
function fireOnce() { ENG.wagonCombat(0.0001); }   // 一帧推进（wcd 从 0 起打一发）

// 开局盘面里"真空地"只有内区 2 格（12 格环 + 镇中心占掉 3×5）——词条/战斗用例要更多
// 空地放塔，这里把废墟清成空地凑数（跳过轨格与建筑；不动资源标记以外的语义）。
function ensureFree(n) {
  let made = 0;
  for (let r = 0; r < CFG.MAP_ROWS && made < n; r++) {
    for (let c = 0; c < CFG.MAP_COLS && made < n; c++) {
      if (GS.isFreeSpot(c, r)) continue;
      const g = GS.grid[r][c];
      if (g.b || GS.onRail(c, r)) continue;
      g.t = 'blank'; g.gold = false; g.heart = false;
      made++;
    }
  }
}

// ============================================================================
// [T1] 四塔型数值（方案 A）
// ============================================================================
{
  const T = TOWERS.TYPES;
  check('[T1] 四塔型齐：arrow/cannon/magic/ice',
    TOWERS.ELEMS.length === 4 && T.arrow && T.cannon && T.magic && T.ice);
  check('[T1] 方案 A：箭=基准（×1.0 / 1.2s / 4.5 格 / 单体 / 无特效）',
    T.arrow.dmgMul === 1.0 && T.arrow.interval === 1.2 && T.arrow.range === 4.5 &&
    T.arrow.targets === 1 && T.arrow.effect === 'none');
  check('[T1] 方案 A：炮=AOE（×2.5 / 3.0s / 6.3 格 / aoe / 灼烧）',
    T.cannon.dmgMul === 2.5 && T.cannon.interval === 3.0 && T.cannon.range === 6.3 &&
    T.cannon.targets === 'aoe' && T.cannon.effect === 'burn');
  check('[T1] 方案 A：魔法（×2.0 / 2.4s / 5.4 格 / 单体 / 中毒）',
    T.magic.dmgMul === 2.0 && T.magic.interval === 2.4 && T.magic.range === 5.4 &&
    T.magic.effect === 'poison');
  check('[T1] 方案 A：寒冰（×0.8 / 1.0s / 3.6 格 / 单体 / 减速）',
    T.ice.dmgMul === 0.8 && T.ice.interval === 1.0 && T.ice.range === 3.6 &&
    T.ice.effect === 'slow');
  check('[T1] DPS 包络：四型 伤害×攻速 全部 ≈0.833（±0.05）',
    [T.arrow, T.cannon, T.magic, T.ice].every(t =>
      Math.abs(t.dmgMul / t.interval - 0.833) < 0.05));
}

// ============================================================================
// [T2] 20 条词条数据
// ============================================================================
{
  check('[T2] 词条共 20 条', AFFIXES.IDS.length === 20, '实际 ' + AFFIXES.IDS.length);
  check('[T2] 每塔型 5 条', TOWERS.ELEMS.every(tp => AFFIXES.BY_TOWER(tp).length === 5));
  check('[T2] 每条都有 name/desc/land（等价落地文案）',
    AFFIXES.IDS.every(id => {
      const d = AFFIXES.DATA[id];
      return d && d.name && d.desc && d.land && d.tower;
    }));
  check('[T2] 新机制三条在列：a4 影锁 / c1 布雷 / i3 霜痕',
    AFFIXES.DATA.a4 && AFFIXES.DATA.c1 && AFFIXES.DATA.i3);
  check('[T2] v1.6.36 全局 API 在位：hasAffix(id) / gainAffix / affixCountOf / drawAffixOffer',
    typeof GS.hasAffix === 'function' && typeof GS.gainAffix === 'function' &&
    typeof GS.affixCountOf === 'function' && typeof GS.drawAffixOffer === 'function');
}

// ============================================================================
// [T3] 全局生效 API（v1.6.36 大王令：词条不需要装备，选中即对全场对应塔型生效）
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  const twA1 = TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const twA2 = TOWERS.placeAt(free[1].c, free[1].r, 'arrow', 1);
  const twM = TOWERS.placeAt(free[2].c, free[2].r, 'magic', 1);
  twA1.flash = 0; twA2.flash = 0; twM.flash = 0;

  check('[T3] 初始：未获得任何词条', !GS.hasAffix('a1') && !GS.playerAffixes.a1);
  check('[T3] gainAffix：选中即获得（全局，不落塔）',
    GS.gainAffix('a1') === true && GS.hasAffix('a1') && !twA1.affix);
  check('[T3] 重复获得被拒（三选一不会再发，双保险）', GS.gainAffix('a1') === false);
  check('[T3] 生效反馈：全场**同型**塔闪光、异型不闪',
    twA1.flash > 0 && twA2.flash > 0 && twM.flash === 0,
    twA1.flash + '/' + twA2.flash + '/' + twM.flash);
  check('[T3] affixCountOf：arrow 型已得 1、magic 0',
    GS.affixCountOf('arrow') === 1 && GS.affixCountOf('magic') === 0);
  check('[T3] 同塔型多词条并存：再获得 a3 ⇒ arrow 计数 2',
    (GS.playerAffixes.a3 = 1) && GS.affixCountOf('arrow') === 2);
}

// ============================================================================
// [T4] 车厢战斗按塔型取数值
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  const pos = wagonPos0();

  // arrow：基准伤害 12×star（v1.6.79 固定基数，§14.55），无特效
  const twA = TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const fA = mkFoe(pos.c, pos.r);
  GS.foes = [fA];
  fireOnce();
  check('[T4] 箭塔 1 星 = 基准一发 12（固定基数）、无特效',
    Math.abs(fA.hp - 88) < 1e-6 && !fA.slow && !fA.burn && !fA.poison, 'hp=' + fA.hp);

  // ice：×0.8 = 9.6，且挂减速
  const twI = TOWERS.placeAt(free[1].c, free[1].r, 'ice', 1);
  const fI = mkFoe(pos.c, pos.r);
  GS.foes = [fI];
  fireOnce();
  check('[T4] 寒冰 1 星 = 9.6/发 且挂减速 1.5s',
    Math.abs(fI.hp - 90.4) < 1e-6 && Math.abs(fI.slow - 1.5) < 1e-6, 'hp=' + fI.hp + ' slow=' + fI.slow);

  // magic：×2.0 = 24，且挂中毒
  const twM = TOWERS.placeAt(free[2].c, free[2].r, 'magic', 1);
  const fM = mkFoe(pos.c, pos.r);
  GS.foes = [fM];
  fireOnce();
  check('[T4] 魔法 1 星 = 24/发 且挂中毒 4s',
    Math.abs(fM.hp - 76) < 1e-6 && Math.abs(fM.poison - 4) < 1e-6, 'hp=' + fM.hp);

  // cannon：×2.5 = 30，AOE 3×3 两只都掉血
  TOWERS.placeAt(free[3].c, free[3].r, 'cannon', 1);
  const fC1 = mkFoe(pos.c, pos.r), fC2 = mkFoe(pos.c + 0.5, pos.r);
  GS.foes = [fC1, fC2];
  fireOnce();
  check('[T4] 炮塔 1 星 = 30/发 且 3×3 AOE 两只同掉',
    Math.abs(fC1.hp - 70) < 1e-6 && Math.abs(fC2.hp - 70) < 1e-6, fC1.hp + '/' + fC2.hp);
}

// ============================================================================
// [T5] 词条钩子（确定性条目；v1.6.36 全局化 = 直接设 GS.playerAffixes）
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  const pos = wagonPos0();

  // a3 撕裂标记：命中叠易伤（全局获得 ⇒ 所有箭塔车厢都带）
  GS.playerAffixes = { a3: 1 };
  TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const f3 = mkFoe(pos.c, pos.r);
  GS.foes = [f3];
  fireOnce();
  check('[T5] a3 撕裂标记：命中叠 1 层易伤（+15%）',
    f3.vuln === 1 && f3.vulnPct === 0.15, 'vuln=' + f3.vuln);

  // a1 散射箭 + a3 并存（v1.6.36：同塔型多词条同时生效）：主 100% + 另 2 只 60%，
  //   且三只都被叠易伤（a1 的散射目标也算"命中"）
  GS.playerAffixes = { a1: 1, a3: 1 };
  const tw = TOWERS.placeAt(free[1].c, free[1].r, 'arrow', 1);
  tw.wcd = 0;
  const m1 = mkFoe(pos.c, pos.r), m2 = mkFoe(pos.c + 0.3, pos.r), m3 = mkFoe(pos.c + 0.6, pos.r);
  GS.foes = [m1, m2, m3];
  fireOnce();
  const hpSorted = [m1.hp, m2.hp, m3.hp].sort(function (p, q) { return p - q; });
  check('[T5] a1 散射箭：三只同帧掉血（100%/60%/60%）',
    Math.abs(hpSorted[0] - 88) < 1e-6 && Math.abs(hpSorted[1] - 92.8) < 1e-6 &&
    Math.abs(hpSorted[2] - 92.8) < 1e-6, hpSorted.join('/'));
  check('[T5] 多词条并存：a1+a3 同持 ⇒ 三只全部叠上易伤',
    m1.vuln === 1 && m2.vuln === 1 && m3.vuln === 1,
    m1.vuln + '/' + m2.vuln + '/' + m3.vuln);

  // c1 布雷 / c4 烈焰 / i3 霜痕：命中后地面物出现
  GS.playerAffixes = { c1: 1 };
  const twC = TOWERS.placeAt(free[2].c, free[2].r, 'cannon', 1);
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5] c1 哑弹布雷：爆炸后留 1 颗雷', GS.mines.length === 1, 'mines=' + GS.mines.length);
  GS.playerAffixes = { c4: 1 };
  twC.wcd = 0;
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5] c4 烈焰燃油：爆炸区留灼烧地带', GS.fireZones.length === 1);
  GS.playerAffixes = { i3: 1 };
  const twI2 = TOWERS.placeAt(free[3].c, free[3].r, 'ice', 1);
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5] i3 霜痕路径：受击格留减速地面', GS.frostZones.length === 1);

  // c2 冲击震退 / m4 极化磁场：怪被挪动
  GS.playerAffixes = { c2: 1 };
  const twK = TOWERS.placeAt(free[4].c, free[4].r, 'cannon', 1);
  twK.wcd = 0;
  const fk = mkFoe(pos.c, pos.r);
  GS.foes = [fk];
  fireOnce();
  check('[T5] c2 冲击震退：怪被推离原位', Math.abs(fk.c - pos.c) + Math.abs(fk.r - pos.r) > 0.2);
  GS.playerAffixes = { m4: 1 };
  const twP = TOWERS.placeAt(free[5].c, free[5].r, 'magic', 1);
  const fp = mkFoe(pos.c, pos.r);
  GS.foes = [fp];
  fireOnce();
  check('[T5] m4 极化磁场：怪被拉向镇中心',
    Math.abs(fp.c - GS.core.c) + Math.abs(fp.r - GS.core.r) <
    Math.abs(pos.c - GS.core.c) + Math.abs(pos.r - GS.core.r) || fp.c !== pos.c);
}

// ============================================================================
// [T5a] v1.6.78 A 案：词条按塔型过滤（规格 §14.54）—— 跨塔不吃，同塔吃到
//   背景：v1.6.36 全局化后 hasAffix 是纯全局查询，箭塔车厢白吃 c1 布雷等
//   炮系词条（超标投放）；v1.6.78 大王拍板 A 案收口到 ENG.affixOf(t, id)。
// ============================================================================
{
  ENG.restart();
  ensureFree(3);
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  const pos = wagonPos0();
  GS.playerAffixes = { c1: 1 };                       // c1 哑弹布雷（cannon 系）
  const twAr = TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const twCa = TOWERS.placeAt(free[1].c, free[1].r, 'cannon', 1);

  // affixOf 单测：hasAffix 为真之外，还要求词条 tower === t.elem
  check('[T5a] affixOf：c1(炮系) 对 arrow 塔 false / 对 cannon 塔 true',
    ENG.affixOf(twAr, 'c1') === false && ENG.affixOf(twCa, 'c1') === true);
  check('[T5a] affixOf：未获得的词条恒 false（先 hasAffix 后塔型过滤）',
    ENG.affixOf(twCa, 'm1') === false);

  // 战斗链验证 ①：箭塔车厢开火不布雷（跨塔被过滤）。twCa 压在冷却里防同帧开火污染。
  GS.mines.length = 0;
  twCa.wcd = 1; twAr.wcd = 0;
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5a] c1 在箭塔车厢不生效：开火后零布雷', GS.mines.length === 0,
    'mines=' + GS.mines.length);

  // 战斗链验证 ②（正向对照）：cannon 车厢同词条照常布雷
  twAr.wcd = 1; twCa.wcd = 0;
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5a] c1 在炮塔车厢照常生效：开火后留 1 颗雷', GS.mines.length === 1,
    'mines=' + GS.mines.length);
  GS.playerAffixes = {};
}

// ============================================================================
// [T6] 军工厂加成
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  check('[T6] 无厂 = 0%', GS.wagonAtkBonus() === 0);
  GS.buildings.push({ type: 'factory', c: 1, r: 1, flash: 0 });
  check('[T6] 1 座 = +20%', Math.abs(GS.wagonAtkBonus() - 0.20) < 1e-9);
  GS.buildings.push({ type: 'factory', c: 2, r: 1, flash: 0 });   // 相邻（曼哈顿 1）
  check('[T6] 两座相邻 = 50%（各 20% + 相邻 10%）', Math.abs(GS.wagonAtkBonus() - 0.50) < 1e-9,
    'bonus=' + GS.wagonAtkBonus());
  GS.buildings = GS.buildings.filter(b => b.type !== 'factory');
  GS.buildings.push({ type: 'factory', c: 1, r: 1, flash: 0 });
  GS.buildings.push({ type: 'factory', c: 7, r: 9, flash: 0 });   // 远离
  check('[T6] 两座远离 = 40%（无相邻加成）', Math.abs(GS.wagonAtkBonus() - 0.40) < 1e-9);
  check('[T6] factoryShare（生效反馈）：远离厂标 +20%、相邻厂标 +30%',
    Math.abs(GS.factoryShare({ type: 'factory', c: 1, r: 1 }) - 0.20) < 1e-9 &&
    Math.abs(GS.factoryShare({ type: 'factory', c: 2, r: 1 }) - 0.30) < 1e-9,
    'far=' + GS.factoryShare({ type: 'factory', c: 1, r: 1 }) +
    ' adj=' + GS.factoryShare({ type: 'factory', c: 2, r: 1 }));

  // 战斗乘区：只留 1 座厂 ⇒ 箭塔一发 12 × 1.2 = 14.4
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  GS.buildings = [GS.core, { type: 'factory', c: 1, r: 1, flash: 0 }];
  TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const pos = wagonPos0();
  const fW = mkFoe(pos.c, pos.r);
  GS.foes = [fW];
  fireOnce();
  check('[T6] 战斗乘区：1 座军工厂 ⇒ 箭塔 12 → 14.4', Math.abs(fW.hp - 85.6) < 1e-6, 'hp=' + fW.hp);
}

// ============================================================================
// [T7] 经验系统
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  check('[T7] 初始：exp 0 / need 10 / 无待发牌',
    GS.exp === 0 && EXP.need() === 10 && !GS.expPending);
  EXP.add(9);
  check('[T7] 9 杀不满（阈值 10）', GS.exp === 9 && !GS.expPending);
  EXP.add(1);
  check('[T7] 10 杀 → 待发牌 1、已得 1、阈值升 20',
    GS.expPending === 1 && GS.expTaken === 1 && EXP.need() === 20);
  EXP.add(20);
  check('[T7] 再攒 20 → 待发牌 2、阈值升 30',
    GS.expPending === 2 && GS.expTaken === 2 && EXP.need() === 30);
  check('[T7] consume 取走一次', EXP.consume() === true && GS.expPending === 1);
  check('[T7] progress 口径', EXP.progress().need === 30);
}

// ============================================================================
// [T8] 词条三选一发牌（v1.6.36：**无视场上已有建筑**纯随机，只排除已获得的）
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  // 空场（一座塔都没有）也必须发满 3 张 ⇒ 证明"无视场上已有建筑"
  for (let round = 0; round < 20; round++) {
    GS.playerAffixes = {};
    GS.towers.length = 0;
    const cards = GS.drawAffixOffer();
    const aids = cards.map(c => c.aid);
    if (cards.length !== 3) { check('[T8] 发 3 张', false, 'n=' + cards.length); break; }
    if (new Set(aids).size !== 3) { check('[T8] 三张互异', false, aids.join(',')); break; }
    if (!cards.every(c => c.kind === 'affix')) { check('[T8] 全是词条卡', false); break; }
    if (round === 19) check('[T8] 20 轮发牌全合法（3 张 / 互异 / 全词条；**空场照发** = 无视场上建筑）', true);
  }
  // 已获得的不再出现（拿满 arrow 全 5 条 ⇒ 发牌里再无 a*）
  GS.playerAffixes = { a1: 1, a2: 1, a3: 1, a4: 1, a5: 1 };
  let noA = true;
  for (let round = 0; round < 20; round++) {
    if (GS.drawAffixOffer().some(c => c.aid.charAt(0) === 'a')) { noA = false; break; }
  }
  check('[T8] 已获得的词条不再出现（arrow 全拿 ⇒ 20 轮无 a*）', noA);
  check('[T8] pickAffixCard 结构', GS.pickAffixCard('m3').kind === 'affix' &&
    GS.pickAffixCard('m3').aid === 'm3');
}

console.log('\n' + '='.repeat(64));
console.log('塔型/词条/军工厂：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
if (fail) { console.log(failures.join('\n')); process.exit(1); }
