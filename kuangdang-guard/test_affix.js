// ============================================================================
// 塔型 / 词条 / 辅助建筑 回归（v1.6.34/35 新建；v1.8u 十三令 [T6] 改猛攻坊/疾速坊）
//
//   ▍覆盖：
//     [T1] TOWERS.TYPES 四塔型数值（v1.8j 车厢改版 + v1.8k/l 微调：预期 DPS 口径）
//     [T2] AFFIXES 20 条（每塔型 5 条，name/desc/land 齐全）
//     [T3] 附着 API：每塔上限 1 条 / 塔型匹配 / 只能装塔上
//     [T4] 车厢战斗按塔型取伤害/间隔/特效（v1.8j：机枪基准 · 火炮溅射 · 闪电单体 · 冰环环绕）
//     [T5] 词条钩子（确定性条目：散射/易伤/地雷/烈焰/霜痕/击退/磁拉）
//     [T6] 辅助建筑加成（v1.8u 十三令：猛攻坊左右 +100%/座、疾速坊上下 +100%/座）+ 战斗乘区
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
           vulnA: 0, vulnAT: 0, vulnM: 0, lock: null, lockT: 0, bumpCd: 0, hitFlash: 0 };
}
function wagonPos0() { return ENG.wagonPos(0); }
function fireOnce() {   // 一帧推进（wcd 从 0 起打一发）+ 弹丸飞完（v1.8n 弹丸化）
  ENG.wagonCombat(0.0001);
  for (var i = 0; i < 600 && GS.bullets.length; i++) ENG.bulletUpdate(0.016);
}

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
// [T1] 四塔型数值（v1.8j 车厢改版 + v1.8k/l 微调：预期 DPS 口径）
// ============================================================================
{
  const T = TOWERS.TYPES;
  check('[T1] 四塔型齐：arrow/cannon/magic/ice',
    TOWERS.ELEMS.length === 4 && T.arrow && T.cannon && T.magic && T.ice);
  check('[T1] 机枪（4/发=1/3 基数 / 0.4s / 4.5 格 / 单体 / 无特效）',
    Math.abs(T.arrow.dmgMul - 1 / 3) < 1e-9 && T.arrow.interval === 0.4 &&
    T.arrow.range === 4.5 &&
    T.arrow.targets === 1 && T.arrow.effect === 'none' && T.arrow.dmgType === 'phys');
  check('[T1] 火炮（15/发=×1.25 基数 / 3.0s / 4.5 格 / 溅射 1.3 / 无特效）',
    T.cannon.dmgMul === 1.25 && T.cannon.interval === 3.0 && T.cannon.range === 4.5 &&
    T.cannon.targets === 'aoe' && T.cannon.splash === 1.3 && T.cannon.effect === 'none');
  check('[T1] 闪电（×2.0 / 2.4s / 4.5 格 / 单体 / 无特效）',
    T.magic.dmgMul === 2.0 && T.magic.interval === 2.4 && T.magic.range === 4.5 &&
    T.magic.targets === 1 && T.magic.effect === 'none' && T.magic.dmgType === 'magic');
  check('[T1] 冰环（6.4/发=8/15 基数 / 2.0s / 2.2 格 / 环绕 AOE / 减速）',
    Math.abs(T.ice.dmgMul - 8 / 15) < 1e-9 && T.ice.interval === 2.0 && T.ice.range === 2.2 &&
    T.ice.targets === 'ring' && T.ice.effect === 'slow');
  check('[T1] 预期 DPS（v1.8l，E[N]：火炮 2 / 冰环 2.5 / 单体 1）：机枪 10 · 火炮 10 · 冰环 8 · 闪电 10',
    Math.abs(T.arrow.dmgMul / T.arrow.interval * 12 - 10) < 0.01 &&
    Math.abs(T.cannon.dmgMul / T.cannon.interval * 12 * 2 - 10) < 0.01 &&
    Math.abs(T.ice.dmgMul / T.ice.interval * 12 * 2.5 - 8) < 0.01 &&
    Math.abs(T.magic.dmgMul / T.magic.interval * 12 - 10) < 0.01);
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

  // arrow（机枪）：1/3×基数 = 4/发（v1.8k 小步快刀），无特效
  const twA = TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const fA = mkFoe(pos.c, pos.r);
  GS.foes = [fA];
  fireOnce();
  check('[T4] 机枪 1 星 = 1/3×基数 4/发、无特效',
    Math.abs(fA.hp - 96) < 1e-6 && !fA.slow && !fA.burn && !fA.poison, 'hp=' + fA.hp);

  // ice（冰环）：8/15×基数 = 6.4，环绕自身 AOE 全体命中，且挂减速（v1.8l 预期 DPS=8）
  const twI = TOWERS.placeAt(free[1].c, free[1].r, 'ice', 1);
  const fI = mkFoe(pos.c, pos.r);
  GS.foes = [fI];
  fireOnce();
  check('[T4] 冰环 1 星 = 6.4/发 且挂减速 1.5s',
    Math.abs(fI.hp - 93.6) < 1e-6 && Math.abs(fI.slow - 1.5) < 1e-6, 'hp=' + fI.hp + ' slow=' + fI.slow);

  // magic（闪电）：×2.0 = 24，纯单体魔法（v1.8j 去中毒）
  const twM = TOWERS.placeAt(free[2].c, free[2].r, 'magic', 1);
  const fM = mkFoe(pos.c, pos.r);
  GS.foes = [fM];
  fireOnce();
  check('[T4] 闪电 1 星 = 24/发、无特效（中毒已移除）',
    Math.abs(fM.hp - 76) < 1e-6 && !fM.poison, 'hp=' + fM.hp + ' poison=' + fM.poison);

  // cannon（火炮）：×1.25 = 15，命中点溅射半径 1.3 圆内两只都掉血（v1.8l 预期 DPS=10）
  TOWERS.placeAt(free[3].c, free[3].r, 'cannon', 1);
  const fC1 = mkFoe(pos.c, pos.r), fC2 = mkFoe(pos.c + 0.5, pos.r);
  GS.foes = [fC1, fC2];
  fireOnce();
  check('[T4] 火炮 1 星 = 15/发 且溅射圈(半径1.3)两只同掉、无灼烧',
    Math.abs(fC1.hp - 85) < 1e-6 && Math.abs(fC2.hp - 85) < 1e-6 && !fC1.burn,
    fC1.hp + '/' + fC2.hp);
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

  // a3 撕裂标记：命中叠易伤（全局获得 ⇒ 所有机枪车厢都带）
  GS.playerAffixes = { a3: 1 };
  TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const f3 = mkFoe(pos.c, pos.r);
  GS.foes = [f3];
  fireOnce();
  check('[T5] a3 撕裂标记：命中叠 1 层易伤（+20%，vulnA 槽）',
    f3.vulnA === 1 && f3.vulnAT === 3, 'vulnA=' + f3.vulnA);

  // a1 散射箭 + a3 并存（v1.6.36：同塔型多词条同时生效）：主 100% + 另 2 只 30%，
  //   且三只都被叠易伤（a1 的散射目标也算"命中"）
  GS.playerAffixes = { a1: 1, a3: 1 };
  const tw = TOWERS.placeAt(free[1].c, free[1].r, 'arrow', 1);
  tw.wcd = 0;
  const m1 = mkFoe(pos.c, pos.r), m2 = mkFoe(pos.c + 0.3, pos.r), m3 = mkFoe(pos.c + 0.6, pos.r);
  GS.foes = [m1, m2, m3];
  fireOnce();
  const hpSorted = [m1.hp, m2.hp, m3.hp].sort(function (p, q) { return p - q; });
  check('[T5] a1 散射箭：三只同帧掉血（100%/30%/30%）',
    Math.abs(hpSorted[0] - 96) < 1e-6 && Math.abs(hpSorted[1] - 98.8) < 1e-6 &&
    Math.abs(hpSorted[2] - 98.8) < 1e-6, hpSorted.join('/'));
  check('[T5] 多词条并存：a1+a3 同持 ⇒ 三只全部叠上易伤',
    m1.vulnA === 1 && m2.vulnA === 1 && m3.vulnA === 1,
    m1.vulnA + '/' + m2.vulnA + '/' + m3.vulnA);

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
  // v1.8j 冰环 = 以**车厢自身**为圆心的环绕 AOE：怪要放在本节车厢（最后一节）的位置上，
  //   放 wagonPos(0) 距冰环车厢约 5 格弧长，超出 2.2 射程就不挨打了。
  const wpI = ENG.wagonPos(GS.towers.length - 1);
  GS.foes = [mkFoe(wpI.c, wpI.r)];
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
  // m4 极化磁场（v1.8o 改口径：拉向最近的其他怪，纯聚怪）——摆两只怪，
  //   被击的那只向另一只靠 1 格：两者间距 2.0 → 1.0（谁被击都一样，断言对称）。
  GS.playerAffixes = { m4: 1 };
  const twP = TOWERS.placeAt(free[5].c, free[5].r, 'magic', 1);
  const fp = mkFoe(pos.c, pos.r), fq = mkFoe(pos.c + 2, pos.r);
  GS.foes = [fp, fq];
  fireOnce();
  const dPull = Math.hypot(fp.c - fq.c, fp.r - fq.r);
  check('[T5] m4 极化磁场：被击怪拉向最近的其他怪（间距 2→1，纯聚怪）',
    Math.abs(dPull - 1) < 0.05, 'd=' + dPull.toFixed(3));
}

