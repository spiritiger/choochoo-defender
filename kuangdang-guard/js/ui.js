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
  // 【v1.6.39 退役】UI.status = getElementById('status') 随提示行一并删除
  UI.overOverlay = document.getElementById('overOverlay');
  UI.overWave = document.getElementById('overWave');
  UI.overBox = document.getElementById('overBox');           // v1.7.0：失败层模式样式钩（.lv）
  UI.btnRestart = document.getElementById('btnRestart');
  UI.deckRow = document.getElementById('deckRow');          // v1.4 底部牌库
  UI.footer = document.getElementById('footer');             // v1.6.38 作战拉远：夜晚隐藏
  UI._battleHidden = null;
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
  document.addEventListener('keydown', UI.onOfferKey);   // v1.6.61：三选一快捷键 1/2/3
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
  if (UI.btnForce) UI.btnForce.addEventListener('click', UI.onMenuForce);
  // v1.6.67 工具菜单（大王令）：导入/导出/强制刷新统一收纳，点开暂停游戏
  UI.menuOverlay = document.getElementById('menuOverlay');
  UI.menuHint = document.getElementById('menuHint');
  UI.importText = document.getElementById('importText');
  UI.btnMenu = document.getElementById('btnMenu');
  if (UI.btnMenu) UI.btnMenu.addEventListener('click', UI.onMenuOpen);
  UI.btnMenuClose = document.getElementById('btnMenuClose');
  if (UI.btnMenuClose) UI.btnMenuClose.addEventListener('click', UI.onMenuClose);
  UI.btnImportGo = document.getElementById('btnImportGo');
  if (UI.btnImportGo) UI.btnImportGo.addEventListener('click', UI.onMenuImportGo);
  // v1.7.0 关卡模式（§14.62）：胜利层 + 失败层追加按钮 + 菜单「关卡模式」区块
  UI.winOverlay = document.getElementById('winOverlay');
  UI.winInfo = document.getElementById('winInfo');
  UI.btnNextLevel = document.getElementById('btnNextLevel');
  UI.btnReplayLevel = document.getElementById('btnReplayLevel');
  UI.btnWinRandom = document.getElementById('btnWinRandom');
  if (UI.btnNextLevel) UI.btnNextLevel.addEventListener('click', function () {
    if (GS.levelIdx < LEVELS.length - 1) UI.onStartLevel(GS.levelIdx + 1);
  });
  if (UI.btnReplayLevel) UI.btnReplayLevel.addEventListener('click', function () {
    UI.onStartLevel(GS.levelIdx);
  });
  if (UI.btnWinRandom) UI.btnWinRandom.addEventListener('click', UI.onModeRandom);
  UI.btnOverRandom = document.getElementById('btnOverRandom');
  if (UI.btnOverRandom) UI.btnOverRandom.addEventListener('click', UI.onModeRandom);
  UI.modeHint = document.getElementById('modeHint');
  UI.btnModeRandom = document.getElementById('btnModeRandom');
  if (UI.btnModeRandom) UI.btnModeRandom.addEventListener('click', function () {
    UI.modeConfirm(UI.btnModeRandom, '确认随机', UI.onModeRandom);
  });
  UI.lvBtns = [];
  var lvRow = document.getElementById('levelBtnRow');
  if (lvRow) {
    var lvList = lvRow.querySelectorAll('.lvBtn');
    for (var bi = 0; bi < lvList.length; bi++) {
      (function (b) {
        var idx = +b.getAttribute('data-lv');
        UI.lvBtns.push(b);
        b.addEventListener('click', function () {
          UI.modeConfirm(b, '确认第' + (idx + 1) + '关', function () { UI.onStartLevel(idx); });
        });
      })(lvList[bi]);
    }
  }
  UI.btnRestart.addEventListener('click', UI.onRestart);
  UI.renderDeck();     // 开局画一次空牌库（此后由选卡/用卡/重开触发刷新）
};

// 可以施工/拖动吗：白天 且 没有失败（v1.3-rc 加 gameOver 闸）
//   v1.7.0：关卡通关（levelDone）同闸锁死 —— 胜利弹层后面不能再动一草一木
UI.isDay = function () {
    if (GS.gameOver || GS.levelDone) return false;
    return typeof CLOCK === 'undefined' || CLOCK.isDay();
  };

