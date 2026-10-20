// ============================================================================
// 规则回归测试（Node 直接跑，不需要浏览器）：node test_rules.js
//
// 覆盖大王 2026-09-21 的 5 条新规则：
//   1) 开局 3×5（宽3 高5，含镇中心）内无任何障碍物
//   2) 外圈 5×7（减去内区）全部是障碍物
//   3) 开局不生成经济建筑，改为 10 个金币地块（都在 5×7 圈外）
//   4) 金币地块**初始即障碍物**（废墟 + 金币，v0.6.12）：开局不可铺轨，
//      用清理形状清出来（金币保留）之后才可铺轨；列车驶入 +5，十字一圈只算一次
//   5) 列车跑完一圈，金币地块全部重置
//   6) 金币先堆在车斗，到站（跑完一圈）才一并交付（v0.9.2 规则 6）；站台白天停靠
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js', 'js/resources.js', 'js/cards.js', 'js/solver-async.js', 'js/station.js', 'js/towers.js', 'js/foes.js', 'js/clock.js',
                 'js/transport.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.window.CFG, GS = sandbox.window.GS, TRANS = sandbox.window.TRANS,
      ENG = sandbox.window.ENG, STATION = sandbox.window.STATION, CLOCK = sandbox.window.CLOCK,
      TOWERS = sandbox.window.TOWERS, FOES = sandbox.window.FOES;   // v1.6.50 [SP] 固定刷怪点用例
GS.debugNoDeadline = true;   // 测试确定性：跳过 400ms 墙钟（防重负载下偶发掐断求解）

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [通过] ' + name); }
  else { fail++; console.log('  [失败] ' + name + (detail ? ' —— ' + detail : '')); }
}
const cC = Math.floor(CFG.MAP_COLS / 2), cR = Math.floor(CFG.MAP_ROWS / 2);
const inInner = (c, r) => Math.abs(c - cC) <= 1 && Math.abs(r - cR) <= 2;   // 3×5
const inRing5x7 = (c, r) => Math.abs(c - cC) <= 2 && Math.abs(r - cR) <= 3; // 5×7

// ---- 每条规则都重开一局，多跑几局抗随机 ----
const ROUNDS = 20;
for (let round = 0; round < ROUNDS; round++) {
  GS.newGame();

  // 规则 1：3×5 内区全部 blank
  let bad = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
    if (inInner(c, r) && GS.grid[r][c].t !== 'blank') bad.push(c + ',' + r);
  }
  if (round === 0) check('规则1：开局 3×5 内区无障碍（20 局抽查）', bad.length === 0, bad.join(' '));

  // 规则 2：5×7 外圈（减内区）全部废墟
  bad = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
    if (inRing5x7(c, r) && !inInner(c, r) && GS.grid[r][c].t !== 'rubble') bad.push(c + ',' + r);
  }
  if (round === 0) check('规则2：5×7 外圈全部是障碍物（20 局抽查）', bad.length === 0, bad.join(' '));

  // 规则 3：无经济建筑 + 10 个金币地块，且都在 5×7 圈外
  const econN = GS.buildings.filter(b => b.type === 'econ').length;
  if (round === 0) check('规则3a：开局无经济建筑', econN === 0, '实际 ' + econN);
  if (round === 0) check('规则3b：开局金币地块数 = CFG.GOLD_TILES（' + CFG.GOLD_TILES + ' 个）',
    GS.goldTiles.length === CFG.GOLD_TILES, '实际 ' + GS.goldTiles.length);
  bad = GS.goldTiles.filter(t => inRing5x7(t.c, t.r));
  if (round === 0) check('规则3c：金币地块都在 5×7 圈外', bad.length === 0,
    bad.map(t => t.c + ',' + t.r).join(' '));
  // v0.6.12：金币地块初始是「废墟 + 金币」—— 视为障碍物，需清理后才能铺轨
  bad = GS.goldTiles.filter(t => { const g = GS.grid[t.r][t.c]; return !g.gold || g.t !== 'rubble'; });
  if (round === 0) check('规则3d：金币地块初始埋在废墟里（t=rubble，视为障碍物）', bad.length === 0);

  if (round === 0) {
    // 规则 4a：金币地块（已清出=空地）可以被铺轨 —— 在内区右侧接一块 2×3 空地，
    // 末端放金币格，环应当能长过去并把金币格包进 railSet。
    // ⚠️ v0.6.14：地图收成 9×13 后内区右边界只剩 1 格余量（列 5..7），
    //    所以补丁必须压在内区外沿上、不能往外铺 3 列（旧版 cC+2..cC+4 会越界）。
    //    金币格取 (7, cR+1)：它在补丁 2×3 的右列，且与内区格 (6,cR+1) 4 向相邻。
    const gc = cC + 2, gr = cR + 1;   // 金币格（补丁右列）
    for (let dr = 0; dr <= 1; dr++) for (let dc = 1; dc <= 2; dc++) {
      const rr = cR + dr, cc2 = cC + dc;
      if (!CFG.inBounds(cc2, rr)) continue;
      GS.grid[rr][cc2].t = 'blank';   // 内区右列 + 外沿一列 → 供铁轨扩出去
    }
    GS.grid[gr][gc].gold = true; GS.grid[gr][gc].harvested = false;
    GS.grid[gr][gc].t = 'blank';
    GS.recomputeRails();
    check('规则4a：金币地块可以被铺设轨道',
      !!GS.railSet[gc + ',' + gr], GS.railSet[gc + ',' + gr] ? '' : '金币格未进环');

    // 规则 4d（v0.6.12）：同一格退回"废墟 + 金币" 状态 → 视作障碍物，不进环
    GS.grid[gr][gc].t = 'rubble';
    GS.recomputeRails();
    check('规则4d：未清理的金币格不可铺轨（视作障碍物）',
      GS.railPath.length >= 4 && !GS.railSet[gc + ',' + gr],
      '步数 ' + GS.railPath.length + '，入环=' + !!GS.railSet[gc + ',' + gr]);
    GS.grid[gr][gc].t = 'blank';   // 复原，供后续用例继续
    GS.recomputeRails();

    // 规则 4b：驶入装载 + 十字一圈只算一次（v0.9.2：先进车斗，不直接入账）
    //   注意：gt 必须在上面的"试验补丁"之后再挑 —— 补丁可能刚好盖住某枚随机金币格，
    //   挑完再改地形就会让下面"未清理"的断言偶发失败（19 局里会碰上一次）。
    const gt = GS.goldTiles.find(t => GS.grid[t.r][t.c].t === 'rubble') || GS.goldTiles[0];
    const goldB = GS.gold, cargoB = GS.train.cargo;
    TRANS.serviceCell({ c: gt.c, r: gt.r });
    TRANS.serviceCell({ c: gt.c, r: gt.r });   // 模拟十字格被进入第二次
    check('规则4b：驶入金币地块车斗 +价值（未入账），同圈第二次进入不再计费',
      GS.train.cargo === cargoB + GS.goldValue() && GS.gold === goldB &&
      GS.grid[gt.r][gt.c].harvested === true,
      '车斗 +' + (GS.train.cargo - cargoB) + '，金币 +' + (GS.gold - goldB));

    // 规则 5：跑完一圈重置
    TRANS.resetLap();
    check('规则5a：resetLap 后地块恢复可收', GS.grid[gt.r][gt.c].harvested === false);
    const cargo2 = GS.train.cargo;
    TRANS.serviceCell({ c: gt.c, r: gt.r });
    check('规则5b：重置后可再次装载', GS.train.cargo === cargo2 + GS.goldValue());

  }
}

