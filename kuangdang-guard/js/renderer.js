// 渲染：空白/废墟地形 + 动态铁轨环 + 经济建筑/镇中心 + 列车
window.REND = {};

REND.C = {
  bg: '#14161d',
  blank: '#20242f',
  rubble: '#2c2620',
  rail: '#7a8090',
  core: '#e08c33',
  econ: '#35b06a',
  gold: '#f0b429',
  ok: 'rgba(61,220,106,0.18)',
  okl: 'rgba(61,220,106,0.9)',
  bad: 'rgba(232,70,58,0.25)'
};

REND.draw = function (ctx, L, hover) {
  ctx.clearRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H);
  ctx.fillStyle = REND.C.bg;
  ctx.fillRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H);

  // 地形
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var t = GS.grid[r][c].t;
      if (t === 'rubble') {
        ctx.fillStyle = REND.C.rubble;
        ctx.fillRect(L.x + c * L.cell, L.y + r * L.cell, L.cell, L.cell);
        // 废墟裂纹
        ctx.strokeStyle = 'rgba(232,70,58,0.28)';
        ctx.lineWidth = 1;
        var cx = CFG.ccx(L, c), cy = CFG.ccy(L, r), s = L.cell * 0.22;
        ctx.beginPath();
        ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
        ctx.moveTo(cx - s * 0.4, cy + s * 0.6); ctx.lineTo(cx + s * 0.6, cy - s * 0.4);
        ctx.stroke();
      } else {
        ctx.fillStyle = REND.C.blank;
        ctx.fillRect(L.x + c * L.cell, L.y + r * L.cell, L.cell, L.cell);
      }
    }
  }

  // 动态铁轨环
  var path = GS.railPath;
  if (path.length) {
    ctx.strokeStyle = REND.C.rail;
    ctx.lineWidth = 4;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.beginPath();
    // 关键：每一对相邻格都必须画出自己的线段，绝不能跳段。
    // 旧实现 i==0 时只 moveTo(path[0])、不画 path[0]→path[1]，下一笔直连 path[2]：
    // 当 path[1] 处拐直角，path[0]→path[2] 连线就是一条真 45° 斜线（列车按 railPath 走所以位置正确，画面却斜了）。
    ctx.moveTo(CFG.ccx(L, path[0].c), CFG.ccy(L, path[0].r));
    for (var i = 0; i < path.length; i++) {
      var p = path[i];
      var p2 = path[(i + 1) % path.length];
      if (Math.abs(p.c - p2.c) === 1 && Math.abs(p.r - p2.r) === 1) {
        // 兜底（railPath 正常不含对角步）：只在“空白补角”拆 L；
        // 两角皆废墟则断笔跳过该步 —— 绝不画 45°，绝不压废墟。
        var kc = p2.c, kr = p.r;
        var blank = !!(GS.grid[kr] && GS.grid[kr][kc] && GS.grid[kr][kc].t === 'blank' && !GS.grid[kr][kc].b);
        if (!blank) { kc = p.c; kr = p2.r; blank = !!(GS.grid[kr] && GS.grid[kr][kc] && GS.grid[kr][kc].t === 'blank' && !GS.grid[kr][kc].b); }
        if (blank) {
          ctx.lineTo(CFG.ccx(L, kc), CFG.ccy(L, kr));
          ctx.lineTo(CFG.ccx(L, p2.c), CFG.ccy(L, p2.r));
        } else {
          ctx.moveTo(CFG.ccx(L, p2.c), CFG.ccy(L, p2.r));
        }
      } else {
        ctx.lineTo(CFG.ccx(L, p2.c), CFG.ccy(L, p2.r));
      }
    }
    ctx.stroke();
  }

  // 建筑
  for (var k = 0; k < GS.buildings.length; k++) REND.building(ctx, L, GS.buildings[k]);

  // 列车
  if (path.length) {
    var tp = ENG.trainPos();
    ctx.save();
    ctx.translate(tp.x, tp.y);
    ctx.rotate(ENG.trainAngle());
    ctx.fillStyle = '#4B3FE3';
    ctx.fillRect(-11, -7, 22, 14);
    ctx.restore();
  }

  // 网格
  ctx.strokeStyle = 'rgba(255,255,255,0.1)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (var gc = 0; gc <= CFG.MAP_COLS; gc++) {
    var gx = L.x + gc * L.cell;
    ctx.moveTo(gx, L.y); ctx.lineTo(gx, L.y + L.h);
  }
  for (var gr = 0; gr <= CFG.MAP_ROWS; gr++) {
    var gy = L.y + gr * L.cell;
    ctx.moveTo(L.x, gy); ctx.lineTo(L.x + L.w, gy);
  }
  ctx.stroke();

  // 工具预览
  if (GS.selToken) REND.tokenGhost(ctx, L, hover);
};

