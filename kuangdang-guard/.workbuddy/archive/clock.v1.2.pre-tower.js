// ============================================================================
// 昼夜模块（v0.9.2）—— 规则 4/5 的时间轴
//
// 三个相位（大王 2026-09-26 定案的流程）：
//   'day'   白天：列车停在站台（engine.js 的 parkAtStation 对齐），可施工/重抽。
//           UI 点「发车」→ startNight()。
//   'night' 夜晚：倒计时 CFG.NIGHT_SEC 秒，列车沿环行驶、拾取的金币堆在车斗。
//           · 倒计时内怪物清空（onCleared）→ 立刻收尾（toDusk）：跑完当前这圈就停。
//           · 倒计时走完：
//               - 还有怪物（hasFoes）→ overtime，继续跑，等清空；
//               - 没有怪物 → 直接收尾（toDusk）。
//   'dusk'  收尾：列车继续跑，**到站即停**（engine.js 到站判定 → finishNight →
//           CLOCK.notifyStation()）→ 交付金币、回到 'day'。
//
// 关键化简：大王描述的两个分支（倒计时中清空 → 跑完当前圈停站台；倒计时后清空 →
//   遇到站台即停）收敛成**同一个状态 'dusk'** —— 因为"一圈"本来就从站台数到站台，
//   所以"跑完当前这圈"与"遇到站台即停"是同一件事，不需要额外区分。
//
// ⚠️ 怪物是桩：hasFoes 目前恒为 false（本步骤"先不做怪物，先完成流程"）。
//   接入怪物模块时只需在怪物生成/死亡时维护 CLOCK.hasFoes，再在清空时调 CLOCK.onCleared()。
//
// 本模块只依赖自身状态 + CFG，不依赖 GS/ENG/TRANS，可独立替换（例如改成昼夜各 30s）。
// ============================================================================
window.CLOCK = {};

CLOCK.CFG = {
  NIGHT_SEC: 20,        // 夜晚倒计时秒数
  OVERLAY_ALPHA: 0.42   // 夜晚遮罩不透明度（0 = 不遮罩）
};

CLOCK.phase = 'day';      // 'day' | 'night' | 'dusk'
CLOCK.remain = 0;         // 夜晚剩余秒数（night 相位有意义）
CLOCK.overtime = false;   // 倒计时已走完但怪物还没清空 → 继续跑
CLOCK.hasFoes = false;    // ⚠️ 怪物桩（见文件头）

CLOCK.isDay = function () { return CLOCK.phase === 'day'; };
CLOCK.isNight = function () { return CLOCK.phase === 'night'; };
CLOCK.isDusk = function () { return CLOCK.phase === 'dusk'; };
// 列车该不该跑：除白天外都在跑（night 倒计时 + dusk 收尾）
CLOCK.isRunning = function () { return CLOCK.phase !== 'day'; };

CLOCK.reset = function () {
  CLOCK.phase = 'day';
  CLOCK.remain = 0;
  CLOCK.overtime = false;
  CLOCK.hasFoes = false;
};

// 白天 → 夜晚（点「发车」时调用）
CLOCK.startNight = function () {
  CLOCK.phase = 'night';
  CLOCK.remain = CLOCK.CFG.NIGHT_SEC;
  CLOCK.overtime = false;
  return true;
};

// → 收尾相位（跑完当前这圈就停）
CLOCK.toDusk = function () {
  CLOCK.phase = 'dusk';
  CLOCK.remain = 0;
  CLOCK.overtime = false;
};

CLOCK.tick = function (dt) {
  if (CLOCK.phase !== 'night' || CLOCK.overtime) return;
  CLOCK.remain -= dt;
  if (CLOCK.remain > 0) return;
  CLOCK.remain = 0;
  if (CLOCK.hasFoes) CLOCK.overtime = true;   // 还有怪物 → 继续跑，等清空
  else CLOCK.toDusk();
};

// 怪物清空钩子：倒计时内清空 → 立刻收尾；超时等清空 → 这时才收尾
CLOCK.onCleared = function () {
  CLOCK.hasFoes = false;
  if (CLOCK.phase === 'night') CLOCK.toDusk();
};

// 列车到站钩子：收尾相位到站 = 这一夜结束 → 回到白天。返回是否真的换相位。
CLOCK.notifyStation = function () {
  if (CLOCK.phase !== 'dusk') return false;
  CLOCK.phase = 'day';
  CLOCK.remain = 0;
  CLOCK.overtime = false;
  return true;
};

// 夜晚遮罩不透明度（renderer.js 用）
CLOCK.darkness = function () {
  return CLOCK.phase === 'day' ? 0 : CLOCK.CFG.OVERLAY_ALPHA;
};

// 状态文案（UI 用）
CLOCK.label = function () {
  if (CLOCK.phase === 'day') return '发车';
  if (CLOCK.phase === 'dusk') return '收车中';
  if (CLOCK.overtime) return '夜·等清场';
  return '夜晚 ' + Math.ceil(CLOCK.remain) + 's';
};