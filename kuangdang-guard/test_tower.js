// ============================================================================
// test_tower.js —— v1.3-rc 塔防迭代专用用例（塔/合成/召唤/怪/波次/失败/站台+10）
// 沙箱加载：map/state/station/towers/foes/clock/transport/engine（与 index.html
// 加载序一致，不含 renderer/ui/main —— 与 test_rules.js 同边界）。
// 跑法：node test_tower.js
// ============================================================================
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = __dirname;
const sb = {}; sb.window = sb; sb.console = console;
vm.createContext(sb);
for (const f of ['js/config/map.js', 'js/log.js', 'js/state.js', 'js/station.js', 'js/towers.js',
                 'js/foes.js', 'js/clock.js', 'js/transport.js', 'js/solver-async.js', 'js/engine.js'])
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sb, { filename: f });

const GS = sb.GS, CFG = sb.CFG, TOWERS = sb.TOWERS, FOES = sb.FOES,
      CLOCK = sb.CLOCK, TRANS = sb.TRANS, ENG = sb.ENG;

// ---- 固定种子随机（召唤落点/元素、刷怪点位全部确定化）----
let _seed = 20260928;
const rnd = () => { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; };
Math.random = rnd;

let pass = 0, fail = 0; const failures = [];
function check(name, ok, detail) {
  if (ok) pass++; else { fail++; failures.push(name + (detail ? ' —— ' + detail : '')); }
  console.log((ok ? '✓' : '✗') + ' ' + name + (ok ? '' : '  [' + (detail || '') + ']'));
}

// ---- 开局：全空白盘（无铁轨 —— 塔可放格 = 全场除核心）----
GS.debugNoDeadline = true;
GS.newGame();
GS.gold = 200;

// [1] 召唤基本盘 -----------------------------------------------------------------
const g0 = GS.gold;
const r1 = TOWERS.summon();
check('[1] 召唤成功返回 true', r1 === true);
check('[2] 召唤扣费 10', GS.gold === g0 - 10, 'gold=' + GS.gold);
check('[3] 塔列表 1 座', GS.towers.length === 1);
const t1 = GS.towers[0];
check('[4] 1 星塔', t1.star === 1 && t1.type === 'tower');
check('[5] 元素合法', TOWERS.ELEMS.includes(t1.elem));
check('[6] 落格镜像一致', GS.grid[t1.r][t1.c].b === t1);
check('[7] 落在合法格（空地/非轨/非金币/无建筑）', TOWERS.isFreeSpot(t1.c, t1.r) === false && t1.elem);

// [8] 金币不足拒绝
GS.gold = 5;
const nT = GS.towers.length;
check('[8] 金币不足召唤被拒', TOWERS.summon() !== true && GS.towers.length === nT && GS.gold === 5);
GS.gold = 200;

// [9] 无空地拒绝：把全场空格占满假建筑
let filled = 0;
for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
  if (TOWERS.isFreeSpot(c, r)) { GS.grid[r][c].b = { type: 'tower', elem: 'fire', star: 9, cd: 0, c, r, flash: 0 }; GS.towers.push(GS.grid[r][c].b); filled++; }
GS.gold = 100;
check('[9] 无空地召唤被拒', TOWERS.summon() !== true && GS.gold === 100);
// 清掉假塔（保留 t1）
for (let i = GS.towers.length - 1; i >= 1; i--) TOWERS.remove(GS.towers[i]);
check('[10] 清场后塔数回 1', GS.towers.length === 1);

// [11-15] 合成 -------------------------------------------------------------------
// 测试盘面清成"无轨、无金币、全空地"（isFreeSpot 才会放行内区外的格子 ——
// 首版把塔摆在内区外的废墟格上，[15] 必挂）。
GS.railSet = {}; GS.railPath = []; GS.railRect = null; GS.station = null;
for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
  const g = GS.grid[r][c];
  if (!g.b) { g.t = 'blank'; g.gold = false; }
}
// ⚠️ placeAt 内部已做"格子+数组"双写，这里不要再手动 push（重复入列会导致
//    remove 只删掉一份、断言length错位 —— 首版测试踩过）。
const a = TOWERS.placeAt(1, 4, 'fire', 1);
const b = TOWERS.placeAt(2, 4, 'fire', 1);
const nBefore = GS.towers.length;
const mres = TOWERS.merge(a, b);
check('[11] 同类同星合成成功', mres === true);
check('[12] 源塔离场（数组+格子）', GS.towers.length === nBefore - 1 && GS.grid[1][4].b === null);
check('[13] 目标位星数 +1', b.star === 2 && b.type === 'tower');
check('[14] 产物元素 ∈ 四元素（随机不继承，可能等于原元素）', TOWERS.ELEMS.includes(b.elem));
check('[15] 源格恢复可放', TOWERS.isFreeSpot(1, 4) === true);

// [16] 异类/异星/自并拒绝（先把产物元素钉死，防随机撞成同元素）
b.elem = 'thunder';
const c1 = TOWERS.placeAt(1, 4, 'ice', 1);
const e1 = TOWERS.placeAt(3, 4, 'fire', 2);
check('[16] 异元素拒绝', TOWERS.canMerge(c1, b) === false);
check('[17] 异星级拒绝', TOWERS.canMerge(b, e1) === false);
check('[18] 与自身合并拒绝', TOWERS.canMerge(b, b) === false);
check('[19] 拒绝时不产生任何变化', b.star === 2 && GS.towers.length === 4);

// [20-24] 塔攻击 ------------------------------------------------------------------
// 清场只留 b（否则场上其它塔也开火，beams 数量不可预期 —— 首版踩过）
TOWERS.remove(GS.towers[0]);   // t1（召唤塔）
TOWERS.remove(c1); TOWERS.remove(e1);
check('[19b] 攻击段场上只剩 b', GS.towers.length === 1 && GS.towers[0] === b);

