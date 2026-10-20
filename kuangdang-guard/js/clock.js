// ============================================================================
// 阶段模块（v0.9.2 昼夜；v1.3.4 起昼夜概念退役）—— 建造 / 防守 / 收尾 三相位
//
// v1.3.4（2026-09-29 大王拍板）："把入夜后的遮罩取消掉，不再有日夜交替了，
//   现在只有建造阶段和防守阶段概念，这样好看一点" ——
//   · **遮罩已删**（原 CLOCK.darkness / OVERLAY_ALPHA，连同 renderer 的绘制块），
//     防守阶段与建造阶段画面亮度一致，阶段区分只靠开波按钮文案与状态栏；
//   · **概念改名**：原"白天"= **建造阶段**（唯一可施工相位），原"夜晚"= **防守阶段**
//     （开波触发：刷怪 + 列车跑圈 + 倒计时），dusk = **收尾**（秒级过渡）。
//   · **只改概念与文案，不动状态机骨架**：内部键名 'day'/'night'/'dusk' 与函数名
//     isDay/isNight/startNight 全部沿用（历史口径 + 测试兼容；同 v1.3-rc
//     "发车→开波"只换按钮文案的先例）。
//
// 三个相位的流程（状态机本身与 v0.9.2 完全一致）：
//   'day'   建造：列车停在站台（engine.js 的 parkAtStation 对齐），可施工/重抽。
//           UI 点「开波」→ startNight()。
//   'night' 防守：倒计时 CFG.NIGHT_SEC 秒，列车沿环行驶、拾取的金币堆在车斗。
//           · 倒计时内怪物清空（onCleared）→ v1.6.19 奖励时间：留在 night 继续跑圈
//             不停靠（到站照常交付），剩余倒计时走完 → toDusk；
//           · 倒计时走完：
//               - 还有怪物（hasFoes）→ overtime，继续跑，等清空（清空 → toDusk）；
//               - 没有怪物 → 直接收尾（toDusk）。
//   'dusk'  收尾：列车继续跑，**到站即停**（engine.js 到站判定 → finishNight →
//           CLOCK.notifyStation()）→ 交付金币、回到 'day'（下一轮建造）。
//
// 关键化简：大王描述的两个分支（倒计时中清空 → 跑完当前圈停站台；倒计时后清空 →
//   遇到站台即停）收敛成**同一个状态 'dusk'** —— 因为"一圈"本来就从站台数到站台，
//   所以"跑完当前这圈"与"遇到站台即停"是同一件事，不需要额外区分。
//
// 本模块只依赖自身状态 + CFG，不依赖 GS/ENG/TRANS，可独立替换（例如改防守时长）。
// ============================================================================
window.CLOCK = {};

CLOCK.CFG = {
  NIGHT_SEC: 40,        // 防守阶段倒计时秒数（v1.6.21 大王令 30→40：奖励时间机制下清场越早跑得越久）
  REWARD_HINT: '奖励时间' // 状态栏文案（label 用）
};

CLOCK.phase = 'day';      // 'day' 建造 | 'night' 防守 | 'dusk' 收尾（键名沿用历史口径）
CLOCK.remain = 0;         // 防守阶段剩余秒数（night 相位有意义）
CLOCK.overtime = false;   // 倒计时已走完但怪物还没清空 → 继续跑
CLOCK.reward = false;     // v1.6.19 奖励时间：倒计时内清空怪物 → 剩余倒计时继续跑圈不停靠
CLOCK.hasFoes = false;    // 场上是否有活怪（foes.js 维护）

// ---- 全局倍速（v1.6.2 大王令：循环按钮；v1.8u 五令：干掉 ×3，只保留 ×1/×2）----
// main.js 把帧 dt 乘上 timeScale 后再喂给 ENG.update，游戏整体（倒计时/刷怪/列车/
// 攻击冷却）等比加速。档位循环 1→2→1；档位记在 sessionStorage —— 关掉网页
// 才重置回 1，同一会话内刷新/开新局都保持（大王口径："除非重新打开网页才重置"）。
// 旧会话存过 3 的，恢复守卫（indexOf 表内校验）拒绝、回落 ×1。
CLOCK.timeScale = 1;
CLOCK.SPEEDS = [1, 2];

CLOCK.speedInit = function () {
  try {
    var s = (typeof sessionStorage !== 'undefined') ? sessionStorage.getItem('kdgSpeed') : null;
    if (s && CLOCK.SPEEDS.indexOf(+s) >= 0) CLOCK.timeScale = +s;
  } catch (e) { /* 隐私模式等取不到就算了，用默认 1 */ }
};