// ---- 端到端（v0.9.2）：金币先堆车斗，跑完一圈到站才交付；站台白天停靠 ----
GS.newGame();
const ring = GS.railPath.slice();
const marks = [ring[2], ring[5], ring[9]];   // 挑 3 个环格改成金币地块
for (const m of marks) {
  const cell = GS.grid[m.r][m.c];
  cell.gold = true; cell.harvested = false; cell.flash = 0;
  if (!GS.goldTiles.some(t => t.c === m.c && t.r === m.r)) GS.goldTiles.push({ c: m.c, r: m.r });
}

// 规则 2/3：站台必须在中轴列、镇中心行以下，且落在铁轨上
const st = STATION.slot();
check('端到端：站台已解出且在中轴列、镇中心以下',
  !!st && st.c === Math.floor(CFG.MAP_COLS / 2) && st.r > Math.floor(CFG.MAP_ROWS / 2),
  st ? st.c + ',' + st.r : 'null');
check('端到端：站台格子确实在铁轨上',
  !!st && GS.railPath.some(p => p.c === st.c && p.r === st.r));

// 规则 4：白天车头停在站台
ENG.parkAtStation();
check('端到端：白天车头对齐站台（index/frac 都归位）',
  !!st && GS.train.index === st.index && GS.train.frac === 0,
  'index=' + GS.train.index + ' 期望 ' + (st ? st.index : '-'));

const gold0 = GS.gold;
check('端到端：开局金币全在账上、车斗为空', GS.train.cargo === 0);

// 规则 5：白天车不动
const idxDay = GS.train.index;
for (let s = 0; s < 5; s++) ENG.trainFlow(0.5);
check('端到端：白天列车不动（parkAtStation 幂等）',
  GS.train.index === idxDay && GS.train.frac === 0);

// ---- 第一夜：发车 → 清空怪物（转收尾）→ 跑完当前这圈停站台 ----
check('端到端：铁轨成环时发车成功', ENG.startNight() === true);
check('端到端：发车后进入夜晚', CLOCK.isNight());

// 圈中途：金币只上车、不进账
ENG.advanceTrain(0.5);
ENG.advanceTrain(0.5);
check('端到端：圈途中金币不进账（只堆车斗）', GS.gold === gold0);

CLOCK.onCleared();                       // 模拟"倒计时内清空怪物" → v1.6.19 奖励时间
check('端到端：倒计时内清空 → 进入奖励时间（仍 night 不停靠）',
  CLOCK.isNight() && CLOCK.reward === true && CLOCK.isRunning(),
  'phase=' + CLOCK.phase + ' reward=' + CLOCK.reward);
CLOCK.tick(CLOCK.CFG.NIGHT_SEC + 1);     // 奖励倒计时走完 → 收尾（hasFoes=false）
check('端到端：奖励倒计时走完转入收尾相位', CLOCK.isDusk());

let steps = 0;
while (!CLOCK.isDay() && steps < 500) { ENG.advanceTrain(0.5); steps++; }
check('端到端：到站即收尾回到白天', CLOCK.isDay(), '推进 ' + steps + ' 次仍未到站');
const oneLap = 3 * GS.goldValue() + CFG.STATION_BONUS;   // 3 块金币 + 站台固定 bonus（2026-10-18 起 5）
check('端到端：一圈交付 3 块 × ' + GS.goldValue() + ' 金币 + 站台 ' + CFG.STATION_BONUS + ' = ' + oneLap,
  GS.gold - gold0 === oneLap, '实际 +' + (GS.gold - gold0));
check('端到端：交付后车斗清零', GS.train.cargo === 0, '残留 ' + GS.train.cargo);
check('端到端：停车位置就是站台下标', GS.train.index === STATION.index() && GS.train.frac === 0);
check('端到端：圈末所有金币地块已重置',
  !GS.goldTiles.some(t => GS.grid[t.r][t.c].harvested === true));

// ---- 第二夜：再跑一圈，累计 50（每圈站台额外 +10）----
check('端到端：第二夜发车成功', ENG.startNight() === true);
CLOCK.onCleared();
CLOCK.tick(CLOCK.CFG.NIGHT_SEC + 1);     // 奖励时间走完 → 收尾，下面到站才停
steps = 0;
while (!CLOCK.isDay() && steps < 500) { ENG.advanceTrain(0.5); steps++; }
check('端到端：两圈累计 +' + (2 * oneLap), GS.gold - gold0 === 2 * oneLap, '实际 +' + (GS.gold - gold0));
check('端到端：两圈后车斗仍清零', GS.train.cargo === 0);

// ---- 夜晚倒计时（无怪物时）：走完即收尾 ----
GS.newGame();
ENG.startNight();
check('端到端：夜晚倒计时推进到 0 即收尾（hasFoes=false）',
  (function () { CLOCK.tick(CLOCK.CFG.NIGHT_SEC); return CLOCK.isDusk(); })(),
  '相位=' + CLOCK.phase + ' 余 ' + CLOCK.remain);

// ---- 昼夜模块自身：倒计时 / 清空钩子 / 到站钩子 ----
CLOCK.reset();
CLOCK.startNight();
check('昼夜：入夜后倒计时 = NIGHT_SEC', CLOCK.remain === CLOCK.CFG.NIGHT_SEC && CLOCK.isNight());
CLOCK.tick(1.0);
check('昼夜：tick 递减倒计时', CLOCK.remain === CLOCK.CFG.NIGHT_SEC - 1);
CLOCK.hasFoes = true;
CLOCK.tick(CLOCK.CFG.NIGHT_SEC);   // 倒计时走完但还有怪物
check('昼夜：倒计时走完仍有怪物 → overtime，不换相位',
  CLOCK.isNight() && CLOCK.overtime === true && CLOCK.remain === 0);
CLOCK.onCleared();
check('昼夜：怪物清空（overtime）→ 转入收尾', CLOCK.isDusk() && CLOCK.hasFoes === false);
check('昼夜：收尾阶段列车仍在跑', CLOCK.isRunning() === true);
check('昼夜：到站钩子把收尾拉回白天', CLOCK.notifyStation() === true && CLOCK.isDay());
check('昼夜：白天再收到站钩子无效', CLOCK.notifyStation() === false);

