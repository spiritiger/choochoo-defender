// UI：HUD、建筑三选一、摆放、蒸汽、缩放、结果
window.UI = {};

UI.meta = {
  turret: ['伤害12 · 射程', '🧱'],
  mine:   ['产矿 · 需贴铁轨', '⛏'],
  boiler: ['加速列车', '🔥']
};

UI.init = function (ctx, canvas) {
  UI.ctx = ctx;
  UI.canvas = canvas;
  UI.gold = document.getElementById('hudGold');
  UI.night = document.getElementById('hudNight');
  UI.hp = document.getElementById('hudHp');
  UI.cards = document.getElementById('cards');
  UI.btnNight = document.getElementById('btnNight');
  UI.btnSteam = document.getElementById('btnSteam');
  UI.phaseTitle = document.getElementById('phaseTitle');
  UI.status = document.getElementById('status');
  UI.overlay = document.getElementById('overlay');
  UI.ovTitle = document.getElementById('ovTitle');
  UI.ovSub = document.getElementById('ovSub');
  UI.btnRestart = document.getElementById('btnRestart');
  UI.move = null;
  UI._sig = '';
  UI._shownResult = false;

  UI.canvas.addEventListener('click', UI.onCanvas);
  UI.canvas.addEventListener('mousemove', UI.onMove);
  UI.btnNight.addEventListener('click', UI.onNight);
  UI.btnSteam.addEventListener('click', UI.onSteam);
  UI.btnRestart.addEventListener('click', function () { location.reload(); });
};

UI.renderCards = function () {
  UI.cards.innerHTML = '';
  GS.offer.forEach(function (id) {
    var def = BUILD.DEF[id];
    var m = UI.meta[id];
    var el = document.createElement('div');
    el.className = 'card' + (GS.phase === 'night' || GS.result ? ' disabled' : '') +
      (GS.selOffer === id ? ' selected' : '');
    el.innerHTML =
      '<div class="c-ico">' + (m ? m[1] : '') + '</div>' +
      '<div class="c-name">' + def.name + '</div>' +
      '<div class="c-meta">' + (m ? m[0] : '') + '</div>' +
      '<div class="c-cost">' + def.cost + '</div>';
    el.addEventListener('click', function () { UI.pickCard(id); });
    UI.cards.appendChild(el);
  });
};

UI.pickCard = function (id) {
  if (GS.phase === 'night' || GS.result) return;
  GS.selOffer = (GS.selOffer === id) ? null : id;
};

UI.onCanvas = function (e) {
  if (GS.phase !== 'day' || GS.result || !GS.selOffer) {
    GS.selOffer = null;
    return;
  }
  var cell = UI.cellFromEvent(e);
  if (!cell) { UI.setStatus('点按可建造地块'); return; }
  if (ENG.place(GS.selOffer, cell.c, cell.r)) UI.setStatus('已建造');
  else UI.setStatus(UI.why(cell));
};

UI.why = function (cell) {
  if (CFG.isTrack(cell.c, cell.r)) return '这里是铁轨';
  if (GS.buildingAt(cell.c, cell.r)) return '已有建筑';
  var def = BUILD.DEF[GS.selOffer];
  var zone = CFG.zoneAt(cell.c, cell.r);
  if (def.zones.indexOf(zone) < 0) return '不能建在' + CFG.ZONE_NAME[zone];
  if (def.needsRail && !GS.adjRail(cell.c, cell.r)) return '矿机需紧贴铁轨';
  if (GS.gold < def.cost) return '金币不足';
  return '无法放置';
};

UI.onNight = function () {
  if (GS.phase !== 'day' || GS.result) return;
  GS.selOffer = null;
  ENG.enterNight();
};

UI.onSteam = function () {
  if (GS.steamCd <= 0 && !GS.result) { GS.steam = 4; GS.steamCd = 9; }
};

UI.onMove = function (e) {
  UI.move = GS.selOffer ? UI.cellFromEvent(e) : null;
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
  // 卡片按状态变化重绘
  var sig = GS.phase + '|' + GS.offer.join(',') + '|' + (GS.selOffer || '-');
  if (sig !== UI._sig) { UI._sig = sig; UI.renderCards(); }

  UI.gold.textContent = Math.floor(GS.gold);
  UI.night.textContent = (GS.nightIndex + 1) + '/' + LEVELS.total;
  UI.hp.textContent = Math.max(0, Math.floor(GS.townHp));
  UI.phaseTitle.textContent = GS.phase === 'day'
    ? '第 ' + (GS.nightIndex + 1) + ' 白昼 · 建造'
    : '第 ' + (GS.nightIndex + 1) + ' 夜 · 防守';
  UI.btnNight.disabled = GS.phase !== 'day' || !!GS.result;
  UI.btnSteam.disabled = GS.steamCd > 0 || !!GS.result;
  UI.btnSteam.textContent = GS.steamCd > 0 ? '蒸汽(' + Math.ceil(GS.steamCd) + 's)' : '蒸汽加速';

  if (GS.steam > 0 && !GS.status) UI.setStatus('蒸汽加速中');

  if (GS.result && !UI._shownResult) { UI._shownResult = true; UI.showResult(); }
};

UI.showResult = function () {
  UI.overlay.classList.remove('hidden');
  UI.ovTitle.textContent = GS.result === 'win' ? '守城成功！' : '镇中心被攻破';
  UI.ovSub.textContent = GS.result === 'win'
    ? '撑过了全部 ' + LEVELS.total + ' 夜'
    : '第 ' + (GS.nightIndex + 1) + ' 夜失守';
};

UI.resize = function () {
  var s = Math.min(window.innerWidth / CFG.CANVAS_W, window.innerHeight / CFG.CANVAS_H);
  document.getElementById('app').style.transform = 'scale(' + s + ')';
};