// [20-26] v1.4.2：塔无攻击能力（大王纠偏"塔没有攻击能力，车厢才有"）------------
//   塔 = 星级容器；攻击只在车厢（ENG.wagonCombat）与车头（ENG.trainCombat）。
GS.foes.push({ c: b.c + 1, r: b.r, hp: 100, maxHp: 100, speed: 1, cd: 0, hitFlash: 0 });    // 射程内
GS.foes.push({ c: b.c + 5, r: b.r, hp: 50, maxHp: 50, speed: 1, cd: 0, hitFlash: 0 });      // 射程外
TOWERS.beams.push({ ac: 0, ar: 0, bc: 1, br: 1, t: 0.05 });   // 塞一条残留连线验衰减
TOWERS.update(0.01); TOWERS.update(0.05);
check('[20] 塔不攻击：射程内外怪均不掉血', GS.foes[0].hp === 100 && GS.foes[1].hp === 50);
check('[21] 塔攻击冷却不再进入', b.cd === 0 || b.cd === undefined,
  'cd=' + b.cd);
check('[22] 塔不产生攻击连线（旧连线仍衰减）', TOWERS.beams.length === 0);
check('[23] 塔攻击循环已退役（__towerAtk_retired 留档）',
  typeof TOWERS.__towerAtk_retired === 'function' && typeof TOWERS.update === 'function');
GS.foes.length = 0; TOWERS.beams.length = 0;
// [24] 合成闪光仍衰减（v1.4.2 后 TOWERS.update 唯一的塔侧职责）
b.flash = 0.4;
TOWERS.update(0.1);
check('[24] 合成闪光衰减保留', b.flash < 0.4, 'flash=' + b.flash);
// [25-26] 旧"射程外不攻击/星级倍率"用例随塔攻击退役 —— 由车厢星级用例 [76] 接棒

// [27-31] 波次与怪 -----------------------------------------------------------------
GS.newGame(); GS.gold = 200;
check('[27] 新局怪清空、波次归零', GS.foes.length === 0 && FOES.wave === 0 && GS.coreHP === CFG.CORE_HP);
FOES.startWave();
check('[28] 第 1 波共 24+12×1=36 只：首批 6 立即进场 + 队列 30',
  GS.foes.length === 6 && FOES.pending === 30,
  'n=' + GS.foes.length + ' pending=' + FOES.pending);
check('[28b] 怪血口径：w1 一刀（≤车头伤害）、w2+ 恒两刀（>车头伤害且 ≤2×车头伤害）',
  FOES.CFG.hp(1) <= ENG.TRAIN_COMBAT.dmg(1) &&
  FOES.CFG.hp(2) > ENG.TRAIN_COMBAT.dmg(2) && FOES.CFG.hp(2) <= 2 * ENG.TRAIN_COMBAT.dmg(2) &&
  FOES.CFG.hp(10) > ENG.TRAIN_COMBAT.dmg(10) && FOES.CFG.hp(10) <= 2 * ENG.TRAIN_COMBAT.dmg(10),
  'hp(1)=' + FOES.CFG.hp(1) + ' train(1)=' + ENG.TRAIN_COMBAT.dmg(1) +
  ' hp(2)=' + FOES.CFG.hp(2) + ' train(2)=' + ENG.TRAIN_COMBAT.dmg(2));
check('[29] 波次号 = 1', FOES.wave === 1);
FOES.pending = 0; FOES.spawnCd = 0;    // 后续用例手工摆怪，别让节奏刷怪往里塞怪（首版踩过）
check('[30] 怪出生在地图边缘外', GS.foes.every(f => f.c < 0 || f.r < 0 || f.c > CFG.MAP_COLS - 1 || f.r > CFG.MAP_ROWS - 1));
const core = GS.core;
const d0 = Math.hypot(GS.foes[0].c - core.c, GS.foes[0].r - core.r);
FOES.update(0.5);
const d1 = Math.hypot(GS.foes[0].c - core.c, GS.foes[0].r - core.r);
check('[31] 怪朝镇中心直线逼近', d1 < d0, d0.toFixed(2) + '→' + d1.toFixed(2));

// [32] 无视地形：全图填废墟也不挡路（拍板 ②）
for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
  if (!GS.grid[r][c].b) GS.grid[r][c].t = 'rubble';
const d2 = Math.hypot(GS.foes[0].c - core.c, GS.foes[0].r - core.r);
FOES.update(0.5);
const d3 = Math.hypot(GS.foes[0].c - core.c, GS.foes[0].r - core.r);
check('[32] 废墟挡不住直线冲锋', d3 < d2, d2.toFixed(2) + '→' + d3.toFixed(2));

// [33-35] 贴身攻击 / 失败 -----------------------------------------------------------
for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
  if (GS.grid[r][c].t === 'rubble' && !GS.grid[r][c].b) GS.grid[r][c].t = 'blank';   // 还原地形
GS.foes = [{ c: core.c + 1, r: core.r, hp: 10, maxHp: 10, speed: 1, cd: 0, hitFlash: 0 }];
GS.coreHP = 8;
FOES.update(0.02);   // REACH 内：不移动，开始攻击
check('[33] 贴身怪不移动、镇中心掉血', GS.coreHP === 8 - FOES.CFG.dmg, 'coreHP=' + GS.coreHP);
GS.coreHP = FOES.CFG.dmg;   // v1.6.14 dmg=1：置 1 血，一击归零（跟常量走，dmg 再调不再挂）
GS.foes[0].cd = 0;    // 重置攻击冷却（上一击刚打出 cd=1.0，不重置这轮打不出来 —— 首版踩过）
FOES.update(0.02);
check('[34] 镇中心归零 → 挑战失败', GS.gameOver === true && GS.coreHP === 0);

// [35] 失败后冻结：塔与怪都不再更新
GS.foes.push({ c: 0, r: 0, hp: 10, maxHp: 10, speed: 1, cd: 0, hitFlash: 0 });
const hpB = GS.foes[GS.foes.length - 1].hp;
TOWERS.update(0.02); FOES.update(0.02);
check('[35] 失败后世界冻结', GS.foes[GS.foes.length - 1].hp === hpB);