// ============================================================================
// [T5b] v1.8o：a3 × m2 拆独立易伤槽（规格 §14.76）——并存时各叠各的层、
//   各自封顶互不压制。v1.8q 严格收口（§14.78）：消费只认对应车厢——vulnA 只对
//   机枪来源伤害生效、vulnM 只对闪电来源伤害生效，其他车厢/车头不吃。
//   直接驱动 affixOnHit/applyHits（不经索敌，避免落点/目标选择的不确定性）。
// ============================================================================
{
  ENG.restart();
  GS.playerAffixes = { a3: 1, m2: 1 };
  const tA = { elem: 'arrow', star: 1 }, tM = { elem: 'magic', star: 1 };
  const TA = TOWERS.TYPES.arrow, TM = TOWERS.TYPES.magic;
  const fX = mkFoe(5, 5);
  GS.foes = [fX];
  ENG.affixOnHit(tA, fX, 4, 4, TA, 1);    // a3 → vulnA
  ENG.affixOnHit(tM, fX, 24, 24, TM, 1);  // m2 → vulnM
  check('[T5b] a3+m2 并存：vulnA / vulnM 各叠 1 层互不干扰',
    fX.vulnA === 1 && fX.vulnM === 1, 'A=' + fX.vulnA + ' M=' + fX.vulnM);
  for (let k = 0; k < 4; k++) ENG.affixOnHit(tA, fX, 4, 4, TA, 1);    // a3 顶到 3 层
  for (let k = 0; k < 3; k++) ENG.affixOnHit(tM, fX, 24, 24, TM, 1);  // m2 顶到 2 层（v1.8r）
  check('[T5b] 各自封顶互不压制：vulnA=3 / vulnM=2（旧版共槽会互踩）',
    fX.vulnA === 3 && fX.vulnM === 2, 'A=' + fX.vulnA + ' M=' + fX.vulnM);
  const hp0 = fX.hp;
  ENG.applyHits(tA, TA, [{ f: fX, mul: 1 }], 10, 1);
  check('[T5b] 严格收口：机枪打吃满 vulnA（10 → 16），不吃 vulnM',
    Math.abs((hp0 - fX.hp) - 16) < 1e-9, 'hd=' + (hp0 - fX.hp).toFixed(4));
  const hp1 = fX.hp;
  ENG.applyHits(tM, TM, [{ f: fX, mul: 1 }], 10, 1);
  check('[T5b] 严格收口：闪电打吃满 vulnM（10 → 16），不吃 vulnA',
    Math.abs((hp1 - fX.hp) - 16) < 1e-9, 'hd=' + (hp1 - fX.hp).toFixed(4));
  const hp2 = fX.hp;
  ENG.applyHits({ elem: 'ice', star: 1 }, TOWERS.TYPES.ice, [{ f: fX, mul: 1 }], 10, 1);
  check('[T5b] 严格收口：其他车厢不吃任何易伤（10 → 10）',
    Math.abs((hp2 - fX.hp) - 10) < 1e-9, 'hd=' + (hp2 - fX.hp).toFixed(4));
}

