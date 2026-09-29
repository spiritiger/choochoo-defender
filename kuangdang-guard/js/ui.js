// UI：HUD、【清理】/【抽塔】双按钮、Canvas 拖动手势（拖塔合成 / 拖形状清理）
// v1.3-rc 塔防迭代：三选一牌组退役（GS.buildOffer/nextOffer 在 state.js 冻结保留），
//   施工手势从"点卡→点格子"改为"按住拖动"。
window.UI = {};

UI.init = function (canvas) {
  UI.canvas = canvas;
  UI.gold = document.getElementById('hudGold');
  UI.cargo = document.getElementById('hudCargo');
  UI.core = document.getElementById('hudCore');
  UI.wave = document.getElementById('hudWave');
  UI.btnSummon = document.getElementById('btnSummon');
  UI.btnClean = document.getElementById('btnClean');
  UI.btnDepart = document.getElementById('btnDepart');
  UI.status = document.getElementById('status');
  UI.overOverlay = document.getElementById('overOverlay');
  UI.overWave = document.getElementById('overWave');
  UI.btnRestart = document.getElementById('btnRestart');
  UI.move = null;        // 悬停格（鼠标）
  UI.drag = null;        // 拖动状态 {kind:'tower',tower,px,py} | {kind:'clean',shape,px,py}
  UI._sig = '';

  // Pointer 事件统一鼠标/触摸（旧版 click+mousemove 无法拖动）。canvas 已设
  //   touch-action:none（css），移动端按住拖动不会触发页面滚动。
  canvas.addEventListener('pointerdown', UI.onDown);
  canvas.addEventListener('pointermove', UI.onMove);
  canvas.addEventListener('pointerup', UI.onUp);
  canvas.addEventListener('pointercancel', UI.onCancel);
  UI.btnClean.addEventListener('pointerdown', UI.onCleanDown);
  UI.btnSummon.addEventListener('click', UI.onSummon);
  if (UI.btnDepart) UI.btnDepart.addEventListener('click', UI.onDepart);
  UI.btnExport = document.getElementById('btnExport');
  if (UI.btnExport) UI.btnExport.addEventListener('click', UI.onExport);
  UI.btnForce = document.getElementById('btnForce');
  if (UI.btnForce) UI.btnForce.addEventListener('click', UI.onForceRefresh);
  UI.btnRestart.addEventListener('click', UI.onRestart);
};

// 可以施工/拖动吗：白天 且 没有失败（v1.3-rc 加 gameOver 闸）
UI.isDay = function () {
  if (GS.gameOver) return false;
  return typeof CLOCK === 'undefined' || CLOCK.isDay();
};

// ---- 指针坐标换算 -------------------------------------------------------------
// 返回画布内像素坐标 {mx,my}（与 cellFromEvent 同一套缩放换算），出画布返回 null。
UI.pointFromEvent = function (e) {
  var fieldH = CFG.fieldH();
  var rect = UI.canvas.getBoundingClientRect();
  var mx = (e.clientX - rect.left) * (CFG.CANVAS_W / rect.width);
  var my = (e.clientY - rect.top) * (fieldH / rect.height);
  if (mx < 0 || mx > CFG.CANVAS_W || my < 0 || my > fieldH) return null;
  return { mx: mx, my: my };
};
UI.cellFromEvent = function (e) {
  var p = UI.pointFromEvent(e);
  if (!p) return null;
  return CFG.pickCell(LAY, p.mx, p.my);
};