// [36-38] coreHP 跨波继承 + 波次清空钩子 --------------------------------------------
// ⚠️ 用 ENG.restart 而非 GS.newGame：newGame 不清 FOES.wave（模块自治），
//    只有 restart 走 FOES.reset 归零 —— 首版在这里把波次数对错了。
ENG.restart(); GS.gold = 200;
ENG.startNight();                        // 开波（经 engine 接线）
check('[36] 开波入夜：首批 6 进场 + 队列 30（第 1 波共 36 只）',
  FOES.wave === 1 && CLOCK.isNight() && GS.foes.length === 6 && FOES.pending === 30,
  'wave=' + FOES.wave + ' n=' + GS.foes.length + ' pending=' + FOES.pending + ' night=' + CLOCK.isNight());
GS.coreHP = 41;                          // 模拟第一波被打掉 19
GS.foes.forEach(f => { f.hp = 0; });     // 塔杀光
FOES.update(0.01);                       // 尸体清空 —— 但队列还有 4 只没放
check('[36b] 待刷队列未清 → 波不结束、不入 dusk',
  FOES.active === true && CLOCK.isNight() && CLOCK.hasFoes === true,
  'active=' + FOES.active + ' pending=' + FOES.pending);
FOES.pending = 0;                        // 模拟后续全部刷完且被杀
FOES.update(0.01);                       // 波次结束
check('[37] 怪清空 → hasFoes=false + 进入奖励时间（v1.6.19 仍在 night）',
  CLOCK.hasFoes === false && CLOCK.isNight() && CLOCK.reward === true && FOES.active === false);
CLOCK.tick(CLOCK.CFG.NIGHT_SEC + 1);     // 奖励倒计时走完 → 收尾
check('[37b] 奖励倒计时走完 → 转收尾', CLOCK.isDusk());
check('[38] coreHP 跨波继承（41 不回满）', GS.coreHP === 41);
// dusk → 白天：收尾相位要"列车到站"才换日（tick 对 dusk 不生效 —— 死循环教训）
check('[38b] 到站回白天', CLOCK.notifyStation() === true && CLOCK.isDay());
ENG.startNight();                        // 第二波
check('[39] 第二波共 24+12×2=48 只：首批 8 进场 + 队列 40',
  GS.foes.length === 8 && FOES.pending === 40,
  'n=' + GS.foes.length + ' pending=' + FOES.pending);
check('[40] 第二波 coreHP 仍继承', GS.coreHP === 41);

// [41] 站台额外 +10 -----------------------------------------------------------------
GS.train.cargo = 0;
const got = TRANS.deliver();
check('[41] 空车斗到站也拿站台 +10', got === CFG.STATION_BONUS && GS.gold >= CFG.STATION_BONUS);
GS.train.cargo = 7;
check('[42] cargo+站台 = 17', TRANS.deliver() === 7 + CFG.STATION_BONUS);

// [43-44] 重开清场 -----------------------------------------------------------------
GS.gameOver = true;
ENG.restart();
check('[43] 重开：失败旗清除、塔怪清空、血量回满', GS.gameOver === false && GS.towers.length === 0 &&
  GS.foes.length === 0 && GS.coreHP === CFG.CORE_HP && FOES.wave === 0);

// [44] 清理形状仍走旧合法性（v1.2 口径不变）：贴内区可清
const shape = CFG.randomShape(4);   // 2×2
const res = ENG.applyShape(3, 9, shape.cells);   // 贴内区底行 (3..4, 8 内 y=9)：相接 2 格放行
check('[44] 清理形状压内区放行（v1.2 口径）', res === true, String(res));

// ============================================================================
// [45-52] v1.3.1 三项增量：初始金币 30 / 车头战斗（撞击+塔式）/ dusk 加速回站
//   （规格 §13.4；车头伤害 dmg(wave)=8+4×wave 随波次自动涨，与塔升星两套成长轨）
// ============================================================================
GS.gameOver = false;
FOES.reset(); TOWERS.reset();

// [45] 初始金币 30
ENG.restart();
check('[45] 初始金币 30', GS.gold === 30, 'gold=' + GS.gold);

ENG.restart();
const mkFoe = (c, r, hp) => ({ c, r, hp, maxHp: hp, speed: 0.5, cd: 0, hitFlash: 0, bumpCd: 0 });
// 车头浮点格坐标（与 ENG.trainCombat 同源插值，不依赖 LAY）
const tHead = () => {
  const a = GS.railCell(GS.train.index), b = GS.railCell(GS.train.index + 1), f = GS.train.frac;
  return { c: a.c + (b.c - a.c) * f, r: a.r + (b.r - a.r) * f };
};
const head = tHead();
FOES.wave = 2;                            // dmg = 8 + 4×2 = 16

// [46-47] 塔式攻击：射程内扣血 + 1.0s 冷却
//   ⚠️ 怪放 2 格处：在塔式射程 2.5 内、撞击圈 1.2 外 —— 单测塔式不被撞击干扰
GS.foes = [mkFoe(head.c + 2, head.r, 100)];
ENG.trainAtkCd = 0;
ENG.trainCombat(0.01);
check('[46] 车头塔式攻击伤害 = 8+4×wave', GS.foes[0].hp === 100 - ENG.TRAIN_COMBAT.dmg(2),
  'hp=' + GS.foes[0].hp + ' 期望 ' + (100 - ENG.TRAIN_COMBAT.dmg(2)));
ENG.trainCombat(0.01);
check('[47] 塔式 1.0s 冷却内不连打', GS.foes[0].hp === 100 - ENG.TRAIN_COMBAT.dmg(2));
ENG.trainAtkCd = 0;                       // 快进冷却
ENG.trainCombat(0.01);
check('[47b] 冷却结束恢复攻击', GS.foes[0].hp === 100 - 2 * ENG.TRAIN_COMBAT.dmg(2));

// [48-48b] 撞击式：1.2 格内贴身怪，每怪独立 0.8s 冷却
GS.foes = [mkFoe(head.c + 0.5, head.r, 100)];
ENG.trainAtkCd = 5;                       // 屏蔽塔式，单测撞击
ENG.trainCombat(0.01);
check('[48] 撞击扣血且挂独立冷却', GS.foes[0].hp === 100 - ENG.TRAIN_COMBAT.dmg(2) && GS.foes[0].bumpCd > 0,
  'hp=' + GS.foes[0].hp + ' bumpCd=' + GS.foes[0].bumpCd);
