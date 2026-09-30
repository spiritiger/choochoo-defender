// ============================================================================
// 怪物模块（v1.3-rc 临时迭代）—— 近战 · 无视地形直线冲 · 波次制
//
// 大王拍板（2026-09-28，规格 §13）：
//   · 近战怪**无视地形直线冲**向镇中心（不走铁轨），贴近后近战攻击镇中心；
//   · **一波 = 一个夜晚**：「发车」= 开波（白天施工 → 夜晚刷怪 + 列车照常跑圈）；
//   · 杀完所有怪进入下一波（触发 CLOCK.onCleared → dusk 收尾 → 白天）；
//   · 镇中心血量跨波**继承不重置**；归零 = 挑战失败（GS.gameOver + 重开）。
//
// v1.3.3（2026-09-29）刷怪位置偏置：**铁轨离哪段边缘近，怪就更偏向从那段来**。
//   · 只偏**位置**、不动数量公式 —— 数量/血量/速度已随波次成长，"位置偏置"是
//     "发展方向 = 引怪方向"的策略层，两件事混在一起就没法单独调了；
//   · 落法：每只怪抽 SPAWN.CANDS 个边缘候选点，按 w = BASE + BOOST·max(0, R_MAX−d)/R_MAX
//     （d = 候选点到最近轨格的欧氏距离）加权择一 —— 不直接取最近点，保留随机性，
//     不然每只怪都从同一个点出，站位与预判全变味；
//   · 设计推理：往哪边铺轨收金币 = 主动引怪到哪边，而那条直冲走廊恰好穿过
//     你的塔区（塔有输出）—— 自洽的风险回报。BASE 保底让远边照常出怪，
//     玩家不能把某条边完全锁死；前期铁轨小而居中（距边 3~4 格）偏置天然弱，
//     随外扩自然增强，正好贴合难度曲线。想前期更明显 → 调大 BOOST / R_MAX。
//
// 与 v0.9.2 昼夜骨架的接线（clock.js 逻辑零改动，用的就是预留桩）：
//   · FOES.update 每帧维护 CLOCK.hasFoes（= 场上还有活怪）；
//   · 怪全灭 → CLOCK.onCleared()（倒计时内清空 → 立即 dusk；超时 overtime → 此时 dusk）；
//   · 开波由 engine.js 的 ENG.startNight 调 FOES.startWave()。
//
// 怪坐标：**浮点格坐标**（f.c/f.r 可以是小数），渲染时换算像素。移动 = 每帧
// 朝镇中心方向推进 speed*dt（无视地形 = 不查 grid，直线就是直线）。
//
// 依赖：GS / CFG。运行时引用 CLOCK（typeof 守卫，test 沙箱可只载部分模块）。
// ============================================================================
window.FOES = {};

FOES.CFG = {
  // 镇中心血量放 CFG.CORE_HP（config/map.js）—— state.js 加载序在 foes.js 之前，
  // newGame 初始化 coreHP 时 FOES 还不存在，不能引用这里。
  atkGap: 1.0,          // 怪攻击间隔秒
  dmg: 3,               // 怪单次攻击伤害
  REACH: 1.01,          // 贴近判定：怪中心距核心中心 ≤1.01 格 = 停下开打（相邻格）
  // 波次成长公式（wave 从 1 起）—— 调优只动这里
  //   ⚠️ v1.3.2（2026-09-29 大王令）：移速整体减半（原 0.7+0.05w 封顶 1.4）
  count: function (w) { return 2 + w; },                          // 怪数量
  hp:    function (w) { return 18 + 8 * w; },                     // 单怪血量
  speed: function (w) { return Math.min(0.7, 0.35 + 0.025 * w); }, // 格/秒（原速一半）
  // 刷怪位置偏置（v1.3.3，见文件头）—— 调优只动这里
  SPAWN: {
    CANDS: 12,   // 每只怪抽几个边缘候选点加权择一
    R_MAX: 6,    // 候选点距最近轨格 ≥ R_MAX 格 → 只剩基准权重
    BASE: 1,     // 基准权重（均匀保底：远处边缘照常出怪，玩家不能完全锁边）
    BOOST: 2     // 0 距离时的加成上限（线性衰减到 R_MAX 处归零）—— 想偏得更狠调大它
  }
};

FOES.wave = 0;        // 已完成的波次号（startWave 后 = 当前正在打的波）
FOES.active = false;  // 本波是否进行中（防止 dusk/白天残留怪被误判）

// ---- 刷怪落点（v1.3.3 加权偏置；纯函数便于单测）-----------------------------
// 边缘随机点：四边等概率、沿边均匀取点（含角），出生在地图外 0.5 格。
//   （v1.3.3 从 startWave 抽出来 —— pickSpawn 要对同一只怪反复抽候选点。）
FOES.randEdgePoint = function () {
  var side = Math.floor(Math.random() * 4);
  var t = Math.random() * (side < 2 ? CFG.MAP_COLS : CFG.MAP_ROWS);
  if (side === 0) return { c: t, r: -0.5 };
  if (side === 1) return { c: t, r: CFG.MAP_ROWS - 0.5 };
  if (side === 2) return { c: -0.5, r: t };
  return { c: CFG.MAP_COLS - 0.5, r: t };
};