// ============================================================================
// [T5c] v1.8p：m3 能量溢出改动态——溢出 = 0.5 × 过量伤（击杀这一击打穿的富余量，
//   击穿帧 _snapOverkill 快照；规格 §14.77）。大王例：伤害 100、剩余血 20 → 溢出 40。
// ============================================================================
{
  ENG.restart();
  GS.playerAffixes = { m3: 1 };
  const tM3 = { elem: 'magic', star: 1 };
  const fK = mkFoe(5, 5, 30);    // 待宰怪：hp30
  const fN = mkFoe(6, 5, 100);   // 邻居（3×3 内，距离 1）
  const fF = mkFoe(8, 5, 100);   // 远邻（3×3 外，距离 3）
  GS.foes = [fK, fN, fF];
  ENG.applyHits(tM3, TOWERS.TYPES.magic, [{ f: fK, mul: 1 }], 100, 1);
  check('[T5c] 击穿快照：hp30 吃 100 伤 → hp=-70、过量=70',
    fK.hp === -70 && fK.overkill === 70, 'hp=' + fK.hp + ' ok=' + fK.overkill);
  ENG.onFoeDeath(fK, 1);         // 清尸钩子：3×3 内 fN 吃 0.5×70=35，fF 不吃
  check('[T5c] 溢出 = 0.5×过量：邻居 100→65，3×3 外不动',
    fN.hp === 65 && fF.hp === 100, 'fN=' + fN.hp + ' fF=' + fF.hp);
  ENG.applyHits(tM3, TOWERS.TYPES.magic, [{ f: fK, mul: 1 }], 50, 1);
  check('[T5c] 补刀不刷新快照：过量仍 70（防把补刀全额算成过量）',
    fK.overkill === 70, 'ok=' + fK.overkill);
  const fD = mkFoe(5, 5, 30);    // 无击穿快照的怪（DoT/旁路杀场景：overkill=0）
  GS.foes = [fD, fN];
  ENG.onFoeDeath(fD, 1);
  check('[T5c] 无击穿快照（DoT/旁路杀）→ 不爆', fN.hp === 65, 'fN=' + fN.hp);
  // v1.8q 严格收口：只有闪电车厢来源的击穿才爆——机枪/车头击穿不爆
  const fA = mkFoe(5, 5, 30), fB = mkFoe(6, 5, 100);
  GS.foes = [fA, fB];
  ENG.applyHits({ elem: 'arrow', star: 1 }, TOWERS.TYPES.arrow, [{ f: fA, mul: 1 }], 100, 1);
  check('[T5c] 来源快照：机枪击穿 → overkill=70 / src=arrow',
    fA.overkill === 70 && fA.overkillSrc === 'arrow', 'src=' + fA.overkillSrc);
  ENG.onFoeDeath(fA, 1);
  check('[T5c] 严格收口：机枪来源击穿不爆溢出', fB.hp === 100, 'fB=' + fB.hp);
  fB.overkill = 70; fB.overkillSrc = 'train';
  GS.foes = [fB, fN];
  ENG.onFoeDeath(fB, 1);
  check('[T5c] 严格收口：车头来源击穿不爆溢出', fN.hp === 65, 'fN=' + fN.hp);
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

  // 战斗链验证 ①：机枪车厢开火不布雷（跨塔被过滤）。twCa 压在冷却里防同帧开火污染。
  GS.mines.length = 0;
  twCa.wcd = 1; twAr.wcd = 0;
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5a] c1 在机枪车厢不生效：开火后零布雷', GS.mines.length === 0,
    'mines=' + GS.mines.length);

  // 战斗链验证 ②（正向对照）：火炮车厢同词条照常布雷
  twAr.wcd = 1; twCa.wcd = 0;
  GS.foes = [mkFoe(pos.c, pos.r)];
  fireOnce();
  check('[T5a] c1 在火炮车厢照常生效：开火后留 1 颗雷', GS.mines.length === 1,
    'mines=' + GS.mines.length);
  GS.playerAffixes = {};
}