ENG.trainCombat(0.01);
check('[48b] 撞击冷却期内不重复扣血', GS.foes[0].hp === 100 - ENG.TRAIN_COMBAT.dmg(2));

// [49] 射程外 + 撞击范围外 = 不掉血（位置跟 RANGE 常量走，射程再调也不挂）
GS.foes = [mkFoe(head.c + ENG.TRAIN_COMBAT.RANGE + 1, head.r, 100)];
ENG.trainAtkCd = 0;
ENG.trainCombat(0.01);
check('[49] 范围外怪不掉血', GS.foes[0].hp === 100, 'hp=' + GS.foes[0].hp);

// [50] 车头杀怪 → 尸体仍由 FOES.update 统一清（与塔同约定）
GS.foes = [mkFoe(head.c + 0.5, head.r, 8)];
ENG.trainAtkCd = 5;                       // 单测撞击致死
ENG.trainCombat(0.01);
FOES.active = true;
FOES.update(0.01);
check('[50] 车头击杀 → FOES.update 清尸', GS.foes.length === 0);

// [51] dusk 加速回站：dusk 且无怪 → boost 每秒 +0.9 封顶 2；速度系数 1+boost
ENG.restart();
CLOCK.toDusk();                           // 直接进收尾相位（场上无怪）
ENG.boost = 0;
ENG.update(1.0);
check('[51] dusk 无怪 → boost 递增且封顶 2', ENG.boost > 0 && ENG.boost <= 2, 'boost=' + ENG.boost);
// 速度系数实测：同位置同步长，boost=2 的 frac 增量 ≈ boost=0 的 3 倍
CLOCK.toDusk();
GS.train.index = 0; GS.train.frac = 0; ENG.boost = 0;
ENG.trainFlow(0.05); const dSl1 = GS.train.frac;
GS.train.index = 0; GS.train.frac = 0; ENG.boost = 2;
ENG.trainFlow(0.05); const dSl2 = GS.train.frac;
check('[51b] boost=2 → 速度 ×3', Math.abs(dSl2 / dSl1 - 3) < 0.01, 'd1=' + dSl1 + ' d2=' + dSl2);

// [52] 非 dusk（白天）或还有怪 → boost 归零
CLOCK.phase = 'day'; GS.foes = [mkFoe(0, 0, 10)];
ENG.update(0.5);
check('[52] 白天/有怪 → 不加速（boost 归零）', ENG.boost === 0);

// ============================================================================
// [53-56] v1.3.3 刷怪位置偏置：铁轨离哪段边缘近，落点权重就往哪边偏
//   （规格 §13.5；只偏位置不动数量公式 —— 数量仍走 count(w)）
// ============================================================================
FOES.reset();
GS.newGame();

// [53] 纯函数基本盘：无铁轨 = 基准权重
check('[53] 无铁轨 → 基准权重（均匀保底）',
  FOES.spawnWeight(-0.5, 6, []) === FOES.CFG.SPAWN.BASE);

// [54] 同一个边缘点：铁轨贴哪侧，哪侧权重更高
const wNear = FOES.spawnWeight(-0.5, 6, [{ c: 0, r: 6 }]);   // 轨格就在左缘
const wFar  = FOES.spawnWeight(-0.5, 6, [{ c: 8, r: 6 }]);   // 轨格在最右（跨整张图）
check('[54] 铁轨近侧落点权重 > 远侧', wNear > wFar, 'near=' + wNear + ' far=' + wFar);

// [55] 距离超出 R_MAX → 无加成（远边照常出怪，玩家不能完全锁边）
const wOut = FOES.spawnWeight(-0.5, 0, [{ c: 8, r: 12 }]);
check('[55] 距轨 ≥ R_MAX → 只剩基准权重', wOut === FOES.CFG.SPAWN.BASE, 'w=' + wOut);

// [56] 统计偏置（seeded RNG）：铁轨压在左缘一列 → 左半场落点明显占多
const leftRail = [];
for (let rr = 0; rr < CFG.MAP_ROWS; rr++) leftRail.push({ c: 0, r: rr });
let leftN = 0;
const N56 = 600;
for (let s56 = 0; s56 < N56; s56++) if (FOES.pickSpawn(leftRail).c < CFG.MAP_COLS / 2) leftN++;
check('[56] 铁轨贴左缘 → 左半场落点占比 > 55%（实际 ' + (leftN / N56 * 100).toFixed(0) + '%）',
  leftN / N56 > 0.55, 'left=' + leftN + '/' + N56);
check('[56b] 数量公式未被偏置影响：第 1 波共 36 只 = 首批 6 + 队列 30',
  (FOES.reset(), GS.foes.length = 0, FOES.startWave(),
    GS.foes.length === 6 && FOES.pending === 30),
  'n=' + GS.foes.length + ' pending=' + FOES.pending);
GS.foes.length = 0; FOES.reset();

// ============================================================================
// [57-63] v1.3.5 行为记录（js/log.js）：施工/经济/战斗三类事件流水 + 导出
//   （前面的用例已经自然产生了一大批事件：summon/merge/deliver/waveStart/
//    waveEnd/coreHit/gameOver/newGame —— 这里直接验证它们都在缓冲里）
// ============================================================================
const LOG = sb.LOG;

// [57] 基本盘：add 返回带 t/ev 的条目，附加字段齐
const ev57 = LOG.add('test', { a: 1 });
check('[57] LOG.add 基本盘（t/ev/附加字段）',
  ev57.ev === 'test' && ev57.a === 1 && typeof ev57.t === 'number');

check('[58] summon 已记录（元素/坐标/费用 10）',
  LOG.buf.some(e => e.ev === 'summon' && e.cost === 10 && e.elem && e.at));
check('[59] summonFail 已记录（[8] 金币不足触发过）',
  LOG.buf.some(e => e.ev === 'summonFail' && e.reason === '金币不足'));
check('[60] merge 已记录（from/to/新元素/星数）',
  LOG.buf.some(e => e.ev === 'merge' && e.from && e.to && e.star >= 2));
check('[61] deliver 已记录（[42] 的 cargo7+bonus10=17，含结余）',
  LOG.buf.some(e => e.ev === 'deliver' && e.got === 7 + CFG.STATION_BONUS &&
               e.bonus === CFG.STATION_BONUS && typeof e.gold === 'number'));