// ---- 按下：塔上按下 = 开始拖塔 -------------------------------------------------
UI.onDown = function (e) {
  if (!UI.isDay()) return;
  var cell = UI.cellFromEvent(e);
  if (!cell) return;
  var b = GS.grid[cell.r][cell.c].b;
  if (!b || b.type !== 'tower') return;
  // setPointerCapture：按住拖出画布也能收到 move/up（否则拖快了会"甩丢"指针）
  try { UI.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  var p = UI.pointFromEvent(e);
  UI.drag = { kind: 'tower', tower: b, px: p.mx, py: p.my };
  UI.setStatus('');
};

// ---- 移动：更新拖动幽灵位置 / 悬停格 --------------------------------------------
UI.onMove = function (e) {
  var cell = UI.cellFromEvent(e);
  UI.move = (!UI.drag && cell) ? cell : null;
  if (UI.drag) {
    var p = UI.pointFromEvent(e);
    if (p) { UI.drag.px = p.mx; UI.drag.py = p.my; }
  }
};

// ---- 抬起：结算拖动 -------------------------------------------------------------
UI.onUp = function (e) {
  if (!UI.drag) return;
  var drag = UI.drag;
  UI.drag = null;
  var cell = UI.cellFromEvent(e);
  if (drag.kind === 'tower') {
    // 拖塔合成：释放在同类同星塔上 → 合成；否则弹回（不扣任何东西）
    if (!cell) return;                                   // 拖出画布 = 弹回
    var dst = GS.grid[cell.r][cell.c].b;
    if (TOWERS.canMerge(drag.tower, dst)) {
      var res = TOWERS.merge(drag.tower, dst);
      UI.setStatus(res === true ? '合成成功！' : res);
    } else if (dst && dst.type === 'tower' && dst !== drag.tower) {
      UI.setStatus('需要同类同星的塔才能合成');
    }
  } else if (drag.kind === 'clean') {
    // 拖形状清理：合法性走 applyShape（相接≥1 或压内区，与 v1.2 完全同口径）
    if (!cell) { UI.setStatus('形状作废'); return; }
    var res2 = ENG.applyShape(cell.c, cell.r, drag.shape.cells);
    UI.setStatus(res2 === true ? '已清理' : res2);
    // 失败也作废（按钮每次按下都是付费抽新形状 —— 规格 §13.1 第 8 条口径）
  }
};

UI.onCancel = function () { UI.drag = null; };   // 指针被打断（来电等）= 弹回，不结算

// ---- 【抽塔】按钮 ----------------------------------------------------------------
UI.onSummon = function () {
  if (!UI.isDay()) { UI.setStatus(GS.gameOver ? '挑战已失败' : '夜晚施工暂停，等列车回到站台'); return; }
  var res = TOWERS.summon();
  UI.setStatus(res === true ? '召唤了一座 1 星塔' : res);
};

// ---- 【清理】按钮：每次按下 = 付费抽新形状 + 立即进入拖动（规格 §13.1 第 8 条）----
// ⚠️ 反馈断层修复（2026-09-29 大王报"形状没出来"）：旧版按下后 px=-1（画布外），
//   renderer 的 drag.px>=0 条件不画幽灵 → 按住按钮期间画布零反馈，"点一下"更是
//   金币白扣+作废全程无提示。现改为：抽到形状**立即显示在画布左上角**，状态栏报
//   形状名与玩法；指针出画布时幽灵钳在边缘跟着走（松手位置照旧须在画布内才结算）。
UI.onCleanDown = function (e) {
  if (!UI.isDay()) { UI.setStatus(GS.gameOver ? '挑战已失败' : '夜晚施工暂停，等列车回到站台'); return; }
  if (GS.gold < 10) { UI.setStatus('金币不足（需 10）'); return; }
  GS.gold -= 10;
  UI.cleanShape = CFG.randomShape();       // { name, cells }（矩形 4/6/8 三档，与 v1.2 同池）
  // 初始位置放地图区内第一格中央（⚠️ 必须落在 LAY 地图区内：renderer 用
  //   CFG.pickCell(LAY,…) 换算，画布左上角 (0,0) 在地图区外会换算成 null 不画）
  UI.drag = { kind: 'clean', shape: UI.cleanShape, px: LAY.x + LAY.cell / 2, py: LAY.y + LAY.cell / 2 };
  UI.setStatus('已抽 ' + UI.cleanShape.name + '，按住拖到场上松手清理');
  try { UI.btnClean.setPointerCapture(e.pointerId); } catch (err) {}
  // 按钮上按下后拖到画布 —— pointermove/up 都挂在 canvas 上收不到！
  // 所以这里把后续事件转嫁：给 document 挂一次性 up/move 由 UI 结算（见下）。
  var mv = function (ev) {
    var p = UI.pointFromEvent(ev);
    if (p) { UI.drag.px = p.mx; UI.drag.py = p.my; }
    else {
      // 出画布：幽灵**钳到地图区边缘**跟着指针走（保持"形状在手"的视觉）；
      //   松手结算仍以"是否在画布内"为准（见 up），贴边不等于可放置。
      var rect = UI.canvas.getBoundingClientRect();
      var rawX = (ev.clientX - rect.left) * (CFG.CANVAS_W / rect.width);
      var rawY = (ev.clientY - rect.top) * (CFG.fieldH() / rect.height);
      UI.drag.px = Math.max(LAY.x, Math.min(LAY.x + LAY.w - 1, rawX));
      UI.drag.py = Math.max(LAY.y, Math.min(LAY.y + LAY.h - 1, rawY));
    }
  };
  var up = function (ev) {
    document.removeEventListener('pointermove', mv);
    document.removeEventListener('pointerup', up);
    // 抬起位置换算成画布坐标再结算（复用 onUp 的 clean 分支逻辑）
    var drag = UI.drag;
    UI.drag = null;
    if (!drag || drag.kind !== 'clean') return;
    var p = UI.pointFromEvent(ev);
    if (!p) { UI.setStatus('形状作废'); return; }
    var cell = CFG.pickCell(LAY, p.mx, p.my);
    if (!cell) { UI.setStatus('形状作废'); return; }
    var res = ENG.applyShape(cell.c, cell.r, drag.shape.cells);
    UI.setStatus(res === true ? '已清理' : res);
  };
  document.addEventListener('pointermove', mv);
  document.addEventListener('pointerup', up);
};

// ---- 开波（原「发车」）-----------------------------------------------------------
UI.onDepart = function () {
  if (typeof CLOCK === 'undefined') return;
  if (!CLOCK.isDay() || GS.gameOver) return;
  if (!ENG.startNight()) { UI.setStatus('还没有成环的铁轨，发不了车'); return; }
  UI.setStatus('怪物来袭！'); 
};

// ---- 失败重开 ---------------------------------------------------------------------
UI.onRestart = function () {
  ENG.restart();
  UI.overOverlay.classList.add('hidden');
  UI.setStatus('新的挑战开始');
};

UI.setStatus = function (s) { UI.status.textContent = s; };

// 缩放适配（v1.3-rc 修复：重写 ui.js 时丢失，main.js 首帧前调它抛 TypeError，
//   主循环根本没启动 → 画布全空）。等比缩放 #app 贴合窗口。
UI.resize = function () {
  var s = Math.min(window.innerWidth / CFG.CANVAS_W, window.innerHeight / CFG.CANVAS_H);
  document.getElementById('app').style.transform = 'scale(' + s + ')';
};

// ---- 调试导出：把当前盘面序列化成可直接重放的文本，复制到剪贴板 ----
// 格式与 test_rail.js 的 setupFromRows 同源：
//   '#'=废墟 '.'=空地 'C'=镇中心 'E'=经济建筑 'G'=金币地块 'T'=塔(导出图例里只记"有塔")
// 附加 rail / train / gold 三行，供还原铁轨与列车状态。
// ▍rail(N) 里的 N 是「步数」不是「格数」（v0.6.18 明确标注）
//   N = GS.railPath 的**序列长度** = 列车沿环走一圈经过的步数（含重复经过的格）。
UI.exportMap = function () {
  var rows = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var s = '';
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var cell = GS.grid[r][c];
      var ch = '.';
      if (cell.t === 'rubble') ch = '#';
      if (cell.b) ch = (cell.b.type === 'core') ? 'C' : (cell.b.type === 'tower' ? 'T' : 'E');
      // v0.6.12：金币格初始埋在废墟里（t='rubble'）→ 小写 g；清出来后才大写 G。
      else if (cell.gold) ch = (cell.t === 'rubble') ? 'g' : 'G';
      s += ch;
    }
    rows.push(s);
  }
  var rail = GS.railPath || [];
  var lines = ['KDG-MAP v1 ' + new Date().toISOString()];
  lines.push('图例: #废墟 .空地 C镇中心 E经济建筑 T塔 G金币地块(已清出) g金币地块(仍在废墟中)');
  Array.prototype.push.apply(lines, rows);
  // rail(N) 的 N = 步数（序列长度），不是去重格数 —— 见函数头说明
  lines.push('rail(' + rail.length + '): ' + rail.map(function (p) { return p.c + ',' + p.r; }).join(' '));
  lines.push('train: ' + (GS.train ? GS.train.index + ',' + GS.train.frac.toFixed(2) : '-'));
  // v0.9.2：站台与车斗（站台是叠加的轨格，不改变上面的 grid 图例）
  if (typeof STATION !== 'undefined') {
    var st = STATION.slot();
    lines.push('station: ' + (st ? st.c + ',' + st.r + '@' + st.index : '-'));
  }
  lines.push('cargo: ' + (GS.train ? Math.floor(GS.train.cargo) : 0));
  lines.push('gold: ' + Math.floor(GS.gold));
  // v1.3-rc：塔明细 / 怪残量 / 核心血量 / 波次 —— 报 bug 直接贴这些
  lines.push('towers: ' + GS.towers.map(function (t) { return t.c + ',' + t.r + ':' + t.elem + t.star; }).join(' '));
  lines.push('foes: ' + GS.foes.length + ' wave: ' + FOES.wave + ' coreHP: ' + GS.coreHP + '/' + GS.coreMaxHP);
  return lines.join('\n');
};