// ---- 指针坐标换算 -------------------------------------------------------------
// 返回画布内像素坐标 {mx,my}（与 cellFromEvent 同一套缩放换算），出画布返回 null。
//   ⚠️ v1.6.38 作战拉远：换算基准用 **canvas.height（物理画布高，恒 792）**，
//   不再是 CFG.fieldH()（白天可视高 560）—— 画布物理尺寸不随昼夜变，footer 只是
//   盖在上面，等比换算两条路径通用。
UI.pointFromEvent = function (e) {
  var ch = UI.canvas.height;
  var rect = UI.canvas.getBoundingClientRect();
  var mx = (e.clientX - rect.left) * (CFG.CANVAS_W / rect.width);
  var my = (e.clientY - rect.top) * (ch / rect.height);
  if (mx < 0 || mx > CFG.CANVAS_W || my < 0 || my > ch) return null;
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
//   ▍v1.6.36 大王令：**词条卡不需要装备** —— 点选即 `GS.gainAffix` 全局生效
//   （对场上所有对应塔型的车厢），不进牌库、不拖拽；普通卡照旧进牌库。
//   ▍v1.6.37 大王令：「抽词条卡牌的时候，游戏需要暂停」—— 弹层含词条卡 ⇒
//   `GS.paused = true`（main.js 跳过整个模拟，画面静止但照常渲染），玩家对着
//   当前战局挑词条；**关层即恢复**（选普通卡/词条卡都走关层路径，统一恢复）。
//   普通抽卡不暂停（白天建造阶段本来就停车，没有"打断战斗"的问题）。
//   ▍v1.6.61 大王令：三选一支持**快捷键 1/2/3**——点卡与键盘共用 UI.pickOffer(idx)；
//   弹层开闭状态用 UI.offerOpen 标志（不读 classList，测试桩无 contains）。
//   ▍v1.6.73 大王令：卡面左上角 `1/2/3` 角标（css .oc-key）退役——快捷键本身
//   保留（onOfferKey/pickOffer 通道不动），只撤视觉提示。
UI.showOffer = function (cards) {
  var isAffix = false;
  for (var i = 0; i < cards.length; i++) if (cards[i].kind === 'affix') { isAffix = true; break; }
  GS.paused = isAffix;                 // 词条弹层 ⇒ 暂停；普通抽卡 ⇒ 保持 false
  UI.offerLive = cards;                // v1.6.61：快捷键候选（pickOffer 消费）
  UI.offerOpen = true;
  UI.offerCards.innerHTML = '';
  cards.forEach(function (card, i) {
    var el = document.createElement('div');
    el.className = 'oc';
    UI.fillCardDom(el, card, true);
    el.addEventListener('click', function () { UI.pickOffer(i); });
    UI.offerCards.appendChild(el);
  });
  UI.offerOverlay.classList.remove('hidden');
};

// v1.6.61 选卡结算（点卡 / 快捷键 1/2/3 共用）：
//   ▍词条卡（v1.6.36 大王令）：不进牌库 —— 点选即 GS.gainAffix 全局生效
//   （对场上所有对应塔型的车厢）。
//   ▍弹层暂停（v1.6.37 大王令）：关层即恢复（选普通卡/词条卡统一走这里）。
UI.pickOffer = function (idx) {
  if (!UI.offerOpen || !UI.offerLive) return;          // 弹层没开 / 已被消费
  var card = UI.offerLive[idx];
  if (!card) return;                                   // 1/2/3 超出候选数（弹层可能只有 1~2 张）
  UI.offerLive = null; UI.offerOpen = false;
  if (card.kind === 'affix') {
    var d = (typeof AFFIXES !== 'undefined') ? AFFIXES.get(card.aid) : null;
    GS.gainAffix(card.aid);
    if (typeof LOG !== 'undefined') LOG.add('pick', { kind: 'affix', name: UI.cardLabel(card) });
    UI.offerOverlay.classList.add('hidden');
    GS.paused = false;             // 选完词条 → 恢复（新强度立刻上场）
    UI.setStatus('词条【' + (d ? d.name : card.aid) + '】已生效：全场' +
      TOWERS.typeName(d ? d.tower : '') + '车厢');
    return;
  }
  GS.deck.push(card);
  if (typeof LOG !== 'undefined') LOG.add('pick', { kind: card.kind, name: UI.cardLabel(card) });
  UI.offerOverlay.classList.add('hidden');
  GS.paused = false;               // 统一恢复（普通卡路径本就 false，防御性复位）
  UI.renderDeck();
  UI.setStatus('已入牌库：' + UI.cardLabel(card));
};

// v1.6.61：三选一快捷键（1/2/3 = 第 1/2/3 张；含小键盘）。弹层没开时完全旁路。
UI.onOfferKey = function (e) {
  if (!UI.offerOpen || !UI.offerLive) return;
  if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName || '')) return;   // 输入框焦点防御
  var idx = '123'.indexOf(e.key);
  if (idx >= 0) UI.pickOffer(idx);
};

// 卡面文案（牌库/弹层共用）
UI.cardLabel = function (card) {
  if (card.kind === 'shape') return '形状 ' + card.name;
  if (card.kind === 'hero') return '塔·' + TOWERS.typeName(card.elem);
  if (card.kind === 'building') {
    var bi = GS.BUILDING_INFO[card.bkey];
    return '建筑·' + (bi ? bi.name : card.bkey);
  }
  if (card.kind === 'affix') {
    var ad = (typeof AFFIXES !== 'undefined') ? AFFIXES.get(card.aid) : null;
    return '词条·' + (ad ? ad.name : card.aid);
  }
  return '辅助';
};