check('[62] waveStart/waveEnd 成对（[36][38b] 触发过）',
  LOG.buf.some(e => e.ev === 'waveStart') && LOG.buf.some(e => e.ev === 'waveEnd'));
check('[63] coreHit/gameOver 已记录（[33][34] 触发过）',
  LOG.buf.some(e => e.ev === 'coreHit') && LOG.buf.some(e => e.ev === 'gameOver'));
check('[64] newGame 已记录（ENG.restart 触发过多次）',
  LOG.buf.filter(e => e.ev === 'newGame').length >= 3);

// [65] exportText：头部 + 汇总 + 每行可解析 JSON 且条数对齐
let ok65 = false;
(function () {
  const txt = LOG.exportText();
  const lines = txt.split('\n');
  if (lines[0].indexOf('KDG-LOG v1') !== 0) return;
  if (lines[2].indexOf('# 事件') !== 0 || lines[3].indexOf('# 统计') !== 0) return;
  let parsed = 0;
  for (let i = 4; i < lines.length; i++) { JSON.parse(lines[i]); parsed++; }
  ok65 = parsed === LOG.count() && lines[3].indexOf('goldEarned=') > 0;
})();
check('[65] exportText 头部/汇总/JSON 行全部合法', ok65);

// [66] 环形上限：超出丢最旧（改小 CAP 快速验证，完了恢复）
const ok66 = (function () {
  LOG.CAP = 5;
  for (let i = 0; i < 8; i++) LOG.add('x', { n: i });
  const ok = LOG.buf.length === 5 && LOG.buf[0].n === 3 && LOG.buf[4].n === 7;
  LOG.CAP = 3000;
  return ok;
})();
check('[66] 环形上限超出丢最旧', ok66);

// ============================================================================
// [67-69] v1.3.5 补充（大王拍板）：头部 ver/sid + 形状家族归一
// ============================================================================
check('[67] 头部第二行 = ver + sid（6 位 base36）',
  (function () {
    const l2 = LOG.exportText().split('\n')[1];
    return l2.indexOf('# ver=' + LOG.VER + ' sid=') === 0 &&
           /^[0-9a-z]{6}$/.test(l2.slice(l2.indexOf('sid=') + 4));
  })(),
  LOG.exportText().split('\n')[1]);
check('[68] shapeFam 归一：3×2→2×3，2×2 不变，非尺寸名原样返回',
  LOG.shapeFam('3×2') === '2×3' && LOG.shapeFam('2×2') === '2×2' &&
  LOG.shapeFam('怪名字') === '怪名字');
check('[69] 带 shape 的事件自动补 fam（2×3 家族），无 shape 的不加',
  (function () {
    const a = LOG.add('cleanApply', { shape: '3×2', at: '0,0', ok: true });
    const b = LOG.add('summon', { elem: 'fire', star: 1, at: '1,1', cost: 10 });
    return a.fam === '2×3' && b.fam === undefined;
  })());

// ============================================================================
// [70-81] v1.4 卡牌大改 + v1.4.1 车厢独立作战（规格 §14.2，大王纠偏口径）
//   车厢 = GS.towers 镜像：每塔一节同元素同星车厢；独立炮位沿轨排位。
// ============================================================================
ENG.restart();
check('[70] 重开：牌库清空', GS.deck.length === 0);

// [71-72] 三选一卡池：构成合法 + 去重
const offer1 = GS.drawCardOffer();
check('[71] 三选一发 3 张、kind 合法', offer1.length === 3 &&
  offer1.every(c => c.kind === 'shape' || c.kind === 'hero'));
check('[72] 去重：形状尺寸家族/英雄元素不重复', (function () {
  const sigs = offer1.map(c => c.kind === 'shape' ? 's:' + GS.cardSig(c) : 'h:' + c.elem);
  return new Set(sigs).size === sigs.length;
})());

// [73] 形状卡满 3 张 → 发牌全为英雄卡
GS.deck = [{ kind: 'shape', id: 1, name: '2×2', cells: [[0,0],[1,0],[0,1],[1,1]] },
           { kind: 'shape', id: 2, name: '2×2', cells: [[0,0],[1,0],[0,1],[1,1]] },
           { kind: 'shape', id: 3, name: '2×2', cells: [[0,0],[1,0],[0,1],[1,1]] }];
const offer2 = GS.drawCardOffer();
check('[73] 形状卡满 3 → 全发英雄卡', offer2.length === 3 && offer2.every(c => c.kind === 'hero'));
GS.deck = [];

// [74] 建英雄塔 → 车厢自动 +1（v1.4.1：车厢 = towers 镜像，无独立列表）
const h0 = tHead();
TOWERS.placeAt(Math.round(h0.c) + 3, Math.round(h0.r), 'fire', 1);
check('[74] 建造英雄 → 塔数=车厢数=1', GS.towers.length === 1);

// [75] 车厢独立攻击：1 星火车厢命中 = 8+4×wave（v1.4.6：与车头一致；wave=2 → 16 伤）
FOES.wave = 2;
GS.foes = []; FOES.active = false;
const wpos0 = ENG.wagonPos(0);                   // 第 0 节车厢弧长位置
GS.foes = [mkFoe(wpos0.c, wpos0.r, 100)];
GS.foes[0].c = wpos0.c; GS.foes[0].r = wpos0.r;  // 精确落位（防 mkFoe 内部处理）
const hpRef75 = GS.foes[0].hp;
ENG.trainAtkCd = 5;                              // 屏蔽车头塔式
ENG.wagonCombat(0.01);
check('[75] 1星车厢独立打 16 伤（=车头@w2）', Math.abs(GS.foes[0].hp - (hpRef75 - 16)) < 1e-9,
  'hp=' + GS.foes[0].hp.toFixed(2) + ' 期望 ' + (hpRef75 - 16));