// ---- v1.6.19 奖励时间：倒计时内清空 → 继续跑圈，倒计时走完才收尾 ----
CLOCK.reset();
CLOCK.startNight();
CLOCK.tick(1.0);
CLOCK.hasFoes = true;
CLOCK.onCleared();                        // 倒计时内清空（不 overtime）
check('奖励时间：倒计时内清空 → reward=true 仍在 night',
  CLOCK.isNight() && CLOCK.reward === true && !CLOCK.overtime);
check('奖励时间：剩余倒计时 = NIGHT_SEC - 已流逝',
  Math.abs(CLOCK.remain - (CLOCK.CFG.NIGHT_SEC - 1)) < 1e-9,
  'remain=' + CLOCK.remain);
check('奖励时间：isRunning 保持 true（列车不停）', CLOCK.isRunning() === true);
CLOCK.tick(CLOCK.CFG.NIGHT_SEC - 1);      // 奖励倒计时走完
check('奖励时间：倒计时走完 → dusk（下一圈到站停）',
  CLOCK.isDusk() && CLOCK.reward === false);
check('奖励时间：收尾到站 → 回白天', CLOCK.notifyStation() === true && CLOCK.isDay());

// ---- 初始环形状（新开局地形下的固定小环）----
// 开局 3×5 内区 = 12 格外圈，无十字 → 步数 = 格数 = 12
GS.newGame();
check('开局铁轨 = 3×5 内区的 12 步小环（无十字，故步数=格数）', GS.railPath.length === 12,
  '实际 ' + GS.railPath.length + '：' + GS.railPath.map(p => p.c + ',' + p.r).join(' '));
// ---- 奖励时间快进（v1.8u 十五令 §14.86 改版：全局时间快进 dt×(1+boost)，战斗链除外；
//      v1.8u 十八令 §14.89：奖励/dusk 同上限封顶 3 = 快进 4×，收车不降档）----
GS.newGame();
ENG.boost = 0;                            // boost 由 ENG.restart 初始化，沙箱里手动归零
ENG.startNight();
CLOCK.onCleared();                        // 进入奖励时间（夜内清场）
check('奖励加速：进入奖励时间', CLOCK.reward === true && CLOCK.isNight());
for (let s = 0; s < 7; s++) ENG.update(0.5);   // 3.5 秒：0.9/秒 ramp → 3.15 封顶到 3
check('奖励快进：boost 封顶 3（全局时间快进 4×，战斗链除外；dusk 同上限，§14.89）',
  ENG.boost === 3, 'boost=' + ENG.boost);
check('v1.6.91 特效闸：奖励时间 boostFx=true', ENG.boostFx === true && ENG.rewardFx === true);
CLOCK.toDusk(); GS.foes = []; ENG.boost = 0;
for (let s = 0; s < 2; s++) ENG.update(0.5);
const duskRose = ENG.boost;               // dusk 机制仍在加速（提 Ramp）
check('v1.6.91 特效闸：奖励过来的收车段 boostFx 保留', ENG.boostFx === true);
for (let s = 0; s < 40 && CLOCK.isDusk(); s++) ENG.update(0.5);   // 跑完圈 → 停靠回白天
ENG.update(0.5);                          // 回白天后的第一帧：boost 归零
check('dusk 加速：机制不变（先加速，停靠回白天后归零）',
  duskRose > 0 && ENG.boost === 0 && !CLOCK.isDusk(),
  'duskRose=' + duskRose + ' end=' + ENG.boost + ' phase=' + CLOCK.phase);
check('v1.6.91 特效闸：回白天痕迹重置（rewardFx/boostFx 归 false）',
  ENG.rewardFx === false && ENG.boostFx === false);
ENG.boost = 0;
CLOCK.reset(); GS.foes = [];
ENG.update(0.5);
check('白天不加速：boost 归零', ENG.boost === 0, 'boost=' + ENG.boost);

// v1.6.91（§14.59）overtime 纯收车：倒计时耗尽才清怪 → toDusk（无奖励）⇒ 特效整段缺席
GS.newGame(); ENG.restart(); ENG.boost = 0;
ENG.startNight();
CLOCK.remain = 0; CLOCK.hasFoes = false; CLOCK.tick(0.5);   // 倒计时走完且无怪 → toDusk
check('v1.6.91 纯收车：构造 overtime dusk（未进奖励时间）',
  CLOCK.isDusk() && CLOCK.reward === false && ENG.rewardFx !== true);
GS.foes = [];
for (let s = 0; s < 3; s++) ENG.update(0.5);   // 收车段 boost 正常涨
check('v1.6.91 纯收车：提速保留（boost>0）但特效闸关（boostFx=false）',
  ENG.boost > 0 && ENG.boostFx === false, 'boost=' + ENG.boost);

check('开局站台 = 中轴列最靠下的轨格 (4,8)', STATION.slot() &&
  STATION.slot().c === 4 && STATION.slot().r === 8,
  JSON.stringify(STATION.slot()));

// ============================================================================
// v1.6.22 爱心地块（大王令 2026-10-13）：5 枚，每枚到站回血 2 点，外圈占比更高
// ============================================================================
const inRing5x7b = (c, r) => Math.abs(c - Math.floor(CFG.MAP_COLS / 2)) <= 2 &&
                             Math.abs(r - Math.floor(CFG.MAP_ROWS / 2)) <= 3;
