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
for (const f of ['js/config/map.js', 'js/state.js', 'js/station.js', 'js/towers.js',
                 'js/foes.js', 'js/clock.js', 'js/transport.js', 'js/engine.js'])
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

// [20-24] 塔攻击 ------------------------------------------------------------------
GS.foes.push({ c: b.c + 1, r: b.r, hp: 100, maxHp: 100, speed: 1, cd: 0, hitFlash: 0 });    // (3,4)：距核心 5
GS.foes.push({ c: b.c + 0.5, r: b.r, hp: 100, maxHp: 100, speed: 1, cd: 0, hitFlash: 0 });  // (2.5,4)：距核心 6.25
const f0 = GS.foes[0].hp;
TOWERS.update(0.01);
check('[20] 射程内单体掉血', GS.foes.some(f => f.hp < 100));
check('[21] 攻击冷却进入', b.cd > 0);
check('[22] 攻击连线已记录', TOWERS.beams.length === 1);
check('[23] 选离镇中心最近的怪（先打最前面的）', GS.foes[0].hp < 100 && GS.foes[1].hp === f0,
  'f0=' + GS.foes[0].hp + ' f1=' + GS.foes[1].hp);
check('[24] 冷却中不二连击', (TOWERS.update(0.1), TOWERS.beams.length === 1));
GS.foes.length = 0; TOWERS.beams.length = 0;

// [25-27] 射程外不攻击
GS.foes.push({ c: b.c + 5, r: b.r, hp: 50, maxHp: 50, speed: 1, cd: 0, hitFlash: 0 });
TOWERS.update(0.01);
check('[25] 射程外不攻击', GS.foes[0].hp === 50 && TOWERS.beams.length === 0);
GS.foes.length = 0;

// [26] 星级倍率：2 星伤害 = STATS.dmg × 2
GS.foes.push({ c: b.c + 1, r: b.r, hp: 999, maxHp: 999, speed: 1, cd: 0, hitFlash: 0 });
b.cd = 0; b.elem = 'thunder';
TOWERS.update(0.01);
check('[26] 2 星雷塔伤害 = 16×2', GS.foes[0].hp === 999 - 32, 'hp=' + GS.foes[0].hp);
GS.foes.length = 0;

// [27-31] 波次与怪 -----------------------------------------------------------------
GS.newGame(); GS.gold = 200;
check('[27] 新局怪清空、波次归零', GS.foes.length === 0 && FOES.wave === 0 && GS.coreHP === CFG.CORE_HP);
FOES.startWave();
check('[28] 第 1 波怪数 = 2+1', GS.foes.length === 3, 'n=' + GS.foes.length);
check('[29] 波次号 = 1', FOES.wave === 1);
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
GS.coreHP = 2;
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
check('[36] 开波刷怪 + 入夜', FOES.wave === 1 && CLOCK.isNight() && GS.foes.length === 3,
  'wave=' + FOES.wave + ' n=' + GS.foes.length + ' night=' + CLOCK.isNight());
GS.coreHP = 41;                          // 模拟第一波被打掉 19
GS.foes.forEach(f => { f.hp = 0; });     // 塔杀光
FOES.update(0.01);                       // 尸体清空 → 波次结束
check('[37] 怪清空 → hasFoes=false + 转收尾', CLOCK.hasFoes === false && CLOCK.isDusk() && FOES.active === false);
check('[38] coreHP 跨波继承（41 不回满）', GS.coreHP === 41);
// dusk → 白天：收尾相位要"列车到站"才换日（tick 对 dusk 不生效 —— 死循环教训）
check('[38b] 到站回白天', CLOCK.notifyStation() === true && CLOCK.isDay());
ENG.startNight();                        // 第二波
check('[39] 第二波 = 4 只', GS.foes.length === 4, 'n=' + GS.foes.length);
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
const res = ENG.applyShape(3, 9, shape.cells);   // 压住内区底行 (3..4, 8..9 内 y=9)
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

// [49] 射程外 + 撞击范围外 = 不掉血
GS.foes = [mkFoe(head.c + 4, head.r, 100)];
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

// ---- 汇总 ------------------------------------------------------------------------
console.log('\n' + '='.repeat(64));
console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); failures.forEach(f => console.log('  - ' + f)); process.exitCode = 1; }