// [76] 星级继承：2 星塔车厢 = 2 倍车头 = 32 伤（v1.4.6 乘法线性）
GS.towers[0].star = 2;
GS.towers[0].wcd = 0;                            // [75] 攻击后进了冷却，清零再测
GS.foes = [mkFoe(ENG.wagonPos(0).c, ENG.wagonPos(0).r, 100)];
const hpRef76 = GS.foes[0].hp;
ENG.wagonCombat(0.01);
check('[76] 2星车厢打 32 伤', Math.abs(GS.foes[0].hp - (hpRef76 - 32)) < 1e-9,
  'hp=' + GS.foes[0].hp.toFixed(2));
GS.towers[0].star = 1;

// [77] 特效挂每节自己的攻击：火车厢命中 → burn；冰车厢命中 → slow（火塔不烧冰的怪）
GS.towers[0].wcd = 0;
GS.towers[0].elem = 'fire';
GS.foes = [mkFoe(ENG.wagonPos(0).c, ENG.wagonPos(0).r, 100)];
ENG.wagonCombat(0.01);
const burned = GS.foes[0].burn === 2 && !GS.foes[0].slow;
GS.towers[0].wcd = 0;                            // 火段攻击后进了冷却，冰段前清零
GS.towers[0].elem = 'ice';
GS.foes = [mkFoe(ENG.wagonPos(0).c, ENG.wagonPos(0).r, 100)];
ENG.wagonCombat(0.01);
check('[77] 特效按节归属', burned && GS.foes[0].slow === 1.5 && !GS.foes[0].burn,
  'fire.burn=' + burned + ' ice.slow=' + (GS.foes[0].slow === 1.5));

// [78] 雷车厢：该节冷却 1.2 → 0.9
GS.towers[0].wcd = 0;
GS.towers[0].elem = 'thunder';
GS.foes = [mkFoe(ENG.wagonPos(0).c, ENG.wagonPos(0).r, 100)];
ENG.wagonCombat(0.01);
check('[78] 雷车厢冷却 0.9s', Math.abs(GS.towers[0].wcd - 0.9) < 1e-9,
  'wcd=' + GS.towers[0].wcd);

// [79] 冰车厢减速生效（v1.3.2 移速减半后的口径：speed×0.7）
//   ⚠️ 怪不能放车厢位正中：开局环的车厢位距核心恰 1 格，会进 REACH 攻击分支不动窝
//   （[79] 首版 Δ=0 的教训）—— 沿"车厢→核心"反向延长 1.5 格放怪：
//   距车厢 1.5 < 射程 2.5 ✓，距核心 ≈2.5 > REACH 1.01 ✓
GS.towers[0].wcd = 0;
GS.towers[0].elem = 'ice';
{
  const wp79 = ENG.wagonPos(0);
  const vx = wp79.c - GS.core.c, vy = wp79.r - GS.core.r;
  const vl = Math.hypot(vx, vy) || 1;
  const foeIce = mkFoe(wp79.c + vx / vl * 1.5, wp79.r + vy / vl * 1.5, 100);
  GS.foes = [foeIce];
  const dRef = Math.hypot(GS.core.c - foeIce.c, GS.core.r - foeIce.r);
  ENG.wagonCombat(0.01);
  FOES.active = true;
  FOES.update(1.0);
  const dIce = Math.hypot(GS.core.c - GS.foes[0].c, GS.core.r - GS.foes[0].r);
  check('[79] 冰车厢命中减速 30%', foeIce.slow > 0 && Math.abs(dRef - dIce - 0.7 * foeIce.speed) < 0.05,
    'Δ=' + (dRef - dIce).toFixed(3) + ' 期望≈' + (0.7 * foeIce.speed).toFixed(3));
}

// [80] 车头剥离车厢加成（v1.4.1 核心）：有车厢时撞击伤害仍是纯 8+4×wave
GS.foes = [mkFoe(head.c + 0.5, head.r, 100)];    // 撞击圈内
GS.foes[0].bumpCd = 0;
ENG.trainAtkCd = 5;                              // 屏蔽塔式，单测撞击
ENG.trainCombat(0.01);
check('[80] 车头不吃车厢加成', GS.foes[0].hp === 100 - ENG.TRAIN_COMBAT.dmg(2),
  'hp=' + GS.foes[0].hp + ' 期望 ' + (100 - ENG.TRAIN_COMBAT.dmg(2)));

// [81] 合成 → 车厢镜像跟着变：两节 1 星 → 一节 2 星（数量减一、单节翻倍）
GS.foes = []; FOES.active = false;
GS.towers = [];
const towerA = { type: 'tower', elem: 'poison', star: 1, cd: 0, wcd: 0, c: 0, r: 0, flash: 0 };
const towerB = { type: 'tower', elem: 'poison', star: 1, cd: 0, wcd: 0, c: 1, r: 0, flash: 0 };
GS.towers.push(towerA, towerB);
GS.grid[0][0].b = towerA; GS.grid[0][1].b = towerB;
TOWERS.merge(towerA, towerB);
check('[81] 合成后车厢镜像：1节2星', GS.towers.length === 1 && towerB.star === 2 &&
  towerB.elem === 'poison');

// ============================================================================
// [82-83] 抽卡价格线性递增（GS.drawCost = 10 + 10×已抽次数，v1.6.15 大王令，新局清零）
// ============================================================================
ENG.restart();
check('[82] 新局 drawCount=0，首抽价 10', GS.drawCount === 0 && GS.drawCost() === 10);
GS.drawCount = 4;                                  // 模拟已抽 4 次
check('[83] 第 5 抽价 = 10+10×4 = 50', GS.drawCost() === 50);
GS.drawCount = 0;                                  // 还原，免得影响后续用例

// ============================================================================
// [84-86] v1.4.5 撤销清理：applyShape 记 was 快照 → undoShape 还原废墟 + 卡回牌库
// ============================================================================
ENG.restart();
GS.deck = [{ kind: 'shape', name: '1×1', cells: [[0, 0]] }];
const uCell = GS.grid[4][2];                       // 外圈废墟带，紧贴内区（过相邻闸）
uCell.t = 'rubble';                                // 强制废墟，消除随机金币落点影响
check('[84] 清理成功且 was 快照正确', ENG.applyShape(2, 4, [[0, 0]]) === true &&
  uCell.t === 'blank' && ENG.lastShapeApply.length === 1 &&
  ENG.lastShapeApply[0].c === 2 && ENG.lastShapeApply[0].r === 4 &&
  ENG.lastShapeApply[0].was === 'rubble');