// 往卡 DOM 里填内容（v1.6.33 大王令统一版式；v1.6.34/35 扩词条卡 + 建筑范围图）。
//   ▍版式 = **顶部形状样式 → 中间名字 → 下面描述**，各类卡**同一套三行结构**，
//     只有尺寸差别（尺寸全在 css/style.css 的 .pcard / .oc 里，**全卡统一字号**）。
//   ▍顶部"形状样式"：
//     形状卡 = mini 方格网格（清理范围）；塔卡 = **六边形**（塔的形状语言）；
//     建筑卡 = 有范围的画**范围图**（加油站 3×3 / 军工厂十字，中间建筑、周围范围——
//     v1.6.35 大王令"用 3×3 的地块，中间是建筑，周围一圈是效果范围"），
//     无范围的（铸币所）仍画方块；词条卡 = **菱形**（塔型色）。
UI.fillCardDom = function (el, card, isOffer) {
  var pre = isOffer ? 'o' : 'p';
  var name = '', desc = '';
  if (card.kind === 'shape') { name = card.name; desc = '清理 ' + card.cells.length + ' 格'; }
  else if (card.kind === 'hero') { name = TOWERS.typeName(card.elem); desc = '建造后 +1 车厢'; }
  else if (card.kind === 'building') {
    var bi = GS.BUILDING_INFO[card.bkey] || { name: card.bkey, sub: '' };
    name = bi.name; desc = bi.sub;
  } else if (card.kind === 'affix') {
    var ad = (typeof AFFIXES !== 'undefined') ? AFFIXES.get(card.aid) : null;
    name = ad ? ad.name : '词条'; desc = ad ? ad.land : '';
  } else { name = '辅助'; desc = ''; }

  // ① 顶部：形状样式
  if (card.kind === 'shape') {
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
  } else if (card.kind === 'building' && (card.bkey === 'gas' || card.bkey === 'factory')) {
    // 建筑范围图（v1.6.35）：3×3 地块，中心 = 建筑本色，周围 = 范围淡色。
    //   加油站 = 3×3 全亮；军工厂 = 十字（四角隐藏）。与拖放时的场上范围预览同构。
    var grid2 = document.createElement('div');
    grid2.className = pre + '-range';
    grid2.style.gridTemplateColumns = 'repeat(3, auto)';
    var bcol = (card.bkey === 'gas') ? '#5ec8f0' : '#7e57c2';
    var rcol = (card.bkey === 'gas') ? 'rgba(94,200,240,0.38)' : 'rgba(126,87,194,0.45)';
    for (var rr2 = 0; rr2 < 3; rr2++) for (var cc2 = 0; cc2 < 3; cc2++) {
      var dot2 = document.createElement('i');
      var isC = (rr2 === 1 && cc2 === 1);
      var inCross = (rr2 === 1 || cc2 === 1);
      if (card.bkey === 'factory' && !isC && !inCross) dot2.style.visibility = 'hidden';
      dot2.style.background = isC ? bcol : rcol;
      grid2.appendChild(dot2);
    }
    el.appendChild(grid2);
  } else {
    var artWrap = document.createElement('div');
    artWrap.className = pre + '-art';
    var glyph = document.createElement('i');
    var col, cls;
    if (card.kind === 'hero') {
      col = REND.C.tower[card.elem] || '#888'; cls = 'art-hex';
    } else if (card.kind === 'affix') {
      col = (typeof AFFIXES !== 'undefined' && AFFIXES.get(card.aid))
            ? (REND.C.tower[AFFIXES.get(card.aid).tower] || '#c58cff') : '#c58cff';
      cls = 'art-dia';
    } else {
      col = (card.bkey === 'mint') ? REND.C.gold
          : (card.bkey === 'factory') ? '#7e57c2' : '#5ec8f0';
      cls = 'art-sq';
    }
    glyph.className = cls;
    glyph.style.background = col;
    artWrap.appendChild(glyph);
    el.appendChild(artWrap);
  }
  // ② 中间：名字
  var nameEl = document.createElement('div');
  nameEl.className = pre + '-name';
  nameEl.textContent = name;
  if (card.kind === 'hero') nameEl.style.color = REND.C.tower[card.elem] || '#888';
  else if (card.kind === 'affix') nameEl.style.color = (typeof AFFIXES !== 'undefined' && AFFIXES.get(card.aid))
            ? (REND.C.tower[AFFIXES.get(card.aid).tower] || '#c58cff') : '#c58cff';
  else if (card.kind === 'building') nameEl.style.color = (card.bkey === 'mint') ? REND.C.gold
          : (card.bkey === 'factory') ? '#a98ede' : '#5ec8f0';
  el.appendChild(nameEl);
  // ③ 下面：描述
  var descEl = document.createElement('div');
  descEl.className = pre + '-desc';
  descEl.textContent = desc;
  el.appendChild(descEl);
};

