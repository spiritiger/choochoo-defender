// 渲染：空白/废墟地形 + 动态铁轨环 + 经济建筑/镇中心 + 列车
window.REND = {};

REND.C = {
  bg: '#14161d',
  blank: '#20242f',
  rubble: '#2c2620',
  core: '#e08c33',
  econ: '#35b06a',
  gold: '#f0b429',
  railLine: '#c3c9d6',   // v0.7.0 贴片双线（亮灰，暗底上清晰；v0.7.0 前的单线色 rail 已随之移除）
  railChev: '#f4f7fc',   // （v0.8.3 已停用）方向箭头色 —— 箭头整体移除，保留定义备恢复
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

  // 动态铁轨（v0.7.0 贴片化，v0.8.0 增 T 岔/折返端头）：GS.railPath 是**有序**闭环序列，
  // 逐格按"用到的边方向"选贴片（直线 / 弯道 / 十字 / T 岔 / 端头，双线样式仿大王参考图），
  // 并按行车方向画箭头（往返桥边天然双向箭头）。
  // 生成逻辑一行不动 —— 贴片只是同一条 railPath 的另一种画法（几何口径见 REND.railTiles）。
  var path = GS.railPath;
  if (path.length) REND.railTiles(ctx, L, path);

  // 站台（v0.9.2，规则 1）：与铁轨**叠加**的停靠格 —— 画在铁轨之上、建筑之下
  if (typeof STATION !== 'undefined') REND.station(ctx, L);

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
    // 车斗金币（v0.9.2，规则 6）：水平绘制、不随车头旋转，画在车体上方
    if (GS.train.cargo > 0) {
      ctx.fillStyle = REND.C.gold;
      ctx.font = 'bold 11px "PingFang SC",system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('+' + Math.floor(GS.train.cargo), tp.x, tp.y - 8);
    }
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

  // 夜晚遮罩（v0.9.2，规则 5）：盖住网格与地图内容，工具预览仍在最上层
  if (typeof CLOCK !== 'undefined' && CLOCK.darkness() > 0) {
    ctx.fillStyle = 'rgba(18,26,64,' + CLOCK.darkness() + ')';
    ctx.fillRect(L.x - 4, L.y - 4, L.w + 8, L.h + 8);
  }

  // 工具预览
  if (GS.selToken) REND.tokenGhost(ctx, L, hover);
};

