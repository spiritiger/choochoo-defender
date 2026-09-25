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
  railLine: '#c3c9d6',   // v0.7.0 贴片双线（亮灰，暗底上清晰；替代旧单线色 rail）
  railChev: '#f4f7fc',   // 方向箭头（比轨线更亮一档）
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
      // 金币地块（v0.6.12 起内部是"废墟 + 金币"，属障碍物）**外观保持原样**：
      // 仍按空白底 + 金币图标画，不走废墟纹理，视觉上与改动前完全一致。
      if (t === 'rubble' && !GS.grid[r][c].gold) {
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
        // 金币地块：开局埋在废墟里（不可铺轨），清出来后才成为真正的空地：
        // 可铺轨、列车驶入 +5，一圈只算一次，跑完一圈重置。
        // 底色与普通空白格完全一致（v0.6.7 大王定案：不叠黄色 tint——
        // 深灰叠暗黄会变成废墟般的棕褐色，看起来像障碍物），只用金币图标区分。
        // 未收 = 实心金币；本圈已收 = 空心圈（跑完一圈自动变回实心）。
        var gc = GS.grid[r][c];
        if (gc.gold) {
          var gx = CFG.ccx(L, c), gy = CFG.ccy(L, r), gr = L.cell * 0.26;
          ctx.beginPath();
          ctx.arc(gx, gy, gr, 0, 7);
          if (gc.harvested) {
            ctx.strokeStyle = 'rgba(240,180,41,0.4)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          } else {
            ctx.fillStyle = REND.C.gold;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.55)';
            ctx.lineWidth = 1;
            ctx.stroke();
          }
          if (gc.flash > 0) {
            ctx.strokeStyle = 'rgba(240,180,41,' + (gc.flash * 3) + ')';
            ctx.lineWidth = 2;
            ctx.strokeRect(L.x + c * L.cell + 1, L.y + r * L.cell + 1, L.cell - 2, L.cell - 2);
          }
        }
      }
    }
  }

  // 动态铁轨（v0.7.0 贴片化）：GS.railPath 是**有序**闭环序列，逐格按"用到的边方向"
  // 选贴片（直线 / 弯道 / 十字，双线样式仿大王参考图），并按行车方向画箭头。
  // 生成逻辑一行不动 —— 贴片只是同一条 railPath 的另一种画法（几何口径见 REND.railTiles）。
  var path = GS.railPath;
  if (path.length) REND.railTiles(ctx, L, path);

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