// ---- 底部牌库渲染：每张卡可拖到场上（形状=清理 / 英雄=建造）---------------------
UI.renderDeck = function () {
  UI.deckRow.innerHTML = '';
  if (!GS.deck.length) {
    var empty = document.createElement('div');
    empty.id = 'deckEmpty';
    empty.textContent = '牌库空 —— 点【抽卡】获得形状/英雄/建筑卡';
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
  else if (card.kind === 'building') drag.kind = 'building', drag.bkey = card.bkey;   // v1.6.23
  // 【v1.6.36 退役】词条卡不再进牌库/拖拽（点选即全局生效），原 affix 分支删除
  else return;                                          // 辅助卡本期不可用

  // ▍手势轴锁定（v1.6.33 大王令"卡牌不超框、允许滑动"）：
  //   牌库卡数多时会横向溢出（`#deckRow` overflow-x:auto）⇒ 同一个"在卡上按下"的手势
  //   既要能**滚牌库**又要能**拖到场上**。判据（先动够 10px 才定性，避免手抖误判）：
  //     · 往上拖（dy ≤ −8）                ⇒ **用卡**（拖到地图必然是往上）
  //     · 横向清晰滑动（|dx| ≥ 10 且 |dx| > 1.5|dy|）且牌库**确实溢出** ⇒ **滚牌库**
  //     · 其余动够 10px                      ⇒ 用卡（保持老手感）
  //   定性前不生成幽灵；横滑结束后**不结算**（不会把卡"用掉"）。
  //   ⚠️ 必须挂 `pointercancel`：浏览器若接管手势（来电/系统手势）会发 cancel 而非 up，
  //     不接就会把 drag 卡住、document 上的 mv/up 监听永不摘除。
  var sx = e.clientX, sy = e.clientY, lastX = sx, mode = '';
  UI.drag = null;                                       // 定性后才挂上（避免横滑时幽灵闪一下）
  UI.dragPreview = null;
  try { e.target.setPointerCapture(e.pointerId); } catch (err) {}
  var detach = function () {
    document.removeEventListener('pointermove', mv);
    document.removeEventListener('pointerup', up);
    document.removeEventListener('pointercancel', cancel);
  };
  var mv = function (ev) {
    if (mode === '') {
      var dx0 = ev.clientX - sx, dy0 = ev.clientY - sy;
      var overflow = UI.deckRow && UI.deckRow.scrollWidth > UI.deckRow.clientWidth + 1;
      if (dy0 <= -8) mode = 'drag';
      else if (overflow && Math.abs(dx0) >= 10 && Math.abs(dx0) > Math.abs(dy0) * 1.5) mode = 'scroll';
      else if (Math.abs(dx0) + Math.abs(dy0) >= 10) mode = 'drag';
      else return;                                      // 还没动够：什么都不做（可能是纯点击）
      if (mode === 'drag') { UI.drag = drag; UI.setStatus(UI.cardLabel(card) + '：拖到场上松手'); }
    }
    if (mode === 'scroll') {                            // 滚牌库：拖多少滚多少（1:1）
      if (UI.deckRow) UI.deckRow.scrollLeft -= (ev.clientX - lastX);
      lastX = ev.clientX;
      return;
    }
    var p = UI.pointFromEvent(ev);
    if (p) { drag.px = p.mx; drag.py = p.my; }
    else {
      // 出画布：幽灵钳到地图区边缘（松手须在画布内才结算）
      var rect = UI.canvas.getBoundingClientRect();
      var rawX = (ev.clientX - rect.left) * (CFG.CANVAS_W / rect.width);
      var rawY = (ev.clientY - rect.top) * (UI.canvas.height / rect.height);   // v1.6.38：物理画布高
      drag.px = Math.max(LAY.x, Math.min(LAY.x + LAY.w - 1, rawX));
      drag.py = Math.max(LAY.y, Math.min(LAY.y + LAY.h - 1, rawY));
    }
    UI.updateCleanPreview(drag);                        // v1.4.11：锚点变了才真算，格内抖动零开销
  };
  var up = function (ev) {
    detach();
    var d = UI.drag;
    UI.drag = null;
    UI.dragPreview = null;                              // v1.4.11：预览环随拖拽结束消失
    if (mode !== 'drag' || !d) return;                  // 滚牌库 / 纯点击 → 不结算（卡留在牌库）
    var p = UI.pointFromEvent(ev);
    var cell = p ? CFG.pickCell(LAY, p.mx, p.my) : null;
    if (d.kind === 'clean') UI.settleClean(d, cell);
    else if (d.kind === 'hero') UI.settleHero(d, cell);
    else if (d.kind === 'building') UI.settleBuilding(d, cell);   // v1.6.23
    // 【v1.6.36 退役】词条卡拖拽结算已删（点选即全局生效）
  };
  var cancel = function () {                            // 手势被浏览器接管 → 弹回，不结算
    detach();
    UI.drag = null;
    UI.dragPreview = null;
  };
  document.addEventListener('pointermove', mv);
  document.addEventListener('pointerup', up);
  document.addEventListener('pointercancel', cancel);
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
    // v1.6.61 大王令"不允许跨波次撤回清理"：记下清理发生时的波次号，onUndo/禁用态把关
    GS.undoClean = { pts: ENG.lastShapeApply, card: GS.deck[drag.cardIdx],
                     cardIdx: drag.cardIdx, shape: drag.shape.name,
                     wave: (typeof FOES !== 'undefined') ? FOES.wave : 0 };
    GS.deck.splice(drag.cardIdx, 1);                   // 成功才消耗
    UI.setStatus('已清理（可点【撤销清理】回撤）');
  } else {
    UI.setStatus(res + '（卡已收回）');
  }
  UI.renderDeck();
};

// v1.4.5 【撤销清理】：把最近一次形状卡清理整体回撤（废墟还原 + 铁轨重算 + 卡回牌库）。
//   动机（大王）：某些清理会让路径规划失败（环覆盖塌了），需要撤回重新规划。
// v1.6.61 大王令：**不允许跨波次撤回**——撤销点带 wave 标记，不是本波清的直接拒绝
//   （防"上波清的地块这波反悔"：铁轨/战局已按清理后盘面打过一整波）。
UI.onUndo = function () {
  if (!UI.isDay()) { UI.setStatus(GS.gameOver ? '挑战已失败' : '防守阶段施工暂停，等列车回到站台'); return; }
  if (GS.undoClean && (GS.undoClean.wave || 0) !== ((typeof FOES !== 'undefined') ? FOES.wave : 0)) {
    UI.setStatus('上一波的清理，不能跨波撤销'); return;
  }
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
      UI.setStatus('塔·' + TOWERS.typeName(drag.elem) + ' 直接合成，' + TOWERS.typeName(dt.elem) + ' 升至 ' + dt.star + ' 星');
      UI.renderDeck();
      return;
    }
    UI.setStatus(mres + '（卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('heroCancel', { reason: 'mergeMismatch', at: cell.c + ',' + cell.r });
    UI.renderDeck();
    return;
  }
  if (!TOWERS.isFreeSpot(cell.c, cell.r)) {
    UI.setStatus('只能建在空地（非轨/非金币/非爱心/无建筑，卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('heroCancel', { reason: 'occupied', at: cell.c + ',' + cell.r });
    UI.renderDeck(); return;
  }
  TOWERS.placeAt(cell.c, cell.r, drag.elem, 1);
  // 车厢不再单独登记（v1.4.1）：车厢 = GS.towers 镜像投影，建塔即自动 +1 节
  GS.deck.splice(drag.cardIdx, 1);
  if (typeof LOG !== 'undefined') LOG.add('buildHero', { elem: drag.elem, at: cell.c + ',' + cell.r });
  UI.setStatus('塔·' + TOWERS.typeName(drag.elem) + ' 已建造，+1 车厢');
  UI.renderDeck();
};