const isOuterRing = (c, r) => c === 0 || c === CFG.MAP_COLS - 1 || r === 0 || r === CFG.MAP_ROWS - 1;
{
  // 多局抗随机：数量恒 5、外圈恒 4、位置合法、资源互相拉开的间距
  let outerMin = 99, outerMax = -1, cntOk = true, posOk = true, gapMin = 99;
  for (let rd = 0; rd < 30; rd++) {
    GS.newGame();
    if (GS.heartTiles.length !== CFG.HEART_TILES) cntOk = false;
    const o = GS.heartTiles.filter(t => isOuterRing(t.c, t.r)).length;
    outerMin = Math.min(outerMin, o); outerMax = Math.max(outerMax, o);
    for (const t of GS.heartTiles) {
      const g = GS.grid[t.r][t.c];
      if (inRing5x7b(t.c, t.r) || !g.heart || g.t !== 'rubble' || g.gold || g.b) posOk = false;
    }
    const all = GS.goldTiles.concat(GS.heartTiles);   // 金币 ∪ 爱心：统一规则要求互相拉开
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
      const d = Math.max(Math.abs(all[i].c - all[j].c), Math.abs(all[i].r - all[j].r));
      if (d < gapMin) gapMin = d;
    }
  }
  check('爱心1：开局爱心数 = CFG.HEART_TILES（30 局恒 5）', cntOk);
  check('爱心2：外圈（最外一圈）枚数 = CFG.HEART_OUTER（30 局恒 4）',
    outerMin === CFG.HEART_OUTER && outerMax === CFG.HEART_OUTER, 'min=' + outerMin + ' max=' + outerMax);
  check('爱心3：爱心都在 5×7 之外 + 埋在废墟里 + 不与金币/建筑重叠', posOk);
  check('爱心3b：金币与爱心共用一套规则 ⇒ 任意两枚资源切比雪夫间距 ≥ CFG.RES_GAP(' + CFG.RES_GAP + ')',
    gapMin >= CFG.RES_GAP, '实测最小 ' + gapMin);

  // 拾取去重 → 到站回血（封顶）→ 每圈重置
  GS.newGame();
  const h0 = GS.heartTiles[0];
  TRANS.serviceCell({ c: h0.c, r: h0.r });
  TRANS.serviceCell({ c: h0.c, r: h0.r });     // 模拟十字格第二次进入
  check('爱心4：驶入爱心格车斗 +1，同圈第二次进入不重复计数',
    GS.train.hearts === 1 && GS.grid[h0.r][h0.c].harvested === true,
    'hearts=' + GS.train.hearts);

  GS.coreHP = 50;
  TRANS.deliver();
  check('爱心5：到站交付回血 CFG.HEART_HEAL 点、爱心清零',
    GS.coreHP === 50 + CFG.HEART_HEAL && GS.train.hearts === 0,
    'coreHP=' + GS.coreHP);

  TRANS.resetLap();
  TRANS.serviceCell({ c: h0.c, r: h0.r });
  GS.coreHP = GS.coreMaxHP - 1;
  TRANS.deliver();
  check('爱心6：回血封顶 coreMaxHP（不超初始上限）', GS.coreHP === GS.coreMaxHP,
    'coreHP=' + GS.coreHP + '/' + GS.coreMaxHP);
  check('爱心7：resetLap 后爱心恢复可收（每圈重置同金币）',
    GS.grid[h0.r][h0.c].harvested === false || GS.train.hearts === 0);

}

// ============================================================================
// v1.6.25 屁股货堆（车头屁股上按拾取次数堆图标，到站才清空）
//   —— 纯表现记账：GS.train.picked 只服务渲染，数值仍看 cargo / hearts。
// ============================================================================
{
  GS.newGame();
  check('货堆1：开局 picked 为空数组',
    Array.isArray(GS.train.picked) && GS.train.picked.length === 0,
    JSON.stringify(GS.train.picked));

  const g1 = GS.goldTiles[0], h2 = GS.heartTiles[0];
  TRANS.serviceCell({ c: g1.c, r: g1.r });
  check('货堆2：驶入金币格 → picked +1 枚 gold',
    GS.train.picked.length === 1 && GS.train.picked[0] === 'gold',
    JSON.stringify(GS.train.picked));
  TRANS.serviceCell({ c: g1.c, r: g1.r });          // 十字格第二次进入
  check('货堆3：同圈重复进入不重复记账（与 harvested 同闸）', GS.train.picked.length === 1);

  TRANS.serviceCell({ c: h2.c, r: h2.r });
  check('货堆4：驶入爱心格 → picked +1 枚 heart',
    GS.train.picked.length === 2 && GS.train.picked[1] === 'heart',
    JSON.stringify(GS.train.picked));


  const before = GS.train.picked.length;
  TRANS.deliver();
  check('货堆6：到站交付 → picked 清空（与规则 6 同节拍）',
    GS.train.picked.length === 0 && before > 0, 'before=' + before);

  // 与数值口径对齐：整圈扫一遍，picked 数 == 金币格 + 爱心格（无经济建筑时）
  GS.newGame();
  const want = GS.goldTiles.length + GS.heartTiles.length;
  for (const t of GS.goldTiles) TRANS.serviceCell({ c: t.c, r: t.r });
  for (const t of GS.heartTiles) TRANS.serviceCell({ c: t.c, r: t.r });
  check('货堆7：整圈 picked 数 == 金币格数 + 爱心格数',
    GS.train.picked.length === want, GS.train.picked.length + ' vs ' + want);
  TRANS.deliver();
  check('货堆8：交付后下一圈从 0 重新累积', GS.train.picked.length === 0);

  // v1.8u 七令：车尾货堆图标跟枚数走 —— 铸币所覆盖格拾取 → 金币图标 2 枚
  GS.newGame();
  const g9 = GS.goldTiles[0];
  const h9c = g9.c > 0 ? g9.c - 1 : g9.c + 1;
  GS.grid[g9.r][h9c].t = 'blank';
  check('货堆9a：金币邻格造空地可摆铸币所', ENG.placeBuilding(h9c, g9.r, 'mint') === true);
  TRANS.serviceCell({ c: g9.c, r: g9.r });
  check('货堆9：铸币所覆盖格拾取 → 车尾金币图标 2 枚（= 金额口径的枚数镜像）',
    GS.train.cargo === CFG.GOLD_RATE * 2 &&
    GS.train.picked.filter(k => k === 'gold').length === 2,
    JSON.stringify(GS.train.picked) + ' cargo=' + GS.train.cargo);
}

