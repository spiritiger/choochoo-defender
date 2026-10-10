// UI：HUD、开波/抽卡按钮、底部牌库、Canvas 拖动手势（拖塔合成 / 拖卡使用）
// v1.4 卡牌大改（规格 §14）：清理按钮退役；抽卡 = 三选一弹层 → 选卡进牌库 →
//   从牌库拖到场上（形状卡清障碍 / 英雄卡建塔+加车厢）。旧 summon 随机落点冻结。
window.UI = {};

UI.init = function (canvas) {
  UI.canvas = canvas;
  UI.gold = document.getElementById('hudGold');
  // v1.4.7：HUD 车斗格子退役（hudCargo 删了）—— 车上浮字 +N 是车斗量的唯一显示，
  //   UI.cargo 缓存一并清掉；导出地图里的 cargo 行保留（调试对账用）。
  UI.core = document.getElementById('hudCore');
  UI.wave = document.getElementById('hudWave');
  UI.btnSummon = document.getElementById('btnSummon');
  UI.btnDepart = document.getElementById('btnDepart');
  UI.btnUndo = document.getElementById('btnUndo');   // v1.4.5：撤销最近一次形状卡清理
  UI.btnSpeed = document.getElementById('btnSpeed'); // v1.6.2：全局倍速 ×1/×2/×3 循环
  UI.status = document.getElementById('status');
  UI.overOverlay = document.getElementById('overOverlay');
  UI.overWave = document.getElementById('overWave');
  UI.btnRestart = document.getElementById('btnRestart');
  UI.deckRow = document.getElementById('deckRow');          // v1.4 底部牌库
  UI.offerOverlay = document.getElementById('offerOverlay'); // v1.4 三选一弹层
  UI.offerCards = document.getElementById('offerCards');
  UI.move = null;        // 悬停格（鼠标）
  UI.drag = null;        // {kind:'tower',tower,px,py} | {kind:'clean',shape,cardIdx,px,py}
                         // | {kind:'hero',elem,cardIdx,px,py}
  UI.trainSel = null;    // v1.6.13 长按的列车单元 {kind:'head'}|{kind:'wagon',i}，null=未按住

  // Pointer 事件统一鼠标/触摸（旧版 click+mousemove 无法拖动）。canvas 已设
  //   touch-action:none（css），移动端按住拖动不会触发页面滚动。
  canvas.addEventListener('pointerdown', UI.onDown);
  canvas.addEventListener('pointermove', UI.onMove);
  canvas.addEventListener('pointerup', UI.onUp);
  canvas.addEventListener('pointercancel', UI.onCancel);
  UI.btnSummon.addEventListener('click', UI.onSummon);
  if (UI.btnDepart) UI.btnDepart.addEventListener('click', UI.onDepart);
  if (UI.btnUndo) UI.btnUndo.addEventListener('click', UI.onUndo);
  if (UI.btnSpeed) {
    CLOCK.speedInit();                                 // 恢复会话内记住的档位（关网页才重置）
    UI.btnSpeed.textContent = '×' + CLOCK.timeScale;
    UI.btnSpeed.addEventListener('click', function () {
      UI.btnSpeed.textContent = '×' + CLOCK.cycleSpeed();
    });
  }
  UI.btnExport = document.getElementById('btnExport');
  if (UI.btnExport) UI.btnExport.addEventListener('click', UI.onExport);
  UI.btnLog = document.getElementById('btnLog');
  if (UI.btnLog) UI.btnLog.addEventListener('click', UI.onLogExport);
  UI.btnForce = document.getElementById('btnForce');
  if (UI.btnForce) UI.btnForce.addEventListener('click', UI.onForceRefresh);
  UI.btnRestart.addEventListener('click', UI.onRestart);
  UI.renderDeck();     // 开局画一次空牌库（此后由选卡/用卡/重开触发刷新）
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

// ---- 按下：车头/车厢 = 长按查射程；塔上按下 = 开始拖塔 -------------------------
// v1.6.13（大王令）：射程环显示从"点选切换"（v1.6.11）改为**长按显示** ——
//   按住车头/车厢期间画该节自己的射程环（UI.trainSel 按住态），**松手即消失**。
//   查射程是纯只读操作，白天夜晚都可用 —— 故判定放在 isDay 闸**之前**。
UI.onDown = function (e) {
  var p = UI.pointFromEvent(e);
  // —— 车头/车厢长按（优先于拖塔：车在轨上跑，从不与塔格手势冲突）——
  //   命中判据：按下点到单元中心距离 ≤0.55 格；车头与车厢中心距 GAP=1 格，
  //   0.55 半径略有重叠，取**最近**的一节即可（pickTrain 内做最小距离竞争）。
  if (p && typeof ENG !== 'undefined' && GS.railPath.length) {
    var hit = UI.pickTrain(p.mx, p.my);
    if (hit) {
      UI.trainSel = hit;   // 按住态：renderer 据此画环，pointerup/cancel 清除
      // setPointerCapture：按住期间指针拖出画布也能收到 up（否则松手在画布外会"卡住"显示）
      try { UI.canvas.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
    UI.trainSel = null;    // 按在空白/塔/地面 = 无按住态（拖塔手势照常继续）
  }
  if (!UI.isDay()) return;
  var cell = UI.cellFromEvent(e);
  if (!cell) return;
  var b = GS.grid[cell.r][cell.c].b;
  if (!b || b.type !== 'tower') return;
  // setPointerCapture：按住拖出画布也能收到 move/up（否则拖快了会"甩丢"指针）
  try { UI.canvas.setPointerCapture(e.pointerId); } catch (err) {}
  UI.drag = { kind: 'tower', tower: b, px: p.mx, py: p.my };
  UI.setStatus('');
};

// 点选列车单元：返回 {kind:'head'} | {kind:'wagon', i}（命中**最近**的一节）或 null。
//   车厢 = GS.towers 的运行时投影（规格 §14.2），第 i 节位置 ENG.wagonPos(i)（浮点格）。
//   车头像素位置直接用 ENG.trainPos()（与 renderer 画环同源，零漂移）。
//   v1.6.13 起用于**长按**判定（按住显示、松手消失），非点选切换。
UI.pickTrain = function (mx, my) {
  if (!GS.railPath.length) return null;
  var R = LAY.cell * 0.55, best = null, bestD = R * R;
  var hp = ENG.trainPos();
  var d = (mx - hp.x) * (mx - hp.x) + (my - hp.y) * (my - hp.y);
  if (d <= bestD) { best = { kind: 'head' }; bestD = d; }
  for (var i = 0; i < GS.towers.length; i++) {
    var wp = ENG.wagonPos(i);
    if (!wp) continue;
    var wx = CFG.ccx(LAY, wp.c), wy = CFG.ccy(LAY, wp.r);
    var d2 = (mx - wx) * (mx - wx) + (my - wy) * (my - wy);
    if (d2 <= bestD) { best = { kind: 'wagon', i: i }; bestD = d2; }
  }
  return best;
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

// ---- 抬起：结算拖动（⚠️ 只处理 canvas 上开始的拖塔合成；
//   牌库卡的拖拽在 pointerdown 时转嫁给 document，见 UI.startDeckDrag）----------
UI.onUp = function (e) {
  UI.trainSel = null;   // v1.6.13：长按查射程松手即消失（先于拖塔结算，两手势互不干扰）
  if (!UI.drag || UI.drag.kind !== 'tower') return;
  var drag = UI.drag;
  UI.drag = null;
  var cell = UI.cellFromEvent(e);
  // 拖塔合成：释放在同名同星塔上 → 合成（v1.4 产物元素继承）；否则弹回
  if (!cell) return;                                   // 拖出画布 = 弹回
  var dst = GS.grid[cell.r][cell.c].b;
  if (TOWERS.canMerge(drag.tower, dst)) {
    var res = TOWERS.merge(drag.tower, dst);
    UI.setStatus(res === true ? '合成成功！' : res);
  } else if (dst && dst.type === 'tower' && dst !== drag.tower) {
    UI.setStatus('需要同名同星的塔才能合成');
  }
};

UI.onCancel = function () { UI.drag = null; UI.trainSel = null; };   // 指针被打断（来电等）= 弹回/环消失，不结算

// ---- 【抽卡】按钮（v1.4）：扣费 → 三选一弹层 → 必须选一张进牌库 ----------
// v1.6.15：价格线性递增（GS.drawCost() = 10 + 10×已抽次数，大王令），10 → 20 → 30 → …
UI.onSummon = function () {
  var cost = GS.drawCost();
  if (!UI.isDay()) { UI.setStatus(GS.gameOver ? '挑战已失败' : '防守阶段施工暂停，等列车回到站台'); return; }
  if (GS.gold < cost) { UI.setStatus('金币不足（需 ' + cost + '）'); return; }
  GS.gold -= cost;
  GS.drawCount += 1;                       // 只在实际扣费时计数（放弃/选卡不退钱）
  if (typeof LOG !== 'undefined') LOG.add('drawPay', { cost: cost, count: GS.drawCount });
  UI.showOffer(GS.drawCardOffer());
};

// 三选一弹层：渲染三张卡，点一张 → 进牌库 → 关弹层
UI.showOffer = function (cards) {
  UI.offerCards.innerHTML = '';
  cards.forEach(function (card) {
    var el = document.createElement('div');
    el.className = 'oc';
    UI.fillCardDom(el, card, true);
    el.addEventListener('click', function () {
      GS.deck.push(card);
      if (typeof LOG !== 'undefined') LOG.add('pick', { kind: card.kind, name: UI.cardLabel(card) });
      UI.offerOverlay.classList.add('hidden');
      UI.renderDeck();
      UI.setStatus('已入牌库：' + UI.cardLabel(card));
    });
    UI.offerCards.appendChild(el);
  });
  UI.offerOverlay.classList.remove('hidden');
};

// 卡面文案（牌库/弹层共用）
UI.cardLabel = function (card) {
  if (card.kind === 'shape') return '形状 ' + card.name;
  if (card.kind === 'hero') return '英雄·' + card.elem;
  return '辅助';
};

// 往卡 DOM 里填内容。isOffer=true 时用弹层大卡类名（o-*），否则牌库小卡（p-*）
UI.fillCardDom = function (el, card, isOffer) {
  var pre = isOffer ? 'o' : 'p';
  if (card.kind === 'shape') {
    var kind1 = document.createElement('div'); kind1.className = pre + '-kind'; kind1.textContent = '形状卡';
    var main = document.createElement('div'); main.className = pre + '-name'; main.textContent = card.name;
    el.appendChild(kind1); el.appendChild(main);
    // mini 形状网格
    var w = 0, h = 0, i;
    for (i = 0; i < card.cells.length; i++) {
      if (card.cells[i][0] + 1 > w) w = card.cells[i][0] + 1;
      if (card.cells[i][1] + 1 > h) h = card.cells[i][1] + 1;
    }
    var grid = document.createElement('div');
    grid.className = pre + '-shape';
    grid.style.gridTemplateColumns = 'repeat(' + w + ', auto)';
    var map = {};
    for (i = 0; i < card.cells.length; i++) map[card.cells[i][0] + ',' + card.cells[i][1]] = 1;
    for (var r = 0; r < h; r++) for (var c = 0; c < w; c++) {
      var dot = document.createElement('i');
      if (!map[c + ',' + r]) dot.style.visibility = 'hidden';
      grid.appendChild(dot);
    }
    el.appendChild(grid);
  } else if (card.kind === 'hero') {
    var kind2 = document.createElement('div'); kind2.className = pre + '-kind'; kind2.textContent = '英雄卡';
    var main2 = document.createElement('div'); main2.className = pre + '-main';
    main2.textContent = card.elem;
    main2.style.color = REND.C.tower[card.elem] || '#888';
    var sub2 = document.createElement('div'); sub2.className = pre + '-sub'; sub2.textContent = '建造后 +1 车厢';
    el.appendChild(kind2); el.appendChild(main2); el.appendChild(sub2);
  } else {
    var kind3 = document.createElement('div'); kind3.className = pre + '-kind'; kind3.textContent = '辅助卡';
    el.appendChild(kind3);
  }
};

// ---- 底部牌库渲染：每张卡可拖到场上（形状=清理 / 英雄=建造）---------------------
UI.renderDeck = function () {
  UI.deckRow.innerHTML = '';
  if (!GS.deck.length) {
    var empty = document.createElement('div');
    empty.id = 'deckEmpty';
    empty.textContent = '牌库空 —— 点【抽卡】获得形状/英雄卡';
    UI.deckRow.appendChild(empty);
    return;
  }
  GS.deck.forEach(function (card, idx) {
    var el = document.createElement('div');
    el.className = 'pcard';
    UI.fillCardDom(el, card, false);
    el.addEventListener('pointerdown', function (e) { UI.startDeckDrag(e, idx); });
    UI.deckRow.appendChild(el);
  });
};

// 从牌库拖卡：pointerdown 在卡 DOM 上 → 后续 move/up 转嫁 document（画布收不到）
UI.startDeckDrag = function (e, idx) {
  if (!UI.isDay()) { UI.setStatus(GS.gameOver ? '挑战已失败' : '防守阶段施工暂停，等列车回到站台'); return; }
  var card = GS.deck[idx];
  if (!card) return;
  var drag = { cardIdx: idx, px: LAY.x + LAY.cell / 2, py: LAY.y + LAY.cell / 2 };
  if (card.kind === 'shape') drag.kind = 'clean', drag.shape = { name: card.name, cells: card.cells };
  else if (card.kind === 'hero') drag.kind = 'hero', drag.elem = card.elem;
  else return;                                          // 辅助卡本期不可用
  UI.drag = drag;
  UI.dragPreview = null;
  UI.setStatus(UI.cardLabel(card) + '：拖到场上松手');
  try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
  var mv = function (ev) {
    var p = UI.pointFromEvent(ev);
    if (p) { UI.drag.px = p.mx; UI.drag.py = p.my; }
    else {
      // 出画布：幽灵钳到地图区边缘（松手须在画布内才结算）
      var rect = UI.canvas.getBoundingClientRect();
      var rawX = (ev.clientX - rect.left) * (CFG.CANVAS_W / rect.width);
      var rawY = (ev.clientY - rect.top) * (CFG.fieldH() / rect.height);
      UI.drag.px = Math.max(LAY.x, Math.min(LAY.x + LAY.w - 1, rawX));
      UI.drag.py = Math.max(LAY.y, Math.min(LAY.y + LAY.h - 1, rawY));
    }
    UI.updateCleanPreview(drag);                        // v1.4.11：锚点变了才真算，格内抖动零开销
  };
  var up = function (ev) {
    document.removeEventListener('pointermove', mv);
    document.removeEventListener('pointerup', up);
    var drag = UI.drag;
    UI.drag = null;
    UI.dragPreview = null;                              // v1.4.11：预览环随拖拽结束消失
    if (!drag) return;
    var p = UI.pointFromEvent(ev);
    var cell = p ? CFG.pickCell(LAY, p.mx, p.my) : null;
    if (drag.kind === 'clean') UI.settleClean(drag, cell);
    else if (drag.kind === 'hero') UI.settleHero(drag, cell);
  };
  document.addEventListener('pointermove', mv);
  document.addEventListener('pointerup', up);
};

// v1.4.11 清理预览（大王拍板"先做了试试，体验差就干掉"）：拖形状卡时实时预测
//   "清完之后铁轨大概长什么样"。落点合法时把清理后重算出的环交给 renderer 画
//   金黄虚线（本层不碰渲染）；非法落点维持红框不画环。
//   ⚠️ v1.4.11 优化（大王问"能不能不全量重算"）——两层提速，行为零风险：
//   ① 求解快速档：置 GS.railFast=true，recomputeRails 只跑主解（90ms 墙钟），
//     跳过 ②枚举/⑤支线（占总耗时大头、采纳率本就 0~1%）。预览环 = 快速近似，
//     松手结算仍走全量求解，真实铁轨不受影响；
//   ② 还原不重算：recomputeRails 对 7 个派生字段（railPath/railSet/railRect/
//     railInner/contourB/railGrowHints/station）全部**整体替换、从不原地改**
//     （station 见 STATION.solve 的整体赋值），拖前按引用快照、拖后原样放回
//     = bit-exact 还原，省掉第二遍全量求解（原实现还原时还要再重算一遍）。
//   性能闸：只在锚点格变化时重算（同格内指针抖动零开销）；单次 >
//   UI.PREVIEW_MS(150ms) 的重盘自动降级——本拖拽剩余时间只显绿/红形状框。
UI.PREVIEW_MS = 150;
UI.dragPreview = null;          // { rail: [{c,r}...] } —— 仅拖形状卡且落点合法时有值
UI.updateCleanPreview = function (drag) {
  if (!drag || drag.kind !== 'clean') return;
  var cell = CFG.pickCell(LAY, drag.px, drag.py);
  var key = cell ? cell.c + ',' + cell.r : null;
  if (key === drag.prevAnchor) return;                  // 锚点没变：沿用上次结果
  drag.prevAnchor = key;
  UI.dragPreview = null;
  if (!cell || drag.previewOff || !UI.isDay()) return;  // 出图/已降级/夜晚：不预览
  var now = function () {
    return (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  };
  var t0 = now();
  // v1.4.12：以指针为中心的锚点（与 renderer 幽灵预览同走 ENG.shapeAnchor，口径只此一份）
  var anc = ENG.shapeAnchor(cell, drag.shape.cells);
  // 按引用快照 7 个派生字段（求解器只整体替换它们，绝不原地改 ⇒ 引用放回即还原）
  var saved = { railPath: GS.railPath, railSet: GS.railSet, railRect: GS.railRect,
                railInner: GS.railInner, contourB: GS.contourB,
                railGrowHints: GS.railGrowHints, station: GS.station };
  var res;
  GS.railFast = true;
  try { res = ENG.applyShape(anc.c, anc.r, drag.shape.cells); }
  finally { GS.railFast = false; }                      // 异常也绝不把快速档漏进正常玩法
  if (res === true) UI.dragPreview = { rail: GS.railPath.slice() };   // 先抓预览环再还原
  var snap = ENG.lastShapeApply;                        // ① 地形还原：逐格放回清理前 t
  if (res === true && snap) {
    for (var i = 0; i < snap.length; i++) GS.grid[snap[i].r][snap[i].c].t = snap[i].was;
  }
  for (var k in saved) GS[k] = saved[k];                // ② 派生字段 bit-exact 放回（不重算）
  if (now() - t0 > UI.PREVIEW_MS) {                     // 重盘：本拖拽内降级，不卡手感
    drag.previewOff = true;
    UI.dragPreview = null;
  }
};

// 形状卡结算：成功 = 卡消耗离库；失败 = 卡回牌库（拍板 ③："清理成功后卡消失"）
UI.settleClean = function (drag, cell) {
  if (!cell) { UI.setStatus('形状作废（卡已收回）'); if (typeof LOG !== 'undefined') LOG.add('cleanDiscard', { shape: drag.shape.name }); return; }
  var anc = ENG.shapeAnchor(cell, drag.shape.cells);    // v1.4.12：以指针为中心
  var res = ENG.applyShape(anc.c, anc.r, drag.shape.cells);
  if (typeof LOG !== 'undefined') {
    var lev = { shape: drag.shape.name, at: anc.c + ',' + anc.r, ok: res === true };
    if (res !== true) lev.reason = res;
    LOG.add(res === true ? 'cleanApply' : 'cleanFail', lev);
  }
  if (res === true) {
    // v1.4.5：打包撤销点（逐格 was 快照 + 被消耗的卡 + 原库位），供【撤销清理】一键回撤
    GS.undoClean = { pts: ENG.lastShapeApply, card: GS.deck[drag.cardIdx],
                     cardIdx: drag.cardIdx, shape: drag.shape.name };
    GS.deck.splice(drag.cardIdx, 1);                   // 成功才消耗
    UI.setStatus('已清理（可点【撤销清理】回撤）');
  } else {
    UI.setStatus(res + '（卡已收回）');
  }
  UI.renderDeck();
};

// v1.4.5 【撤销清理】：把最近一次形状卡清理整体回撤（废墟还原 + 铁轨重算 + 卡回牌库）。
//   动机（大王）：某些清理会让路径规划失败（环覆盖塌了），需要撤回重新规划。
UI.onUndo = function () {
  if (!UI.isDay()) { UI.setStatus(GS.gameOver ? '挑战已失败' : '防守阶段施工暂停，等列车回到站台'); return; }
  var shapeName = GS.undoClean ? GS.undoClean.shape : '';   // undoShape 会清掉撤销点，先取名字
  var res = ENG.undoShape();
  if (res !== true) { UI.setStatus(res); return; }
  if (typeof LOG !== 'undefined') LOG.add('cleanUndo', { shape: shapeName });
  UI.setStatus('已撤销清理，卡回牌库');
  UI.renderDeck();
};

// 英雄卡结算：释放在合法空地 → 建塔（免费）+ 车尾 +1 对应元素车厢 → 卡消耗
UI.settleHero = function (drag, cell) {
  if (!cell) {
    UI.setStatus('建造取消（卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('heroCancel', { reason: 'offmap' });   // v1.4.10：拖空收回入流水
    return;
  }
  // v1.6.10 手牌直接合成：拖到同名 1 星塔上松手 = 直接升星（免"先建塔再拖动"两步）。
  // 判据/执行走 canMergeCard/mergeFromHand（= canMerge/merge 单一口径，虚源 from:'hand'）。
  var dt = GS.grid[cell.r][cell.c].b;
  if (dt && dt.type === 'tower') {
    var mres = TOWERS.mergeFromHand(drag.elem, dt);
    if (mres === true) {
      GS.deck.splice(drag.cardIdx, 1);
      UI.setStatus('英雄·' + drag.elem + ' 直接合成，' + dt.elem + ' 升至 ' + dt.star + ' 星');
      UI.renderDeck();
      return;
    }
    UI.setStatus(mres + '（卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('heroCancel', { reason: 'mergeMismatch', at: cell.c + ',' + cell.r });
    UI.renderDeck();
    return;
  }
  if (!TOWERS.isFreeSpot(cell.c, cell.r)) {
    UI.setStatus('只能建在空地（非轨/非金币/无建筑，卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('heroCancel', { reason: 'occupied', at: cell.c + ',' + cell.r });
    UI.renderDeck(); return;
  }
  TOWERS.placeAt(cell.c, cell.r, drag.elem, 1);
  // 车厢不再单独登记（v1.4.1）：车厢 = GS.towers 镜像投影，建塔即自动 +1 节
  GS.deck.splice(drag.cardIdx, 1);
  if (typeof LOG !== 'undefined') LOG.add('buildHero', { elem: drag.elem, at: cell.c + ',' + cell.r });
  UI.setStatus('英雄·' + drag.elem + ' 已建造，+1 车厢');
  UI.renderDeck();
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
  UI.renderDeck();                                   // v1.4：牌库随重开清空
  UI.trainSel = null;                                // v1.6.13：长按状态随重开清空
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

// ---- 导出记录（v1.3.5）：复制本次行为流水（LOG.exportText 的 JSON 行），同走剪贴板 ----
UI.onLogExport = function () {
  var text = LOG.exportText();
  var finish = function (ok) {
    UI.setStatus(ok ? '已复制行为记录（' + LOG.count() + ' 条事件）'
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
  // v1.4.7：车斗 HUD 刷新已退役（车上浮字 +N 唯一显示，见 UI.init 注释）
  // 城墙血量（低血变红）与波次
  if (UI.core) {
    UI.core.textContent = Math.max(0, Math.ceil(GS.coreHP));
    UI.core.style.color = GS.coreHP <= GS.coreMaxHP * 0.3 ? '#e8563f' : '';
  }
  if (UI.wave) UI.wave.textContent = FOES.wave > 0 ? FOES.wave : '-';
  var drawCost = GS.drawCost();                    // v1.4.4/v1.4.8：线性递增价（5+5×已抽次数）
  UI.btnSummon.disabled = !day || GS.gold < drawCost;
  UI.btnSummon.textContent = '抽卡(' + drawCost + ')';
  // v1.4.5：撤销按钮 —— 有可撤销点且白天才可点
  if (UI.btnUndo) UI.btnUndo.disabled = !day || !GS.undoClean;
  // 开波按钮：建造阶段「开波」，防守阶段显示倒计时 / 波次；非建造阶段不可点
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