// v1.6.23 建筑卡落位（铸币所 / 加油站）：拖到**任意空地**松手 → 建成；非法落点卡收回。
//   校验与落位都在 ENG.placeBuilding（判据 = GS.isFreeSpot，与抽塔同一条）。
UI.settleBuilding = function (drag, cell) {
  var bi = GS.BUILDING_INFO[drag.bkey] || { name: drag.bkey };
  if (!cell) {
    UI.setStatus('建造取消（卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('buildCancel', { reason: 'offmap', bkey: drag.bkey });
    return;
  }
  var res = ENG.placeBuilding(cell.c, cell.r, drag.bkey);
  if (res !== true) {
    UI.setStatus(res + '（卡已收回）');
    if (typeof LOG !== 'undefined') LOG.add('buildCancel', { reason: 'occupied', at: cell.c + ',' + cell.r, bkey: drag.bkey });
    UI.renderDeck();
    return;
  }
  GS.deck.splice(drag.cardIdx, 1);
  if (typeof LOG !== 'undefined') LOG.add('buildBuilding', { bkey: drag.bkey, at: cell.c + ',' + cell.r });
  UI.setStatus('建筑·' + bi.name + ' 已建成' + (drag.bkey === 'mint'
    ? '（金币价值 ' + GS.goldValue() + '）' : drag.bkey === 'gas'
    ? '（3×3 内提速）' : '（车厢攻击 +' + Math.round(GS.wagonAtkBonus() * 100) + '%）'));
  UI.renderDeck();
};

// ---- 开波（原「发车」）-----------------------------------------------------------
UI.onDepart = function () {
  if (typeof CLOCK === 'undefined') return;
  if (!CLOCK.isDay() || GS.gameOver || GS.levelDone) return;   // v1.7.0：通关后不许开波
  if (!ENG.startNight()) { UI.setStatus('还没有成环的铁轨，发不了车'); return; }
  UI.setStatus('怪物来袭！'); 
};

// ---- 失败重开 ---------------------------------------------------------------------
UI.onRestart = function () {
  // v1.7.0（§14.62）：关卡模式下失败层按钮即「重打本关」——同一关重开（地形/波次照旧）
  if (GS.mode === 'level') { UI.onStartLevel(GS.levelIdx); return; }
  ENG.restart();
  UI.overOverlay.classList.add('hidden');
  UI.renderDeck();                                   // v1.4：牌库随重开清空
  UI.trainSel = null;                                // v1.6.13：长按状态随重开清空
  UI.setStatus('新的挑战开始');
};

// ---- v1.7.0 关卡模式（§14.62 大王令"两种挑战模式"）--------------------------------
// 开一关：胜利层「下一关/重打本关」、失败层「重打本关」、菜单选关的统一入口。
//   重开新局 + 收掉胜/败弹层 + 清牌库/长按态（与 onRestart 同套收尾）。
UI.onStartLevel = function (idx) {
  GS.startLevel(idx);
  if (UI.winOverlay) UI.winOverlay.classList.add('hidden');
  UI.overOverlay.classList.add('hidden');
  UI.renderDeck();
  UI.trainSel = null;
  UI._modePendingReset();
};
// 回随机模式（胜利层/失败层/菜单统一入口）：模式切回 + 全量重开一局随机挑战。
UI.onModeRandom = function () {
  GS.mode = 'random';
  GS.levelIdx = -1;
  ENG.restart();
  if (UI.winOverlay) UI.winOverlay.classList.add('hidden');
  UI.overOverlay.classList.add('hidden');
  UI.renderDeck();
  UI.trainSel = null;
  UI._modePendingReset();
};
// 菜单内**两步确认**（§14.62 大王拍板"切换即重开新局 + 二次确认"）：
//   首点 → 按钮文字变确认文案（4s 超时自动复位）；4s 内再点同一键才真正生效。
//   换键/开合菜单也会复位 —— 防误触丢局的轻量确认，不弹系统对话框。
UI.modeConfirm = function (btn, confirmText, action) {
  if (UI._modePending && UI._modePending.btn === btn) {      // 第二次点同一键 → 生效
    var act = UI._modePending.action;
    UI._modePendingReset();
    act();
    // v1.7.2（大王令）：确认生效即关闭菜单弹框（menuOpenFlag 标志位判——沙箱桩无
    //   classList.contains，直接看开层标志；onMenuClose 自带 paused 恢复）
    if (UI.menuOpenFlag && UI.onMenuClose) UI.onMenuClose();
    return;
  }
  UI._modePendingReset();                                    // 换键：旧的复位再挂新的
  UI._modePending = { btn: btn, orig: btn.textContent, action: action,
                      timer: setTimeout(UI._modePendingReset, 4000) };
  btn.textContent = confirmText;
  if (UI.modeHint) UI.modeHint.textContent = '再点一次确认（会重开新局）';
};
UI._modePendingReset = function () {
  if (!UI._modePending) return;
  if (UI._modePending.timer) clearTimeout(UI._modePending.timer);
  if (UI._modePending.btn) UI._modePending.btn.textContent = UI._modePending.orig;
  UI._modePending = null;
  if (UI.modeHint) UI.modeHint.textContent = '';
};
// 菜单打开时刷新「关卡模式」区块：当前模式高亮（active 描边）、未解锁禁用、
//   已通关的关打 ✓；底部提示已通关进度。开层即复位两步确认态。
UI.refreshModeButtons = function () {
  UI._modePendingReset();
  if (!UI.btnModeRandom) return;
  cls(UI.btnModeRandom, 'active', GS.mode !== 'level');
  var prog = (typeof GS.levelProgress === 'function') ? GS.levelProgress() : -1;
  for (var i = 0; i < UI.lvBtns.length; i++) {
    var b = UI.lvBtns[i], idx = +b.getAttribute('data-lv');
    var cur = GS.mode === 'level' && GS.levelIdx === idx;
    cls(b, 'active', cur);
    b.disabled = !(typeof GS.levelUnlocked === 'function' && GS.levelUnlocked(idx));
    b.textContent = '第' + (idx + 1) + '关' + (cur && prog >= idx ? '✓' : '');
  }
  if (UI.modeHint) UI.modeHint.textContent =
    '已通关：' + (prog < 0 ? '暂无' : '第' + (prog + 1) + '关');
};
// classList 布尔助手（沙箱桩只有 add/remove，没有 toggle/contains —— v1.6.71 教训）
function cls(el, name, on) { if (on) el.classList.add(name); else el.classList.remove(name); }

// v1.6.39 提示行退役（大王令"已入牌库之类的提示文本感觉没有太有必要"）：
//   #status 元素与其样式已删。约 40 处 setStatus 调用大多长在条件分支里、承担
//   return 前的播报职责（如金币不足 / 非法落位）——控制流一行不动，只摘掉显示端，
//   函数退化为 no-op。失败反馈由"卡弹回牌库"的动效天然承担。
UI.setStatus = function () {};

// 缩放适配（v1.3-rc 修复：重写 ui.js 时丢失，main.js 首帧前调它抛 TypeError，
//   主循环根本没启动 → 画布全空）。等比缩放 #app 贴合窗口。
UI.resize = function () {
  var s = Math.min(window.innerWidth / CFG.CANVAS_W, window.innerHeight / CFG.CANVAS_H);
  document.getElementById('app').style.transform = 'scale(' + s + ')';
};

// ---- 调试导出：把当前盘面序列化成可直接重放的文本，复制到剪贴板 ----
// 格式与 test_rail.js 的 setupFromRows 同源：
//   '#'=废墟 '.'=空地 'C'=镇中心 'E'=经济建筑 'M'=铸币所 'F'=加油站 'G'=金币地块 'T'=塔
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
      if (cell.b) {
        var bt = cell.b.type;
        // v1.6.23：M=铸币所 / F=加油站；v1.6.35：A=军工厂（沿用 E=经济建筑、T=塔）
        ch = (bt === 'core') ? 'C' : (bt === 'tower') ? 'T'
           : (bt === 'mint') ? 'M' : (bt === 'gas') ? 'F'
           : (bt === 'factory') ? 'A' : 'E';
      }
      // v0.6.12：金币格初始埋在废墟里（t='rubble'）→ 小写 g；清出来后才大写 G。
      else if (cell.gold) ch = (cell.t === 'rubble') ? 'g' : 'G';
      // v1.6.22：爱心格同口径 → 小写 h（仍在废墟）/ 大写 H（已清出）。
      else if (cell.heart) ch = (cell.t === 'rubble') ? 'h' : 'H';
      s += ch;
    }
    rows.push(s);
  }
  var rail = GS.railPath || [];
  var lines = ['KDG-MAP v1 ' + new Date().toISOString()];
  lines.push('图例: #废墟 .空地 C镇中心 E经济建筑 T塔 M铸币所 F加油站 A军工厂 G金币地块(已清出) g金币地块(仍在废墟中) H爱心地块(已清出) h爱心地块(仍在废墟中)');
  Array.prototype.push.apply(lines, rows);
  // rail(N) 的 N = 步数（序列长度），不是去重格数 —— 见函数头说明
  lines.push('rail(' + rail.length + '): ' + rail.map(function (p) { return p.c + ',' + p.r; }).join(' '));
  // v1.6.66 完整性校验行（大王拍板 B 案）：**紧随 rail 行**而非全文末尾——
  //   实测病灶（2026-10-15 导出排查，沙箱 11/0）：rail 行是全文最长单行
  //   （74 项 ≈321 字符），手动复制漏选行尾一个 token（1,2）而后续 7 行完好。
  //   数量肉眼数不过来，但首尾格一眼可辨：粘贴后 rail 行应以 tail 格收尾、
  //   以 head 格开头，rail= 应与坐标个数一致。解析器按行前缀匹配，此行天然被跳过。
  if (rail.length) {
    lines.push('check: rail=' + rail.length + ' head=' + rail[0].c + ',' + rail[0].r +
               ' tail=' + rail[rail.length - 1].c + ',' + rail[rail.length - 1].r);
  }
  lines.push('train: ' + (GS.train ? GS.train.index + ',' + GS.train.frac.toFixed(2) : '-'));
  // v0.9.2：站台与车斗（站台是叠加的轨格，不改变上面的 grid 图例）
  if (typeof STATION !== 'undefined') {
    var st = STATION.slot();
    lines.push('station: ' + (st ? st.c + ',' + st.r + '@' + st.index : '-'));
  }
  lines.push('cargo: ' + (GS.train ? Math.floor(GS.train.cargo) : 0));
  // v1.6.22：车斗爱心数（到站交付时按 CFG.HEART_HEAL 回血）
  lines.push('hearts: ' + (GS.train && GS.train.hearts ? GS.train.hearts : 0));
  lines.push('gold: ' + Math.floor(GS.gold));
  // v1.3-rc：塔明细 / 怪残量 / 核心血量 / 波次 —— 报 bug 直接贴这些
  lines.push('towers: ' + GS.towers.map(function (t) {
    return t.c + ',' + t.r + ':' + t.elem + t.star + (t.affix ? '+' + t.affix : '');
  }).join(' '));
  lines.push('foes: ' + GS.foes.length + ' wave: ' + FOES.wave + ' coreHP: ' + GS.coreHP + '/' + GS.coreMaxHP);
  // v1.6.50：下一波固定刷怪点（白天预警画的就是它）—— 报预警 UI 的 bug 直接贴这行
  lines.push('nextSpawns: ' + (GS.nextSpawns || []).map(function (p) {
    return p.c.toFixed(2) + ',' + p.r.toFixed(2) + '×' + p.count;
  }).join(' '));
  return lines.join('\n');
};