// ============================================================================
// v1.6.32 交付飘字（交付瞬间在站台上方冒「金币 +N / 生命 +N」；纯表现）
//   逻辑口径：生成两条 / 固定错开 20px / 同类只留最新（不叠字）/ 满血不飘生命行 /
//            ENG.update 按 dt 到期出队。
//   绘制几何（颜色、图标在左、不重叠）在 test_render.js [R7]。
// ============================================================================
{
  GS.newGame();
  check('飘字1：开局飘字队列为空', Array.isArray(GS.floats) && GS.floats.length === 0);

  const lay0 = CFG.layout(), st0 = GS.station;
  const ax0 = CFG.ccx(lay0, st0.c), ay0 = CFG.ccy(lay0, st0.r);

  // 装 30 金币 + 2 枚爱心，血不满 → 交付
  GS.train.cargo = 30; GS.train.hearts = 2; GS.coreHP = 50;
  const got0 = ENG.deliverAtStation();
  check('飘字2：交付后生成两条（金币 + 生命）',
    GS.floats.length === 2 && GS.floats.map(f => f.kind).sort().join(',') === 'gold,heal',
    JSON.stringify(GS.floats.map(f => f.kind)));

  const fg = GS.floats.find(f => f.kind === 'gold'), fh = GS.floats.find(f => f.kind === 'heal');
  check('飘字3：锚点 = 站台格中心，金币行 −32 / 生命行 −52',
    fg.x === ax0 && fh.x === ax0 && fg.y === ay0 - 32 && fh.y === ay0 - 52,
    JSON.stringify({ ax: ax0, ay: ay0, g: [fg.x, fg.y], h: [fh.x, fh.y] }));
  check('飘字4：两行**固定错开 20px**（金币在下、生命在上）⇒ 不重叠',
    fg.y - fh.y === 20);
  check('飘字5：文案 = 本次入账额 / 实际回血量（' + fg.text + ' / ' + fh.text + '）',
    fg.text === '+' + got0 && got0 === 30 + CFG.STATION_BONUS && fh.text === '+' + (2 * CFG.HEART_HEAL));

  // 连续交付：同类只留最新一条 ⇒ 不会层层叠字
  GS.train.cargo = 10; GS.train.hearts = 0; GS.coreHP = 50;
  ENG.deliverAtStation();
  const gs2 = GS.floats.filter(f => f.kind === 'gold');
  check('飘字6：再交付一次 → 金币行仍只有 1 条（同类只留最新、不叠字）',
    gs2.length === 1 && gs2[0].text === '+' + (10 + CFG.STATION_BONUS),
    JSON.stringify(gs2.map(f => f.text)));
  check('飘字6b：新一轮生命行为 0 ⇒ 旧的已清、新的不生成',
    GS.floats.filter(f => f.kind === 'heal').length === 0);

  // 满血交付：不飘生命行（免得出现没用的 "+0"）
  GS.train.hearts = 3; GS.coreHP = GS.coreMaxHP;
  ENG.deliverAtStation();
  check('飘字7：满血交付不飘生命行', !GS.floats.some(f => f.kind === 'heal'),
    JSON.stringify(GS.floats.map(f => f.kind)));

  // 衰减：推进到一个 ttl 后自动出队
  GS.floats = [{ kind: 'gold', text: '+1', x: 0, y: 0, t: 0, ttl: ENG.FLOAT_TTL }];
  ENG.update(ENG.FLOAT_TTL);
  check('飘字8：ENG.update 推进 ≥ ttl 后自动出队', GS.floats.length === 0,
    'len=' + GS.floats.length);
}

// ============================================================================
// v1.6.23 建筑卡（铸币所 / 加油站）+ 金币默认价值（2026-10-18 大王令：GOLD_RATE 10→5）
// ============================================================================
{
  // ① 金币默认价值
  GS.newGame();
  check('建筑1：金币默认价值 = CFG.GOLD_RATE = 5（2026-10-18 大王令 10→5）',
    CFG.GOLD_RATE === 5 && GS.goldValue() === 5, 'goldValue=' + GS.goldValue());

  // ② 铸币所：任意空地可建 + 全场加值**叠加**
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c: c, r: r });
  check('建筑2：开局内区有可建空地', free.length >= 2, '空地 ' + free.length + ' 格');
  check('建筑2b：塔与建筑共用同一条空地判据（唯一定义）',
    TOWERS.isFreeSpot(free[0].c, free[0].r) === GS.isFreeSpot(free[0].c, free[0].r) &&
    GS.isFreeSpot(free[0].c, free[0].r) === true);
  check('建筑3：铸币所落位成功', ENG.placeBuilding(free[0].c, free[0].r, 'mint') === true);
  // v1.8u（§14.82 三拍板枚数口径）：覆盖格拾取 = GOLD_RATE×(1+MINT_BONUS×座数)（1枚→2枚…）、
  //   非覆盖格基础价（1 枚）、无参 goldValue 恒基础价
  let far = null;
  for (let r = 0; r < CFG.MAP_ROWS && !far; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.mintCoverAt(c, r) === 0) { far = { c: c, r: r }; break; }
  check('建筑4：一座铸币所 → 覆盖格拾取 GOLD_RATE×' + (1 + CFG.MINT_BONUS) + '（1枚→2枚）、非覆盖格基础价、无参=基础价',
    GS.goldValue(free[0].c, free[0].r) === CFG.GOLD_RATE * (1 + CFG.MINT_BONUS) &&
    !!far && GS.goldValue(far.c, far.r) === CFG.GOLD_RATE &&
    GS.goldValue() === CFG.GOLD_RATE,
    '覆盖=' + GS.goldValue(free[0].c, free[0].r) + ' 非覆盖=' + (far ? GS.goldValue(far.c, far.r) : 'null'));
  ENG.placeBuilding(free[1].c, free[1].r, 'mint');
  let g2 = null;
  for (let r = 0; r < CFG.MAP_ROWS && !g2; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.mintCoverAt(c, r) === 2) { g2 = { c: c, r: r }; break; }
  check('建筑5：两座铸币所覆盖交叠格**叠加** → ' + (1 + 2 * CFG.MINT_BONUS) + ' 枚 = GOLD_RATE×' + (1 + 2 * CFG.MINT_BONUS),
    !!g2 && GS.goldValue(g2.c, g2.r) === CFG.GOLD_RATE * (1 + 2 * CFG.MINT_BONUS),
    '交叠=' + (g2 ? GS.goldValue(g2.c, g2.r) : 'null'));
  {
    // v1.8u：拾取**带格**入账 —— 金币邻格造空地摆铸币所（测试权宜，规则4a 先例），
    //   serviceCell 后车斗 = GOLD_RATE×枚数（枚数口径，RES_GAP=2 保证金币邻格无爱心）
    const gt = GS.goldTiles[0], b0 = GS.train.cargo;
    const hc = gt.c > 0 ? gt.c - 1 : gt.c + 1;
    GS.grid[gt.r][hc].t = 'blank';
    check('建筑6a：金币邻格造空地可摆铸币所', ENG.placeBuilding(hc, gt.r, 'mint') === true);
    TRANS.serviceCell({ c: gt.c, r: gt.r });
    check('建筑6：拾取金币**带格**入账（覆盖格 = ' + CFG.GOLD_RATE + '×' + (1 + CFG.MINT_BONUS) + ' 枚）',
      GS.train.cargo === b0 + GS.goldValue(gt.c, gt.r) &&
      GS.train.cargo === b0 + CFG.GOLD_RATE * (1 + CFG.MINT_BONUS),
      '车斗 +' + (GS.train.cargo - b0) + ' 期望 ' + (CFG.GOLD_RATE * (1 + CFG.MINT_BONUS)));
  }

  // ③ 落位校验（与抽塔同一条 GS.isFreeSpot）
  GS.newGame();
  const f0 = (function () { const a = []; for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) if (GS.isFreeSpot(c, r)) a.push({ c: c, r: r }); return a; })();
  check('建筑7：废墟上不可建', ENG.placeBuilding(0, 0, 'mint') !== true);
  check('建筑8：金币格 / 爱心格 / 铁轨格上都不可建',
    ENG.placeBuilding(GS.goldTiles[0].c, GS.goldTiles[0].r, 'mint') !== true &&
    ENG.placeBuilding(GS.heartTiles[0].c, GS.heartTiles[0].r, 'mint') !== true &&
    ENG.placeBuilding(GS.railPath[0].c, GS.railPath[0].r, 'mint') !== true);
  check('建筑9：空地可建 + 同格不可重复建',
    ENG.placeBuilding(f0[0].c, f0[0].r, 'gas') === true &&
    ENG.placeBuilding(f0[0].c, f0[0].r, 'mint') !== true);

  // ④ 加油站：3×3 覆盖 → 车头格查询式提速（v1.8u 十二令改回初版 §14.81，buff 制退役）
  ENG.restart();          // 归零基准（前序端到端块可能有 boost/摆位残留）
  ENG.boost = 0;
  const rail0 = GS.railPath.slice();
  const host = (function () {
    for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
      if (!GS.isFreeSpot(c, r)) continue;
      const hit = rail0.find(p => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= CFG.GAS_RANGE);
      if (hit) return { cell: { c: c, r: r }, hit: hit };
    }
    return null;
  })();
  check('建筑10：存在"3×3 内有铁轨"的可建空地', !!host);
  if (host) {
    ENG.placeBuilding(host.cell.c, host.cell.r, 'gas');
    GS.train.index = rail0.indexOf(host.hit);
    // v1.8u 十二令查询式回归：车头在覆盖格即提速（每座 +100%），无需跨格触发
    check('建筑11：查询式回归——车头在覆盖格即提速（1 座 = 2×）',
      ENG.trainSpeedMul() === 2, 'mul=' + ENG.trainSpeedMul());
    ENG.boost = 2;
    check('建筑12：boost 不再短路（v1.8u 十五令 §14.86：boost 走 dt 快进，系数仍读覆盖）',
      ENG.trainSpeedMul() === 2, 'mul=' + ENG.trainSpeedMul());
    ENG.boost = 0;
    check('建筑13：系数直读覆盖座数（1 + gasCoverAt）',
      ENG.trainSpeedMul() === 1 + GS.gasCoverAt(host.hit.c, host.hit.r),
      'mul=' + ENG.trainSpeedMul());
  }