// 候选点到最近轨格的欧氏距离。rail = GS.railPath（有序闭环，重复格不影响
// 最近距离，无需去重）；rail 为空（没解出环）返回 Infinity。
FOES.nearestRailDist = function (c, r, rail) {
  var best = Infinity;
  for (var i = 0; i < rail.length; i++) {
    var dx = rail[i].c - c, dy = rail[i].r - r;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < best) best = d;
  }
  return best;
};

// 落点权重（v1.3.3）：w = BASE + BOOST · max(0, R_MAX − d) / R_MAX。
//   d ≤ R_MAX 时线性加成、越近越狠；d ≥ R_MAX 或无铁轨 = 纯基准。
FOES.spawnWeight = function (c, r, rail) {
  var S = FOES.CFG.SPAWN;
  var d = FOES.nearestRailDist(c, r, rail);
  if (d >= S.R_MAX) return S.BASE;
  return S.BASE + S.BOOST * (S.R_MAX - d) / S.R_MAX;
};

// 加权择一：抽 CANDS 个候选各算权重，按权重划分区间掷点。
//   不直接取"权重最大的候选"——那会把怪钉死在离铁轨最近的固定点上。
FOES.pickSpawn = function (rail) {
  var S = FOES.CFG.SPAWN;
  var cands = [], ws = [], sum = 0;
  for (var i = 0; i < S.CANDS; i++) {
    var p = FOES.randEdgePoint();
    var w = FOES.spawnWeight(p.c, p.r, rail);
    cands.push(p); ws.push(w); sum += w;
  }
  var roll = Math.random() * sum;
  for (var j = 0; j < cands.length; j++) {
    roll -= ws[j];
    if (roll <= 0) return cands[j];
  }
  return cands[cands.length - 1];      // 浮点边界兜底（roll 恰好擦过总和）
};

// ---- 开波（一波 = 一个夜晚；ENG.startNight 调）-------------------------------
// 在地图**四边外圈**刷怪（从场外进场，往里走）。数量/血量/速度按 wave 成长；
// 落点按 v1.3.3 偏置：铁轨贴近的那段边缘出怪概率更高。
FOES.startWave = function () {
  FOES.wave += 1;
  FOES.active = true;
  var n = FOES.CFG.count(FOES.wave);
  var hp = FOES.CFG.hp(FOES.wave);
  var sp = FOES.CFG.speed(FOES.wave);
  var rail = GS.railPath || [];
  for (var i = 0; i < n; i++) {
    var p = FOES.pickSpawn(rail);
    var f = { c: p.c, r: p.r };
    f.hp = hp; f.maxHp = hp;
    f.speed = sp;
    f.cd = 0;             // 攻击冷却
    f.bumpCd = 0;         // 被车头撞击的独立冷却（v1.3.1，engine.js 用）
    f.hitFlash = 0;       // 被塔打中的闪白（renderer 用）
    GS.foes.push(f);
  }
  return FOES.wave;
};

// ---- 每帧（engine.js 调）------------------------------------------------------
FOES.update = function (dt) {
  if (typeof CLOCK !== 'undefined') {
    // hasFoes 桩接线（v0.9.2 预留口）：夜里还有活怪 = 真，怪清空 = 假
    CLOCK.hasFoes = FOES.active && GS.foes.length > 0;
  }
  if (GS.gameOver) return;
  if (!FOES.active || !GS.foes.length) return;
  var core = GS.core;
  for (var i = GS.foes.length - 1; i >= 0; i--) {
    var f = GS.foes[i];
    if (f.hitFlash > 0) f.hitFlash -= dt;
    // 塔的伤害结算后 hp<=0 → 死亡移除（塔模块只扣血不删怪，尸体在这里清）
    if (f.hp <= 0) { GS.foes.splice(i, 1); continue; }
    var dx = core.c - f.c, dy = core.r - f.r;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > FOES.CFG.REACH) {
      // 直线冲：无视地形（拍板 ②），不做任何 grid 查询
      f.c += dx / dist * f.speed * dt;
      f.r += dy / dist * f.speed * dt;
    } else {
      // 贴身近战：站桩输出镇中心
      f.cd -= dt;
      if (f.cd <= 0) {
        f.cd = FOES.CFG.atkGap;
        GS.coreHP -= FOES.CFG.dmg;
        f.atkFlash = 0.2;                      // 攻击动作提示（renderer 用）
        // 行为记录（v1.3.5 战斗类）：每次受伤后的城防血量
        if (typeof LOG !== 'undefined') LOG.add('coreHit', { hp: GS.coreHP });
        if (GS.coreHP <= 0) {
          GS.coreHP = 0;
          GS.gameOver = true;                  // 挑战失败（规格 §13.1 第 5 条）
          if (typeof LOG !== 'undefined') LOG.add('gameOver', { wave: FOES.wave });
          return;                              // 直接停：局面已定
        }
      }
    }
  }
  // 波次清空 → 交回昼夜骨架（倒计时内清空 → 立即收尾；overtime → 此时收尾）
  if (!GS.foes.length && FOES.active) {
    FOES.active = false;
    if (typeof CLOCK !== 'undefined') CLOCK.onCleared();
  }
};

// ---- 重开清场（ENG.init / 失败重开时调）--------------------------------------
FOES.reset = function () {
  GS.foes = [];
  FOES.wave = 0;
  FOES.active = false;
  if (typeof CLOCK !== 'undefined') CLOCK.hasFoes = false;
};