UI.onExport = function () {
  var text = UI.exportMap();
  var finish = function (ok) {
    // v1.6.71：菜单开着时反馈进弹层（HUD 状态栏被弹层盖住），否则走老路径
    UI.toolFeedback(ok, '✓ 已复制地图数据，直接粘贴即可（' + text.length + ' 字符）',
                       '自动复制失败，请在弹窗里手动复制');
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
    // v1.6.71：同导出地图——菜单开着时反馈进弹层
    UI.toolFeedback(ok, '✓ 已复制行为记录（' + LOG.count() + ' 条事件）',
                       '自动复制失败，请在弹窗里手动复制');
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

// ---- v1.6.67 工具菜单（大王令）：导入/导出地图、导出记录、强制刷新统一收纳 ----
//   点开暂停游戏（GS.paused），关闭恢复打开前的暂停态（词条弹层等场景不打架）。
//   之后新增工具类功能一律挂进这个弹层，不再往 HUD 加按钮。
UI.onMenuOpen = function () {
  UI.menuPrevPaused = GS.paused;              // 关闭时原样恢复（含词条弹层已暂停的场景）
  GS.paused = true;
  UI.menuOpenFlag = true;                     // v1.6.71：开合标志（反馈分流用；classList.contains 沙箱桩不可用）
  UI.menuHint.textContent = '';
  UI.menuHint.classList.remove('err');
  UI.menuHint.classList.remove('ok');
  if (UI._menuHintTimer) { clearTimeout(UI._menuHintTimer); UI._menuHintTimer = null; }
  if (UI._importCloseTimer) { clearTimeout(UI._importCloseTimer); UI._importCloseTimer = null; }  // v1.6.72
  UI.menuOverlay.classList.remove('hidden');
  // v1.7.0（§14.62）：开层刷新「关卡模式」区块（当前模式高亮/锁定禁用/进度提示），
  //   并复位两步确认态（确认不跨开合存活，防回来一上手就误触发旧确认）。
  if (typeof UI.refreshModeButtons === 'function') UI.refreshModeButtons();
};
UI.onMenuClose = function () {
  UI.menuOverlay.classList.add('hidden');
  UI.menuOpenFlag = false;
  GS.paused = UI.menuPrevPaused || false;
  if (typeof UI._modePendingReset === 'function') UI._modePendingReset();   // v1.7.0：确认态随关层复位
};
// v1.6.71（大王令）工具成功反馈：弹层内绿色提示 + 3s 自动消退。
//   动机 = 导出/记录成功的 setStatus 写 HUD 状态栏，被全屏菜单弹层盖住看不见。
UI.menuHintOk = function (msg) {
  if (!UI.menuHint) return;
  UI.menuHint.textContent = msg;
  UI.menuHint.classList.remove('err');
  UI.menuHint.classList.add('ok');
  if (UI._menuHintTimer) clearTimeout(UI._menuHintTimer);
  UI._menuHintTimer = setTimeout(function () {
    UI.menuHint.textContent = '';
    UI.menuHint.classList.remove('ok');
    UI._menuHintTimer = null;
  }, 3000);
};
// 复制类工具的反馈分流：菜单开着 → 弹层内提示；否则 HUD 状态栏（老路径）。
UI.toolFeedback = function (ok, okMsg, errMsg) {
  if (UI.menuOpenFlag) UI.menuHintOk(ok ? okMsg : errMsg);
  else UI.setStatus(ok ? okMsg : errMsg);
};
// v1.6.70（大王拍板 A 案）：粘贴区常驻，砍掉【导入地图】按钮与展开状态机
//   （原 onMenuImport 显隐切换 + onMenuOpen 复位共 ~10 行状态切换代码）。
UI.onMenuImportGo = function () {
  var err = GS.importMap(UI.importText.value);
  if (err) {                                  // 失败：盘面原地不动，弹层内报错
    UI.menuHint.textContent = err;
    UI.menuHint.classList.remove('ok');
    UI.menuHint.classList.add('err');
    return;
  }
  // v1.6.72：setStatus 已退役为 no-op（v1.6.39 大王令）→ 成功反馈必须在弹层内看见。
  //   绿字驻留 + 1.2s 自动收层（看到"成功"再收，比瞬间关层可感）。
  UI.menuHintOk('✓ 导入成功：铁轨 ' + GS.railPath.length + ' 步（波次 ' +
    (typeof FOES !== 'undefined' ? FOES.wave : 0) + '）');
  UI.importText.value = '';                   // 清粘贴区防误重复导入
  if (UI._importCloseTimer) clearTimeout(UI._importCloseTimer);
  UI._importCloseTimer = setTimeout(function () {
    UI._importCloseTimer = null;
    if (UI.menuOpenFlag) UI.onMenuClose();    // guard：手动先关过就不再动暂停态
  }, 1200);
};
UI.onMenuForce = function () {                // v1.6.72：不再先关层——完成反馈走弹层绿字
  if (UI._forcing) return;
  UI.menuHint.textContent = '强制刷新中…界面会卡住几秒';   // 先渲染出去再冻结（下方 setTimeout）
  UI.menuHint.classList.remove('ok');
  UI.menuHint.classList.remove('err');
  UI.onForceRefresh(function (msg) { UI.menuHintOk(msg); });
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

UI.railShape = function () {       // 环形态摘要（v1.6.69 强刷反馈用）：步数/去重格/十字数
  var m = {}, i, k, cells = 0, cross = 0;
  for (i = 0; i < GS.railPath.length; i++) {
    k = GS.railPath[i].c + ',' + GS.railPath[i].r;
    m[k] = (m[k] || 0) + 1;
  }
  for (k in m) { cells++; if (m[k] >= 2) cross++; }
  return { steps: GS.railPath.length, cells: cells, cross: cross };
};

UI.onForceRefresh = function (onDone) {
  if (UI._forcing) return;                       // 防连点：同步求解期间按钮本来也点不动
  UI._forcing = true;
  var before = UI.railShape(), beforeCov = UI.railCov();
  var report = onDone || function () {};         // v1.6.72：完成反馈走回调（setStatus 已退役 no-op；"重算中"提示由入口自己写）
  // 让入口的提示先渲染出去，再开始同步求解（否则整段是直接卡死，看不出在算）
  setTimeout(function () {
    var t = Date.now();
    GS.forceRefresh = true;
    try { GS.recomputeRails(); }
    finally { GS.forceRefresh = false; UI._forcing = false; }
    var after = UI.railShape(), afterCov = UI.railCov();
    var sec = ((Date.now() - t) / 1000).toFixed(1);
    // v1.6.69：报真差异（步数/十字）——轮廓覆盖强刷前后常恒等，报它等于说"没效果"
    if (before.steps === after.steps && before.cross === after.cross && beforeCov === afterCov) {
      report('✓ 强刷完成：环无变化——放开预算重算无更优（' + after.steps +
        ' 步/十字 ' + after.cross + '，' + sec + 's）');
    } else {
      var msg = '✓ 强刷完成：' + before.steps + '→' + after.steps + ' 步、十字 ' +
        before.cross + '→' + after.cross;
      if (beforeCov !== afterCov) msg += '、轮廓覆盖 ' + beforeCov + '→' + afterCov;
      report(msg + '（' + sec + 's）');
    }
  }, 30);
};

UI.tick = function () {
  // 作战拉远（v1.6.38/39/40 终态）：夜晚 footer 淡出（class + CSS opacity .5s），
  //   牌库/按钮/状态栏随层全藏；隐藏中 pointer-events:none 防透明期误触。
  //   只在相位翻转时动 DOM；暂停期间 CLOCK 停 ⇒ 相位不变 ⇒ footer 状态稳定。
  var battle = !(typeof CLOCK !== 'undefined' && CLOCK.isDay());
  if (UI.footer && UI._battleHidden !== battle) {
    UI.footer.classList.toggle('battle-hidden', battle);
    UI._battleHidden = battle;
  }
  // v1.6.34：经验攒满 → 弹**词条三选一**（不用点抽卡；一次消费一条，弹层未关不重复弹）
  //   v1.7.0：关卡通关后不再弹（胜利层后面不许再派卡）
  if ((GS.expPending || 0) > 0 && !GS.levelDone && UI.offerOverlay.classList.contains('hidden') &&
      typeof EXP !== 'undefined' && EXP.consume()) {
    UI.showOffer(GS.drawAffixOffer());
  }
  var day = UI.isDay();
  UI.gold.textContent = Math.floor(GS.gold);
  // v1.4.7：车斗 HUD 刷新已退役（车上浮字 +N 唯一显示，见 UI.init 注释）
  // 城墙血量（低血变红）与波次
  if (UI.core) {
    UI.core.textContent = Math.max(0, Math.ceil(GS.coreHP));
    UI.core.style.color = GS.coreHP <= GS.coreMaxHP * 0.3 ? '#e8563f' : '';
  }
  if (UI.wave) {
    // v1.7.0：关卡模式波次显示 n/10（§14.62），随机模式维持原样
    UI.wave.textContent = (GS.mode === 'level')
      ? ((FOES.wave > 0 ? FOES.wave : 0) + '/' + (typeof LEVEL_WAVES !== 'undefined' ? LEVEL_WAVES : 10))
      : (FOES.wave > 0 ? FOES.wave : '-');
  }
  var drawCost = GS.drawCost();                    // v1.4.4/v1.4.8：线性递增价（5+5×已抽次数）
  UI.btnSummon.disabled = !day || GS.gold < drawCost || GS.levelDone;   // v1.7.0：通关锁抽卡
  UI.btnSummon.textContent = '抽卡(' + drawCost + ')';
  // v1.4.5：撤销按钮 —— 有可撤销点且白天才可点；v1.6.61：跨波撤销点一并禁用
  if (UI.btnUndo) UI.btnUndo.disabled = !day || !GS.undoClean ||
    (GS.undoClean.wave || 0) !== ((typeof FOES !== 'undefined') ? FOES.wave : 0);
  // 开波按钮：建造阶段「开波」，防守阶段显示倒计时 / 波次；非建造阶段不可点
  //   v1.7.0：关卡通关后一并禁用（胜利层压场，不许再开第 11 波）
  if (UI.btnDepart) {
    UI.btnDepart.disabled = !day || GS.levelDone;
    UI.btnDepart.textContent = day ? '开波'
      : (typeof CLOCK !== 'undefined' ? CLOCK.label() : '开波');
  }
  // 失败遮罩（GS.gameOver 由 foes.js 置位）
  if (GS.gameOver && UI.overOverlay.classList.contains('hidden')) {
    UI.overWave.textContent = '坚守波次：' + FOES.wave;
    // v1.7.0（§14.62）：关卡模式按钮文案「重打本关」+ 显示「回随机模式」
    var lv = GS.mode === 'level';
    UI.btnRestart.textContent = lv ? '重打本关' : '重新开始';
    cls(UI.overBox, 'lv', lv);
    UI.overOverlay.classList.remove('hidden');
  }
  // 关卡通关弹层（v1.7.0：GS.levelDone 由 clock.notifyStation 置位，§14.62）
  if (GS.levelDone && UI.winOverlay.classList.contains('hidden')) {
    var lastLv = GS.levelIdx >= LEVELS.length - 1;
    UI.winInfo.textContent = '第' + (GS.levelIdx + 1) + '关 · ' + LEVELS[GS.levelIdx].name +
      ' · ' + (typeof LEVEL_WAVES !== 'undefined' ? LEVEL_WAVES : 10) + '波全清' +
      (lastLv ? '（五关全部通关！）' : '');
    UI.btnNextLevel.disabled = lastLv;     // 下一关在 notifyStation 里已随通关解锁
    UI.winOverlay.classList.remove('hidden');
  }
};