// ---- 铁轨贴片（v0.7.0 贴片化，v0.8.0 增 T 岔 / 折返端头）----------------------
// railPath 的几何不变量（证明见 state.js 头注释）：相邻格正交、每格度数为偶数
// （按**边使用次数**计，网格里即 2 或 4）。据此每个轨格属四类之一：
//   度 2 对向（N+S 或 E+W）→ **直线**贴片（横 / 竖）
//   度 2 相邻（如 N+E）    → **弯道**贴片（4 朝向：圆心在该格角上、半径 h∓d 的两道四分之一弧）
//   度 4                   → **十字**贴片（该格被走两次；straightenRing 配对保证两趟都直行 → 必是「+」）
//   度 3（v0.8.0 往返支线桥头）→ **T 岔**贴片：贯通轴（唯一的对向边对）画满宽双线，
//     支臂以**弯道同款切向弧**（喇叭口）并入贯通轴（v0.8.1，旧直角对接被大王判
//     "资源不对"）。旧版"度 3 不可能"在支线下失效：桥头格 = 主环 2 边 + 桥边往返
//     2 次（同一条边只占 1 个方向）→ 3 个方向、4 次使用。两形态：
//     A「环拐进支臂」（0721 盘）与 B「环直穿 + 支臂折返」（2 格桥：根部 A + 尖端掉头）。
//   度 1（v0.8.0 折返端头）→ 往返支线端点格：双线从该边接到中心 + 一根横梁当车挡。
//     （只可能出现在"起点即半岛"的退化走线上：车开进去原路开回来。）
// 双线样式：线间距 2d（d = 0.12·格宽），线宽 0.075·格宽；直线/十字/T 岔贯通到格边，
// 相邻贴片在格边上无缝对接。旧折线版"拐角抄近路画成 45° 斜线"的坑，贴片化后天然不存在。
// 往返桥边（被双向各走一次的边）：贴片画法与普通双线段完全一致。
// 方向箭头：**v0.8.3 已整体移除**（大王令"把箭头干掉"）—— 单环天然单向，箭头只是可视化
//   辅助。pass 向量仍要收集（T 岔喇叭口的角点计算依赖它），只是不再用于画箭头。
//   想恢复：从 archive/renderer.v0.8.1.js 找回箭头循环 + REND.chevron。
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
    // 行进方向 = prev → next：直线时即轴向；弯道时是两臂合方向（指向弧中切线，对角向）。
    // 第 3 元 = prev 所在方向（0N 1E 2S 3W）：零向量 pass（prev=next，本格 180° 折返）
    // 的差值是 (0,0) 分不出折返边 —— T 岔第二形态（v0.8.1）靠它定位加倍边。
    var pdx = pv.c - a.c, pdy = pv.r - a.r;
    var pd = pdy === -1 ? 0 : (pdx === 1 ? 1 : (pdy === 1 ? 2 : 3));
    pass[a.c + ',' + a.r].push([b.c - pv.c, b.r - pv.r, pd]);
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
    var cornerX = 0, cornerY = 0;                     // 弯道弧心（箭头期曾另有 thm/thrAxis，已随箭头移除）
    ctx.beginPath();
    if (deg === 4) {
      // 十字：横竖两对线各自贯通到格边
      ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy + h);
      ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy + h);
      ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx + h, cy - d);
      ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx + h, cy + d);
      ctx.stroke();
    } else if (deg === 3) {
      // T 岔（v0.8.0 往返支线桥头；v0.8.1 改切向并入）：3 个方向必有且仅有一对对向
      //   （组合事实），对向对 = 贯通轴，画满宽双线；支臂以**弯道同款**两道四分之一弧
      //   （喇叭口）并入贯通轴 —— 弧心 = 「支臂边 × 转弯趟所用轴边」夹角的格角，
      //   与弯道贴片同一张查表；弧的端点恰好落在格边的 ±d 双线端点上（相切 = 无缝，
      //   旧版"支臂直角怼到贯通轴"被大王判"资源不对"，v0.8.1 统一圆弧风格）。
      //   转弯趟用哪条轴边由 pass 向量推出：支臂是入口 → 轴边 = 行进方向；
      //   支臂是出口 → 轴边 = 行进反方向（入口在身后）。逐案验证过 0721 盘两桥头。
      var spur;                                       // 支臂方向下标（0N 1E 2S 3W）
      if (u[1] && u[3]) {                            // 贯通轴横向（E+W）
        ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx + h, cy - d);
        ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx + h, cy + d);
        spur = u[0] ? 0 : 2;
      } else {                                       // 贯通轴纵向（N+S）
        ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy + h);
        ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy + h);
        spur = u[1] ? 1 : 3;
      }
      ctx.stroke();
      // 逐趟画喇叭口。T 岔两形态（v0.8.1）：
      //   A「环拐进支臂」：转弯趟 pass = 对角向量（两分量皆非零）→ 角点 = 支臂 × 该趟所用轴边；
      //   B「环直穿 + 支臂折返」：折返趟 pass = (0,0,prevDir)（本格 180° 掉头）→ 加倍边 =
      //     prevDir，角点 = 支臂 × 两条轴边**全画**（翻出/折回两个弧，轴两侧各一）。
      var ps3 = pass[k], tj;
      for (tj = 0; tj < ps3.length; tj++) {
        var vt = ps3[tj];
        var armY = (spur === 0 || spur === 2);        // 支臂在纵向（N/S）还是横向（E/W）
        var doubled = null;                           // 形态 B：本格 180° 折返的边方向
        if (vt[0] === 0 && vt[1] === 0) doubled = vt[2];
        if (doubled === null && (vt[0] === 0 || vt[1] === 0)) continue;  // 直行趟，不画弧
        var vA = armY ? vt[1] : vt[0];                // 行进向量在支臂轴上的分量
        var vT = armY ? vt[0] : vt[1];                // …在贯通轴上的分量
        var armEdge = (spur === 0) ? -1 : (spur === 2) ? 1 : (spur === 1) ? 1 : -1;
        var armIsEntry = (vA > 0 ? 1 : -1) === -armEdge;  // 行进背离支臂边 = 从支臂进来
        // 喇叭口角点用的"所用轴边"外法线：入口趟→出口边(+分量)；出口趟→入口边(−分量)
        var usedSign = (vT > 0 ? 1 : -1) * (armIsEntry ? 1 : -1);
        var usedDir = armY ? (usedSign > 0 ? 1 : 3) : (usedSign > 0 ? 2 : 0);
        var q3 = [usedDir];                           // 形态 A：只画所用轴边那一个角
        if (doubled !== null) q3 = armY ? [1, 3] : [0, 2];  // 形态 B：支臂×两条轴边（armY=纵支臂→E/W 角）
        for (var qi = 0; qi < q3.length; qi++) {
          var ud3 = q3[qi];
          // 角点查表（与弯道同表：支臂 × 转弯趟轴边 的无序对）
          var pair3 = (spur < ud3) ? spur * 10 + ud3 : ud3 * 10 + spur;
          var c3, a03, ccw3;
          if (pair3 === 1)      { c3 = [cx + h, cy - h]; a03 = Math.PI; ccw3 = true;  } // N+E
          else if (pair3 === 3) { c3 = [cx - h, cy - h]; a03 = 0;       ccw3 = false; } // N+W
          else if (pair3 === 12){ c3 = [cx + h, cy + h]; a03 = Math.PI; ccw3 = false; } // S+E
          else                  { c3 = [cx - h, cy + h]; a03 = 0;       ccw3 = true;  } // S+W
          var a13 = ccw3 ? a03 - Math.PI / 2 : a03 + Math.PI / 2;
          ctx.beginPath(); ctx.arc(c3[0], c3[1], h - d, a03, a13, ccw3); ctx.stroke();
          ctx.beginPath(); ctx.arc(c3[0], c3[1], h + d, a03, a13, ccw3); ctx.stroke();
        }
      }
    } else if (deg === 1) {
      // 折返端头（v0.8.0）：双线从唯一边接到格中心，中心一根横梁当车挡。
      //   车开到这里原路折回。（v0.8.3 起不再画方向箭头，双向信息无从展示 —— 单环天然单向。）
      if (u[0]) {          // N
        ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy);
        ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy);
        ctx.moveTo(cx - d, cy); ctx.lineTo(cx + d, cy);
      } else if (u[2]) {   // S
        ctx.moveTo(cx - d, cy + h); ctx.lineTo(cx - d, cy);
        ctx.moveTo(cx + d, cy + h); ctx.lineTo(cx + d, cy);
        ctx.moveTo(cx - d, cy); ctx.lineTo(cx + d, cy);
      } else if (u[1]) {   // E
        ctx.moveTo(cx + h, cy - d); ctx.lineTo(cx, cy - d);
        ctx.moveTo(cx + h, cy + d); ctx.lineTo(cx, cy + d);
        ctx.moveTo(cx, cy - d); ctx.lineTo(cx, cy + d);
      } else {             // W
        ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx, cy - d);
        ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx, cy + d);
        ctx.moveTo(cx, cy - d); ctx.lineTo(cx, cy + d);
      }
      ctx.stroke();
    } else if (deg === 2 && straight) {
      // 直线（竖 / 横）
      if (u[0] && u[2]) {
        ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy + h);
        ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy + h);
      } else {
        ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx + h, cy - d);
        ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx + h, cy + d);
      }
      ctx.stroke();
    } else if (deg === 2) {
      // 弯道：圆心 = 两邻边夹角的格角；半径 h∓d 的两道四分之一弧。
      //   四个朝向逐案推过（角度/绕向都对着格中心验过），查表别改成三角函数通式。
      //   分两次 stroke：同一 path 里连续 arc() 会从上一弧终点连一条直线到下一弧起点。
      var corner, a0, ccw;
      if (u[0] && u[1])      { corner = [cx + h, cy - h]; a0 = Math.PI; ccw = true;  } // N+E
      else if (u[0] && u[3]) { corner = [cx - h, cy - h]; a0 = 0;       ccw = false; } // N+W
      else if (u[2] && u[1]) { corner = [cx + h, cy + h]; a0 = Math.PI; ccw = false; } // S+E
      else                   { corner = [cx - h, cy + h]; a0 = 0;       ccw = true;  } // S+W
      var a1 = ccw ? a0 - Math.PI / 2 : a0 + Math.PI / 2;
      cornerX = corner[0]; cornerY = corner[1];
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, h - d, a0, a1, ccw);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cornerX, cornerY, h + d, a0, a1, ccw);
      ctx.stroke();
    } else {
      // 防御分支：deg 0 / deg>4 理论不出现（0 = 没有方向不会进 use 表，>4 只有 4 条边），
      //   真发生了按十字画，缺臂就缺臂，至少不崩。
      ctx.moveTo(cx - d, cy - h); ctx.lineTo(cx - d, cy + h);
      ctx.moveTo(cx + d, cy - h); ctx.lineTo(cx + d, cy + h);
      ctx.moveTo(cx - h, cy - d); ctx.lineTo(cx + h, cy - d);
      ctx.moveTo(cx - h, cy + d); ctx.lineTo(cx + h, cy + d);
      ctx.stroke();
    }
    // 3) 方向箭头已移除（v0.8.3，大王令"把箭头干掉"）—— 单环天然单向，箭头只是可视化
    //    辅助。想恢复：把 REND.chevron 重新接回这里（按 pass 向量逐趟画，历史实现见 archive）。
  }
};

