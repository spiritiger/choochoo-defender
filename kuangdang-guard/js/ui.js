// UI：HUD、三选一牌(清理形状/经济建筑)、重抽
window.UI = {};

UI.init = function (canvas) {
  UI.canvas = canvas;
  UI.gold = document.getElementById('hudGold');
  UI.cards = document.getElementById('cards');
  UI.btnRoll = document.getElementById('btnRoll');
  UI.status = document.getElementById('status');
  UI.move = null;
  UI._sig = '';

  UI.canvas.addEventListener('click', UI.onCanvas);
  UI.canvas.addEventListener('mousemove', UI.onMove);
  UI.btnRoll.addEventListener('click', UI.onRoll);
};

UI.cardInfo = function (card) {
  if (card.kind === 'shape') {
    var sh = CFG.SHAPES[card.si];
    return { ico: '清', name: '清理·' + sh.name, meta: '把形状内废墟清为空白' };
  }
  return { ico: '钱', name: '经济建筑', meta: '列车经过+' + CFG.ECON_RATE + '金币' };
};

UI.renderCards = function () {
  UI.cards.innerHTML = '';
  GS.offer.forEach(function (card) {
    var info = UI.cardInfo(card);
    var sel = GS.selToken && GS.selToken.kind === card.kind && (card.kind !== 'shape' || GS.selToken.si === card.si);
    var el = document.createElement('div');
    el.className = 'card' + (sel ? ' selected' : '');
    el.innerHTML =
      '<div class="c-ico">' + info.ico + '</div>' +
      '<div class="c-name">' + info.name + '</div>' +
      '<div class="c-meta">' + info.meta + '</div>';
    el.addEventListener('click', function () { UI.pickCard(card); });
    UI.cards.appendChild(el);
  });
};

UI.pickCard = function (card) {
  var same = GS.selToken && GS.selToken.kind === card.kind && (card.kind !== 'shape' || GS.selToken.si === card.si);
  GS.selToken = same ? null : card;
  GS.status = '';
};

UI.onRoll = function () {
  UI.setStatus(GS.nextOffer(true) ? '已重新抽取' : '金币不足，等列车收入');
};

UI.onCanvas = function (e) {
  if (!GS.selToken) { return; }
  var cell = UI.cellFromEvent(e);
  if (!cell) { UI.setStatus('点按地图地块'); return; }
  var tk = GS.selToken;
  var res;
  if (tk.kind === 'shape') res = ENG.applyShape(cell.c, cell.r, tk.cells);
  else res = ENG.placeEcon(cell.c, cell.r);

  if (res === true) {
    GS.selToken = null;
    UI.setStatus(GS.nextOffer(true) ? '完成，已抽取新选择' : '完成（金币不足，可再选本组余牌）');
  } else {
    UI.setStatus(res);
  }
};

UI.onMove = function (e) {
  UI.move = GS.selToken ? UI.cellFromEvent(e) : null;
};
UI.cellFromEvent = function (e) {
  var fieldH = CFG.fieldH();
  var rect = UI.canvas.getBoundingClientRect();
  var mx = (e.clientX - rect.left) * (CFG.CANVAS_W / rect.width);
  var my = (e.clientY - rect.top) * (fieldH / rect.height);
  if (my < 0 || my > fieldH) return null;
  return CFG.pickCell(LAY, mx, my);
};
UI.setStatus = function (s) { UI.status.textContent = s; };

UI.tick = function () {
  var sig = GS.offer.map(function (c) { return c.kind + ':' + (c.si === undefined ? 'x' : c.si); }).join(',') +
    '|' + (GS.selToken ? GS.selToken.kind + ':' + (GS.selToken.si === undefined ? 'x' : GS.selToken.si) : '-');
  if (sig !== UI._sig) { UI._sig = sig; UI.renderCards(); }

  UI.gold.textContent = Math.floor(GS.gold);
  UI.btnRoll.disabled = GS.gold < GS.offerCost;
  UI.btnRoll.textContent = '重抽(' + GS.offerCost + ')';
};

UI.resize = function () {
  var s = Math.min(window.innerWidth / CFG.CANVAS_W, window.innerHeight / CFG.CANVAS_H);
  document.getElementById('app').style.transform = 'scale(' + s + ')';
};