// ============================================================================
// [GB] 加油站提速（v1.8u 十二令改回初版 §14.81：查询式 +100%/座、可叠加、无尾巴）
// ============================================================================
{
  ENG.restart();          // 归零基准
  ENG.boost = 0;
  const rail = GS.railPath.slice();
  const spot = (function () {
    for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
      if (!GS.isFreeSpot(c, r)) continue;
      const hit = rail.find(p => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= CFG.GAS_RANGE);
      if (hit) return { cell: { c: c, r: r }, hit: hit, idx: rail.indexOf(hit) };
    }
    return null;
  })();
  ENG.placeBuilding(spot.cell.c, spot.cell.r, 'gas');
  // ① 覆盖格提速：车头在覆盖格 ⇒ 1 + 覆盖座数（1 座 = 2×），无需跨格触发
  GS.train.index = spot.idx;
  check('[GB] 覆盖格提速：1 座 = 2×（每座 +100%）', ENG.trainSpeedMul() === 2,
    'mul=' + ENG.trainSpeedMul());
  // ② 无尾巴：车头挪到无覆盖格 ⇒ 立即回落 1×（查询式与旧 buff 制的本质区别）
  const far = rail.findIndex(p => GS.gasCoverAt(p.c, p.r) === 0);
  check('[GB] 前置：环上存在无覆盖格', far >= 0);
  GS.train.index = far;
  check('[GB] 离开覆盖格立即回落（无尾巴）', ENG.trainSpeedMul() === 1,
    'mul=' + ENG.trainSpeedMul() + ' far=' + far);
  // ③ 可叠加：第二座站也盖同一格（测试直注建筑，等价 3×3 内同格两座）⇒ 1+2 = 3×
  GS.buildings.push({ type: 'gas', c: spot.hit.c, r: spot.hit.r - 1 });
  GS.train.index = spot.idx;
  check('[GB] 可叠加：两座同盖 = 3×（求和非连乘、无上限）',
    GS.gasCoverAt(spot.hit.c, spot.hit.r) === 2 && ENG.trainSpeedMul() === 3,
    'cov=' + GS.gasCoverAt(spot.hit.c, spot.hit.r) + ' mul=' + ENG.trainSpeedMul());
  // ④ boost 不短路（v1.8u 十五令 §14.86）：boost 走 dt 快进，系数全程 = 1+覆盖座数
  ENG.boost = 3;
  check('[GB] boost 不短路：boost=3 时系数仍 = 1+覆盖座数（两座格）', ENG.trainSpeedMul() === 3);
  ENG.boost = 0;
  // ⑤ 重开归零：restart 清建筑与车头位置 ⇒ 覆盖 0、系数 1
  ENG.restart();
  check('[GB] 重开归零',
    ENG.trainSpeedMul() === 1 && GS.buildings.every(b => b.type !== 'gas'));
}

  // ⑤ 三选一：三类卡同池 + 概率 50/35/15（v1.8v）+ 去重 + 同类型最多 2 张
  GS.newGame();
  const N = 3000, cnt = { shape: 0, hero: 0, building: 0 };
  let sizeOk = true, dupOk = true, capOk = true, hasB = false;
  for (let i = 0; i < N; i++) {
    const cards = GS.drawCardOffer();
    if (cards.length !== 3) sizeOk = false;
    const sigs = {}, per = { shape: 0, hero: 0, building: 0 };
    for (const c of cards) {
      cnt[c.kind] = (cnt[c.kind] || 0) + 1;
      per[c.kind] = (per[c.kind] || 0) + 1;
      if (c.kind === 'building') hasB = true;
      const sig = c.kind === 'shape' ? 's' + GS.cardSig(c) : c.kind === 'hero' ? 'h' + c.elem : 'b' + c.bkey;
      if (sigs[sig]) dupOk = false;
      sigs[sig] = 1;
    }
    if (per.shape > 2 || per.hero > 2 || per.building > 2) capOk = false;
  }
  check('建筑14：三选一恒发满 3 张且互不重复', sizeOk && dupOk);
  check('建筑15：三类卡同池出现（清理/英雄/建筑）',
    cnt.shape > 0 && cnt.hero > 0 && cnt.building > 0 && hasB);
  check('建筑16：同类型卡单次最多 2 张（v1.8v 大王令）', capOk,
    'shape=' + cnt.shape + ' hero=' + cnt.hero + ' bld=' + cnt.building);
  // 基础抽类概率走 GS.rollCardKind（不受“最多 2 张”与保底影响）：50/35/15
  {
    const M = 20000, rc = { shape: 0, hero: 0, building: 0 };
    for (let i = 0; i < M; i++) rc[GS.rollCardKind()]++;
    check('建筑17：抽类基础概率 50/35/15（±2%）',
      Math.abs(rc.shape / M - 0.50) < 0.02 &&
      Math.abs(rc.hero / M - 0.35) < 0.02 &&
      Math.abs(rc.building / M - 0.15) < 0.02,
      '实测 ' + (rc.shape / M * 100).toFixed(1) + '/' + (rc.hero / M * 100).toFixed(1) +
      '/' + (rc.building / M * 100).toFixed(1));
  }
  check('建筑18：CARD_RATE 常量 = 50/35/15',
    GS.CARD_RATE.shape === 0.50 && GS.CARD_RATE.hero === 0.35 && GS.CARD_RATE.building === 0.15,
    JSON.stringify(GS.CARD_RATE));
}