GS.undoClean = { pts: ENG.lastShapeApply, card: { kind: 'shape', name: '1×1', cells: [[0, 0]] },
                 cardIdx: 0, shape: '1×1' };
GS.deck = [];                                      // 模拟卡已被消耗
check('[85] 撤销：废墟还原+卡原位回库+撤销点清空', ENG.undoShape() === true &&
  uCell.t === 'rubble' && GS.deck.length === 1 && GS.deck[0].name === '1×1' &&
  GS.undoClean === null);

// [86] 清理格上已建塔 → 拒绝撤销（否则塔被压进废墟，盘面损坏）
uCell.t = 'rubble';
ENG.applyShape(2, 4, [[0, 0]]);
GS.undoClean = { pts: ENG.lastShapeApply, card: { kind: 'shape', name: '1×1' }, cardIdx: 0, shape: '1×1' };
GS.deck = [];
uCell.b = { type: 'tower', elem: 'fire', star: 1, c: 2, r: 4, cd: 0, wcd: 0, flash: 0 };
const blocked86 = ENG.undoShape();
check('[86] 建塔后拒绝撤销（状态不被动）', typeof blocked86 === 'string' &&
  uCell.t === 'blank' && GS.deck.length === 0 && GS.undoClean !== null);
uCell.b = null;                                    // 还原，别污染后续

// ============================================================================
// [87-88] v1.4.11 清理预览的还原纪律：applyShape 抓环后逐格还原 + 重算
//   ⇒ 盘面 t 逐格复原、railPath 逐格复原（UI.updateCleanPreview 依赖此不变量）
// ============================================================================
ENG.restart();
GS.debugNoDeadline = true;
const pCell = GS.grid[4][2];
pCell.t = 'rubble';
const railBefore = JSON.stringify(GS.railPath);
const gridBefore = [];
for (let gr = 0; gr < CFG.MAP_ROWS; gr++) {
  gridBefore.push([]);
  for (let gc = 0; gc < CFG.MAP_COLS; gc++) gridBefore[gr].push(GS.grid[gr][gc].t);
}
check('[87] 预览跑通：applyShape 成功且抓到预览环',
  ENG.applyShape(2, 4, [[0, 0]]) === true && Array.isArray(GS.railPath) && GS.railPath.length > 0);
const snap87 = ENG.lastShapeApply;
for (let s87 = 0; s87 < snap87.length; s87++)      // —— 以下为 UI.updateCleanPreview 的还原步 ——
  GS.grid[snap87[s87].r][snap87[s87].c].t = snap87[s87].was;
GS.recomputeRails();
let gridRestored = true;
for (let gr2 = 0; gr2 < CFG.MAP_ROWS && gridRestored; gr2++)
  for (let gc2 = 0; gc2 < CFG.MAP_COLS; gc2++)
    if (GS.grid[gr2][gc2].t !== gridBefore[gr2][gc2]) { gridRestored = false; break; }
check('[88] 还原纪律：t 与 railPath 逐格复原', gridRestored && JSON.stringify(GS.railPath) === railBefore);

// [89] v1.4.11 快速档（GS.railFast）：只砍预算不改逻辑 —— 常规盘上结果与全量一致
GS.railFast = true;
GS.recomputeRails();
const railFast89 = JSON.stringify(GS.railPath);
GS.railFast = false;
GS.recomputeRails();
check('[89] railFast 快速档：常规盘结果与全量一致', railFast89 === JSON.stringify(GS.railPath));

// ============================================================================
// [90-91] v1.4.12 允许形状越界（大王拍板）：越界部分忽略，图内部分照常结算
//   （导出记录实证：底边两次 cleanFail"形状超出地图"= 边缘瞄准摩擦，全部消灭）
// ============================================================================
ENG.restart();
GS.debugNoDeadline = true;
const hCellA = GS.grid[11][2], hCellB = GS.grid[12][2];
hCellA.t = 'rubble'; hCellB.t = 'rubble';
hCellA.gold = false; hCellB.gold = false;
GS.grid[10][2].t = 'blank'; GS.grid[10][2].gold = false;   // 造一格相邻区域，过相接闸
const hangRes = ENG.applyShape(2, 11, [[0, 0], [0, 1], [0, 2], [0, 3]]);   // (2,13) 越界
check('[90] 越界悬挂：返回 true 且只清图内 2 格', hangRes === true &&
  hCellA.t === 'blank' && hCellB.t === 'blank' && ENG.lastShapeApply.length === 2,
  'res=' + hangRes);
check('[91] 快照只含图内格', ENG.lastShapeApply.every(p => p.r <= 12));

// [92] v1.4.12 以指针为中心：包围盒中心对准指针格（偶数边 floor 取中偏左上）
const cells92 = [[0, 0], [1, 0], [0, 1], [1, 1], [0, 2], [1, 2], [0, 3], [1, 3]];   // 2×4
const anc92 = ENG.shapeAnchor({ c: 4, r: 6 }, cells92);
const cov92 = cells92.map(p => (anc92.c + p[0]) + ',' + (anc92.r + p[1]));
check('[92] shapeAnchor 居中：指针格 (4,6) 在包围盒中心偏左上', anc92.c === 4 && anc92.r === 5 &&
  cov92.includes('4,6') && cov92.includes('5,6') &&
  !cov92.includes('4,' + (6 - 2)) && !cov92.includes('5,' + (6 + 3)),
  'anchor=' + anc92.c + ',' + anc92.r);

