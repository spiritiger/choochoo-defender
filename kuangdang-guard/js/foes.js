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
  dmg: 1,               // 怪单次攻击伤害（v1.6.14 大王令：2→1；沿革：v1.4.15 方案乙 3→2）
  REACH: 1.01,          // 贴近判定：怪中心距核心中心 ≤1.01 格 = 停下开打（相邻格）
  // 波次成长公式（wave 从 1 起）—— 调优只动这里
  //   ⚠️ v1.3.2（2026-09-29 大王令）：移速整体减半（原 0.7+0.05w 封顶 1.4）
  //   ⚠️ v1.4.13（2026-10-08 大王令）：数量提升 + 单怪血量减少 + 节奏刷怪——
  //       压力来自"怪多而碎、间隔进场"的节奏，而非单只肉度。
  //   ⚠️ v1.4.14/v1.4.18（2026-10-08 大王令）：hp 与车头攻击的相对口径——
  //       w1 恒一刀（hp(1) ≤ 车头 12）、w2 起恒两刀（2×(8+4w) 恒 > hp）。
  //   ⚠️ v1.6.14（2026-10-10 大王令五连）：①数量**再**翻倍（12+6w→24+12w）
  //       ②成批刷（BURST=3 只/批，批间隔 = 逐只 gap×3，平均速率守恒、瞬时脉冲）
  //       ③hp 更陡（斜率 6→8；起点 6→4 反向回调，保"w1 一刀"口径不变：
  //         hp(1)=12=车头一刀、hp(2)=20∈(16,32] 两刀、hp(10)=84≤96 两刀）
  //       ④移速降一点（封顶 0.7→0.6，起点 0.35→0.28，斜率 0.025→0.02）
  //       ⑤dmg 2→1（泄漏怪单次威胁减半，与数量翻倍对冲）
  count: function (w) { return 24 + 12 * w; },                    // 怪数量（v1.6.14：再翻倍，12+6w → 24+12w）
  hp:    function (w) { return 4 + 8 * w; },                      // 单怪血量（v1.6.14：斜率 6→8 更陡，起点 6→4 保 w1 一刀）
  speed: function (w) { return 0.2; },                            // 格/秒（v1.6.19 大王令"移动速度不增加"：恒 0.2，不随 wave 增长；沿革 v1.6.18 曾 0.2+0.01w、v1.6.17 曾 0.22+0.015w、v1.6.14 曾 0.28+0.02w、v1.3.2 曾整体减半）
  gap:   function (w) { return Math.max(0.8, 1.6 - 0.1 * (w - 1)); }, // 逐只间隔秒（v1.6.16 起无消费者，留作历史参数与批数推导参考）
  // v1.6.16（大王令"固定批数和时间"）+ v1.6.20（大王令"缩短至 15s 或以内"）：
  //   **批数与批间隔全部定常**——每波恒 BURSTS 批、批间隔恒 BURST_GAP ⇒
  //   总刷怪时长 = (BURSTS-1)×BURST_GAP = 15s（≤15s 达标，与 wave 无关）；
  //   每批数量 = ceil(count/BURSTS) 随波次增长（w1 每批 6 只 → w10 每批 24 只），
  //   压力全压在"批更挤"上。count=12(2+w) 恒被 6 整除 ⇒ 每批 = 2w+4 恒满额。
  BURSTS: 6,                                           // 每波固定批数
  BURST_GAP: 3.0,                                      // 固定批间隔秒（总时长 5×3.0 = 15s；沿革 v1.6.16 曾 3.6=18s）
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
FOES.pending = 0;     // v1.4.13 节奏刷怪：本波还没放出来的怪数（startWave 置、update 消化）
FOES.spawnCd = 0;     // 距下一次放怪的倒计时秒

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

// ---- 放一只怪（v1.4.13 从 startWave 抽出：节奏刷怪每只单独放）----------------
// 落点按 v1.3.3 偏置：铁轨贴近的那段边缘出怪概率更高。数量/血量/速度按当前波取。
FOES.spawnOne = function () {
  var rail = GS.railPath || [];
  var p = FOES.pickSpawn(rail);
  var hp = FOES.CFG.hp(FOES.wave);
  var f = { c: p.c, r: p.r };
  f.hp = hp; f.maxHp = hp;
  f.speed = FOES.CFG.speed(FOES.wave);
  f.cd = 0;             // 攻击冷却
  f.slow = 0; f.burn = 0; f.poison = 0;   // 车厢特效状态计时（v1.4，engine 挂 / 这里衰减）
  f.bumpCd = 0;         // 被车头撞击的独立冷却（v1.3.1，engine.js 用）
  f.hitFlash = 0;       // 被塔打中的闪白（renderer 用）
  GS.foes.push(f);
};

