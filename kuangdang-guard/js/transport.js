// ============================================================================
// 运输模块（v0.9.2）—— 规则 6：拾取的金币**堆在车上**，到站才一并交付
//
// 与旧版的唯一区别：serviceCell 不再直接 GS.gold += …，而是 TRANS.load(…)
// 累加到 GS.train.cargo；跑完一圈回到站台时由 engine.js 调 TRANS.deliver()
// 一次性入账并清空车斗。
//
// 车斗口径 = "这一圈（站台→站台）车上攒了多少"：
//   · 金币地块：+GS.goldValue()（= CFG.GOLD_RATE + 铸币所数量 × CFG.MINT_BONUS；
//     harvested 保证一圈只算一次，圈末由 resetLap 重置）
//   · 爱心地块：+1 枚（v1.6.22；同上圈末重置，交付时按 CFG.HEART_HEAL 回血）
//   · 贴轨经济建筑：+b.rate（每经过一次算一次）
//   · 站台格自身的金币也会先装载再交付（engine.js 里"先装载、后判到站"）
//
// 本模块只依赖 GS / CFG，不依赖昼夜与站台模块，可独立替换（例如加容量上限、货物种类）。
// ============================================================================
window.TRANS = {};

// 车上装载（规则 6）。n <= 0 视为没装到东西。
TRANS.load = function (n) {
  if (n > 0) GS.train.cargo += n;
  return GS.train.cargo;
};

// 拾取流水登记（v1.6.25 大王令）：车头屁股上的货堆"按拾取次数"堆一枚图标 ——
//   每次拾取（金币格 / 爱心格 / 贴轨经济建筑）各 push 一枚对应的 kind。
//   ⚠️ 纯表现记账：不进任何公式，数值一律仍看 GS.train.cargo / GS.train.hearts。
//   清空时机 = 到站交付（TRANS.deliver），与规则 6「到站才交付」同节拍。
TRANS.picked = function (kind) {
  if (!GS.train.picked) GS.train.picked = [];
  GS.train.picked.push(kind);
};

// 到站交付：车斗一次性并入金币，清零。返回本次交付额。
//   v1.3-rc 拍板 ④："站台一定提供金币" = **额外**（cargo 之外再送），保三选一退役后
//   即使空圈也有进账。数量来源 CFG.STATION_BONUS（2026-10-18 大王令 10→5）。
//   v1.6.22：爱心也在这里交付 —— 车上攒了 h 枚就回 h×CFG.HEART_HEAL 点血
//   （**封顶 coreMaxHP**，不会超过初始血量上限）；爱心计数清零，地块由 resetLap 重置。
TRANS.deliver = function () {
  var cargo = GS.train.cargo;
  var got = cargo + CFG.STATION_BONUS;
  GS.gold += got;
  GS.train.cargo = 0;
  GS.train.picked = [];            // v1.6.25：屁股货堆到站清空（同一"圈"的节拍）
  // 爱心交付回血（v1.6.22）
  var hearts = GS.train.hearts || 0;
  var healed = 0;
  if (hearts > 0) {
    var before = GS.coreHP, cap = GS.coreMaxHP;
    GS.coreHP = Math.min(cap, GS.coreHP + hearts * CFG.HEART_HEAL);
    healed = GS.coreHP - before;
    GS.train.hearts = 0;
    if (typeof LOG !== 'undefined') LOG.add('heal',
      { wave: (typeof FOES !== 'undefined') ? FOES.wave : 0,
        hearts: hearts, heal: healed, coreHP: GS.coreHP, coreMaxHP: cap });
  }
  // 行为记录（v1.3.5 经济类）：分项金额 + 结余快照
  if (typeof LOG !== 'undefined') LOG.add('deliver',
    { wave: (typeof FOES !== 'undefined') ? FOES.wave : 0,
      cargo: cargo, bonus: CFG.STATION_BONUS, got: got, gold: GS.gold,
      hearts: hearts, heal: healed });
  // 交付明细快照（v1.6.32）：给"交付飘字"用 —— 返回值仍是 got（不动既有契约），
  //   详情挂 GS.train.lastDeliver，避免改签名波及调用方/测试。
  GS.train.lastDeliver = { gold: got, cargo: cargo, hearts: hearts, healed: healed };
  return got;
};

TRANS.serviceCell = function (cell) {
  // 金币/爱心地块：列车驶入即"拾取"。十字格一圈会被进入两次，harvested 标记保证
  // **一圈只算一次**；跑完一圈回到站台时由 resetLap 统一重置。
  var g = GS.grid[cell.r][cell.c];
  if (g.gold && !g.harvested) {
    g.harvested = true;
    g.flash = 0.35;
    // v1.6.23：金币价值走 GS.goldValue()（= GOLD_RATE + 铸币所数量 × MINT_BONUS）
    TRANS.load(GS.goldValue());    // v0.9.2：先堆到车上，到站才入账
    TRANS.picked('gold');          // v1.6.25：屁股货堆 +1 枚金币图标
  } else if (g.heart && !g.harvested) {
    // v1.6.22 爱心：拾取进车斗（计数一枚），到站交付时才回血
    g.harvested = true;
    g.flash = 0.35;
    GS.train.hearts = (GS.train.hearts || 0) + 1;
    TRANS.picked('heart');         // v1.6.25：屁股货堆 +1 枚爱心图标
  }
};

// 一圈跑完（到站交付时调用）：所有金币 + 爱心地块恢复可收状态
TRANS.resetLap = function () {
  var i, t;
  for (i = 0; i < GS.goldTiles.length; i++) {
    t = GS.goldTiles[i];
    GS.grid[t.r][t.c].harvested = false;
  }
  for (i = 0; i < GS.heartTiles.length; i++) {
    t = GS.heartTiles[i];
    GS.grid[t.r][t.c].harvested = false;
  }
};