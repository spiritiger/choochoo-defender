// ============================================================================
// 怪物模块（v1.3-rc 临时迭代）—— 近战 · 无视地形直线冲 · 波次制
//
// 大王拍板（2026-09-28，规格 §13）：
//   · 近战怪**无视地形直线冲**向镇中心（不走铁轨），贴近后近战攻击镇中心；
//   · **一波 = 一个夜晚**：「发车」= 开波（白天施工 → 夜晚刷怪 + 列车照常跑圈）；
//   · 杀完所有怪进入下一波（触发 CLOCK.onCleared → dusk 收尾 → 白天）；
//   · 镇中心血量跨波**继承不重置**；归零 = 挑战失败（GS.gameOver + 重开）。
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
  speed: function (w) { return Math.min(0.7, 0.35 + 0.025 * w); } // 格/秒（原速一半）
};

FOES.wave = 0;        // 已完成的波次号（startWave 后 = 当前正在打的波）
FOES.active = false;  // 本波是否进行中（防止 dusk/白天残留怪被误判）

// ---- 开波（一波 = 一个夜晚；ENG.startNight 调）-------------------------------
// 在地图**四边外圈**随机刷怪（从场外进场，往里走）。数量/血量/速度按 wave 成长。
FOES.startWave = function () {
  FOES.wave += 1;
  FOES.active = true;
  var n = FOES.CFG.count(FOES.wave);
  var hp = FOES.CFG.hp(FOES.wave);
  var sp = FOES.CFG.speed(FOES.wave);
  for (var i = 0; i < n; i++) {
    // 四边等概率：0=上 1=下 2=左 3=右；沿边均匀取点（含角），出生在地图外 0.5 格
    var side = Math.floor(Math.random() * 4);
    var t = Math.random() * (side < 2 ? CFG.MAP_COLS : CFG.MAP_ROWS);
    var f;
    if (side === 0) f = { c: t, r: -0.5 };
    else if (side === 1) f = { c: t, r: CFG.MAP_ROWS - 0.5 };
    else if (side === 2) f = { c: -0.5, r: t };
    else f = { c: CFG.MAP_COLS - 0.5, r: t };
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
        if (GS.coreHP <= 0) {
          GS.coreHP = 0;
          GS.gameOver = true;                  // 挑战失败（规格 §13.1 第 5 条）
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
