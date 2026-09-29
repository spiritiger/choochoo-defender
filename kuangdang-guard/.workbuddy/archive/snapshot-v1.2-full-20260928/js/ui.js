// UI：HUD、三选一牌(清理形状/经济建筑)、重抽
window.UI = {};

UI.init = function (canvas) {
  UI.canvas = canvas;
  UI.gold = document.getElementById('hudGold');
  UI.cargo = document.getElementById('hudCargo');
  UI.cards = document.getElementById('cards');
  UI.btnRoll = document.getElementById('btnRoll');
  UI.btnDepart = document.getElementById('btnDepart');
  UI.status = document.getElementById('status');
  UI.move = null;
  UI._sig = '';

  UI.canvas.addEventListener('click', UI.onCanvas);
  UI.canvas.addEventListener('mousemove', UI.onMove);
  UI.btnRoll.addEventListener('click', UI.onRoll);
  if (UI.btnDepart) UI.btnDepart.addEventListener('click', UI.onDepart);
  UI.btnExport = document.getElementById('btnExport');
  if (UI.btnExport) UI.btnExport.addEventListener('click', UI.onExport);
  UI.btnForce = document.getElementById('btnForce');
  if (UI.btnForce) UI.btnForce.addEventListener('click', UI.onForceRefresh);
};

// 现在是不是可以施工/重抽的白天（v0.9.2：夜晚与收尾阶段锁操作，与规格 §6「白天：三选一」一致）
UI.isDay = function () {
  return typeof CLOCK === 'undefined' || CLOCK.isDay();
};

UI.cardInfo = function (card) {
  if (card.kind === 'shape') {
    // v0.9.0：形状卡不再显示副标题文案（原「N格·相邻1格或压住内区」，大王令删）。
    //   形状卡下方本来就有格子预览，尺寸一眼可见；meta 留空，渲染时整块省略。
    return { ico: '清', name: '清理·' + card.name, meta: '' };
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
        (info.meta ? '<div class="c-meta">' + info.meta + '</div>' : ''));
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
  if (!UI.isDay()) { UI.setStatus('夜晚施工暂停，等列车回到站台'); return; }
  var same = GS.selToken === card;
  GS.selToken = same ? null : card;
  // 原为 GS.status=''（写到了一个不存在的字段上，提示文案不会被清掉），应清 UI 上的提示
  UI.setStatus('');
};

UI.onRoll = function () {
  if (!UI.isDay()) { UI.setStatus('夜晚施工暂停，等列车回到站台'); return; }
  UI.setStatus(GS.nextOffer(true) ? '已重新抽取' : '金币不足，等列车收入');
};

// 「发车」：白天 → 入夜，列车从站台出发（规则 4/5）
UI.onDepart = function () {
  if (typeof CLOCK === 'undefined') return;
  if (!CLOCK.isDay()) return;
  if (!ENG.startNight()) { UI.setStatus('还没有成环的铁轨，发不了车'); return; }
  UI.setStatus('入夜，列车从站台发车');
};

UI.onCanvas = function (e) {
  if (!GS.selToken) { return; }
  if (!UI.isDay()) { UI.setStatus('夜晚施工暂停，等列车回到站台'); return; }
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
  // v0.9.2：站台与车斗（站台是叠加的轨格，不改变上面的 grid 图例）
  if (typeof STATION !== 'undefined') {
    var st = STATION.slot();
    lines.push('station: ' + (st ? st.c + ',' + st.r + '@' + st.index : '-'));
  }
  lines.push('cargo: ' + (GS.train ? Math.floor(GS.train.cargo) : 0));
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

// ---- 强制刷新铁轨（v0.9.0，临时救急）----------------------------------------
// 背景：求解器有三处时间闸（①700 / ②250 / ⑤150ms）。极端盘面（1~2 格厚的"肥带"轮廓）
//   在闸内搜不出"覆盖全部轮廓格"的环，于是沿用上一帧的旧环 —— 表现就是"新清出来的
//   地块铁轨没接过去"。本按钮把这些时间闸一次性放开（GS.forceRefresh），让求解器一直
//   搜到节点预算耗尽为止。**只放开预算，不放宽任何铺轨规则**（合法性/围镇中心照旧）。
// ⚠️ 求解是同步单线程的：点下去界面会卡住（实测极端盘几十秒），所以先渲染提示再开跑。
// 覆盖数口径：railPath 去重后落在当前轮廓 contourB 上的格数 / 轮廓总格数。
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
  var sig = GS.offer.map(function (c) { return c.kind + ':' + c.id; }).join(',') +
    '|' + (GS.selToken ? GS.selToken.kind + ':' + GS.selToken.id : '-');
  if (sig !== UI._sig) { UI._sig = sig; UI.renderCards(); }

  var day = UI.isDay();
  UI.gold.textContent = Math.floor(GS.gold);
  if (UI.cargo) UI.cargo.textContent = Math.floor(GS.train.cargo);
  UI.btnRoll.disabled = !day || GS.gold < GS.offerCost;
  UI.btnRoll.textContent = '重抽(' + GS.offerCost + ')';
  // 发车按钮：白天「发车」，夜里显示倒计时 / 收车中；非白天一律不可点
  if (UI.btnDepart) {
    UI.btnDepart.disabled = !day;
    UI.btnDepart.textContent = day ? '发车'
      : (typeof CLOCK !== 'undefined' ? CLOCK.label() : '发车');
  }
};

UI.resize = function () {
  var s = Math.min(window.innerWidth / CFG.CANVAS_W, window.innerHeight / CFG.CANVAS_H);
  document.getElementById('app').style.transform = 'scale(' + s + ')';
};