REND.building = function (ctx, L, b) {
  var cx = CFG.ccx(L, b.c), cy = CFG.ccy(L, b.r), s = L.cell * 0.72;
  ctx.save();
  if (b.type === 'core') {
    ctx.fillStyle = REND.C.core; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('城', cx, cy);
  } else if (b.type === 'econ') {
    ctx.fillStyle = REND.C.econ;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    // 屋顶
    ctx.fillStyle = '#1f7a4d';
    ctx.beginPath();
    ctx.moveTo(cx - s / 2, cy - s * 0.05);
    ctx.lineTo(cx, cy - s / 2 - s * 0.18);
    ctx.lineTo(cx + s / 2, cy - s * 0.05);
    ctx.closePath(); ctx.fill();
    // 金币点
    ctx.fillStyle = REND.C.gold; ctx.beginPath(); ctx.arc(cx, cy + s * 0.2, 3.4, 0, 7); ctx.fill();
    if (b.flash > 0) {
      ctx.strokeStyle = 'rgba(240,180,41,' + (b.flash * 3) + ')'; ctx.lineWidth = 2;
      ctx.strokeRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2);
    }
  }
  ctx.restore();
};

// 工具预览：形状覆盖格高亮 / 经济建筑合法格
REND.tokenGhost = function (ctx, L, hover) {
  var tk = GS.selToken;
  if (tk.kind === 'shape') {
    if (hover) {
      var ok = true;
      var pts = [];
      for (var i = 0; i < tk.cells.length; i++) {
        var c = hover.c + tk.cells[i][0], r = hover.r + tk.cells[i][1];
        if (!CFG.inBounds(c, r) || GS.grid[r][c].b) { ok = false; pts.push({ c: c, r: r }); continue; }
        pts.push({ c: c, r: r });
      }
      ctx.fillStyle = REND.C.ok;
      for (var j = 0; j < pts.length; j++) {
        if (!CFG.inBounds(pts[j].c, pts[j].r)) continue;
        ctx.fillRect(L.x + pts[j].c * L.cell, L.y + pts[j].r * L.cell, L.cell, L.cell);
      }
      ctx.strokeStyle = ok ? REND.C.okl : REND.C.bad;
      ctx.lineWidth = 2;
      for (var q = 0; q < pts.length; q++) {
        if (!CFG.inBounds(pts[q].c, pts[q].r)) continue;
        ctx.strokeRect(L.x + pts[q].c * L.cell + 1, L.y + pts[q].r * L.cell + 1, L.cell - 2, L.cell - 2);
      }
    }
  } else {
    var needRail = tk.kind === 'econ';
    for (var r = 0; r < CFG.MAP_ROWS; r++) {
      for (var c = 0; c < CFG.MAP_COLS; c++) {
        var cell = GS.grid[r][c];
        if (cell.t !== 'blank' || cell.b) continue;
        if (GS.onRail(c, r)) continue;
        if (needRail && !GS.railNeighbor(c, r)) continue;
        ctx.fillStyle = REND.C.ok;
        ctx.fillRect(L.x + c * L.cell, L.y + r * L.cell, L.cell, L.cell);
      }
    }
    if (hover && CFG.inBounds(hover.c, hover.r)) {
      var hc = GS.grid[hover.r][hover.c];
      var valid = hc.t === 'blank' && !hc.b && !GS.onRail(hover.c, hover.r) &&
        (!needRail || GS.railNeighbor(hover.c, hover.r));
      ctx.strokeStyle = valid ? REND.C.okl : REND.C.bad;
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x + hover.c * L.cell + 1, L.y + hover.r * L.cell + 1, L.cell - 2, L.cell - 2);
    }
  }
};