// ---- 开波（一波 = 一个夜晚；ENG.startNight 调）-------------------------------
// v1.4.13 节奏刷怪（大王令）：不再一波全涌出，pending 队列按间隔放。
// v1.6.16（大王令）：**固定批数 + 固定时长**——首放一批（ceil(count/BURSTS) 只）立即
//   进场，剩下的进 pending 队列每 BURST_GAP 秒放一批；总刷怪时长恒
//   (BURSTS-1)×BURST_GAP = 15s（v1.6.20 由 18s 压至 15s），与 wave 无关。波次结束
//   判定（update 尾）必须等 pending 清零且场上无怪，防"怪还没刷完就开白天"。
FOES.startWave = function () {
  FOES.wave += 1;
  FOES.active = true;
  var per = Math.ceil(FOES.CFG.count(FOES.wave) / FOES.CFG.BURSTS);  // 每批 = 2w+4 恒整除
  var first = Math.min(per, FOES.CFG.count(FOES.wave));
  for (var bi = 0; bi < first; bi++) FOES.spawnOne();     // 首批立即进场
  FOES.pending = Math.max(0, FOES.CFG.count(FOES.wave) - first);
  FOES.spawnCd = FOES.CFG.BURST_GAP;                      // 之后每 3.6s 放一批
  return FOES.wave;
};

// ---- 每帧（engine.js 调）------------------------------------------------------
FOES.update = function (dt) {
  if (typeof CLOCK !== 'undefined') {
    // hasFoes 桩接线（v0.9.2 预留口）：夜里还有活怪**或还有怪没放完** = 真
    //   （v1.4.13：pending 不算完，波次就不算结束，夜晚不能提前收）
    CLOCK.hasFoes = FOES.active && (GS.foes.length > 0 || FOES.pending > 0);
  }
  if (GS.gameOver) return;
  // 节奏刷怪（v1.4.13 逐只 → v1.6.14 成批 → v1.6.16 固定批数+固定时长）：
  //   pending > 0 时倒计时，到点放一批（= ceil(count/BURSTS)，恒 2w+4）。
  //   必须排在下方 `!GS.foes.length 早退` 之前 —— 队列消化期间场上可能空无一只。
  if (FOES.active && FOES.pending > 0) {
    FOES.spawnCd -= dt;
    if (FOES.spawnCd <= 0) {
      var bn = Math.min(Math.ceil(FOES.CFG.count(FOES.wave) / FOES.CFG.BURSTS), FOES.pending);
      for (var bi2 = 0; bi2 < bn; bi2++) FOES.spawnOne();
      FOES.pending -= bn;
      // 带上 dt 溢出（此刻为负）→ 放批周期严格 = BURST_GAP，不随帧率漂移
      FOES.spawnCd = FOES.CFG.BURST_GAP + FOES.spawnCd;
    }
  }
  if (!FOES.active) return;
  // 波次清空（场上无怪**且**队列已放完）→ 交回昼夜骨架（倒计时内清空 → 立即收尾；
  // overtime → 此时收尾）。⚠️ 必须在 `!GS.foes.length` 早退**之前**判——杀光最后一
  // 只的那一帧之后，场上可能已经空了，靠这早退就永远走不到结束判定。
  if (!GS.foes.length) {
    if (!FOES.pending) {
      FOES.active = false;
      if (typeof CLOCK !== 'undefined') CLOCK.onCleared();
    }
    return;                                // 队列还有：等下一只放出来再演
  }
  var core = GS.core;
  for (var i = GS.foes.length - 1; i >= 0; i--) {
    var f = GS.foes[i];
    if (f.hitFlash > 0) f.hitFlash -= dt;
    // 车厢特效状态衰减（v1.4，规格 §14.2）：slow 计时 / burn·poison 计时并扣血。
    //   DOT 在这里结算（engine.trainCombat 只负责"命中时挂状态"），死亡仍走下方清尸。
    if (f.slow > 0) f.slow -= dt;
    if (f.burn > 0) { f.burn -= dt; f.hp -= 3 * dt; }
    if (f.poison > 0) { f.poison -= dt; f.hp -= 2 * dt; }
    // 塔的伤害结算后 hp<=0 → 死亡移除（塔/车头模块只扣血不删怪，尸体在这里清）
    if (f.hp <= 0) { GS.foes.splice(i, 1); continue; }
    var dx = core.c - f.c, dy = core.r - f.r;
    var dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > FOES.CFG.REACH) {
      // 直线冲：无视地形（拍板 ②），不做任何 grid 查询。
      //   冰车厢减速（v1.4）：状态存活期间移速 ×0.7（-30%）
      var spd = f.speed * (f.slow > 0 ? 0.7 : 1);
      f.c += dx / dist * spd * dt;
      f.r += dy / dist * spd * dt;
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
};

// ---- 重开清场（ENG.init / 失败重开时调）--------------------------------------
FOES.reset = function () {
  GS.foes = [];
  FOES.wave = 0;
  FOES.active = false;
  FOES.pending = 0;                     // v1.4.13：队列一并清
  FOES.spawnCd = 0;
  if (typeof CLOCK !== 'undefined') CLOCK.hasFoes = false;
};