UI.onExport = function () {
  var text = UI.exportMap();
  var finish = function (ok) {
    UI.setStatus(ok ? '已复制地图数据，直接粘贴发给对方即可'
                    : '自动复制失败，请在弹窗里手动复制');
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function () { finish(true); },
                                             function () { UI.copyFallback(text, finish); });
  } else {
    UI.copyFallback(text, finish);
  }
};

// 剪贴板 API 在 file:// 等非安全环境可能不可用：退回 execCommand，再不行用弹窗手动复制
UI.copyFallback = function (text, finish) {
  var ok = false;
  try {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    ok = document.execCommand('copy');
    document.body.removeChild(ta);
  } catch (e) { ok = false; }
  if (ok) finish(true);
  else window.prompt('请全选复制下面的地图数据：', text);
};

// ---- 强制刷新铁轨（v0.9.0，临时救急）----------------------------------------
// 背景：求解器有三处时间闸（①700 / ②250 / ⑤150ms）。极端盘面在闸内搜不出
//   "覆盖全部轮廓格"的环，于是沿用上一帧的旧环。本按钮把时间闸一次性放开。
// ⚠️ 求解是同步单线程的：点下去界面会卡住（实测极端盘几十秒），先渲染提示再开跑。
UI.railCov = function () {
  var B = GS.contourB;
  if (!B || !GS.railPath.length) return '0/0';
  var tot = 0, i;
  for (i = 0; i < B.length; i++) if (B[i]) tot++;
  var seen = {}, cov = 0;
  for (i = 0; i < GS.railPath.length; i++) {
    var p = GS.railPath[i], k = p.c + ',' + p.r;
    if (seen[k]) continue;
    seen[k] = 1;
    if (B[p.r * CFG.MAP_COLS + p.c]) cov++;
  }
  return cov + '/' + tot;
};