// ============================================================================
// [FX] 粒子地基 + 死亡/爆炸特效（v1.6.43 大王令 B/E）
// ============================================================================
{
  GS.newGame();
  const n0 = GS.fx.length;
  // ① 死亡特效：onFoeDeath ⇒ 尸影 + 冲击环 + 4 碎屑 = 6 枚（无 m3 词条也要出特效）
  ENG.onFoeDeath({ c: 4.2, r: 6.3, hp: 0 }, 1);
  const dk = GS.fx.slice(n0).map(p => p.kind);
  check('[FX] 怪死亡 ⇒ 尸影+冲击环+4 碎屑（6 枚；挂在 m3 早退之前）',
    GS.fx.length === n0 + 6 &&
    dk.filter(k => k === 'puff').length === 1 && dk.filter(k => k === 'ring').length === 1 &&
    dk.filter(k => k === 'spark').length === 4,
    JSON.stringify(dk));
  // ② 爆炸特效：三种基元齐、共 9 枚（火光/亮心 2 puff + 冲击环 1 ring + 火星 6 spark）
  GS.fx.length = 0;
  ENG.explosionFx(4, 6, 1.5);
  const ek = GS.fx.map(p => p.kind);
  check('[FX] 爆炸 ⇒ 火光+亮心+冲击环+6 火星（9 枚，ring/puff/spark 齐全）',
    GS.fx.length === 9 && ek.indexOf('ring') >= 0 && ek.indexOf('puff') >= 0 && ek.indexOf('spark') >= 0,
    JSON.stringify(ek));
  check('[FX] 爆炸半径随 AOE 范围走（rad=2.5 的火光终径 > rad=1.5）', (() => {
    ENG.explosionFx(4, 6, 2.5);
    const big = GS.fx.filter(p => p.kind === 'puff' && p.r1 > 2).map(p => p.r1);
    return big.length >= 2 && Math.max(...big) > 2.4;
  })());
  // ③ 衰减：寿命到期全清（最长 ttl 0.4s ⇒ 推进 5s 必空）
  ENG.updateFx(5);
  check('[FX] updateFx(5s) ⇒ 粒子全部到期清空', GS.fx.length === 0, '剩 ' + GS.fx.length);
  // ④ 新局重置
  GS.newGame();
  check('[FX] newGame ⇒ GS.fx 重置为空数组', Array.isArray(GS.fx) && GS.fx.length === 0);
}

// ============================================================================
// [FX2] 伤害/击杀飘字（v1.8s 大王令 C：特效盘点清单 C 销账）
// ============================================================================
{
  GS.newGame();
  sandbox.LAY = CFG.layout();   // 飘字锚点换算需要布局（游戏里 LAY 由 main 每帧喂）
  GS.floats = [];
  const mkHit = (hp, cd) => ({ c: 4.2, r: 6.3, hp: hp, maxHp: 100, dmgFloatT: cd || 0, hitFlash: 0, slow: 0 });
  // ① 普通伤害飘字：kind=dmg、文本=实扣血量、锚点在怪位附近
  const fA = mkHit(100);
  ENG.dmgFloat(fA, 8, false);
  const d1 = GS.floats[0];
  check('[FX2] 伤害飘字生成：kind=dmg / 文本=实扣血 / 锚点=怪位换算',
    d1 && d1.kind === 'dmg' && d1.text === '8' &&
    Math.abs(d1.x - CFG.ccx(sandbox.LAY, 4.2)) < 0.01 &&
    Math.abs(d1.y - (CFG.ccy(sandbox.LAY, 6.3) - 14)) < 0.01,
    JSON.stringify(d1));
  check('[FX2] 节流冷却置位 0.3s', fA.dmgFloatT === ENG.DMG_FLOAT_CD);
  // ② 同怪节流：0.3s 冷却内的第二次命中不飘（机枪 0.4s 高频防糊屏）
  ENG.dmgFloat(fA, 8, false);
  check('[FX2] 同怪 0.3s 节流 ⇒ 冷却中不生成', GS.floats.length === 1);
  // ③ 冷却过后恢复生成
  fA.dmgFloatT = 0;
  ENG.dmgFloat(fA, 8, false);
  check('[FX2] 冷却过后恢复生成', GS.floats.length === 2);
  // ④ 击杀飘字：kind=kill 且无视节流（冷却中击杀也必须报）；补刀（preHp≤0）不报击杀
  const fK = mkHit(5, 0.2);   // 冷却中
  ENG.dmgFloat(fK, 9, true);
  const k1 = GS.floats[2];
  check('[FX2] 击杀飘字：kind=kill / 无视节流必报', k1 && k1.kind === 'kill' && k1.text === '9');
  ENG.dmgFloat(mkHit(-3), 9, false);   // 已死怪补刀：killed=false（preHp≤0）
  const k2 = GS.floats[3];
  check('[FX2] 补刀不报击杀（preHp≤0 ⇒ kind=dmg）', k2 && k2.kind === 'dmg');
  // ⑤ ttl 短于交付飘字（战斗高频，长寿命会叠成一片）
  check('[FX2] 伤害飘字 ttl 0.75s < 交付 1.15s', ENG.DMG_FLOAT_TTL === 0.75 && ENG.DMG_FLOAT_TTL < ENG.FLOAT_TTL);
  // ⑥ 交付清场只清 gold/heal 行，伤害/击杀飘字保留
  ENG.spawnDeliverFloats(10, 5);
  const kinds = GS.floats.map(x => x.kind);
  check('[FX2] 交付清场 ⇒ 只清交付行，dmg/kill 保留',
    kinds.indexOf('gold') >= 0 && kinds.indexOf('heal') >= 0 &&
    kinds.indexOf('dmg') >= 0 && kinds.indexOf('kill') >= 0,
    JSON.stringify(kinds));
  // ⑦ 无 LAY（纯逻辑沙箱）不生成——与交付飘字同一退化口径
  sandbox.LAY = null;
  GS.floats = [];
  ENG.dmgFloat(mkHit(10), 5, true);
  check('[FX2] 无 LAY ⇒ 不生成（typeof 守卫）', GS.floats.length === 0);
  delete sandbox.LAY;   // 还原：后续块（[SP] 等）不感知布局
  ENG.dmgFloat(mkHit(10), 5, true);
  check('[FX2] 还原后仍不生成', GS.floats.length === 0);
}