// [98-99] v1.6.6 压塔跳过（大王流水 sid=ouxk6f 实证 2×4 擦塔边两次 cleanFail"范围内
//   已有建筑"）：形状罩到建筑格 → 跳过它、其余废墟照清。塔本体绝对不动；
//   相接判定不借塔轮廓（shapeContacts 跳建筑格）；撤销快照不含塔格。
ENG.restart();
GS.debugNoDeadline = true;
GS.grid[6][5].b = { type: 'tower', c: 5, r: 6, elem: 'fire', star: 1 };   // 摆一座塔
for (const [c98, r98] of [[6, 6], [5, 7], [6, 7]]) {
  GS.grid[r98][c98].t = 'rubble'; GS.grid[r98][c98].gold = false;
}
GS.grid[6][7].t = 'blank'; GS.grid[6][7].gold = false;    // (7,6) 造一格区域过相接闸
const skipRes = ENG.applyShape(5, 6, [[0, 0], [1, 0], [0, 1], [1, 1]]);   // 压 (5,6) 塔
check('[98] 压塔跳过：返回 true、塔格 b 原样、其余 3 格清成 blank',
  skipRes === true && !!GS.grid[6][5].b &&
  GS.grid[6][6].t === 'blank' && GS.grid[7][5].t === 'blank' && GS.grid[7][6].t === 'blank',
  'res=' + skipRes + ' towerB=' + !!GS.grid[6][5].b +
  ' cells=' + GS.grid[6][6].t + '/' + GS.grid[7][5].t + '/' + GS.grid[7][6].t);
check('[99] 快照不含塔格（撤销不碰塔）',
  ENG.lastShapeApply.length === 3 && ENG.lastShapeApply.every(p => !(p.c === 5 && p.r === 6)),
  'snapN=' + ENG.lastShapeApply.length);

// [93-94] v1.4.13 节奏刷怪：间隔未到不放 / 到点恰好 +1（数量↑血量↓的波次成长已由 [28][56b] 锁定）
FOES.reset(); GS.foes.length = 0;
FOES.startWave();                        // v1.6.16 第 1 波：首批 ceil(36/6)=6 立即 + pending = 30 + cd = BURST_GAP=3.6
const n93 = GS.foes.length;              // = 6（首批）
FOES.update(FOES.CFG.BURST_GAP - 0.01);  // 批间隔差 0.01s：不该放
check('[93] 节奏刷怪：间隔未到不放假怪', GS.foes.length === n93 && FOES.pending === 30,
  'n=' + GS.foes.length + ' pending=' + FOES.pending);
FOES.update(0.02);                       // 跨过批间隔：放一批（6 只）
check('[94] 节奏刷怪：到点恰好 +6、队列 −6、cd 重置',
  GS.foes.length === n93 + 6 && FOES.pending === 24 &&
  Math.abs(FOES.spawnCd - (FOES.CFG.BURST_GAP - 0.01)) < 1e-9,
  'n=' + GS.foes.length + ' pending=' + FOES.pending + ' cd=' + FOES.spawnCd.toFixed(3));
FOES.reset(); GS.foes.length = 0;

// [95-97] v1.6.2 全局倍速：循环 1→2→3→1；默认值与恢复（Node 沙箱无 sessionStorage，
//   clock.js 内有守卫 —— 正好验证"无存储环境下不炸、功能照常"）
check('[95] 倍速默认 ×1', CLOCK.timeScale === 1, 'ts=' + CLOCK.timeScale);
check('[96] 循环 1→2→3→1',
  CLOCK.cycleSpeed() === 2 && CLOCK.cycleSpeed() === 3 && CLOCK.cycleSpeed() === 1,
  'ts=' + CLOCK.timeScale);
CLOCK.timeScale = 3;
check('[97] speedInit 无存储不炸且保持当前档（模拟浏览器恢复语义在 UI 层实测）',
  (CLOCK.speedInit(), CLOCK.timeScale === 3), 'ts=' + CLOCK.timeScale);
CLOCK.timeScale = 1;

// [120-126] v1.6.10 手牌直接合成（英雄卡拖到场上同名 1 星塔上 = 直接升星）
//   判据/执行复用 canMerge/merge 单一路径（虚源 c=-1 占位、跳过离场、from:'hand'）；
//   手牌塔恒 1 星 ⇒ 只与同名 1 星塔直接合成；塔数不变（车厢数不变）。
{
  const nH0 = GS.towers.length;
  const tA = TOWERS.placeAt(2, 2, 'ice', 1);
  check('[120] canMergeCard：同名 1 星 → true', TOWERS.canMergeCard('ice', tA) === true);
  check('[121] canMergeCard：异元素 → false', TOWERS.canMergeCard('fire', tA) === false);
  check('[121b] canMergeCard：2 星同名 → false（手牌塔恒 1 星）', (function () {
    const t2 = TOWERS.placeAt(3, 2, 'fire', 2);
    const r = TOWERS.canMergeCard('fire', t2) === false;
    TOWERS.remove(t2);
    return r;
  })());
  const mH = TOWERS.mergeFromHand('ice', tA);
  check('[122] 手牌直接合成成功：星 1→2、塔数不变（车厢数不变）',
    mH === true && tA.star === 2 && GS.towers.length === nH0 + 1,
    'mH=' + mH + ' star=' + tA.star + ' n=' + GS.towers.length);
  check('[123] 手牌合成无离场：格镜像仍是它', GS.grid[2][2].b === tA);
  check('[124] merge 流水 from=\'hand\'、star=2',
    LOG.buf.some(e => e.ev === 'merge' && e.from === 'hand' && e.star === 2 && e.elem === 'ice'));
  tA.flash = 0;                                    // 清合成闪光，防残留影响视觉类断言
  const mF = TOWERS.mergeFromHand('fire', tA);
  check('[125] 异元素手牌合成被拒：返回提示、星数不变、mergeFail from=\'hand\'',
    typeof mF === 'string' && tA.star === 2 && LOG.buf.some(e => e.ev === 'mergeFail' && e.from === 'hand'),
    'mF=' + mF);
  check('[126] 场上塔 merge 回归：实塔仍走离场路径（from=坐标、星+1）', (function () {
    const tB = TOWERS.placeAt(4, 2, 'ice', 2);
    const nC = GS.towers.length;
    const res = TOWERS.merge(tB, tA);              // 2星+2星 同元素 → 3 星
    const ev = LOG.buf.filter(e => e.ev === 'merge').pop();
    const ok = res === true && GS.towers.length === nC - 1 && tA.star === 3 &&
               ev && ev.from === '4,2' && ev.to === '2,2';
    TOWERS.remove(tA);                             // 清场，不留高星塔给后面用例
    return ok;
  })());
}

// ---- 汇总 ------------------------------------------------------------------------
console.log('\n' + '='.repeat(64));
console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
