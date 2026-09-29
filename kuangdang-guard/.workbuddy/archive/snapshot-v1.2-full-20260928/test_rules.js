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
for (const f of ['js/config/map.js', 'js/state.js', 'js/station.js', 'js/clock.js',
                 'js/transport.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.window.CFG, GS = sandbox.window.GS, TRANS = sandbox.window.TRANS,
      ENG = sandbox.window.ENG, STATION = sandbox.window.STATION, CLOCK = sandbox.window.CLOCK;
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
    check('规则4b：驶入金币地块车斗 +5（未入账），同圈第二次进入不再计费',
      GS.train.cargo === cargoB + CFG.GOLD_RATE && GS.gold === goldB &&
      GS.grid[gt.r][gt.c].harvested === true,
      '车斗 +' + (GS.train.cargo - cargoB) + '，金币 +' + (GS.gold - goldB));

    // 规则 5：跑完一圈重置
    TRANS.resetGoldLap();
    check('规则5a：resetGoldLap 后地块恢复可收', GS.grid[gt.r][gt.c].harvested === false);
    const cargo2 = GS.train.cargo;
    TRANS.serviceCell({ c: gt.c, r: gt.r });
    check('规则5b：重置后可再次装载', GS.train.cargo === cargo2 + CFG.GOLD_RATE);

    // 规则 4c：金币地块不可建经济建筑
    //   v0.6.12：未清理时它是废墟 → 先报"这里是废墟，先清理"；
    //   清出来（空地 + 金币）之后 → 报"金币地块，不可建造"。
    const res1 = ENG.placeEcon(gt.c, gt.r);
    check('规则4c：未清理的金币格不可建造（视作废墟）', res1 === '这里是废墟，先清理', String(res1));
    const gtT = GS.grid[gt.r][gt.c].t;
    GS.grid[gt.r][gt.c].t = 'blank';
    const res = ENG.placeEcon(gt.c, gt.r);
    GS.grid[gt.r][gt.c].t = gtT;
    check('规则4c2：金币地块（已清出）不可建造经济建筑', res === '金币地块，不可建造', String(res));
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

CLOCK.onCleared();                       // 模拟"倒计时内清空怪物" → 立即收尾
check('端到端：怪物清空后转入收尾相位', CLOCK.isDusk());

let steps = 0;
while (!CLOCK.isDay() && steps < 500) { ENG.advanceTrain(0.5); steps++; }
check('端到端：到站即收尾回到白天', CLOCK.isDay(), '推进 ' + steps + ' 次仍未到站');
check('端到端：一圈交付 3 块 × 5 金币 = 15', GS.gold - gold0 === 15,
  '实际 +' + (GS.gold - gold0));
check('端到端：交付后车斗清零', GS.train.cargo === 0, '残留 ' + GS.train.cargo);
check('端到端：停车位置就是站台下标', GS.train.index === STATION.index() && GS.train.frac === 0);
check('端到端：圈末所有金币地块已重置',
  !GS.goldTiles.some(t => GS.grid[t.r][t.c].harvested === true));

// ---- 第二夜：再跑一圈，累计 30 ----
check('端到端：第二夜发车成功', ENG.startNight() === true);
CLOCK.onCleared();
steps = 0;
while (!CLOCK.isDay() && steps < 500) { ENG.advanceTrain(0.5); steps++; }
check('端到端：两圈累计 +30', GS.gold - gold0 === 30, '实际 +' + (GS.gold - gold0));
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
check('昼夜：怪物清空 → 转入收尾', CLOCK.isDusk() && CLOCK.hasFoes === false);
check('昼夜：收尾阶段列车仍在跑', CLOCK.isRunning() === true);
check('昼夜：到站钩子把收尾拉回白天', CLOCK.notifyStation() === true && CLOCK.isDay());
check('昼夜：白天再收到站钩子无效', CLOCK.notifyStation() === false);

// ---- 初始环形状（新开局地形下的固定小环）----
// 开局 3×5 内区 = 12 格外圈，无十字 → 步数 = 格数 = 12
GS.newGame();
check('开局铁轨 = 3×5 内区的 12 步小环（无十字，故步数=格数）', GS.railPath.length === 12,
  '实际 ' + GS.railPath.length + '：' + GS.railPath.map(p => p.c + ',' + p.r).join(' '));
check('开局站台 = 中轴列最靠下的轨格 (4,8)', STATION.slot() &&
  STATION.slot().c === 4 && STATION.slot().r === 8,
  JSON.stringify(STATION.slot()));

console.log('\n' + '='.repeat(64));
console.log(pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
process.exit(fail ? 1 : 0);