// ---- 铁轨贴片（v0.7.0）-----------------------------------------------------
// railPath 的几何不变量（证明见 state.js 头注释）：相邻格正交、每条边最多走一次、
// 每格度数为偶数（网格里即 2 或 4）。据此每个轨格恰属三类之一：
//   度 2 对向（N+S 或 E+W）→ **直线**贴片（横 / 竖）
//   度 2 相邻（如 N+E）    → **弯道**贴片（4 朝向：圆心在该格角上、半径 h∓d 的两道四分之一弧）
//   度 4                   → **十字**贴片（该格被走两次；straightenRing 配对保证两趟都直行 → 必是「+」）
// 度 3 数学上不可能（闭合迹每格度数必偶），防御分支按十字画（缺臂不会发生）。
// 双线样式：线间距 2d（d = 0.12·格宽），线宽 0.075·格宽；直线/十字贯通到格边，
// 相邻贴片在格边上无缝对接。旧折线版"拐角抄近路画成 45° 斜线"的坑，贴片化后天然不存在。
// 方向箭头：每格每次经过画一枚、指向该趟行进方向（= railPath 里 前格→后格 的合成方向；
// 单环天然严格单向，箭头只是显示出来 —— 整段不想显示时删掉画箭头的循环即可）。
REND.railTiles = function (ctx, L, path) {
  var n = path.length, i, k;
  // 1) 扫描：每格的边方向使用集（N E S W）+ 每趟行进方向
  //    ⚠️ 一条边要标**两端**：a 记"朝向 b"，b 记"朝向 a" —— 只标一端每格只攒到 1 个方向，
  //    会全部掉进防御分支画成十字（首轮验证抓到的真 bug）。
  var use = {}, pass = {};
  function markDir(p, dx, dy) {
    var kk = p.c + ',' + p.r, uu = use[kk];
    if (!uu) { uu = use[kk] = [0, 0, 0, 0]; pass[kk] = []; }
    if (dx === 1) uu[1] = 1; else if (dx === -1) uu[3] = 1;
    else if (dy === -1) uu[0] = 1; else uu[2] = 1;
  }
  for (i = 0; i < n; i++) {
    var a = path[i], b = path[(i + 1) % n], pv = path[(i - 1 + n) % n];
    var dx = b.c - a.c, dy = b.r - a.r;              // a → b 这条边
    markDir(a, dx, dy);
    markDir(b, -dx, -dy);
    // 行进方向 = prev → next：直线时即轴向；弯道时是两臂合方向（指向弧中切线，对角向）
    pass[a.c + ',' + a.r].push([b.c - pv.c, b.r - pv.r]);
  }
  // 2) 逐格画贴片
  var s = L.cell, h = s / 2, d = s * 0.12;
  ctx.lineCap = 'butt';
  ctx.strokeStyle = REND.C.railLine;
  ctx.lineWidth = Math.max(1.6, s * 0.075);
  for (k in use) {
    var cc = k.split(',');
    var c = +cc[0], r = +cc[1];
    var u = use[k];
    var cx = CFG.ccx(L, c), cy = CFG.ccy(L, r);
    var deg = u[0] + u[1] + u[2] + u[3];
    var straight = deg === 2 && ((u[0] && u[2]) || (u[1] && u[3]));
    var curve = deg === 2 && !straight;
    var cornerX = 0, cornerY = 0, thm = 0;           // 弯道箭头定位用（弧中点）
    ctx.beginPath();
    if (deg === 4 || (deg !== 2 && deg !== 4)) {
      // 十字（含防御分支）：横竖两对线各自贯通到格边
      ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy + h);
      ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy + h);
      ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx + h, cy - d);
      ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx + h, cy + d);
      ctx.stroke();
    } else if (straight) {
      // 直线（竖 / 横）
      if (u[0] && u[2]) {
        ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy + h);
        ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy + h);
      } else {
        ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx + h, cy - d);
        ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx + h, cy + d);
      }
      ctx.stroke();
    } else {
      // 弯道：圆心 = 两邻边夹角的格角；半径 h∓d 的两道四分之一弧。
      //   四个朝向逐案推过（角度/绕向都对着格中心验过），查表别改成三角函数通式。
      //   分两次 stroke：同一 path 里连续 arc() 会从上一弧终点连一条直线到下一弧起点。
      var corner, a0, ccw;
      if (u[0] && u[1])      { corner = [cx + h, cy - h]; a0 = Math.PI; ccw = true;  } // N+E
      else if (u[0] && u[3]) { corner = [cx - h, cy - h]; a0 = 0;       ccw = false; } // N+W
      else if (u[2] && u[1]) { corner = [cx + h, cy + h]; a0 = Math.PI; ccw = false; } // S+E
      else                   { corner = [cx - h, cy + h]; a0 = 0;       ccw = true;  } // S+W
      var a1 = ccw ? a0 - Math.PI / 2 : a0 + Math.PI / 2;
      thm = ccw ? a0 - Math.PI / 4 : a0 + Math.PI / 4; // 弧中点角（分角线）
      cornerX = corner[0]; cornerY = corner[1];
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, h - d, a0, a1, ccw);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, h + d, a0, a1, ccw);
      ctx.stroke();
    }
    // 3) 方向箭头：每趟一枚
    var ps = pass[k];
    ctx.fillStyle = REND.C.railChev;
    for (i = 0; i < ps.length; i++) {
      var vx = ps[i][0], vy = ps[i][1];
      if (!vx && !vy) continue;                      // 防御：边不重走，理论不出现
      var ux = vx > 0 ? 1 : (vx < 0 ? -1 : 0);
      var uy = vy > 0 ? 1 : (vy < 0 ? -1 : 0);
      var px, py;
      if (curve) {
        px = cornerX + h * Math.cos(thm);            // 弧中点（双线正中间）
        py = cornerY + h * Math.sin(thm);
      } else if (deg === 4) {
        px = cx - ux * s * 0.14;                     // 十字：两枚各沿行进轴后撤，错开中心
        py = cy - uy * s * 0.14;
      } else {
        px = cx; py = cy;
      }
      REND.chevron(ctx, px, py, Math.atan2(uy, ux), s);
    }
  }
};

// 方向箭头：指向 +x 的小三角，旋转 ang 后放到 (x, y)
REND.chevron = function (ctx, x, y, ang, s) {
  var w = s * 0.085, hh = s * 0.095;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(-w, -hh); ctx.lineTo(w * 0.75, 0); ctx.lineTo(-w, hh);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
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
      // v0.6.9b：需与当前区域至少 2 格相接，或贴住内区边界；否则预览整体变红
      var ct = ENG.shapeContacts(hover.c, hover.r, tk.cells);
      if (ok && ct.count < ENG.MIN_CONTACT && !ct.inner) ok = false;
      ctx.fillStyle = REND.C.ok;
      for (var j = 0; j < pts.length; j++) {
        if (!CFG.inBounds(pts[j].c, pts[j].r)) continue;
        ctx.fillRect(L.x + pts[j].c * L.cell, L.y + pts[j].r * L.cell, L.cell, L.cell);
      }
      // 相接格描黄圈：让玩家直接看到"贴上了哪几格"
      ctx.strokeStyle = REND.C.gold;
      ctx.lineWidth = 2;
      for (var k = 0; k < ct.cells.length; k++) {
        ctx.strokeRect(L.x + ct.cells[k].c * L.cell + 2, L.y + ct.cells[k].r * L.cell + 2, L.cell - 4, L.cell - 4);
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
        if (cell.t !== 'blank' || cell.b || cell.gold) continue;
        if (GS.onRail(c, r)) continue;
        if (needRail && !GS.railNeighbor(c, r)) continue;
        ctx.fillStyle = REND.C.ok;
        ctx.fillRect(L.x + c * L.cell, L.y + r * L.cell, L.cell, L.cell);
      }
    }
    if (hover && CFG.inBounds(hover.c, hover.r)) {
      var hc = GS.grid[hover.r][hover.c];
      var valid = hc.t === 'blank' && !hc.b && !hc.gold && !GS.onRail(hover.c, hover.r) &&
        (!needRail || GS.railNeighbor(hover.c, hover.r));
      ctx.strokeStyle = valid ? REND.C.okl : REND.C.bad;
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x + hover.c * L.cell + 1, L.y + hover.r * L.cell + 1, L.cell - 2, L.cell - 2);
    }
  }
};