// 渲染：简单几何 + 色块（贴图槽位预留，后续可换正式美术）
window.REND = {};

REND.C = {
  bg: '#14161d',
  zone: ['#1a1d27', '#1e2230', null, '#14281e', '#2a2118'],
  rail: '#565b66',
  railLight: '#7a8090',
  env: '#2b3a2b',
  core: '#e08c33',
  station: '#2aa89a',
  turret: '#8a94a6',
  mine: '#5c6ac4',
  boiler: '#cf5b3f',
  hp: '#3ddc6a',
  hpBg: '#3a3f4d',
  monster: '#e8463a',
  proj: '#ffd96a',
  night: 'rgba(30,34,70,0.35)',
  ok: 'rgba(61,220,106,0.18)',
  okl: 'rgba(61,220,106,0.9)'
};

REND.draw = function (ctx, L, hover) {
  ctx.clearRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H);
  // 地图区底
  ctx.fillStyle = REND.C.bg;
  ctx.fillRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H);

  // 地块底（Zone）
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var z = CFG.zoneAt(c, r);
      var col = REND.C.zone[z];
      if (!col) continue;
      ctx.fillStyle = col;
      ctx.fillRect(L.x + c * L.cell, L.y + r * L.cell, L.cell, L.cell);
    }
  }

  // 铁轨（可通行环）+ 连接
  var path = GS.railPath;
  ctx.strokeStyle = REND.C.railLight;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (var i = 0; i < path.length; i++) {
    var pc = path[i];
    var p2 = path[(i + 1) % path.length];
    var x1 = CFG.ccx(L, pc.c), y1 = CFG.ccy(L, pc.r);
    var x2 = CFG.ccx(L, p2.c), y2 = CFG.ccy(L, p2.r);
    if (i === 0) ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
  }
  ctx.stroke();

  // 环境地块（装饰）
  for (r = 0; r < CFG.MAP_ROWS; r++) {
    for (c = 0; c < CFG.MAP_COLS; c++) {
      var t = GS.grid[r][c].terrain;
      if (!t) continue;
      var cx = CFG.ccx(L, c), cy = CFG.ccy(L, r);
      if (t === 'tree') {
        ctx.fillStyle = '#3c7a46'; ctx.beginPath(); ctx.arc(cx, cy - 1, 6, 0, 7); ctx.fill();
        ctx.fillStyle = '#5c4a32'; ctx.fillRect(cx - 1.5, cy + 4, 3, 5);
      } else { // hill
        ctx.fillStyle = '#6b5a3f'; ctx.beginPath(); ctx.arc(cx, cy - 2, 6, Math.PI, 0); ctx.fill();
      }
    }
  }

  // 建筑
  for (var k = 0; k < GS.buildings.length; k++) {
    REND.building(ctx, L, GS.buildings[k]);
  }

  // 怪物
  for (var m = 0; m < GS.monsters.length; m++) {
    var mo = GS.monsters[m];
    if (mo.dead) continue;
    var rad = 6 + 3 * (mo.hp / mo.hpMax);
    ctx.fillStyle = REND.C.monster; ctx.beginPath(); ctx.arc(mo.x, mo.y, rad, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.arc(mo.x, mo.y, rad * 0.45, 0, 7); ctx.fill();
  }

  // 列车
  var tp = ENG.trainPos();
  ctx.save();
  ctx.translate(tp.x, tp.y);
  ctx.rotate(ENG.trainAngle());
  ctx.fillStyle = GS.steam > 0 ? '#ffd96a' : '#4B3FE3';
  ctx.fillRect(-11, -7, 22, 14);
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(String(GS.train.cargo), 0, 0.5);
  ctx.restore();

  // 弹道
  for (var p = 0; p < GS.projectiles.length; p++) {
    var pr = GS.projectiles[p];
    ctx.globalAlpha = pr.life / pr.max;
    ctx.strokeStyle = REND.C.proj; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(pr.x, pr.y); ctx.lineTo(pr.tx, pr.ty); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 夜晚染色
  if (GS.phase === 'night') { ctx.fillStyle = REND.C.night; ctx.fillRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H); }

  // 地块网格线（辅助观察每个地块边界）
  ctx.strokeStyle = 'rgba(255,255,255,0.14)';
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

  // 放置提示
  if (GS.selOffer) REND.placeGhost(ctx, L, hover);
};

REND.placeGhost = function (ctx, L, hover) {
  var def = BUILD.DEF[GS.selOffer];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      if (CFG.isTrack(c, r) || GS.buildingAt(c, r)) continue;
      if (!BUILD.canPlace(def, CFG.zoneAt(c, r), GS.adjRail(c, r))) continue;
      ctx.fillStyle = REND.C.ok;
      ctx.fillRect(L.x + c * L.cell, L.y + r * L.cell, L.cell, L.cell);
    }
  }
  if (hover) {
    ctx.strokeStyle = REND.C.okl; ctx.lineWidth = 2;
    ctx.strokeRect(L.x + hover.c * L.cell + 1, L.y + hover.r * L.cell + 1, L.cell - 2, L.cell - 2);
  }
};

REND.building = function (ctx, L, b) {
  var cx = CFG.ccx(L, b.c), cy = CFG.ccy(L, b.r), cs = L.cell;
  var s = cs * 0.72;
  ctx.save();
  if (b.type === 'core') {
    ctx.fillStyle = REND.C.core; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('E', cx, cy);
  } else if (b.type === 'station') {
    ctx.fillStyle = REND.C.station; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('站', cx, cy);
  } else if (b.type === 'turret') {
    ctx.fillStyle = REND.C.turret; ctx.beginPath(); ctx.arc(cx, cy, s * 0.36, 0, 7); ctx.fill();
    ctx.fillStyle = '#2c3038'; ctx.beginPath(); ctx.arc(cx, cy, s * 0.16, 0, 7); ctx.fill();
    // 弹药条
    var ar = b.ammoMax ? Math.max(0, b.ammo / b.ammoMax) : 0;
    ctx.fillStyle = '#a0202060'; ctx.fillRect(cx - s / 2, cy + s * 0.42, s, 3);
    ctx.fillStyle = ar > 0.25 ? '#ffd96a' : '#e8463a';
    ctx.fillRect(cx - s / 2, cy + s * 0.42, s * ar, 3);
  } else if (b.type === 'mine') {
    ctx.fillStyle = REND.C.mine; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 8px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('矿' + b.stock, cx, cy);
  } else if (b.type === 'boiler') {
    ctx.fillStyle = REND.C.boiler; ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('B', cx, cy);
  }
  // 血条（未满血或可毁）
  if (!b.invincible && b.hp < b.hpMax) {
    var bw = s, bx = cx - bw / 2, by = cy - s / 2 - 5;
    ctx.fillStyle = REND.C.hpBg; ctx.fillRect(bx, by, bw, 3);
    ctx.fillStyle = REND.C.hp; ctx.fillRect(bx, by, bw * Math.max(0, b.hp / b.hpMax), 3);
  }
  ctx.restore();
};