// 方向箭头（v0.8.3 已停用，大王令"把箭头干掉"）：指向 +x 的小三角，旋转 ang 后放到 (x, y)。
//   函数保留备查——恢复时在 railTiles 尾部按 pass 向量逐趟调用即可（历史实现见 archive/renderer.v0.8.1.js）。
// （已无调用点；fillStyle 色 railChev 同步停用，见 REND.C 注释。）
function __chevron_retired(ctx, x, y, ang, s) {
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

// 站台贴片（v0.9.2）：叠加在铁轨格上，所以底色用半透明（别把轨道盖死），
// 只留一圈亮边 + 一个「站」字。字贴格子上缘，避免被车头方块挡住。
REND.station = function (ctx, L) {
  var st = STATION.slot();
  if (!st) return;
  var x = L.x + st.c * L.cell, y = L.y + st.r * L.cell, s = L.cell;
  ctx.fillStyle = 'rgba(240,180,41,0.16)';
  ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
  ctx.strokeStyle = 'rgba(240,180,41,0.85)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1.5, y + 1.5, s - 3, s - 3);
  ctx.fillStyle = 'rgba(240,180,41,0.95)';
  ctx.font = 'bold ' + Math.round(s * 0.34) + 'px "PingFang SC",system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('站', x + s / 2, y + 1);
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
      // ⚠️ 这里原有一圈「相接格描黄圈」（REND.C.gold 描边 ct.cells）——
      //    v0.9.0 已整体移除。它只是视觉提示，相接判定（ENG.shapeContacts 的
      //    count / inner，见上一条）不受影响，也不删 REND.C.gold（金币图标仍用它）。
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