// ============================================================================
// [T6] 辅助建筑加成（v1.8u 十三令 §14.84：猛攻坊左右攻击 / 疾速坊上下攻速，
//   原军工厂全局乘区退役）
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  check('[T6] 无坊 = 攻 0% / 速 0%', GS.atkBoostAt(3, 5) === 0 && GS.aspBoostAt(3, 5) === 0);
  // —— 猛攻坊：同行左右邻格（b.r===r && |b.c−c|===1）——
  GS.buildings.push({ type: 'atk', c: 2, r: 5, flash: 0 });
  check('[T6] 猛攻坊左邻 1 座 = +100%', Math.abs(GS.atkBoostAt(3, 5) - 1.0) < 1e-9,
    'atk=' + GS.atkBoostAt(3, 5));
  GS.buildings.push({ type: 'atk', c: 4, r: 5, flash: 0 });
  check('[T6] 左右各 1 座 = +200%（求和非连乘）', Math.abs(GS.atkBoostAt(3, 5) - 2.0) < 1e-9,
    'atk=' + GS.atkBoostAt(3, 5));
  check('[T6] 猛攻坊斜角/隔格不算（斜角(3,6)=0、隔两格(0,5)=0）',
    GS.atkBoostAt(3, 6) === 0 && GS.atkBoostAt(0, 5) === 0);
  GS.buildings = GS.buildings.filter(b => b.type !== 'atk');
  // —— 疾速坊：同列上下邻格（b.c===c && |b.r−r|===1）——
  GS.buildings.push({ type: 'asp', c: 3, r: 4, flash: 0 });
  check('[T6] 疾速坊上邻 1 座 = +100%', Math.abs(GS.aspBoostAt(3, 5) - 1.0) < 1e-9,
    'asp=' + GS.aspBoostAt(3, 5));
  GS.buildings.push({ type: 'asp', c: 3, r: 6, flash: 0 });
  check('[T6] 上下各 1 座 = +200%（求和非连乘）', Math.abs(GS.aspBoostAt(3, 5) - 2.0) < 1e-9,
    'asp=' + GS.aspBoostAt(3, 5));
  check('[T6] 疾速坊同行不算（(4,5) = 0）', GS.aspBoostAt(4, 5) === 0);
  GS.buildings = GS.buildings.filter(b => b.type !== 'asp');

  // 战斗乘区：坊贴**车厢固定格**（t.c/t.r，非行驶投影）——猛攻坊 ⇒ 伤害 ×2、
  //   疾速坊 ⇒ 间隔 ÷2（+100% 攻速；三座即 ÷4 = −75%，大王锚点）
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  TOWERS.placeAt(free[0].c, free[0].r, 'arrow', 1);
  const ac = free[0].c + 1 < CFG.MAP_COLS ? free[0].c + 1 : free[0].c - 1;   // 邻格（越界取另一侧）
  const ar = free[0].r + 1 < CFG.MAP_ROWS ? free[0].r + 1 : free[0].r - 1;
  GS.buildings = [GS.core, { type: 'atk', c: ac, r: free[0].r, flash: 0 }];
  const posA = wagonPos0();
  const fW = mkFoe(posA.c, posA.r);
  GS.foes = [fW];
  fireOnce();
  check('[T6] 战斗乘区：猛攻坊邻格 ⇒ 机枪 4 → 8', Math.abs(fW.hp - 92) < 1e-6, 'hp=' + fW.hp);
  check('[T6] 生效连线查询：坊对车厢固定格贡献 = +100%',
    Math.abs(GS.atkBoostAt(free[0].c, free[0].r) - 1.0) < 1e-9);
  GS.towers[0].wcd = 0;   // 重置冷却，疾速坊单发验证
  GS.buildings = [GS.core, { type: 'asp', c: free[0].c, r: ar, flash: 0 }];
  const posS = wagonPos0();
  GS.foes = [mkFoe(posS.c, posS.r)];
  fireOnce();
  check('[T6] 战斗乘区：疾速坊邻格 ⇒ 机枪间隔 ÷2（+100% 攻速）',
    Math.abs(GS.towers[0].wcd - TOWERS.TYPES.arrow.interval / 2) < 1e-9,
    'wcd=' + GS.towers[0].wcd);
}