CLOCK.cycleSpeed = function () {
  var i = CLOCK.SPEEDS.indexOf(CLOCK.timeScale);
  CLOCK.timeScale = CLOCK.SPEEDS[(i + 1) % CLOCK.SPEEDS.length];
  try {
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem('kdgSpeed', String(CLOCK.timeScale));
  } catch (e) { /* 同上，存储失败不影响功能 */ }
  return CLOCK.timeScale;
};

CLOCK.isDay = function () { return CLOCK.phase === 'day'; };
CLOCK.isNight = function () { return CLOCK.phase === 'night'; };
CLOCK.isDusk = function () { return CLOCK.phase === 'dusk'; };
// 列车该不该跑：除建造阶段外都在跑（night 倒计时 + dusk 收尾）
CLOCK.isRunning = function () { return CLOCK.phase !== 'day'; };

CLOCK.reset = function () {
  CLOCK.phase = 'day';
  CLOCK.remain = 0;
  CLOCK.overtime = false;
  CLOCK.reward = false;
  CLOCK.hasFoes = false;
};

// 建造 → 防守（点「开波」时调用；函数名沿用历史口径）
CLOCK.startNight = function () {
  CLOCK.phase = 'night';
  CLOCK.remain = CLOCK.CFG.NIGHT_SEC;
  CLOCK.overtime = false;
  CLOCK.reward = false;
  return true;
};

// → 收尾相位（跑完当前这圈就停）
CLOCK.toDusk = function () {
  CLOCK.phase = 'dusk';
  CLOCK.remain = 0;
  CLOCK.overtime = false;
  CLOCK.reward = false;
};

CLOCK.tick = function (dt) {
  if (CLOCK.phase !== 'night' || CLOCK.overtime) return;
  CLOCK.remain -= dt;
  if (CLOCK.remain > 0) return;
  CLOCK.remain = 0;
  if (CLOCK.hasFoes) CLOCK.overtime = true;   // 还有怪物 → 继续跑，等清空
  else CLOCK.toDusk();
};

// 怪物清空钩子（v1.6.19 奖励时间）：
//   · 倒计时内清空 → **进入奖励时间**：留在 night 相位继续倒计时，列车继续跑圈
//     不停靠（到站照常交付、不停车），直到倒计时走完 → toDusk → 下一圈到站停。
//     奖励时长 = 剩余倒计时（清得越快跑得越久）。
//   · overtime（倒计时走完才清空）→ 维持旧口径：此刻收尾到站即停。
CLOCK.onCleared = function () {
  CLOCK.hasFoes = false;
  if (CLOCK.phase === 'night') {
    if (CLOCK.overtime) CLOCK.toDusk();
    else CLOCK.reward = true;
  }
};

// 列车到站钩子：收尾相位到站 = 这一夜结束 → 回到白天。返回是否真的换相位。
CLOCK.notifyStation = function () {
  if (CLOCK.phase !== 'dusk') return false;
  CLOCK.phase = 'day';
  CLOCK.remain = 0;
  CLOCK.overtime = false;
  // 行为记录（v1.3.5 经济类）：防守结束（与 waveStart 的时间差 = 波时长）
  if (typeof LOG !== 'undefined') LOG.add('waveEnd',
    { wave: (typeof FOES !== 'undefined') ? FOES.wave : 0 });
  // 关卡模式胜利钩子（v1.7.0 §14.62 大王令"波次有限"）：清完第 LEVEL_WAVES 波
  //   收车回白天 = 通关。随机模式（mode!=='level'）一字不进。通关旗与 gameOver
  //   同闸锁操作（ui.js），进度解锁 + 记录在此落账。
  if (GS.mode === 'level' && !GS.gameOver && !GS.levelDone &&
      typeof FOES !== 'undefined' &&
      FOES.wave >= (typeof LEVEL_WAVES !== 'undefined' ? LEVEL_WAVES : 10) &&
      typeof GS.levelUnlock === 'function') {
    GS.levelDone = true;
    GS.levelUnlock(GS.levelIdx);
    if (typeof LOG !== 'undefined') LOG.add('levelClear', { idx: GS.levelIdx });
  }
  return true;
};

// 状态文案（UI 用）。v1.3.4 概念改名：白天→建造，夜晚→防守；
//   文案带波次号（FOES.wave，typeof 守卫——test 沙箱可能只载 clock 不载 foes）
CLOCK.label = function () {
  var w = (typeof FOES !== 'undefined' && FOES.wave > 0) ? ('第' + FOES.wave + '波 ') : '';
  if (CLOCK.phase === 'day') return '开波';
  if (CLOCK.phase === 'dusk') return '收车中';
  if (CLOCK.reward) return w + '·奖励时间 ' + Math.ceil(CLOCK.remain) + 's';
  if (CLOCK.overtime) return w + '·等清场';
  return w + '防守 ' + Math.ceil(CLOCK.remain) + 's';
};