// ============================================================================
// [SP] 固定刷怪点（v1.6.50 大王令：数量随波增、位置每波重抽、预警 ×数量守恒）
// ============================================================================
{
  FOES.reset();            // wave 归零 + 预生成第 1 波点位（前序战斗块可能已推高 wave）
  GS.newGame();
  // ① 第 1 波点位：N=3（v1.6.56）、count 总和 = count(1)=8、点间距 ≥3、均在地图外 ≥2 格
  const ns = GS.nextSpawns;
  check('[SP] newGame ⇒ 第 1 波点位就绪（3 个点，预警可用）',
    Array.isArray(ns) && ns.length === FOES.nextPointCount(1),
    JSON.stringify(ns));
  const cntSum = ns.reduce((s, p) => s + p.count, 0);
  check('[SP] 各点 count 之和 = 本波总怪数 8（均分+余数随机）', cntSum === FOES.CFG.count(1),
    'sum=' + cntSum);
  let gapOk = true;
  for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++)
    if (Math.hypot(ns[i].c - ns[j].c, ns[i].r - ns[j].r) < 3) gapOk = false;
  check('[SP] 点间距 ≥ 3 格（2a）', gapOk);
  const outOk = ns.every(p => p.r <= -2 || p.r >= 12 + 2 || p.c <= -2 || p.c >= 8 + 2);
  check('[SP] 点位均在地图外 ≥ 2 格', outOk, JSON.stringify(ns));
  // ② 数量梯度（1a）：v1.8u 十一令 count=6w+2 下移 —— w1=3 w3=3 w10=3 w13=4 w20=7 w25=8
  check('[SP] 点数梯度 min(8,max(3,round(per/3)))：w1=3 w3=3 w10=3 w13=4 w20=7 w25=8',
    FOES.nextPointCount(1) === 3 && FOES.nextPointCount(3) === 3 &&
    FOES.nextPointCount(10) === 3 && FOES.nextPointCount(13) === 4 &&
    FOES.nextPointCount(20) === 7 && FOES.nextPointCount(25) === 8);
  // ③ 避重（3a）：带 prev 生成的新点全部距 prev ≥ 2 格
  const gen2 = FOES.genSpawns(2, ns);
  check('[SP] 下一波点位避开上一波（距离 ≥ 2 格）',
    gen2.every(g => ns.every(p => Math.hypot(g.c - p.c, g.r - p.r) >= 2)));
  // ④ startWave：点位接管 + 洗牌队列 + 首批消费
  const w1count = FOES.CFG.count(1);
  FOES.startWave();
  const first = Math.ceil(w1count / FOES.CFG.BURSTS);
  check('[SP] startWave ⇒ 接管点位 + fadeSpawns 淡出计时 + 队列余 = 总数 - 首批',
    FOES.waveSpawns === ns && FOES.fadeSpawns && FOES.fadeSpawns.t === 1 &&
    FOES.spawnQueue.length === w1count - first && FOES.pending === w1count - first,
    'queue=' + FOES.spawnQueue.length + ' pending=' + FOES.pending);
  FOES.spawnOne();
  check('[SP] spawnOne ⇒ 从队列弹出（守恒）', FOES.spawnQueue.length === w1count - first - 1);
  // ⑤ 恢复干净状态（其余用例依赖）
  FOES.reset();
  GS.newGame();
  check('[SP] reset/newGame ⇒ 点位重抽（第 1 波 3 点）',
    Array.isArray(GS.nextSpawns) && GS.nextSpawns.length === 3);
}

// ============================================================================
// [SD] 怪软分离 + 出生抖动（v1.6.55 大王拍板 A+C）
// ============================================================================
{
  FOES.reset();
  GS.newGame();
  // ① 完全重合的两只 → separate 后分开（>0）
  GS.foes = [{ c: 4, r: 2, hp: 9, speed: 0.3, _idx: 0 }, { c: 4, r: 2, hp: 9, speed: 0.3, _idx: 1 }];
  FOES.separate();
  const d0 = Math.hypot(GS.foes[1].c - GS.foes[0].c, GS.foes[1].r - GS.foes[0].r);
  check('[SD] 完全重合 ⇒ separate 后距离 > 0', d0 > 0, 'd=' + d0.toFixed(3));
  // ② 贴脸两只（0.3 < SEP=0.55）→ 柔推每帧退 35%，多帧迭代后收敛到 ≥ SEP
  GS.foes = [{ c: 4, r: 2, hp: 9, speed: 0.3, _idx: 0 }, { c: 4, r: 2.3, hp: 9, speed: 0.3, _idx: 1 }];
  for (let it = 0; it < 20; it++) FOES.separate();
  const d1 = Math.hypot(GS.foes[1].c - GS.foes[0].c, GS.foes[1].r - GS.foes[0].r);
  check('[SD] 距离 0.3 ⇒ 20 帧柔推几何收敛 ≥ SEP-0.001（渐进逼近，不硬着陆）',
    d1 >= FOES.CFG.SEP - 0.001, 'd=' + d1.toFixed(6));
  // ③ 已分离（0.8 > SEP）→ 不动
  GS.foes = [{ c: 4, r: 2, hp: 9, speed: 0.3, _idx: 0 }, { c: 4, r: 2.8, hp: 9, speed: 0.3, _idx: 1 }];
  FOES.separate();
  const d2 = Math.hypot(GS.foes[1].c - GS.foes[0].c, GS.foes[1].r - GS.foes[0].r);
  check('[SD] 距离 0.8 > SEP ⇒ 位置不动', Math.abs(d2 - 0.8) < 1e-9, 'd=' + d2.toFixed(3));
  // ④ 抖动：speedMul 恒 1（v1.6.60 ±8% 退役）、位置偏移 ≠ 原点
  FOES.spawnQueue = [{ c: 2, r: -2 }, { c: 2, r: -2 }];
  FOES.spawnOne(); FOES.spawnOne();
  const [m1, m2] = GS.foes.slice(-2);
  check('[SD] 出生抖动 ⇒ speedMul 恒 1、两怪不同位',
    m1.speedMul === 1 && m2.speedMul === 1 &&
    (Math.hypot(m1.c - m2.c, m1.r - m2.r) > 0.01),
    'mul1=' + m1.speedMul + ' mul2=' + m2.speedMul);
  // ⑤ 压测：144 只（w10 规模）separate 耗时
  GS.foes = [];
  for (let i = 0; i < 144; i++) {
    GS.foes.push({ c: Math.random() * 20 - 4, r: Math.random() * 24 - 4, hp: 9, speed: 0.3, _idx: i });
  }
  const t0 = Date.now();
  for (let it = 0; it < 100; it++) FOES.separate();
  const cost = (Date.now() - t0) / 100;
  check('[SD] 144 只 separate 单帧 < 2ms', cost < 2, cost.toFixed(2) + 'ms');
  // 恢复
  FOES.reset();
  GS.newGame();
}


console.log('\n' + '='.repeat(64));
console.log(pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