// ============================================================================
// [T7] 经验系统（v1.8u 四拍板 §14.83：等级曲线 3500+300×(L-1)、25 级封顶；
//   波次均分 killGain = WAVE_EXP[波]/怪数 —— FOES.wave=0 时 count(0)=24，仅查可用性）
// ============================================================================
{
  ENG.restart();
  ensureFree(6);
  check('[T7] 初始：exp 0 / need 3500（L1→L2）/ 无待发牌',
    GS.exp === 0 && EXP.need() === 3500 && !GS.expPending);
  EXP.add(3499);
  check('[T7] 攒 3499 不满（阈值 3500）', GS.exp === 3499 && !GS.expPending);
  EXP.add(1);
  check('[T7] 攒满 3500 → 待发牌 1、已得 1（升 L2）、阈值升 3800',
    GS.expPending === 1 && GS.expTaken === 1 && EXP.need() === 3800);
  EXP.add(3800);
  check('[T7] 再攒 3800 → 待发牌 2、阈值升 4100',
    GS.expPending === 2 && GS.expTaken === 2 && EXP.need() === 4100);
  check('[T7] consume 取走一次', EXP.consume() === true && GS.expPending === 1);
  check('[T7] progress 口径', EXP.progress().need === 4100);
  check('[T7] killGain = 波总额/怪数（w0 表底 1500 / count(0)=2）',
    Math.abs(EXP.killGain() - 1500 / FOES.CFG.count(0)) < 1e-9 &&
    CFG.waveExp(1) === 1500 && CFG.waveExp(10) === 5600 && CFG.waveExp(11) === 5600);
  // v1.8v 波次经验曲线：前两波合计不够升级，第 3~10 波每波恰升 1 级，10 波打完 L9
  {
    var saved = { exp: GS.exp, taken: GS.expTaken, pend: GS.expPending, wave: FOES.wave };
    GS.exp = 0; GS.expTaken = 0; GS.expPending = 0;
    var kinds = [];
    for (var w = 1; w <= 10; w++) {
      var lvBefore = GS.expTaken;
      GS.exp = GS.exp + CFG.waveExp(w);          // 模拟本波全部击杀后的经验账
      var gd = 0;
      while (GS.exp >= EXP.need() && gd++ < 999) {
        GS.exp -= EXP.need(); GS.expTaken++; GS.expPending++;
      }
      kinds.push(GS.expTaken - lvBefore);
    }
    check('[T7] 前两波不升级，之后每波升 1 级，第 10 波到 L9',
      kinds[0] === 0 && kinds[1] === 0 && kinds.slice(2).every(n => n === 1) &&
      GS.expTaken === 8,
      '每波升级=' + kinds.join(',') + ' 终等级=L' + (GS.expTaken + 1));
    GS.exp = saved.exp; GS.expTaken = saved.taken; GS.expPending = saved.pend; FOES.wave = saved.wave;
  }
  { // 25 级封顶：expTaken=24（L25）→ need=Infinity 永不满、progress 满条
    var savedTaken = GS.expTaken, savedExp = GS.exp, savedPend = GS.expPending;
    GS.expTaken = 24; GS.exp = 99999;
    check('[T7] 25 级封顶：need=Infinity、progress 满条、add 不再发牌',
      EXP.need() === Infinity && EXP.progress().cur === 1 && EXP.progress().need === 1,
      'need=' + EXP.need());
    EXP.add(5000);
    check('[T7] 封顶后 add 不再发牌（pending 不涨）', GS.expTaken === 24 && GS.expPending === 1);
    GS.expTaken = savedTaken; GS.exp = savedExp; GS.expPending = savedPend;
  }
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
console.log('塔型/词条/辅助建筑：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
if (fail) { console.log(failures.join('\n')); process.exit(1); }