UI.onForceRefresh = function () {
  if (UI._forcing) return;                       // 防连点：同步求解期间按钮本来也点不动
  UI._forcing = true;
  var before = UI.railCov();
  UI.setStatus('强制刷新中…（已放开时间预算，界面会暂时卡住）');
  // 让上面这句提示先渲染出去，再开始同步求解（否则整段是直接卡死，看不出在算）
  setTimeout(function () {
    var t = Date.now();
    GS.forceRefresh = true;
    try { GS.recomputeRails(); }
    finally { GS.forceRefresh = false; UI._forcing = false; }
    UI.setStatus('强制刷新完成：轮廓覆盖 ' + before + ' → ' + UI.railCov() +
                 '，耗时 ' + ((Date.now() - t) / 1000).toFixed(1) + 's');
  }, 30);
};

UI.tick = function () {
  var day = UI.isDay();
  UI.gold.textContent = Math.floor(GS.gold);
  if (UI.cargo) UI.cargo.textContent = Math.floor(GS.train.cargo);
  // 城墙血量（低血变红）与波次
  if (UI.core) {
    UI.core.textContent = Math.max(0, Math.ceil(GS.coreHP));
    UI.core.style.color = GS.coreHP <= GS.coreMaxHP * 0.3 ? '#e8563f' : '';
  }
  if (UI.wave) UI.wave.textContent = FOES.wave > 0 ? FOES.wave : '-';
  UI.btnSummon.disabled = !day || GS.gold < TOWERS.CFG.COST;
  UI.btnClean.disabled = !day || GS.gold < 10;
  // 开波按钮：白天「开波」，夜里显示倒计时 / 波次；非白天一律不可点
  if (UI.btnDepart) {
    UI.btnDepart.disabled = !day;
    UI.btnDepart.textContent = day ? '开波'
      : (typeof CLOCK !== 'undefined' ? CLOCK.label() : '开波');
  }
  // 失败遮罩（GS.gameOver 由 foes.js 置位）
  if (GS.gameOver && UI.overOverlay.classList.contains('hidden')) {
    UI.overWave.textContent = '坚守波次：' + FOES.wave;
    UI.overOverlay.classList.remove('hidden');
  }
};
