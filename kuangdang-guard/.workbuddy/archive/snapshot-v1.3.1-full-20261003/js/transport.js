// ============================================================================
// 运输模块（v0.9.2）—— 规则 6：拾取的金币**堆在车上**，到站才一并交付
//
// 与旧版的唯一区别：serviceCell 不再直接 GS.gold += …，而是 TRANS.load(…)
// 累加到 GS.train.cargo；跑完一圈回到站台时由 engine.js 调 TRANS.deliver()
// 一次性入账并清空车斗。
//
// 车斗口径 = "这一圈（站台→站台）车上攒了多少"：
//   · 金币地块：+CFG.GOLD_RATE（harvested 保证一圈只算一次，圈末由 resetGoldLap 重置）
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

// 到站交付：车斗一次性并入金币，清零。返回本次交付额。
//   v1.3-rc 拍板 ④："站台一定提供 10 金币" = **额外 +10**（cargo 之外再送），
//   保三选一退役后即使空圈也有进账。数量来源 CFG.STATION_BONUS。
TRANS.deliver = function () {
  var cargo = GS.train.cargo;
  var got = cargo + CFG.STATION_BONUS;
  GS.gold += got;
  GS.train.cargo = 0;
  // 行为记录（v1.3.5 经济类）：分项金额 + 结余快照
  if (typeof LOG !== 'undefined') LOG.add('deliver',
    { wave: (typeof FOES !== 'undefined') ? FOES.wave : 0,
      cargo: cargo, bonus: CFG.STATION_BONUS, got: got, gold: GS.gold });
  return got;
};

TRANS.serviceCell = function (cell) {
  // 金币地块：列车驶入即"拾取"。十字格一圈会被进入两次，harvested 标记保证
  // **一圈只算一次**；跑完一圈回到站台时由 resetGoldLap 统一重置。
  var g = GS.grid[cell.r][cell.c];
  if (g.gold && !g.harvested) {
    g.harvested = true;
    g.flash = 0.35;
    TRANS.load(CFG.GOLD_RATE);     // v0.9.2：先堆到车上，到站才入账
  }
  var n = GS.neighbors(cell.c, cell.r);
  for (var i = 0; i < n.length; i++) {
    var b = GS.buildingAt(n[i][0], n[i][1]);
    if (!b || b.type !== 'econ') continue;
    TRANS.load(b.rate);            // 同上：车斗累积
    b.flash = 0.35;
  }
};

// 一圈跑完（到站交付时调用）：所有金币地块恢复可收状态
TRANS.resetGoldLap = function () {
  for (var i = 0; i < GS.goldTiles.length; i++) {
    var t = GS.goldTiles[i];
    GS.grid[t.r][t.c].harvested = false;
  }
};