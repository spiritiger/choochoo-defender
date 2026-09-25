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
  UI.btnExport = document.getElementById('btnExport');
  if (UI.btnExport) UI.btnExport.addEventListener('click', UI.onExport);
};

UI.cardInfo = function (card) {
  if (card.kind === 'shape') {
    return { ico: '清', name: '清理·' + card.name, meta: card.cells.length + '格·相邻1格或压住内区' };
  }
  return { ico: '钱', name: '经济建筑', meta: '列车经过+' + CFG.ECON_RATE + '金币' };
};

UI.renderCards = function () {
  UI.cards.innerHTML = '';
  GS.offer.forEach(function (card) {
    var info = UI.cardInfo(card);
    var sel = GS.selToken === card;   // 每张卡都是独立对象，直接比对引用
    var el = document.createElement('div');
    el.className = 'card' + (sel ? ' selected' : '');
    // 形状卡：把形状画成小格子预览（v0.6.7 大王定案）；经济卡保持文字图标
    if (card.kind === 'shape') {
      el.appendChild(UI.shapePreview(card.cells));
      el.insertAdjacentHTML('beforeend',
        '<div class="c-name">' + info.name + '</div>' +
        '<div class="c-meta">' + info.meta + '</div>');
    } else {
      el.innerHTML =
        '<div class="c-ico">' + info.ico + '</div>' +
        '<div class="c-name">' + info.name + '</div>' +
        '<div class="c-meta">' + info.meta + '</div>';
    }
    el.addEventListener('click', function () { UI.pickCard(card); });
    UI.cards.appendChild(el);
  });
};

// 形状预览：把 cells 画成 mini 格子图（cells 已归一化，最小坐标为 0）
// v0.6.8：形状最大到 12 格（外框可达 ~11 宽），格子尺寸按外框自适应，
// 保证预览整体不超过 ~60px 宽高。
UI.shapePreview = function (cells) {
  var maxC = 0, maxR = 0;
  cells.forEach(function (p) { if (p[0] > maxC) maxC = p[0]; if (p[1] > maxR) maxR = p[1]; });
  var px = Math.max(8, Math.min(14, Math.floor(60 / Math.max(maxC + 1, maxR + 1))));
  var wrap = document.createElement('div');
  wrap.className = 'shapePrev';
  wrap.style.width = (maxC + 1) * px + 'px';
  wrap.style.height = (maxR + 1) * px + 'px';
  cells.forEach(function (p) {
    var d = document.createElement('i');
    d.style.left = p[0] * px + 'px';
    d.style.top = p[1] * px + 'px';
    d.style.width = (px - 2) + 'px';
    d.style.height = (px - 2) + 'px';
    wrap.appendChild(d);
  });
  return wrap;
};

UI.pickCard = function (card) {
  var same = GS.selToken === card;
  GS.selToken = same ? null : card;
  // 原为 GS.status=''（写到了一个不存在的字段上，提示文案不会被清掉），应清 UI 上的提示
  UI.setStatus('');
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

// ---- 调试导出：把当前盘面序列化成可直接重放的文本，复制到剪贴板 ----
// 格式与 test_rail.js 的 setupFromRows 同源：
//   '#'=废墟  '.'=空地  'C'=镇中心  'E'=经济建筑  'G'=金币地块
// 附加 rail / train / gold 三行，供还原铁轨与列车状态。
// 图例行用「图例:」前缀，便于人读；前 16 行固定，程序可按行号截取 grid。
//
// ▍rail(N) 里的 N 是「步数」不是「格数」（v0.6.18 明确标注）
//   N = GS.railPath 的**序列长度** = 列车沿环走一圈经过的步数（含重复经过的格）。
//   因为铁轨是闭合轨迹，序列回绕到起点结束，所以 N 也等于"边的条数"。
//   想玩家关心的另两个量要自己算：
//     · 格数 = 去重后的格数（同一格被走两次只算一格）
//     · 十字 = 被走 **≥2 次** 的格数
//   例：`rail(24)` 的 24 步里可能有 22 个不同的格、其中 2 个被走了 2 次。
UI.exportMap = function () {
  var rows = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var s = '';
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var cell = GS.grid[r][c];
      var ch = '.';
      if (cell.t === 'rubble') ch = '#';
      if (cell.b) ch = (cell.b.type === 'core') ? 'C' : 'E';
      // v0.6.12：金币格初始埋在废墟里（t='rubble'）→ 小写 g；清出来后才大写 G。
      // 大写的含义与旧版一致（可用的金币格 = 空地 + 金币）。
      else if (cell.gold) ch = (cell.t === 'rubble') ? 'g' : 'G';
      s += ch;
    }
    rows.push(s);
  }
  var rail = GS.railPath || [];
  var lines = ['KDG-MAP v1 ' + new Date().toISOString()];
  lines.push('图例: #废墟 .空地 C镇中心 E经济建筑 G金币地块(已清出) g金币地块(仍在废墟中)');
  Array.prototype.push.apply(lines, rows);
  // rail(N) 的 N = 步数（序列长度），不是去重格数 —— 见函数头说明
  lines.push('rail(' + rail.length + '): ' + rail.map(function (p) { return p.c + ',' + p.r; }).join(' '));
  lines.push('train: ' + (GS.train ? GS.train.index + ',' + GS.train.frac.toFixed(2) : '-'));
  lines.push('gold: ' + Math.floor(GS.gold));
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

UI.tick = function () {
  var sig = GS.offer.map(function (c) { return c.kind + ':' + c.id; }).join(',') +
    '|' + (GS.selToken ? GS.selToken.kind + ':' + GS.selToken.id : '-');
  if (sig !== UI._sig) { UI._sig = sig; UI.renderCards(); }

  UI.gold.textContent = Math.floor(GS.gold);
  UI.btnRoll.disabled = GS.gold < GS.offerCost;
  UI.btnRoll.textContent = '重抽(' + GS.offerCost + ')';
};

UI.resize = function () {
  var s = Math.min(window.innerWidth / CFG.CANVAS_W, window.innerHeight / CFG.CANVAS_H);
  document.getElementById('app').style.transform = 'scale(' + s + ')';
};
