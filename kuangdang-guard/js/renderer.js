// 渲染：空白/废墟地形 + 动态铁轨环 + 经济建筑/镇中心 + 列车
window.REND = {};

REND.C = {
  bg: '#14161d',
  blank: '#20242f',
  rubble: '#2c2620',
  core: '#e08c33',
  gold: '#f0b429',
  heart: '#ff5c8a',      // v1.6.22 爱心地块主色（玫红，与金/红/绿全都拉开）
  railLine: '#c3c9d6',   // v0.7.0 贴片双线（亮灰，暗底上清晰；v0.7.0 前的单线色 rail 已随之移除）
  railChev: '#f4f7fc',   // （v0.8.3 已停用）方向箭头色 —— 箭头整体移除，保留定义备恢复
  ok: 'rgba(61,220,106,0.18)',
  okl: 'rgba(61,220,106,0.9)',
  bad: 'rgba(232,70,58,0.25)',
  preview: '#ffd75e',    // v1.4.11 清理预览环（金黄虚线，与真轨亮灰/形状绿红都拉开）
  // v1.6.34 塔型色板（顺序对应 TOWERS.ELEMS = arrow/cannon/magic/ice）——
  //   3 色沿用旧元素（thunder→arrow 黄 / fire→cannon 红 / ice 蓝），魔法换紫（原 poison 绿
  //   与经济建筑绿 #35b06a 撞脸，顺手改掉）。
  tower: { arrow: '#f7d94c', cannon: '#e8563f', magic: '#a855f7', ice: '#6ec6ff' },
  // v1.6.34 地面物
  mine: '#8a8f9c',        // 地雷（哑光金属灰）
  fireZone: 'rgba(240,120,50,0.30)',   // 烈焰地带
  frostZone: 'rgba(120,200,255,0.28)', // 霜痕地带
  // 【v1.6.41 退役】expBar: '#c58cff' —— 经验条改版后颜色内联在 REND.expBar（紫 #7F77DD/#AFA9EC）
  trainRGB: '143,134,255',
  foe: '#e8563f'
};

// v1.6.74 火车整体放大（规格 §14.50，大王令"火车的大小可以稍微放大一点"）：
//   车头/车厢 save 块内 ctx.scale 等比放大（车头 22×14→25.3×16.1、车厢
//   16×12→18.4×13.8）；链杆粗细、货堆尾巴锚点、速度线散布配套 ×s。
//   ⚠️ 纯视觉：战斗半径/撞击圈/索敌全是格制坐标，一概不动。夜战
//   BATTLE_CELL=28 仍容纳（车厢宽 18.4 < 28）。
REND.TRAIN_SCALE = 1.15;

// v1.3.3 攻击范围提示（"不抢视觉"口径，规格 §13.5）：细虚线圆 + 极淡填充，
// **按需出现**，平时零视觉占用 —— v1.6.11 起唯一存活的是列车环：只在点选
// 车头/车厢时画（常驻显示退役，大王令）。
REND.RANGE = {
  LINE_W: 1.2,
  DASH: [4, 4],
  train: { line: 0.30, fill: 0.05 }    // 列车射程环（点选车头/车厢时显示）
  // ⚠️ v1.6.5：drag/hover 两档随塔射程环整体退役（大王拍板"塔没有攻击能力"），
  //    塔相关覆盖显示由 mergeHint（合成高亮）接棒。
};

// 双层硬币（v1.6.12b）：深金币缘（厚度感）+ 亮金币面 + 左上白高光。
//   埋着/清出的金币格共用（r=像素半径，harvested=本圈已收 → 空心双圈降淡）。
REND.coin = function (ctx, x, y, r, harvested) {
  if (harvested) {
    ctx.strokeStyle = 'rgba(240,180,41,0.40)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke();
    ctx.strokeStyle = 'rgba(240,180,41,0.28)';
    ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, 7); ctx.stroke();
    return;
  }
  ctx.beginPath(); ctx.arc(x, y, r, 0, 7);
  ctx.fillStyle = '#d99a1b';                       // 币缘（深金 = 厚度）
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,60,0,0.55)';          // 币缘描边
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath(); ctx.arc(x, y, r * 0.62, 0, 7);
  ctx.fillStyle = '#ffd257';                       // 币面（亮金）
  ctx.fill();
  ctx.beginPath();                                 // 左上高光点
  ctx.arc(x - r * 0.25, y - r * 0.3, r * 0.16, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fill();
};

// 铸币所覆盖金币的叠币 + 呼吸金光（v1.8u §14.82，大王拍板"直接金币叠加 + 呼吸金光"）：
//   n = GS.mintCoverAt(c,r) 座 ⇒ 金币本体画 n 枚错位叠币（底层降淡、顶层主币原位完整），
//   画前先铺 radial 金色光晕（breathe 同 rangeHighlights 呼吸语言，座数越多越亮）。
//   n=0 走原单币路径零开销；**地块本身无效果**（底色/金框/裂纹/flash 全不动）。
REND.mintStack = function (ctx, x, y, r, harvested, c, rr) {
  var n = (typeof GS.mintCoverAt === 'function') ? GS.mintCoverAt(c, rr) : 0;
  if (n <= 0) { REND.coin(ctx, x, y, r, harvested); return; }
  var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : 0;
  var breathe = 0.5 + 0.5 * Math.sin(now / 700);            // ~4.4s 周期缓慢呼吸
  var alpha = (0.22 + 0.30 * breathe) * Math.min(1.35, 0.75 + 0.25 * n);
  var dim = harvested ? 0.5 : 1;                            // 本圈已收 → 表现整体降淡
  var grad = ctx.createRadialGradient(x, y, r * 0.2, x, y, r * 1.6);
  grad.addColorStop(0, 'rgba(240,180,41,' + (alpha * 0.9 * dim).toFixed(3) + ')');
  grad.addColorStop(1, 'rgba(240,180,41,0)');
  ctx.fillStyle = grad;
  ctx.beginPath(); ctx.arc(x, y, r * 1.6, 0, 7); ctx.fill();
  // v1.8u 十令（大王亲定布阵）：右上小币角标退役，换 **「格内多币布阵」** ——
  //   格内币数 = 总枚数 piles = 覆盖座数 n + 1（与 goldValue 枚数口径一致）：
  //   2 枚 = 右上+左下对角、3 枚 = 顶点朝上三角形、≥4 枚 = 圆周均分；
  //   币随枚数缩小（0.78r / 0.66r / 0.58r），布阵半径令相邻币轻微相切（≈1px 叠，
  //   保留"堆"感）且不出格；每枚完整 REND.coin（自带深缘即天然分界），
  //   按 y 降序绘制（上币压下币）。呼吸金光 / harvested 降淡口径不变。
  var piles = n + 1;
  var sr = piles >= 4 ? r * 0.58 : (piles === 3 ? r * 0.66 : r * 0.78);   // 币随枚数缩小
  var d  = piles >= 4 ? r * 0.62 : (piles === 3 ? r * 0.70 : r * 0.72);   // 布阵半径
  var pts = [];
  for (var i = 0; i < piles; i++) {
    var ang = piles === 2 ? (-Math.PI / 4 + i * Math.PI)          // 右上 → 左下
            : piles === 3 ? (-Math.PI / 2 + i * 2 * Math.PI / 3)  // △：上/右下/左下
            : (-Math.PI / 4 + i * 2 * Math.PI / piles);           // ≥4 圆周均分
    pts.push({ x: x + Math.cos(ang) * d, y: y + Math.sin(ang) * d });
  }
  pts.sort(function (a, b) { return b.y - a.y; });                  // y 降序：上币后画压下币
  for (var j = 0; j < pts.length; j++) {
    ctx.save();
    ctx.globalAlpha = dim;
    REND.coin(ctx, pts[j].x, pts[j].y, sr, harvested);
    ctx.restore();
  }
};

// 爱心图标（v1.6.22）：玫红双层心形（深色底 + 亮色面）+ 左上白高光。
//   埋着/清出的爱心格共用（r=像素半径，harvested=本圈已收 → 空心降淡）。
//   心形路径 = 下尖 + 两段贝塞尔（左右上瓣）；
//   rr=1 画外轮廓/深色底，rr=0.6 画亮色面（同 REND.coin 的"缘 + 面"双层手法）。
REND.heart = function (ctx, x, y, r, harvested) {
  var heartPath = function (rr) {
    ctx.beginPath();
    ctx.moveTo(x, y + rr * 0.92);                                        // 下尖
    ctx.bezierCurveTo(x - rr * 1.45, y - rr * 0.42, x - rr * 0.60, y - rr * 1.22, x, y - rr * 0.36);
    ctx.bezierCurveTo(x + rr * 0.60, y - rr * 1.22, x + rr * 1.45, y - rr * 0.42, x, y + rr * 0.92);
    ctx.closePath();
  };
  if (harvested) {
    ctx.strokeStyle = 'rgba(255,92,138,0.40)';
    ctx.lineWidth = 1.4;
    heartPath(r);
    ctx.stroke();
    return;
  }
  heartPath(r);
  ctx.fillStyle = '#d63a6a';                       // 心底（深玫红 = 厚度）
  ctx.fill();
  ctx.strokeStyle = 'rgba(90,10,35,0.55)';         // 边缘描边
  ctx.lineWidth = 1;
  ctx.stroke();
  heartPath(r * 0.6);
  ctx.fillStyle = '#ff6f9c';                       // 心面（亮玫红）
  ctx.fill();
  ctx.beginPath();                                 // 左上高光点
  ctx.arc(x - r * 0.36, y - r * 0.44, r * 0.14, 0, 7);
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fill();
};

// 圆角矩形路径（v1.4.3 列车整体感）：只建路径不填充，调用方自己 fill/stroke。
//   车头/车厢共用同一描边风格 —— 同一列车的单元必须长得像一家人。
REND.rr = function (ctx, x, y, w, h, r) {  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

// 加速速度线（v1.6.64 大王令建；**v1.6.76 大王纠偏"速度线不是给火车的，是给镜头的"**）：
//   ▍触发 = ENG.boostFx && ENG.boost > 0 —— **v1.6.91（规格 §14.59，大王两令）**：
//     overtime 纯收车（倒计时耗尽才清怪、从未进奖励时间）提速保留、速度线退场；
//     奖励时间及其后续收车段照常。加油站提速不经 boost ⇒ 依旧天然不出现。
//   ▍强度 s = boost/3 线性（dusk 满档 0.67、奖励满档 1）；boost 本身 0.9/s 渐涨 ⇒
//     线由少到多、由淡到亮，"随速度加快而更加显著"逐帧自然成立。
//   ▍v1.6.76 新画法：**镜头级全屏径向流线** —— 以画布中心为锚，条线沿随机角度
//     从外圈**向外掠出**（世界向后掠的镜头冲刺感）；中心留空不压主体。
//     逐帧随机 = 抖动。画布尺寸取 CFG.CANVAS_W/H 常量（390×844 恒定；
//     沙箱桩无 ctx.canvas 也不炸）。
//   ▍v1.6.81 大王令"更显著一点，更靠近屏幕边缘一点"：起点半径 42%~72% →
//     58%~86%（线尾可越出画布=掠出边缘感）；条数 8→20、线长 30~110px、
//     alpha 满档 0.42、线宽满档 2.8px。
//   ▍v1.6.82 大王令"左右两侧看不到速度线"：竖屏画布水平半宽只有 0.42×对角半径，
//     统一按 R 锚定时水平流线全在画布外 ⇒ 改为**逐角度到画布边的距离**锚定
//     （maxR = min(cx/|ux|, cy/|uy|)），各方向各自 58%~86% 贴边——左右上下全可见。
//   ▍调用点 = draw 尾部 battleBanner 之前（场景最上层、横幅/经验条之下）。
//   ⚠️ 纯表现：只读 ENG.boost，不写任何状态。
REND.speedLines = function (ctx) {
  var b = (ENG.boostFx ? (ENG.boost || 0) : 0);   // v1.6.91：纯收车 boostFx=false ⇒ 零绘制
  if (b <= 0.03) return;                          // boost≈0（正常车速/相位刚切走）零绘制
  var s = Math.min(1, b / 3);                     // 0~1 强度
  var n = 8 + Math.round(s * 12);                 // 条数 8→20（v1.6.81 加强）
  var cx = CFG.CANVAS_W / 2, cy = CFG.CANVAS_H / 2;
  ctx.save();
  ctx.lineCap = 'round';
  for (var i = 0; i < n; i++) {
    var a = Math.random() * 6.283;
    var ux = Math.cos(a), uy = Math.sin(a);
    // v1.6.82：该方向从画布中心到边缘的距离（横平竖直各自贴边，左右侧不再缺线）
    var ex = Math.abs(ux) > 1e-6 ? cx / Math.abs(ux) : 1e9;
    var ey = Math.abs(uy) > 1e-6 ? cy / Math.abs(uy) : 1e9;
    var maxR = Math.min(ex, ey);
    var r0 = maxR * (0.58 + Math.random() * 0.28);   // 起点：该方向边缘的 58%~86%
    var len = (30 + Math.random() * 80) * (0.5 + 0.5 * s);
    var al = (0.16 + Math.random() * 0.26) * (0.45 + 0.55 * s);
    ctx.strokeStyle = 'rgba(255,255,255,' + al.toFixed(3) + ')';
    ctx.lineWidth = 1.2 + s * 1.6;
    ctx.beginPath();
    ctx.moveTo(cx + ux * r0, cy + uy * r0);
    ctx.lineTo(cx + ux * (r0 + len), cy + uy * (r0 + len));
    ctx.stroke();
  }
  ctx.restore();
};

REND.draw = function (ctx, L, hover, drag) {
  ctx.clearRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H);
  ctx.fillStyle = REND.C.bg;
  ctx.fillRect(0, 0, CFG.CANVAS_W, CFG.CANVAS_H);

  // 荒野世界层（v1.6.39 建，v1.6.48 大王令"建造与战斗的场景展示保持一致，仅 UI
  //   和镜头不同"）：**常驻渲染** —— 昼夜都画同一套世界（城外土地底色 + 轻羽化
  //   + 废墟残片 + 草石），白天 cell 41 可视区窄只露出边缘带，夜晚 cell 28 全景；
  //   拉远过渡中 LAY 插值 ⇒ 荒野内容随地图矩形平滑跟随。昼夜只剩 UI（footer/横幅）
  //   与镜头的区别，场景零分叉。
  REND.wilderness(ctx, L);

  // 地形（v1.6.12 大王令"金币格太像空地"重订视觉语言，规格 §4a）：
  //   金色语言 = 金币格（埋着：废墟底+金裂纹+金框；清出：空白底+金框），
  //   红色语言 = 废墟（红裂纹+弱红斜纹）。底色不叠黄 tint（v0.6.7 教训：
  //   深灰叠暗黄变棕褐像障碍），辨识度全靠框/裂纹/图标。
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var t = GS.grid[r][c].t;
      var gc = GS.grid[r][c];
      var px = L.x + c * L.cell, py = L.y + r * L.cell;
      if (t === 'rubble') {
        ctx.fillStyle = REND.C.rubble;
        ctx.fillRect(px, py, L.cell, L.cell);
        var cx = CFG.ccx(L, c), cy = CFG.ccy(L, r), s = L.cell * 0.22;
        if (gc.gold) {
          // 金币格埋在废墟里（未清）：金裂纹 + 金色内框 + **金币本体**（v1.6.12b
          // 修复：重构时金币图标漏画在 blank 分支，埋着格只剩框没币——大王反馈
          // "看不出来像金币"的真正根源）。框/裂纹降淡当配角，金币当主角。
          ctx.strokeStyle = 'rgba(240,180,41,0.20)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
          ctx.moveTo(cx - s * 0.4, cy + s * 0.6); ctx.lineTo(cx + s * 0.6, cy - s * 0.4);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(240,180,41,0.35)';
          ctx.strokeRect(px + 1.5, py + 1.5, L.cell - 3, L.cell - 3);
          REND.mintStack(ctx, CFG.ccx(L, c), CFG.ccy(L, r), L.cell * 0.30, gc.harvested, c, r);
        } else if (gc.heart) {
          // 爱心格埋在废墟里（未清，v1.6.22）：玫红裂纹 + 玫红内框 + 爱心本体。
          //   与金币格同构的"障碍里藏着货"视觉，颜色语言换成玫红（REND.C.heart）。
          ctx.strokeStyle = 'rgba(255,92,138,0.20)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
          ctx.moveTo(cx - s * 0.4, cy + s * 0.6); ctx.lineTo(cx + s * 0.6, cy - s * 0.4);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(255,92,138,0.35)';
          ctx.strokeRect(px + 1.5, py + 1.5, L.cell - 3, L.cell - 3);
          REND.heart(ctx, CFG.ccx(L, c), CFG.ccy(L, r), L.cell * 0.30, gc.harvested);
        } else {
          // 普通废墟：红裂纹 + 弱红 45° 斜纹排线（v1.6.12 一并强化"堵死"感）
          ctx.strokeStyle = 'rgba(232,70,58,0.28)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - s, cy - s); ctx.lineTo(cx + s, cy + s);
          ctx.moveTo(cx - s * 0.4, cy + s * 0.6); ctx.lineTo(cx + s * 0.6, cy - s * 0.4);
          ctx.stroke();
          ctx.strokeStyle = 'rgba(232,70,58,0.10)';
          ctx.beginPath();
          var hstep = L.cell / 4;
          for (var hh = 1; hh < 4; hh++) {
            ctx.moveTo(px, py + hh * hstep); ctx.lineTo(px + hh * hstep, py);
            ctx.moveTo(px + hh * hstep, py + L.cell); ctx.lineTo(px + L.cell, py + hh * hstep);
          }
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = REND.C.blank;
        ctx.fillRect(px, py, L.cell, L.cell);
        // 人工地面纹理（v1.6.46 ①）：9×13 = "人工干预过的城镇废墟地面" —— blank 底上
        //   按格坐标 hash 叠极淡裂纹/夯土点（对比 ±4%，细看有粗看无），与城外纯荒野
        //   形成土地质感的本质区别。rubble 格自带碎石纹不叠加；金币/爱心格同为 blank 底照叠。
        REND.groundTex(ctx, c, r, px, py, L.cell);
        // 金币地块：开局埋在废墟里（不可铺轨），清出来后才成为真正的空地：
        // 可铺轨、列车驶入 +5，一圈只算一次，跑完一圈重置。
        // 底色与普通空白格完全一致（v0.6.7 大王定案教训：深灰叠暗黄 tint 会变
        //   棕褐像障碍物）—— v1.6.12 辨识度改由**金色内框**承担。
        // 未收 = 实心金币 + 亮金框；本圈已收 = 空心圈 + 整格降淡（下圈重置回亮）。
        if (gc.gold) {
          var gx = CFG.ccx(L, c), gy = CFG.ccy(L, r), gr = L.cell * 0.30;
          ctx.strokeStyle = gc.harvested ? 'rgba(240,180,41,0.22)' : 'rgba(240,180,41,0.55)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 1.5, py + 1.5, L.cell - 3, L.cell - 3);
          REND.mintStack(ctx, gx, gy, gr, gc.harvested, c, r);
          if (gc.flash > 0) {
            ctx.strokeStyle = 'rgba(240,180,41,' + (gc.flash * 3) + ')';
            ctx.lineWidth = 2;
            ctx.strokeRect(L.x + c * L.cell + 1, L.y + r * L.cell + 1, L.cell - 2, L.cell - 2);
          }
        } else if (gc.heart) {
          // 爱心地块已清出（v1.6.22）：空白底 + 玫红内框 + 爱心本体；
          //   与本圈已收（harvested）时框与图标整体降淡，下圈重置回亮。
          var hx = CFG.ccx(L, c), hy = CFG.ccy(L, r), hr = L.cell * 0.30;
          ctx.strokeStyle = gc.harvested ? 'rgba(255,92,138,0.22)' : 'rgba(255,92,138,0.55)';
          ctx.lineWidth = 1.5;
          ctx.strokeRect(px + 1.5, py + 1.5, L.cell - 3, L.cell - 3);
          REND.heart(ctx, hx, hy, hr, gc.harvested);
          if (gc.flash > 0) {
            ctx.strokeStyle = 'rgba(255,92,138,' + (gc.flash * 3) + ')';
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

  // 建筑效果范围高亮（v1.6.35 大王令"加油站生效范围内的铁轨需要高亮"）：
  //   加油站 3×3 内**在轨**的格子，淡色覆盖 + 同色描边 ——
  //   一眼看清"这条轨吃到几座加成"（覆盖多座时颜色随座数加深）。
  //   （v1.8u 十三令：军工厂退役；猛攻坊/疾速坊生效反馈走建筑连线，不标铁轨。）
  REND.rangeHighlights(ctx, L);
  // 地面物（v1.6.34 词条）：烈焰地带 c4 / 霜痕 i3 / 地雷 c1 —— 铁轨之上、建筑之下
  REND.groundFx(ctx, L);

  // 建筑
  for (var k = 0; k < GS.buildings.length; k++) REND.building(ctx, L, GS.buildings[k]);
  REND.coreLvBar(ctx, L);   // 镇中心 lv 刻度条（v1.8y 反馈补丁四：速度等级 lv1~lv9）
  // 塔（v1.3-rc 修复"地图里看不到塔"：TOWERS.placeAt 只写格子 + GS.towers 数组镜像，
  //   不进 GS.buildings —— 塔的权威列表是 GS.towers，渲染必须单独遍历它）
  for (var kt = 0; kt < GS.towers.length; kt++) REND.building(ctx, L, GS.towers[kt]);

  // 列车
  if (path.length) {
    var tp = ENG.trainPos();
    // v1.8u 十二令（§14.81 改回初版）：提速 = 查询式（车头格覆盖座数，每座 +100%）。
    //   加速残影表现不变：提速生效（车头在覆盖格、非 boost、列车运行相位）⇒ 车头后方
    //   沿反方向平移 0.07/0.14/0.21s×车速画淡化青色车头轮廓；每座 1 道影（封顶 3 道）。
    //   直线平移不沿弧回退——3 帧短影在弯道最大横向偏差 ~2px，淡化后不可辨，零弧长换算。
    var gsum = 0;
    if ((ENG.boost || 0) <= 0 && typeof GS.gasCoverAt === 'function' &&
        (typeof CLOCK === 'undefined' || CLOCK.isRunning())) {
      var gcell = GS.railCell(GS.train.index);
      if (gcell) gsum = GS.gasCoverAt(gcell.c, gcell.r);   // 覆盖座数 = 层数（每座 +100%，无上限）
    }
    if (gsum > 0.001) {
      var ga = ENG.trainAngle(), gpx = Math.cos(ga), gpy = Math.sin(ga);
      var gspd = CFG.TRAIN_SPEED * (1 + gsum) * L.cell;   // 提速生效期实际速度（px/s）
      var gN = Math.min(3, gsum);   // 每座一道影（显示封顶 3 道，效果本身无上限）
      var gAl = [0.30, 0.18, 0.09], gDt = [0.07, 0.14, 0.21];
      for (var gj = 0; gj < gN; gj++) {
        var gbd = gspd * gDt[gj];
        ctx.save();
        ctx.globalAlpha = gAl[gj];
        ctx.translate(tp.x - gpx * gbd, tp.y - gpy * gbd);
        ctx.rotate(ga);
        ctx.scale(REND.TRAIN_SCALE, REND.TRAIN_SCALE);
        ctx.fillStyle = '#5EC8F0';
        REND.rr(ctx, -11, -7, 22, 14, 3);
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    ctx.translate(tp.x, tp.y);
    ctx.rotate(ENG.trainAngle());
    ctx.scale(REND.TRAIN_SCALE, REND.TRAIN_SCALE);   // v1.6.74 火车放大
    // 车头体（v1.4.3：圆角矩形 + 深色描边，与车厢同风格 —— 整列车一个画风）
    ctx.fillStyle = '#4B3FE3';
    REND.rr(ctx, -11, -7, 22, 14, 3);
    ctx.fill();
    ctx.strokeStyle = '#232347';
    ctx.lineWidth = 1.5;
    REND.rr(ctx, -11, -7, 22, 14, 3);
    ctx.stroke();

    ctx.restore();

    // 【v1.6.76 退役】车尾拖尾速度线已改镜头级（大王令）——新 speedLines 是全屏
    //   径向流线，调用点挪到 draw 尾部（battleBanner 之前），不再挂车头。

    // 屁股货堆（v1.6.25 大王令；v1.6.27 改版；v1.6.29 修正朝向；v1.8g 方案 B；
    //   **v1.8u 十六令改"锁定朝 Y"**）—— 绘制块挪到**车厢之后**（编组最上层），
    //   见下方 PK 段：金币/爱心两条拖尾恒朝屏幕上方堆叠，不随车头转向甩动。
    // 车厢（v1.4.1）：**独立炮位** —— 每座英雄塔（GS.towers 镜像）派生一节
    //   同元素同星车厢，按 ENG.wagonPos 沿轨排位绝对绘制（元素色车体+星点）。
    //   ⚠️ 攻击全在车厢（v1.4.2 大王纠偏：塔没有攻击能力），战斗位置 =
    //   ENG.wagonPos = 车头弧长退 (i+1)×GAP，渲染与战斗严格同源，别改动其中一个。
    // v1.4.3 贴身短编组（大王拍板 B 方案）：GAP 2→1 —— 车厢真贴近车头，
    //   战斗连带影响（射程重叠变多、防线前压）已在规格 §14.2 留拍板记录。
    //   渲染配套：单元间只剩 ~1 格缝，画一层 4px 深色短链杆补缝即成整列；
    //   旧"长链条 + 中间皮"两段式（为 GAP=2 设计）随之简化为单层。
    if (typeof ENG.wagonPos === 'function') {
      // v1.6.3（大王拍板 B）：上限全撤，塔数=车厢数全画 —— 战斗层 wagonCombat
      //   本就遍历全部塔，旧 6 节上限导致"伤害有、车厢看不见"的视觉割裂。
      //   小环时多节车厢绕圈重叠属玩家自选布局的结果，不做干预。
      var wn = GS.towers.length;
      if (wn > 0) {
        var headArc = GS.train.index + GS.train.frac;   // 车头弧长（格，浮点）
        // 弧长（格，可负可超一圈）→ 画布像素：**走 ENG.railPoint（圆角路径，v1.8f）**，
        //   与 ENG.wagonPos 同一套公式 ⇒ 链条/车厢严格同位，且拐角处角度连续（不再跳变）。
        //   带出 ang（该处行进方向角）—— 车厢贴片跟着转。
        var arcPix = function (arc) {
          var pt = ENG.railPoint(arc);
          if (!pt) return { x: 0, y: 0, ang: 0 };
          return { x: CFG.ccx(L, pt.c), y: CFG.ccy(L, pt.r), ang: pt.ang };
        };
        // ① 短链杆：车头中心 → 各节车厢中心（贴身编组下就是几截短耦合杆）
        ctx.strokeStyle = '#232347';
        ctx.lineWidth = 4 * REND.TRAIN_SCALE;          // v1.6.74 链杆随车体加粗
        ctx.lineCap = 'round';
        ctx.beginPath();
        var prev = { x: tp.x, y: tp.y };
        for (var li = 0; li < wn; li++) {
          var lp = arcPix(headArc - (li + 1) * ENG.WAGON.GAP);
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(lp.x, lp.y);
          prev = lp;
        }
        ctx.stroke();
      }
      for (var wi = 0; wi < wn; wi++) {
        var wt = GS.towers[wi];
        // v1.4.3c 车厢形状跟随轨道方向（大王纠偏"车头会转车厢不会"）：
        //   与车头同一套 save/translate/rotate —— 旋转角取该节所在轨段的行进方向。
        //   位置用 arcPix 的弧长插值（比 wagonPos 多带 ang），与链条严格同源。
        var wa = arcPix(headArc - (wi + 1) * ENG.WAGON.GAP);
        ctx.save();
        ctx.translate(wa.x, wa.y);
        ctx.rotate(wa.ang);
        ctx.scale(REND.TRAIN_SCALE, REND.TRAIN_SCALE); // v1.6.74 火车放大（星点随动）
        // 车厢体：圆角矩形 + 与车头同款深色描边（一个画风）。
        //   ⚠️ 长边朝行进方向（16×12，车头 22×14 —— 车厢略短，编组有层次）
        ctx.fillStyle = REND.C.tower[wt.elem] || '#888';
        REND.rr(ctx, -8, -6, 16, 12, 3);
        ctx.fill();
        ctx.strokeStyle = '#232347';
        ctx.lineWidth = 1.5;
        REND.rr(ctx, -8, -6, 16, 12, 3);
        ctx.stroke();
        // 星点（与塔同款白点，数量=星级），画在车厢体内、贴尾排一行
        ctx.fillStyle = '#fff';
        for (var ws = 0; ws < wt.star && ws < 4; ws++)
          ctx.fillRect(-6 + ws * 3.5, -2, 2, 2);
        ctx.restore();
      }
    }
    // 屁股货堆 PK 段（v1.8u 十六令"锁定朝 Y"定稿）：拾取的金币/爱心堆在车头上方，
    //   到站交付才清空（流水 = GS.train.picked，transport.js 记账）。两条拖尾**恒朝
    //   屏幕上方**堆叠（大王令"资源甩来甩去不好看，锁定朝 Y"）——金币列在左、爱心
    //   列在右（横向错开 PK_SEP），整堆随车头平移、不随车头转向旋转。
    //   ▍沿革：v1.6.29 首版屏幕系（修"车头朝左时朝下"）→ v1.8g B 案刚性挂车尾
    //   （修"距离忽长忽短"）→ v1.8u 十六令改回屏幕系：转向时的角速度甩动（绕车头
    //   旋转）比距离小幅摆动更扎眼，两害相权取朝向恒定。
    //   ▍画在编组最上层（车厢之后）：车头朝上/下行驶时堆与车厢重叠段由资源压顶，
    //   资源可见性优先。粒度不变（v1.6.27 大王三条）：每种资源 1 条拖尾、计数按总数
    //   合并、列内步距 3.6 < 直径 9.2（压掉 61%）⇒"一枚压一枚"的堆；首枚退距 16
    //   （v1.8i 下限，车头上缘外沿起叠）。
    //   ⚠️ 纯表现：只读 GS.train.picked，不写任何状态。别挪回车头的 save/translate/rotate 块内。
    var picked = GS.train.picked;
    if (picked && picked.length) {
      var PK_R = 4.6, PK_STEP = 3.6;                 // 半径 / 朝上叠距（重叠 61%）
      var PK_D = 16 * REND.TRAIN_SCALE, PK_SEP = 4.75;  // 首枚离车头退距（v1.8i 下限）/ 两列横向半间距
      var pkG = 0, pkH = 0, pkq;
      for (pkq = 0; pkq < picked.length; pkq++) {
        if (picked[pkq] === 'heart') pkH++; else pkG++;
      }
      // 从车头**垂直向上**依次叠：金币列（左）/ 爱心列（右）；远枚后画 ⇒ 上枚压下枚。
      for (pkq = 0; pkq < pkG; pkq++) {
        var gd = PK_D + pkq * PK_STEP;
        REND.coin(ctx, tp.x - PK_SEP, tp.y - gd, PK_R, false);
      }
      for (pkq = 0; pkq < pkH; pkq++) {
        var hd = PK_D + pkq * PK_STEP;
        REND.heart(ctx, tp.x + PK_SEP, tp.y - hd, PK_R, false);
      }
    }
    // 【v1.6.30~31 两枚车顶浮标全部退役】大王令："不需要为玩家强调"。
    //   · 爱心浮标（v1.6.22 的"小爱心 + 枚数"）：货堆本身按枚堆 ⇒ 数字与图标数重复，
    //     且固定画在车头正上方、车头朝上/朝下时与货堆叠在一起。→ v1.6.30 删。
    //   · 金币 `+N`（v0.9.2 的"车斗金额"）：车斗金额是**到站才结算**的东西，
    //     途中不需要向玩家报数；拾取节奏交给屁股货堆表达。→ v1.6.31 删。
    //   ⚠️ **只是不画，口径全在**：`GS.train.cargo`（金额：金币价值 + 铸币所加成 +
    //     贴轨经济建筑进账）与 `GS.train.hearts`（枚数）仍是数值权威，交付/HUD/LOG
    //     都照旧读它们；HUD「车斗」格子早在 v1.4.7 就退役了 ⇒ 现在途中的车斗量
    //     **画面上不再显示**（到站入账后由 HUD 的金币数体现）。
  }

  // 交付飘字（v1.6.32 大王令"交付的时候飘字，包括生命和金币"）：交付瞬间在站台上方冒
  //   「金币 +N」「生命 +N」两行，向上飘 26px 并淡出（1.15s）。
  //   ▍**屏幕坐标系**（不随车头旋转）—— 文字要保持"朝上"可读，不能跟着车转。
  //   ▍"不要重叠导致看不清"的落实：
  //     ① 两行**固定错开 20px**（金币行在下、生命行在上），一起上飘 ⇒ 间距恒定；
  //        13px 粗体行高约 13px ⇒ 20px 间距留 7px 余量，肉眼看是两行不是一团；
  //     ② **同类只留最新一条**（`ENG.spawnFloat` 按 kind 去重）⇒ 连续几圈交付不叠字；
  //     ③ 每行都是「小图标 + 文字」作为一个整体**水平居中**在锚点上（图标在左、文字在右），
  //        不会出现图标压字；
  //     ④ 锚点 = 站台格上移 32/52px，且交付同帧货堆已清空 ⇒ 不压列车、不压货堆。
  if (GS.floats && GS.floats.length) {
    var FL_RISE = 26;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var fi = 0; fi < GS.floats.length; fi++) {
      var fl = GS.floats[fi];
      var pr = fl.t / fl.ttl;                                   // 0→1
      var alpha = (pr < 0.12) ? (pr / 0.12) : (1 - (pr - 0.12) / 0.88);   // 快入、慢出
      if (alpha < 0) alpha = 0;
      var fy = fl.y - FL_RISE * pr;                             // 向上飘
      ctx.globalAlpha = alpha;
      // ▍v1.8s 伤害/击杀飘字：无图标，纯文字水平居中（白=普通伤害 / 金=击杀击穿）；
      //   字号比交付行小一档、击杀放大一档——战斗高频，视觉层级压过交付播报即可。
      if (fl.kind === 'dmg' || fl.kind === 'kill') {
        var kill = fl.kind === 'kill';
        ctx.font = kill ? 'bold 15px "PingFang SC",system-ui,sans-serif'
                        : 'bold 12px "PingFang SC",system-ui,sans-serif';
        ctx.fillStyle = kill ? REND.C.gold : '#f2ede4';
        var tw = ctx.measureText(fl.text).width;
        ctx.fillText(fl.text, fl.x - tw / 2, fy);
      } else if (fl.kind === 'speed') {
        // v1.8y 消耗提速飘字：**两行块状**（补丁十二·大王令「加换行」）——state 侧
        //   text 带 \n（行1「提速 +X% · lv N」/ 行2「车头 M」，单行沙箱自动兼容），
        //   块体垂直居中锚点、行距 20px（> 16px 字号 ⇒ 不重叠）、整体上飘；
        //   浅蓝 + 深色描边兜底——描边 3→4px、底色更深（上轮 3px 观感不足，
        //   补丁十二·大王令「加描边」），保证任何背景都可读；ttl 2.4s。
        ctx.font = 'bold 16px "PingFang SC",system-ui,sans-serif';
        ctx.lineWidth = 4;
        ctx.strokeStyle = 'rgba(10,20,35,0.95)';
        ctx.lineJoin = 'round';
        var spLines = fl.text.split('\n');
        var spLH = 20, spSpan = (spLines.length - 1) * spLH;
        for (var spI = 0; spI < spLines.length; spI++) {
          var spY = fy - spSpan / 2 + spI * spLH;
          var spW = ctx.measureText(spLines[spI]).width;
          ctx.strokeText(spLines[spI], fl.x - spW / 2, spY);
          ctx.fillStyle = '#7cc4ff';
          ctx.fillText(spLines[spI], fl.x - spW / 2, spY);
        }
      } else {
        ctx.font = 'bold 13px "PingFang SC",system-ui,sans-serif';
        var fw = ctx.measureText(fl.text).width;
        var ir = 4.4, flGap = 4;
        var ix = fl.x - (ir * 2 + flGap + fw) / 2;              // 图标 + 文字整体居中
        if (fl.kind === 'heal') REND.heart(ctx, ix + ir, fy, ir, false);
        else REND.coin(ctx, ix + ir, fy, ir, false);
        ctx.fillStyle = (fl.kind === 'heal') ? REND.C.heart : REND.C.gold;
        ctx.fillText(fl.text, ix + ir * 2 + flGap, fy);
      }
    }
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

  // v1.3.4 入夜遮罩已删（大王拍板"不再有日夜交替"）：防守/建造画面亮度一致，
  //   阶段区分只靠开波按钮文案与状态栏（原 CLOCK.darkness() 已随退役记录移除）。

  // ---- v1.3.3 攻击范围提示（画在地面上、怪之下：范围是"地面信息"，
  //      怪 / 攻击连线 / 拖动幽灵保持在上层）—— 细虚线 + 极淡填充，不抢视觉 ----
  // ① 塔射程环 **整体退役**（v1.6.5 大王拍板："不不不，塔没有攻击能力啊"）：
  //    拖塔/悬停塔不再画任何攻击范围环。推理链：该环只在白天触发（拖塔/悬停
  //    排盘），白天无战斗 → "覆盖"没有静态答案（车厢随车跑）；且 v1.4.2 口径下
  //    塔=星级容器、没有攻击能力 —— 无论画在塔格（暗示塔能打）还是画在车厢
  //    实时位置（白天堆在站台后，与源塔零联系=大王报的 bug）都不成立。
  //    拖塔的**合成反馈**保留：可合成目标塔画金色虚线高亮圈（非范围语义）。
  if (drag && drag.kind === 'tower') {
    var tcell = CFG.pickCell(L, drag.px, drag.py);
    var tdst = tcell ? GS.grid[tcell.r][tcell.c].b : null;
    if (tdst && TOWERS.canMerge(drag.tower, tdst)) REND.mergeHint(ctx, L, tdst);
  }
  // ② 车头/车厢攻击环：**常驻显示退役（v1.6.11 大王令），v1.6.13 改为长按显示**——
  //    按住车头/车厢（UI.trainSel 按住态，ui.onDown 维护、pointerup/cancel 清除）
  //    时画该节**自己**的射程环：车头 = TRAIN_COMBAT.RANGE、车厢 = 塔型射程
  //    （v1.8j 起 TYPES.range 按型分化 4.5/2.2，不再统一用 WAGON.RANGE 兜底）；
  //    松手即消失。撞击圈 0.8 仍不画（添乱）。
  var tsel = (typeof UI !== 'undefined') ? UI.trainSel : null;
  if (tsel && GS.railPath.length) {
    if (tsel.kind === 'head') {
      var thp = ENG.trainPos();
      REND.rangeRing(ctx, L, thp.x, thp.y, ENG.TRAIN_COMBAT.RANGE, REND.C.trainRGB, REND.RANGE.train);
    } else {
      var twp = ENG.wagonPos(tsel.i);
      var twT = (typeof TOWERS !== 'undefined' && GS.towers[tsel.i])
              ? TOWERS.TYPES[GS.towers[tsel.i].elem] : null;
      if (twp) REND.rangeRing(ctx, L, CFG.ccx(L, twp.c), CFG.ccy(L, twp.r),
                              (twT ? twT.range : ENG.WAGON.RANGE), REND.C.trainRGB, REND.RANGE.train);
    }
  }

  // ---- v1.3-rc 塔防动态层（v1.3.4 起无遮罩，怪直接画在地图上）----
  // 怪：红圆 + 血条（浮点格坐标 → 像素）
  for (var fi = 0; fi < GS.foes.length; fi++) {
    var f = GS.foes[fi];
    var fx = L.x + f.c * L.cell + L.cell / 2, fy = L.y + f.r * L.cell + L.cell / 2;
    // v1.6.74 击退滑动演出（规格 §14.50）：_knockback 逻辑坐标已到目标，这里把
    //   怪画在"原位 → 新位"的 easeOutCubic 插值位上（1−p 收敛 ⇒ 无跳变；新位
    //   照常赶路，动画只是叠加一个衰减偏移）。闪白/血条随动。
    if (f.kbAnim) {
      // v1.6.80：t 从 −stun 起步（撞击先顿再滑）⇒ 钳位下限 0，t<0 画原位
      var kp = Math.max(0, Math.min(1, f.kbAnim.t / f.kbAnim.dur));
      kp = 1 - (1 - kp) * (1 - kp) * (1 - kp);          // easeOutCubic：起步快、贴停慢
      fx += (f.kbAnim.fx - f.c) * (1 - kp) * L.cell;
      fy += (f.kbAnim.fy - f.r) * (1 - kp) * L.cell;
    }
    var fr = L.cell * 0.3;
    ctx.fillStyle = REND.C.foe;
    ctx.beginPath();
    ctx.arc(fx, fy, fr, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // 被击闪白
    if (f.hitFlash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,' + (f.hitFlash * 4) + ')';
      ctx.beginPath();
      ctx.arc(fx, fy, fr, 0, 7);
      ctx.fill();
    }
    // 血条（宽 = 格宽 0.8，高 3px，压在怪头顶）
    var bw = L.cell * 0.8;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(fx - bw / 2, fy - fr - 7, bw, 3.5);
    ctx.fillStyle = '#7ee081';
    ctx.fillRect(fx - bw / 2, fy - fr - 7, bw * Math.max(0, f.hp / f.maxHp), 3.5);
  }
  // 粒子层（v1.6.43 B/E）：死亡尸影/碎屑、爆炸火光/冲击环 —— 画在怪之上、连线之下
  REND.drawFx(ctx);
  // 刷怪点预警（v1.6.50 大王令）：白天布阵画下一波点位（红圈+怪头像+×数量）；
  //   开波后 fadeSpawns 随 t 淡出 1s。
  REND.spawnMarks(ctx, L);
  // 攻击连线（瞬时弹道感，0.12s 衰减）。塔默认白；车头浅紫（v1.3.1，bm.rgb 模板拼 alpha）
  for (var bi = 0; bi < TOWERS.beams.length; bi++) {
    var bm = TOWERS.beams[bi];
    ctx.strokeStyle = bm.rgb
      ? 'rgba(' + bm.rgb + ',' + (bm.t / 0.12 * 0.9) + ')'
      : 'rgba(255,255,255,' + (bm.t / 0.12 * 0.8) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(CFG.ccx(L, bm.ac), CFG.ccy(L, bm.ar));
    ctx.lineTo(L.x + bm.bc * L.cell + L.cell / 2, L.y + bm.br * L.cell + L.cell / 2);
    ctx.stroke();
  }
  // 车厢弹丸（v1.8n）：机枪小黄点 / 火炮大橙点 / 闪电紫点，沿飞行方向短拖尾。
  //   冰环无弹（扩散环特效走 fx 层）。颜色复用车厢 rgb 模板（ENG.wagonRgb）。
  for (var bi2 = 0; bi2 < (GS.bullets || []).length; bi2++) {
    var bl = GS.bullets[bi2];
    var bx = CFG.ccx(L, bl.c), by = CFG.ccy(L, bl.r);
    var dx2 = CFG.ccx(L, bl.target.c) - bx, dy2 = CFG.ccy(L, bl.target.r) - by;
    var ang2 = Math.atan2(dy2, dx2);
    var rgb2 = ENG.wagonRgb(bl.kind);
    var rr2 = bl.kind === 'cannon' ? L.cell * 0.16 : (bl.kind === 'magic' ? L.cell * 0.11 : L.cell * 0.08);
    ctx.strokeStyle = 'rgba(' + rgb2 + ',0.5)';            // 拖尾（沿反方向 2.2×半径）
    ctx.lineWidth = rr2;
    ctx.beginPath();
    ctx.moveTo(bx - Math.cos(ang2) * rr2 * 2.2, by - Math.sin(ang2) * rr2 * 2.2);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.fillStyle = 'rgba(' + rgb2 + ',0.95)';             // 弹体
    ctx.beginPath(); ctx.arc(bx, by, rr2, 0, 7); ctx.fill();
  }
  // 镇中心血条（画在 core 格正上方；v1.8y 反馈补丁七·大王令「一并纳入、不要出框」
  // ——上收贴格顶，全宽 0.86 格不出格；低血仍红）
  var coreB = GS.core;
  if (coreB) {
    var hx = CFG.ccx(L, coreB.c), hyTop = L.y + coreB.r * L.cell + 1.5;
    var hw = L.cell * 0.86;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(hx - hw / 2, hyTop, hw, 4);
    ctx.fillStyle = GS.coreHP / GS.coreMaxHP > 0.3 ? '#4fae52' : '#e8563f';
    ctx.fillRect(hx - hw / 2, hyTop, hw * Math.max(0, GS.coreHP / GS.coreMaxHP), 4);
  }
  // 拖动幽灵（v1.3-rc）：拖塔 = 半透明圆台跟指针；拖清理形状 = 形状格高亮
  if (drag && drag.kind === 'tower') {
    var gtc = REND.C.tower[drag.tower.elem] || '#888';
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = gtc;
    ctx.beginPath();
    ctx.arc(drag.px, drag.py, L.cell * 0.34, 0, 7);
    ctx.fill();
    ctx.globalAlpha = 1;
    // v1.8u 十七令（§14.88）：拖塔不再只求合成——悬停格语义描边（与建筑 bmove 同色制：
    //   绿=移动空地 / 金=交换·合成 / 红=弹回），判定与 UI.settleTowerMove 同口径（只读）。
    var tmv = CFG.pickCell(L, drag.px, drag.py);
    if (tmv && (tmv.c !== drag.tower.c || tmv.r !== drag.tower.r)) {
      var tdb = GS.grid[tmv.r][tmv.c].b;
      var tmode = (tdb && TOWERS.canMerge(drag.tower, tdb)) ? 'swap'
                : (!tdb && GS.isFreeSpot(tmv.c, tmv.r)) ? 'move'
                : (tdb && tdb.type !== 'core') ? 'swap' : 'bad';
      var tcol = (tmode === 'move') ? REND.C.okl
               : (tmode === 'swap') ? 'rgba(240,180,41,0.95)' : REND.C.bad;
      ctx.strokeStyle = tcol;
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x + tmv.c * L.cell + 1, L.y + tmv.r * L.cell + 1, L.cell - 2, L.cell - 2);
    }
  } else if (drag && drag.kind === 'clean' && drag.px >= 0) {
    var hcell = CFG.pickCell(LAY, drag.px, drag.py);
    if (hcell) {
      // 合法性预览（2026-09-29 大王报"可摆放状态不见了"补回 —— 判据与 ENG.applyShape
      //   完全同口径，但**只读**不改地形）：① 全部在界内且无建筑 ② 形状内至少 1 格废墟
      //   ③ 与区域相接 ≥ MIN_CONTACT 或压住内区。可清 = 绿，不可清 = 红。
      var okAll = true;
      var hasRubble = false;
      var pts3 = [];
      var anc3 = ENG.shapeAnchor(hcell, drag.shape.cells);   // v1.4.12：以指针为中心（与结算同口径）
      for (var ci = 0; ci < drag.shape.cells.length; ci++) {
        var cc3 = anc3.c + drag.shape.cells[ci][0], cr3 = anc3.r + drag.shape.cells[ci][1];
        // v1.4.12：越界格直接跳过（不画、不算红）—— 与 ENG.applyShape"越界忽略"同口径；
        //   图内格才有红/绿判定，图内部分整体悬空时由 hasRubble/ct3 落红
        if (!CFG.inBounds(cc3, cr3)) continue;
        // v1.6.6：建筑格同口径跳过（不画、不判红）—— 与 applyShape"压塔跳过"一致
        if (GS.grid[cr3][cc3].b) continue;
        if (GS.grid[cr3][cc3].t === 'rubble') hasRubble = true;
        pts3.push({ c: cc3, r: cr3 });
      }
      if (!hasRubble) okAll = false;
      // ⚠️ v1.4.12b 修复（大王实测 sid=9qo8z6 "(7,11) 预览红实际可放"）：相接检查必须
      //   同用居中锚点 anc3 —— 上一刀格子坐标换了、这里还留着指针格 hcell，锚点错位
      //   一格导致相接算错位置（4×2 锚点比指针偏 1 列）。预览三要素（格子/废墟/相接）
      //   从此全部同锚。
      var ct3 = ENG.shapeContacts(anc3.c, anc3.r, drag.shape.cells);
      if (ct3.count < ENG.MIN_CONTACT && !ct3.inner) okAll = false;
      for (var ci2 = 0; ci2 < pts3.length; ci2++) {
        var pc = pts3[ci2];
        ctx.fillStyle = okAll ? REND.C.ok : REND.C.bad;
        ctx.fillRect(L.x + pc.c * L.cell, L.y + pc.r * L.cell, L.cell, L.cell);
        ctx.strokeStyle = okAll ? REND.C.okl : REND.C.bad;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(L.x + pc.c * L.cell + 1, L.y + pc.r * L.cell + 1, L.cell - 2, L.cell - 2);
      }
      // v1.4.11 清理预览环：落点合法且 ui.js 已算出预览时，把"清完后的铁轨"画成
      //   金黄虚线（数据 = UI.updateCleanPreview 真跑 applyShape 抓下的 railPath，
      //   本层只读不改盘面）。深色衬底一遍 + 金黄一遍，保证任何底色上可辨。
      if (okAll && typeof UI !== 'undefined' && UI.dragPreview && UI.dragPreview.rail) {
        var pr2 = UI.dragPreview.rail;
        ctx.beginPath();
        for (var ri = 0; ri < pr2.length; ri++) {
          var x2 = L.x + (pr2[ri].c + 0.5) * L.cell, y2 = L.y + (pr2[ri].r + 0.5) * L.cell;
          if (ri === 0) ctx.moveTo(x2, y2); else ctx.lineTo(x2, y2);
        }
        ctx.closePath();
        ctx.setLineDash([6, 4]);
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.stroke();
        ctx.lineWidth = 2; ctx.strokeStyle = REND.C.preview; ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  } else if (drag && (drag.kind === 'hero' || drag.kind === 'building') && drag.px >= 0) {
    // 英雄卡 / 建筑卡幽灵（v1.4 / v1.6.23）：全场可建格淡绿高亮 + 悬停格描边（绿=可建/红=不可建）
    for (var hr2 = 0; hr2 < CFG.MAP_ROWS; hr2++) for (var hc2 = 0; hc2 < CFG.MAP_COLS; hc2++) {
      if (!GS.isFreeSpot(hc2, hr2)) continue;
      ctx.fillStyle = REND.C.ok;
      ctx.fillRect(L.x + hc2 * L.cell, L.y + hr2 * L.cell, L.cell, L.cell);
    }
    var hcell2 = CFG.pickCell(LAY, drag.px, drag.py);
    if (hcell2) {
      var okHero = GS.isFreeSpot(hcell2.c, hcell2.r);
      if (drag.kind === 'building') REND.buildingRange(ctx, L, hcell2.c, hcell2.r, drag.bkey);
      ctx.strokeStyle = okHero ? REND.C.okl : REND.C.bad;
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x + hcell2.c * L.cell + 1, L.y + hcell2.r * L.cell + 1, L.cell - 2, L.cell - 2);
      // v1.6.10 手牌直接合成：悬停同名 1 星塔 → 金圈提示（与拖塔合成同款 mergeHint）
      var hb2 = GS.grid[hcell2.r][hcell2.c].b;
      if (drag.kind === 'hero' && hb2 && hb2.type === 'tower' && TOWERS.canMergeCard(drag.elem, hb2)) {
        REND.mergeHint(ctx, L, hb2);
      }
    }
  } else if (drag && drag.kind === 'bmove' && drag.px >= 0) {
    // v1.8u 十四令（§14.85）：场上建筑拖动 —— 幽灵（建筑主色半透明方块 + 白描边）
    //   跟指针；悬停格语义描边（绿=移动 / 金=交换 / 红=弹回）。源建筑原格照画
    //   （结算前数据不动，与拖塔同口径），判定与 UI.settleBuildingMove 完全同口径。
    var mbt = drag.building.type;
    var mcell = CFG.pickCell(LAY, drag.px, drag.py);
    // 拖动场上建筑时同样显示效果范围（与手牌拖上场同一套渲染件，落点即预览）——
    //   先铺范围再画幽灵，幽灵方块保持清晰不被范围底色压暗。
    if (mcell) REND.buildingRange(ctx, L, mcell.c, mcell.r, mbt);
    var mbody = (mbt === 'mint') ? '#8a6a12' : (mbt === 'gas') ? '#1b6a94'
              : (mbt === 'atk') ? '#a93b2e' : '#1f7a68';
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = mbody;
    ctx.fillRect(drag.px - L.cell * 0.36, drag.py - L.cell * 0.36, L.cell * 0.72, L.cell * 0.72);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(drag.px - L.cell * 0.36, drag.py - L.cell * 0.36, L.cell * 0.72, L.cell * 0.72);
    if (mcell && (mcell.c !== drag.building.c || mcell.r !== drag.building.r)) {
      var mdb = GS.grid[mcell.r][mcell.c].b;
      // v1.8u 十七令（§14.88）：塔也纳入交换（建筑 ⇄ 塔双向），只剩 core/非空地弹回
      var mmode = (!mdb && GS.isFreeSpot(mcell.c, mcell.r)) ? 'move'
                : (mdb && mdb.type !== 'core') ? 'swap' : 'bad';
      var mcol = (mmode === 'move') ? REND.C.okl
               : (mmode === 'swap') ? 'rgba(240,180,41,0.95)' : REND.C.bad;
      ctx.strokeStyle = mcol;
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x + mcell.c * L.cell + 1, L.y + mcell.r * L.cell + 1, L.cell - 2, L.cell - 2);
    }
  }
  // 【v1.6.36 退役】词条卡拖拽幽灵已随"选中即全场生效、不需要装备"一并移除
  //   （词条卡在弹层里点选即生效，不再进牌库、不再拖到塔上）。
  // 镜头速度线（v1.6.76）：boost 驱动的全屏径向流线 —— 场景最上层、横幅/经验条
  //   之下（不压数字与倒计时）。
  REND.speedLines(ctx);
  // 作战横幅（v1.6.38）：拉远时倒计时/奖励时间/收车提示大字
  REND.battleBanner(ctx, L);
  // 词条经验条（v1.6.41）：**画在横幅之后** ⇒ 夜晚数字浮在横幅底条上（数字靠右、
  //   横幅文字居中，互不遮挡）；旧序（横幅前）会被半透明底条压暗看不清。
  REND.expBar(ctx, L);
  // 镇中心 tips（v1.8y 反馈补丁八·大王令）：UI.coreTip 开启时画等级/速度气泡，
  //   置于 draw 最末 ⇒ 盖在一切之上（血条/进度条/横幅都不挡它）
  REND.coreTip(ctx, L);
};

// 建筑效果范围预览（手牌拖上场 / 场上建筑拖动**共用**，v1.6.23 建，抽出共用件）：
//   以 (c,r) 为建筑中心，按建筑类型铺作用范围。两态口径（v1.8u 六令 §4d/§14.82）：
//   标准态淡底；范围格内**有效目标**整格高亮 —— gas = 在轨格（GS.onRail）、
//   mint = 金币格（grid.gold）、atk/asp = 车厢格（塔）。猛攻坊/疾速坊为横/竖 3 格条。
REND.buildingRange = function (ctx, L, c, r, bkey) {
  // 加油站：3×3 蓝淡底（在轨格提亮）
  if (bkey === 'gas') {
    var gr = CFG.GAS_RANGE;
    for (var gdr = -gr; gdr <= gr; gdr++) for (var gdc = -gr; gdc <= gr; gdc++) {
      var gc2 = c + gdc, gr3 = r + gdr;
      if (!CFG.inBounds(gc2, gr3)) continue;
      ctx.fillStyle = GS.onRail(gc2, gr3) ? 'rgba(94,200,240,0.38)' : 'rgba(94,200,240,0.16)';
      ctx.fillRect(L.x + gc2 * L.cell, L.y + gr3 * L.cell, L.cell, L.cell);
    }
  }
  // 铸币所：3×3 金淡底（金币格提亮）+ 金币格淡金描边
  if (bkey === 'mint') {
    var mr = CFG.MINT_RANGE;
    for (var mdr = -mr; mdr <= mr; mdr++) for (var mdc = -mr; mdc <= mr; mdc++) {
      var mc2 = c + mdc, mr3 = r + mdr;
      if (!CFG.inBounds(mc2, mr3)) continue;
      ctx.fillStyle = GS.grid[mr3][mc2].gold ? 'rgba(240,180,41,0.35)' : 'rgba(240,180,41,0.14)';
      ctx.fillRect(L.x + mc2 * L.cell, L.y + mr3 * L.cell, L.cell, L.cell);
    }
    for (var mdr2 = -mr; mdr2 <= mr; mdr2++) for (var mdc2 = -mr; mdc2 <= mr; mdc2++) {
      var mc3 = c + mdc2, mr4 = r + mdr2;
      if (!CFG.inBounds(mc3, mr4)) continue;
      if (!GS.grid[mr4][mc3].gold) continue;
      ctx.strokeStyle = 'rgba(240,180,41,0.45)';
      ctx.lineWidth = 2;
      ctx.strokeRect(L.x + mc3 * L.cell + 1.5, L.y + mr4 * L.cell + 1.5, L.cell - 3, L.cell - 3);
    }
  }
  // 猛攻坊（横条）/ 疾速坊（竖条）：各 3 格（车厢格提亮）
  if (bkey === 'atk' || bkey === 'asp') {
    var axDirs = (bkey === 'atk') ? [[0, 0], [1, 0], [-1, 0]] : [[0, 0], [0, 1], [0, -1]];
    for (var d5 = 0; d5 < axDirs.length; d5++) {
      var fc5 = c + axDirs[d5][0], fr5 = r + axDirs[d5][1];
      if (!CFG.inBounds(fc5, fr5)) continue;
      var axHit = GS.grid[fr5][fc5].b && GS.grid[fr5][fc5].b.type === 'tower';
      ctx.fillStyle = (bkey === 'atk')
        ? (axHit ? 'rgba(224,86,63,0.38)' : 'rgba(224,86,63,0.16)')
        : (axHit ? 'rgba(61,189,158,0.38)' : 'rgba(61,189,158,0.16)');
      ctx.fillRect(L.x + fc5 * L.cell, L.y + fr5 * L.cell, L.cell, L.cell);
    }
  }
};

// 人工地面纹理（v1.6.46 ①）：每格确定性 hash（同一格逐帧稳定）生成
//   1 条 2 段微裂纹（暗，alpha 0.045~0.075）+ 2 个夯土亮点（亮，alpha 0.025~0.045）
//   —— 对比控制在 ±4%，28px 小格上"细看有、粗看无"，不抢格子主体。
REND.groundTex = function (ctx, c, r, px, py, cell) {
  var s = ((c * 73856093) ^ (r * 19349663)) & 0x7fffffff;
  var h1 = s / 0x7fffffff;
  var h2 = ((s * 48271) & 0x7fffffff) / 0x7fffffff;
  var h3 = ((s * 1103515245) & 0x7fffffff) / 0x7fffffff;
  ctx.strokeStyle = 'rgba(0,0,0,' + (0.045 + h1 * 0.03).toFixed(3) + ')';
  ctx.lineWidth = 1;
  ctx.beginPath();
  var tx = px + cell * (0.25 + h1 * 0.3), ty = py + cell * (0.25 + h2 * 0.3);
  ctx.moveTo(tx, ty);
  ctx.lineTo(tx + cell * (0.1 + h2 * 0.12), ty + cell * (0.12 + h3 * 0.1));
  ctx.lineTo(tx + cell * (0.22 + h3 * 0.1), ty + cell * (0.05 + h1 * 0.18));
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,' + (0.025 + h2 * 0.02).toFixed(3) + ')';
  ctx.beginPath(); ctx.arc(px + cell * (0.3 + h3 * 0.4), py + cell * (0.3 + h1 * 0.4), cell * 0.035, 0, 7); ctx.fill();
  ctx.beginPath(); ctx.arc(px + cell * (0.3 + h2 * 0.4), py + cell * (0.3 + h3 * 0.4), cell * 0.03, 0, 7); ctx.fill();
};

// 荒野带（v1.6.39 建；v1.6.44 去框改过渡；v1.6.45 羽化修；v1.6.46 大王令"从土地样式上
//   做过渡"：城内=人工地面（REND.groundTex），城外=纯荒野，中间=**废墟残片过渡带**）：
// 荒野世界层（v1.6.39 建；v1.6.46/47 土地样式过渡；v1.6.48 大王令"建造与战斗场景
//   一致，仅 UI 和镜头不同" ⇒ **常驻渲染**，昼夜不挂钩、e 参数退役）：
//   ① 荒野土地底色 —— 城外 evenodd 挖洞铺暖棕实色（比 bg 亮一档、与城内废墟同族）；
//   ② 轻羽化 —— 10 级×50px 环带外缘微收暗（alpha 0.12，smoothstep）；
//   ③ 废墟残片带 —— 碎石块 + 断墙残段，贴边密而大、向外变小变稀（同族色）；
//   ④ 自然点缀 —— 草簇/石点全域撒（rejection sampling），alpha 随距离衰减。
// 白天 cell 41：上下各 ~54px 荒野带可见；夜晚 cell 28：全景。LAY 插值时自动跟随。
REND.wilderness = function (ctx, L) {
  var x = L.x, y = L.y, w = L.w, h = L.h;
  ctx.save();
  // ⓪ 荒野土地底色（v1.6.47 建，v1.6.48 实色化常显）：明度差缩小后残片/草石才显形。
  ctx.beginPath();
  ctx.rect(0, 0, CFG.CANVAS_W, CFG.battleFieldH());
  ctx.rect(x, y, w, h);
  ctx.fillStyle = '#1a1510';
  ctx.fill('evenodd');
  // ① 阴影羽化（氛围辅助）：只在外缘远端做轻微收暗。
  var FE = 50, STEPS = 10, STEP = FE / STEPS;
  for (var li = 0; li <= STEPS; li++) {
    var out = FE - li * STEP;
    var inn = Math.max(0, out - STEP);
    var t = Math.min(1, (li + 0.5) / STEPS);
    var s = t * t * (3 - 2 * t);
    ctx.beginPath();
    if (li === 0) {
      ctx.rect(0, 0, CFG.CANVAS_W, CFG.battleFieldH());
      ctx.rect(x - out, y - out, w + out * 2, h + out * 2);
    } else {
      ctx.rect(x - out, y - out, w + out * 2, h + out * 2);
      ctx.rect(x - inn, y - inn, w + inn * 2, h + inn * 2);
    }
    ctx.fillStyle = 'rgba(5,7,12,' + (0.12 * s).toFixed(3) + ')';
    ctx.fill('evenodd');
  }
  // ② 废墟残片过渡带（土地样式过渡的主角，v1.6.47 加大提亮）：碎石块 + 断墙残段，
  //    **贴边密而大、向外变小变稀** —— 像城内废墟蔓延出去自然风化。分三层密度
  //    采样（0~35px 12 片 / 35~70px 8 片 / 70~110px 5 片）。
  var seed = 20261014;
  function rnd() { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; }
  var yTop = CFG.HUD_H + 14, yBot = CFG.battleFieldH() - 10;
  function wildSpot(maxDist) {                // 全荒野随机点：地图 ±10px 内重投、限距
    for (var t = 0; t < 30; t++) {
      var px = 6 + rnd() * (CFG.CANVAS_W - 12);
      var py = yTop + rnd() * (yBot - yTop);
      if (px > x - 10 && px < x + w + 10 && py > y - 10 && py < y + h + 10) continue;
      var dx = Math.max(x - px, px - (x + w), 0);
      var dy = Math.max(y - py, py - (y + h), 0);
      var dist = Math.sqrt(dx * dx + dy * dy);
      if (maxDist !== undefined && dist > maxDist) continue;
      var fade = Math.max(0.22, 1 - dist / 140);
      return { x: px, y: py, a: fade, d: dist };
    }
    return null;
  }
  // 碎石块 25 片（三层密度：近 12 / 中 8 / 远 5；v1.6.47 尺寸 ×1.8、alpha 0.5→0.65）
  var rubLayers = [[35, 12], [70, 8], [110, 5]];
  for (var ri = 0; ri < rubLayers.length; ri++) {
    for (var rj = 0; rj < rubLayers[ri][1]; rj++) {
      var rp = wildSpot(rubLayers[ri][0]);
      if (!rp) continue;
      var rw = L.cell * (0.15 + rnd() * 0.2), rh = L.cell * (0.11 + rnd() * 0.16);
      ctx.fillStyle = 'rgba(66,60,52,' + (0.65 * rp.a).toFixed(3) + ')';
      ctx.beginPath();
      ctx.moveTo(rp.x, rp.y);
      ctx.lineTo(rp.x + rw, rp.y + rh * 0.3);
      ctx.lineTo(rp.x + rw * 0.7, rp.y + rh);
      ctx.lineTo(rp.x - rw * 0.3, rp.y + rh * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }
  // 断墙残段 6 段（2 段直角折线 = 墙基，近密远稀；v1.6.47 加长提亮）
  var wallLayers = [[40, 3], [80, 2], [110, 1]];
  for (var wi = 0; wi < wallLayers.length; wi++) {
    for (var wj = 0; wj < wallLayers[wi][1]; wj++) {
      var wp = wildSpot(wallLayers[wi][0]);
      if (!wp) continue;
      var wl = L.cell * (0.3 + rnd() * 0.25), vert = rnd() > 0.5;
      ctx.strokeStyle = 'rgba(96,86,70,' + (0.75 * wp.a).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath();
      if (vert) {
        ctx.moveTo(wp.x, wp.y); ctx.lineTo(wp.x, wp.y + wl);
        ctx.lineTo(wp.x + wl * 0.5, wp.y + wl);
      } else {
        ctx.moveTo(wp.x, wp.y); ctx.lineTo(wp.x + wl, wp.y);
        ctx.lineTo(wp.x + wl, wp.y + wl * 0.5);
      }
      ctx.stroke();
    }
  }
  // ③ 自然荒野点缀（固定种子 ⇒ 逐帧稳定）：全荒野随机取点（seed/rnd/wildSpot 复用
  //    ②段定义，wildSpot() 无参 = 不限距）；**透明度按离地图边缘距离衰减**（C）：
  //    0~140px 从 1.0 衰到 0.22，近密亮远稀暗。
  // 草簇 22 簇（逐簇按距离定透明度；v1.6.47 提亮，黑底已换土地色可撑住高 alpha）
  ctx.lineWidth = 1.2;
  for (var gi = 0; gi < 22; gi++) {
    var gs = wildSpot();
    if (!gs) continue;
    ctx.strokeStyle = 'rgba(122,152,92,' + (0.6 * gs.a).toFixed(3) + ')';
    ctx.beginPath();
    ctx.moveTo(gs.x, gs.y); ctx.lineTo(gs.x - 2.2, gs.y - 3.6 - rnd() * 2);
    ctx.moveTo(gs.x, gs.y); ctx.lineTo(gs.x + 0.4, gs.y - 4.2 - rnd() * 2);
    ctx.moveTo(gs.x, gs.y); ctx.lineTo(gs.x + 2.6, gs.y - 3.2 - rnd() * 2);
    ctx.stroke();
  }
  // 石点 16 颗（同款距离衰减；v1.6.47 提亮）
  for (var si = 0; si < 16; si++) {
    var sp = wildSpot();
    if (!sp) continue;
    ctx.fillStyle = 'rgba(120,122,134,' + (0.6 * sp.a).toFixed(3) + ')';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 1.4 + rnd() * 1.4, 0, 7);
    ctx.fill();
  }
  ctx.restore();
};

// 作战横幅（v1.6.38 大王令"倒计时、奖励时间与收车提示文本显示在顶部UI下方、
//   地块区域上方，并且放大+醒目显示"）：
//   · 只在**非白天**画（白天不拉远，提示仍在开波按钮上）；
//   · 位置 = 画布顶部（HUD 之下）、地块上方 —— 夜晚地图 y 从 ~129 起，
//     横幅占 y 8~52 一整条，互不重叠；
//   · 文本 = CLOCK.label()（"第N波 防守 Xs / ·奖励时间 Xs / ·等清场 / 收车中"）；
//   · 醒目 = 全宽深色底条 + 20px 粗体白字 + 深描边；**奖励时间**整体换金色
//     （与"清得快有奖"的正反馈同色语言）；收车中换青色（提示"这圈跑完就停"）。
REND.battleBanner = function (ctx, L) {
  if (typeof CLOCK === 'undefined' || typeof CLOCK.label !== 'function') return;
  // 淡入淡出（v1.6.39）：alpha 跟 CAM.t（0=白天 1=夜晚，过渡中平滑）⇒ 横幅
  //   随镜头拉远一同浮现、随镜头收回一同隐去，不再硬切。无 CAM 环境（测试沙箱）
  //   退回相位布尔，保持 v1.6.38 行为。
  var a = (typeof CAM !== 'undefined' && CAM) ? CAM.t : (CLOCK.isDay() ? 0 : 1);
  if (a <= 0.02) return;
  var txt = CLOCK.label();
  var y = 30;                                   // 横幅中线（HUD 下方、地图上方）
  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = 'rgba(10,10,16,0.55)';        // 全宽底条（压住底下任何元素）
  ctx.fillRect(0, y - 22, CFG.CANVAS_W, 44);
  var col = '#ffffff';
  if (CLOCK.reward) col = REND.C.gold;          // 奖励时间 → 金色
  else if (CLOCK.phase === 'dusk') col = '#7fe0ff';  // 收车中 → 青色
  ctx.font = 'bold 20px "PingFang SC",system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';         // 深描边（任何底色上可辨）
  ctx.strokeText(txt, CFG.CANVAS_W / 2, y);
  ctx.fillStyle = col;
  ctx.fillText(txt, CFG.CANVAS_W / 2, y);
  ctx.restore();
};

// ---- 攻击范围环（v1.3.3）极淡填充 + 细虚线，两层都压到"刚好可辨"的最低档：----
// 填充给"盖到哪"的面感，虚线给精确边界。rgb = 'r,g,b' 模板串（同 beams 拼 alpha）；
// rCells = 半径（格）。只在按需路径上被调（拖塔/悬停/夜里的车头），平时零绘制。
REND.rangeRing = function (ctx, L, cx, cy, rCells, rgb, style) {
  var R = rCells * L.cell;
  if (R <= 0) return;
  ctx.fillStyle = 'rgba(' + rgb + ',' + style.fill + ')';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(' + rgb + ',' + style.line + ')';
  ctx.lineWidth = REND.RANGE.LINE_W;
  ctx.setLineDash(REND.RANGE.DASH);
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, 7); ctx.stroke();
  ctx.setLineDash([]);
};

// 拖塔合成目标高亮（v1.6.5）：金色虚线圆圈套住可合成目标塔 —— 传达"拖到这里
//   会合成"，替代退役的射程环。非范围语义，只是归属提示。
REND.mergeHint = function (ctx, L, tower) {
  var x = L.x + tower.c * L.cell + L.cell / 2, y = L.y + tower.r * L.cell + L.cell / 2;
  ctx.strokeStyle = '#ffd75e';
  ctx.lineWidth = 2.5;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.arc(x, y, L.cell * 0.44, 0, 7);
  ctx.stroke();
  ctx.setLineDash([]);
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
//   想恢复：箭头循环的 chevron 历史实现见归档 archive/js-before-cleanup-20261015/renderer.js。
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
    //    辅助。chevron 历史实现见归档 archive/js-before-cleanup-20261015/renderer.js。
  }
};

// 方向箭头（v0.8.3 已停用，大王令"把箭头干掉"）：指向 +x 的小三角，旋转 ang 后放到 (x, y)。
//   函数保留备查——恢复时在 railTiles 尾部按 pass 向量逐趟调用即可（历史实现见 archive/renderer.v0.8.1.js）。
// （已无调用点；fillStyle 色 railChev 同步停用，见 REND.C 注释。）

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
  } else if (b.type === 'mint') {
    // v1.6.23 铸币所：深色垫层 + 暗金主体 + 金色描边 + **三枚叠币**（"造币/加值"语义）。
    //   配色刻意贴着金币黄（它是给金币加值的建筑），但形状用**方块**，
    //   与"金币=圆"拉开（沿用"形状类别互斥"的定稿口径）。
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(cx - s / 2 + 1, cy - s / 2 + 2, s, s);
    ctx.fillStyle = '#8a6a12';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeStyle = 'rgba(240,180,41,0.95)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - s / 2 + 0.6, cy - s / 2 + 0.6, s - 1.2, s - 1.2);
    for (var mi2 = 0; mi2 < 3; mi2++) {
      ctx.beginPath();
      ctx.arc(cx + (mi2 - 1) * s * 0.21, cy + s * 0.06, s * 0.13, 0, 7);
      ctx.fillStyle = '#ffd257'; ctx.fill();
      ctx.strokeStyle = 'rgba(90,60,0,0.6)'; ctx.lineWidth = 0.8; ctx.stroke();
    }
  } else if (b.type === 'gas') {
    // v1.6.23 加油站：深色垫层 + 蓝色主体 + 白色描边 + **白闪电**（"提速"语义）。
    //   蓝系与金币黄/经济绿/废墟红/爱心玫红都不同色系。
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(cx - s / 2 + 1, cy - s / 2 + 2, s, s);
    ctx.fillStyle = '#1b6a94';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeStyle = 'rgba(150,225,255,0.95)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - s / 2 + 0.6, cy - s / 2 + 0.6, s - 1.2, s - 1.2);
    ctx.beginPath();                                   // 闪电
    ctx.moveTo(cx + s * 0.10, cy - s * 0.30);
    ctx.lineTo(cx - s * 0.14, cy + s * 0.02);
    ctx.lineTo(cx + s * 0.02, cy + s * 0.02);
    ctx.lineTo(cx - s * 0.10, cy + s * 0.30);
    ctx.lineTo(cx + s * 0.16, cy - s * 0.04);
    ctx.lineTo(cx - s * 0.01, cy - s * 0.04);
    ctx.closePath();
    ctx.fillStyle = '#eaf8ff';
    ctx.fill();
  } else if (b.type === 'atk' || b.type === 'asp') {
    // v1.8u 十三令（§14.84）猛攻坊/疾速坊：深垫层 + 主体方块 + 白语义符号 ——
    //   猛攻坊 = 深绯 + 横向双头箭 ←→（范围形状 = 攻击语义）；疾速坊 = 深青 +
    //   发条弹簧（竖直锯齿 + 上箭头，疾速/攻速语义）。绯红与火炮亮红 #e8563f 同族
    //   但更深暗，形状互斥口径不变（建筑=方块 / 塔=六边形）。
    //   【v1.6.35 军工厂（钢紫方块 + 白十字 + % 标注）随十三令退役】
    var axAtk = (b.type === 'atk');
    // 生效连线（大王拍板连线案，替代军工厂 % 标注）：常驻细线连到每个被增益的
    //   车厢格中心（画在主体之前 ⇒ 端点被车厢六边形覆盖，视觉干净）。
    if (typeof GS.towers !== 'undefined') {
      ctx.strokeStyle = axAtk ? 'rgba(255,120,95,0.5)' : 'rgba(80,220,180,0.5)';
      ctx.lineWidth = 1.5;
      for (var iw = 0; iw < GS.towers.length; iw++) {
        var tw = GS.towers[iw];
        var axBoosted = axAtk ? (tw.r === b.r && Math.abs(tw.c - b.c) === 1)
                              : (tw.c === b.c && Math.abs(tw.r - b.r) === 1);
        if (!axBoosted) continue;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(CFG.ccx(L, tw.c), CFG.ccy(L, tw.r));
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(cx - s / 2 + 1, cy - s / 2 + 2, s, s);
    ctx.fillStyle = axAtk ? '#a93b2e' : '#1f7a68';
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    ctx.strokeStyle = axAtk ? 'rgba(255,150,130,0.95)' : 'rgba(130,235,205,0.95)';
    ctx.lineWidth = 1.2;
    ctx.strokeRect(cx - s / 2 + 0.6, cy - s / 2 + 0.6, s - 1.2, s - 1.2);
    ctx.strokeStyle = axAtk ? '#ffe3dc' : '#eafff8';   // 白语义符号（与作用范围同构）
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (axAtk) {
      // 横向双头箭 ←→
      ctx.moveTo(cx - s * 0.28, cy); ctx.lineTo(cx + s * 0.28, cy);
      ctx.moveTo(cx - s * 0.28, cy); ctx.lineTo(cx - s * 0.16, cy - s * 0.10);
      ctx.moveTo(cx - s * 0.28, cy); ctx.lineTo(cx - s * 0.16, cy + s * 0.10);
      ctx.moveTo(cx + s * 0.28, cy); ctx.lineTo(cx + s * 0.16, cy - s * 0.10);
      ctx.moveTo(cx + s * 0.28, cy); ctx.lineTo(cx + s * 0.16, cy + s * 0.10);
    } else {
      // 发条弹簧（竖直锯齿）+ 顶端上箭头
      ctx.moveTo(cx, cy + s * 0.30);
      ctx.lineTo(cx + s * 0.10, cy + s * 0.18);
      ctx.lineTo(cx - s * 0.10, cy + s * 0.04);
      ctx.lineTo(cx + s * 0.10, cy - s * 0.10);
      ctx.lineTo(cx, cy - s * 0.20);
      ctx.moveTo(cx - s * 0.09, cy - s * 0.28);
      ctx.lineTo(cx, cy - s * 0.38);
      ctx.lineTo(cx + s * 0.09, cy - s * 0.28);
    }
    ctx.stroke();
  } else if (b.type === 'tower') {
    // v1.4.16 塔（大王令"建筑形象与金币太接近，换个方案"）：圆台 → **六边形双层**。
    //   病根是双重撞脸：塔(圆 r=0.34) vs 金币地块(圆 r=0.26) 形状同类且大小接近，
    //   雷元素色 #f7d94c 还与金币色 #f0b429 同为黄系。定稿口径（形状类别互斥）：
    //   金币=圆 / 塔=六边形 / 列车=圆角矩形 / 废墟=方格裂纹。
    //   双层 = 深色底座六边形（落地的分量）+ 元素色主体六边形 + 白细描边；
    //   星点与命中闪光沿用 v1.3-rc 口径。元素色板不动（车厢也用同一套 tower 色）。
    var tc = REND.C.tower[b.elem] || '#888';
    var hexPts = function (rr) {                    // 尖顶六边形顶点（cell 内居中）
      var pts = [];
      for (var hi = 0; hi < 6; hi++) {
        var ha = Math.PI / 3 * hi - Math.PI / 2;
        pts.push([cx + rr * Math.cos(ha), cy + rr * Math.sin(ha)]);
      }
      return pts;
    };
    var fillHex = function (rr, fill) {
      var pts = hexPts(rr);
      ctx.beginPath();
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (var hi2 = 1; hi2 < 6; hi2++) ctx.lineTo(pts[hi2][0], pts[hi2][1]);
      ctx.closePath();
      ctx.fillStyle = fill;
      ctx.fill();
    };
    fillHex(s * 0.42, 'rgba(0,0,0,0.45)');          // 底座：深色垫层，塔"立"在地上
    fillHex(s * 0.32, tc);                          // 主体：元素色
    var edge = hexPts(s * 0.32);                    // 白细描边（与金币白圈呼应但形状不同类）
    ctx.beginPath();
    ctx.moveTo(edge[0][0], edge[0][1]);
    for (var ei = 1; ei < 6; ei++) ctx.lineTo(edge[ei][0], edge[ei][1]);
    ctx.closePath();
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // 攻击闪光：命中瞬间描一圈亮边
    if (b.flash > 0) {
      ctx.strokeStyle = 'rgba(255,255,255,' + (b.flash * 3.5) + ')';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(cx, cy, s * 0.42, 0, 7);
      ctx.stroke();
    }
    // 星级点：横排小圆点
    ctx.fillStyle = '#fff';
    var nStar = Math.min(b.star, 5);
    for (var si2 = 0; si2 < nStar; si2++) {
      ctx.beginPath();
      ctx.arc(cx - ((nStar - 1) * 4) / 2 + si2 * 4, cy + s * 0.28, 1.6, 0, 7);
      ctx.fill();
    }
    // v1.6.36 词条角标（全局化改版）：不再表示"这座塔装了词条"，而是
    //   **该塔型已获得的词条数**（≤5，GS.affixCountOf）—— 词条对全场同型车厢生效，
    //   同型每座塔都亮同样数量的菱形（塔顶横排小白菱形）。
    var nAf = (typeof GS.affixCountOf === 'function' && typeof AFFIXES !== 'undefined')
      ? GS.affixCountOf(b.elem) : 0;
    for (var ai = 0; ai < nAf; ai++) {
      var axx = cx - ((nAf - 1) * 7) / 2 + ai * 7, ayy = cy - s * 0.58;
      ctx.beginPath();
      ctx.moveTo(axx, ayy - 3); ctx.lineTo(axx + 3, ayy); ctx.lineTo(axx, ayy + 3); ctx.lineTo(axx - 3, ayy);
      ctx.closePath();
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.strokeStyle = 'rgba(20,20,30,0.7)'; ctx.lineWidth = 1; ctx.stroke();
    }
  }
  ctx.restore();
};
// ============================================================================
// v1.6.34/35 新增渲染件：建筑效果范围高亮 / 地面物 / 词条经验条
// ============================================================================

// 建筑效果范围内的**在轨格**贴轨流光（v1.6.35 整格色块 → v1.8t 描边流光 →
//   **v1.8u 五改：单轨中心线 + 保留弧度**，§14.81。大王令"改成单轨，居中于两条
//   铁轨之间"——几何骨架沿用 railTiles 分支与 pass 推演（四改引入），绘制改
//   单线/单弧：直线=中线贯通格边、弯道=单四分之一弧（圆心格角、半径 h=双轨正中、
//   查表同轨贴片）、T 岔=贯通轴中线+支臂喇叭口单弧（pass 驱动查表，弧度保留）、
//   十字=横竖两条中线、度 1 端头=中线接格心+横梁；lineWidth max(2.5, s×0.10)、
//   lineCap='butt' 格边无缝。gas 座数重复描 gas 遍——透明度非线性叠亮（1−(1−a)ⁿ），
//   单层 alpha 恒 0.55（原 performance.now 呼吸已去：谷值 0.26 偏暗看不清，大王令）。
REND.rangeHighlights = function (ctx, L) {
  if (!GS.railSet || !GS.railPath || !GS.railPath.length) return;
  // 1) 扫描（railTiles 同款）：每格边方向使用集（两端都标）+ 每趟行进方向
  //    pass（prev→next 向量 + prev 边下标）——T 岔喇叭口的角点/绕向靠它推，照抄勿改。
  var use = {}, pass = {}, n = GS.railPath.length, i, k;
  function markDir(p, dx, dy) {
    var kk = p.c + ',' + p.r, uu = use[kk];
    if (!uu) { uu = use[kk] = [0, 0, 0, 0]; pass[kk] = []; }
    if (dx === 1) uu[1] = 1; else if (dx === -1) uu[3] = 1;
    else if (dy === -1) uu[0] = 1; else uu[2] = 1;
  }
  for (i = 0; i < n; i++) {
    var a = GS.railPath[i], b = GS.railPath[(i + 1) % n], pv = GS.railPath[(i - 1 + n) % n];
    var dx = b.c - a.c, dy = b.r - a.r;
    markDir(a, dx, dy);
    markDir(b, -dx, -dy);
    var pdx = pv.c - a.c, pdy = pv.r - a.r;
    var pd = pdy === -1 ? 0 : (pdx === 1 ? 1 : (pdy === 1 ? 2 : 3));
    pass[a.c + ',' + a.r].push([b.c - pv.c, b.r - pv.r, pd]);
  }
  // 2) 逐格叠画：几何 = railTiles 同款查表（弧参数照抄，别改成三角函数通式）；
  //    多座加油站 = tile() 画 gas 遍，rgba 叠加自然提亮。
  var s = L.cell, h = s / 2, d = s * 0.12;
  ctx.save();
  ctx.lineCap = 'butt';                           // 与轨贴片一致，格边无缝对接
  ctx.strokeStyle = 'rgba(94,200,240,0.55)';      // 单层恒定；N 层叠 = 1-(1-0.55)^N
  ctx.lineWidth = Math.max(2.5, s * 0.10);        // 单中心线，居中于 ±d 双轨之间
  for (k in use) {
    var cc = k.split(','), c = +cc[0], r = +cc[1];
    var gas = (typeof GS.gasCoverAt === 'function') ? GS.gasCoverAt(c, r) : 0;
    if (!gas) continue;
    var u = use[k], cx = CFG.ccx(L, c), cy = CFG.ccy(L, r);
    var deg = u[0] + u[1] + u[2] + u[3];
    var straight = deg === 2 && ((u[0] && u[2]) || (u[1] && u[3]));
    var tile = function () {
      ctx.beginPath();
      if (deg === 4) {                            // 十字：横竖两条中线贯通到格边
        ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h);
        ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy);
        ctx.stroke();
      } else if (deg === 3) {                     // T 岔：贯通轴中线 + 支臂喇叭口单弧
        var spur;
        if (u[1] && u[3]) {                       // 贯通轴横向（E+W）
          ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy);
          spur = u[0] ? 0 : 2;
        } else {                                  // 贯通轴纵向（N+S）
          ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h);
          spur = u[1] ? 1 : 3;
        }
        ctx.stroke();
        // 逐趟喇叭口（railTiles 同款推演，半径改 h=双轨正中）：形态 A「环拐进支臂」
        // 画所用轴边一角；形态 B「直穿折返」(0,0,prevDir) 画两轴边双角。查表与弯道同一张。
        var ps3 = pass[k], tj;
        for (tj = 0; tj < ps3.length; tj++) {
          var vt = ps3[tj];
          var armY = (spur === 0 || spur === 2);  // 支臂纵向（N/S）？
          var doubled = null;
          if (vt[0] === 0 && vt[1] === 0) doubled = vt[2];
          if (doubled === null && (vt[0] === 0 || vt[1] === 0)) continue;  // 直行趟
          var vA = armY ? vt[1] : vt[0];          // 行进向量在支臂轴上的分量
          var vT = armY ? vt[0] : vt[1];          // …在贯通轴上的分量
          var armEdge = (spur === 0) ? -1 : (spur === 2) ? 1 : (spur === 1) ? 1 : -1;
          var armIsEntry = (vA > 0 ? 1 : -1) === -armEdge;
          var usedSign = (vT > 0 ? 1 : -1) * (armIsEntry ? 1 : -1);
          var usedDir = armY ? (usedSign > 0 ? 1 : 3) : (usedSign > 0 ? 2 : 0);
          var q3 = [usedDir];
          if (doubled !== null) q3 = armY ? [1, 3] : [0, 2];
          for (var qi = 0; qi < q3.length; qi++) {
            var ud3 = q3[qi];
            var pair3 = (spur < ud3) ? spur * 10 + ud3 : ud3 * 10 + spur;
            var c3, a03, ccw3;
            if (pair3 === 1)      { c3 = [cx + h, cy - h]; a03 = Math.PI; ccw3 = true;  } // N+E
            else if (pair3 === 3) { c3 = [cx - h, cy - h]; a03 = 0;       ccw3 = false; } // N+W
            else if (pair3 === 12){ c3 = [cx + h, cy + h]; a03 = Math.PI; ccw3 = false; } // S+E
            else                  { c3 = [cx - h, cy + h]; a03 = 0;       ccw3 = true;  } // S+W
            var a13 = ccw3 ? a03 - Math.PI / 2 : a03 + Math.PI / 2;
            ctx.beginPath(); ctx.arc(c3[0], c3[1], h, a03, a13, ccw3); ctx.stroke();
          }
        }
      } else if (deg === 1) {                     // 折返端头：中线接格心 + 横梁
        if (u[0]) {
          ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy);
          ctx.moveTo(cx - d, cy); ctx.lineTo(cx + d, cy);
        } else if (u[2]) {
          ctx.moveTo(cx, cy + h); ctx.lineTo(cx, cy);
          ctx.moveTo(cx - d, cy); ctx.lineTo(cx + d, cy);
        } else if (u[1]) {
          ctx.moveTo(cx + h, cy); ctx.lineTo(cx, cy);
          ctx.moveTo(cx, cy - d); ctx.lineTo(cx, cy + d);
        } else {
          ctx.moveTo(cx - h, cy); ctx.lineTo(cx, cy);
          ctx.moveTo(cx, cy - d); ctx.lineTo(cx, cy + d);
        }
        ctx.stroke();
      } else if (deg === 2 && straight) {         // 直线：中线贯通格边
        if (u[0] && u[2]) { ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h); }
        else { ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy); }
        ctx.stroke();
      } else if (deg === 2) {                     // 弯道：单四分之一弧（半径 h，双轨正中）
        var corner, a0, ccw;
        if (u[0] && u[1])      { corner = [cx + h, cy - h]; a0 = Math.PI; ccw = true;  } // N+E
        else if (u[0] && u[3]) { corner = [cx - h, cy - h]; a0 = 0;       ccw = false; } // N+W
        else if (u[2] && u[1]) { corner = [cx + h, cy + h]; a0 = Math.PI; ccw = false; } // S+E
        else                   { corner = [cx - h, cy + h]; a0 = 0;       ccw = true;  } // S+W
        var a1 = ccw ? a0 - Math.PI / 2 : a0 + Math.PI / 2;
        ctx.beginPath();
        ctx.arc(corner[0], corner[1], h, a0, a1, ccw);
        ctx.stroke();
      } else {                                    // 防御分支（deg 0/>4）：按十字画
        ctx.moveTo(cx, cy - h); ctx.lineTo(cx, cy + h);
        ctx.moveTo(cx - h, cy); ctx.lineTo(cx + h, cy);
        ctx.stroke();
      }
    };
    for (var gi = 0; gi < gas; gi++) tile();      // 多座 = 叠多遍，透明度非线性提亮
  }
  ctx.restore();
};

// 地面物（v1.6.34 词条）：烈焰地带 c4（橙）/ 霜痕 i3（淡蓝）/ 地雷 c1（金属灰圆 + 橙芯）
REND.groundFx = function (ctx, L) {
  var i, g;
  for (i = 0; i < (GS.fireZones || []).length; i++) {
    g = GS.fireZones[i];
    ctx.fillStyle = REND.C.fireZone;
    ctx.fillRect(L.x + g.c * L.cell, L.y + g.r * L.cell, L.cell, L.cell);
  }
  for (i = 0; i < (GS.frostZones || []).length; i++) {
    g = GS.frostZones[i];
    ctx.fillStyle = REND.C.frostZone;
    ctx.fillRect(L.x + g.c * L.cell, L.y + g.r * L.cell, L.cell, L.cell);
  }
  for (i = 0; i < (GS.mines || []).length; i++) {
    g = GS.mines[i];
    var mx = CFG.ccx(L, g.c), my = CFG.ccy(L, g.r);
    ctx.beginPath(); ctx.arc(mx, my, L.cell * 0.16, 0, 7);
    ctx.fillStyle = REND.C.mine; ctx.fill();
    ctx.beginPath(); ctx.arc(mx, my, L.cell * 0.05, 0, 7);
    ctx.fillStyle = '#ff8c42'; ctx.fill();
  }
};

// 粒子层（v1.6.43 大王令 B/E）：GS.fx 的统一渲染。kind 三种：
//   ring = 扩张淡出圆环（冲击波）· puff = 扩张淡出实心圆（尸影/火光）· spark = 漂移碎屑。
// alpha = (1 - life/ttl) 随寿命线性淡出；坐标是生成瞬间的画布像素（ENG 侧换算）。
// 空/缺失 GS.fx 直接跳过（旧存档与测试沙箱安全）。
REND.drawFx = function (ctx) {
  var fx = GS.fx; if (!fx || !fx.length) return;
  for (var i = 0; i < fx.length; i++) {
    var p = fx[i];
    var k = 1 - p.life / p.ttl;                 // 存活比例 1→0
    if (k <= 0) continue;
    var prog = p.life / p.ttl;                  // 扩张进度 0→1
    if (p.kind === 'ring') {
      ctx.strokeStyle = 'rgba(' + p.color + ',' + (k * 0.8).toFixed(3) + ')';
      ctx.lineWidth = p.lw || 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * prog, 0, 7);
      ctx.stroke();
    } else if (p.kind === 'puff') {
      ctx.fillStyle = 'rgba(' + p.color + ',' + (k * 0.8).toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r0 + (p.r1 - p.r0) * prog, 0, 7);
      ctx.fill();
    } else {                                    // spark：缩小淡出的碎屑
      ctx.fillStyle = 'rgba(' + p.color + ',' + k.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + k * 0.5), 0, 7);
      ctx.fill();
    }
  }
};

// 刷怪点预警（v1.6.50 大王令"布阵阶段有预警 UI：红色圆圈+怪物头像"；v1.6.51 出界
//   降级箭头；v1.6.52 大王令"数量干掉，更短更宽的箭头+缩小的红圈，被遮一部分的
//   也用箭头"）：
//   · 白天布阵：画 GS.nextSpawns（下一波点位）。白天 cell 41 时点位（图外 2 格）
//     几乎全在可视区外 ⇒ **标记未完整落入可视区（含光晕）一律降级**：
//     缩小红圈（贴边完整可见）+ 短宽箭头指向真实方向；无数量文字。
//   · 开波后：画 FOES.fadeSpawns（同批点位，alpha 随 t 1→0 淡出）。
//   怪头像 = 场上怪的同族造型（红圆 + 双白眼）。可视区 = HUD 以下、footer 以上。
REND.spawnMarks = function (ctx, L) {
  var day = (typeof CLOCK === 'undefined') || CLOCK.isDay();
  var pts = null, fade = 1;
  if (day) {
    pts = GS.nextSpawns;                       // 布阵阶段：下一波点位
  } else if (typeof FOES !== 'undefined' && FOES.fadeSpawns) {
    pts = FOES.fadeSpawns.pts; fade = Math.max(0, FOES.fadeSpawns.t);   // 开波淡出
  }
  if (!pts || !pts.length || fade <= 0) return;
  var now = (typeof performance !== 'undefined') ? performance.now() : 0;
  // 可视区边界：左右留 6px；顶 = 画布顶（经验条 y0~9 会叠在标记上部，可接受）；
  //   底 = footer 上沿。⚠️ v1.6.53 修 bug：底沿此前误用 CANVAS_H(844) ⇒ clamp 进
  //   footer 背后被遮（大王截图实报）—— 画布物理高是 battleFieldH(792)。
  //   v1.6.57 大王令："顶部和底部的预警 UI 位置在可见区域内就不用箭头" ⇒
  //   inside 判定回到**圆心**口径（光晕/圆周被经验条或 footer 裁一点可接受），
  //   只有圆心真正出画布的（左右侧向）才降级箭头。
  var visL = 6, visR = CFG.CANVAS_W - 6;
  var visTop = 0, visBot = CFG.battleFieldH() - CFG.FOOTER_H;
  ctx.save();
  ctx.globalAlpha = fade;
  for (var i = 0; i < pts.length; i++) {
    var px = CFG.ccx(L, pts[i].c), py = CFG.ccy(L, pts[i].r);
    var r = L.cell * (0.5 + 0.05 * Math.sin(now / 280 + i));   // 脉动（每点相位错开）
    // 完整可见判定（v1.6.57 圆心口径）：圆心在可视区内即画完整标记——顶部点贴着
    //   经验条、底部点贴着 footer，位置可见就不用箭头；被裁一点的光晕/圆周可接受。
    var inside = px >= visL && px <= visR && py >= visTop && py <= visBot;
    if (inside) {
      // —— 完整标记（夜晚全景 / 恰好完整落在可视区的点）——
      ctx.fillStyle = 'rgba(232,70,58,0.14)';
      ctx.beginPath(); ctx.arc(px, py, r * 1.5, 0, 7); ctx.fill();
      ctx.strokeStyle = '#e8463a';
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,138,128,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(px, py, r - 3, 0, 7); ctx.stroke();
      var hr = r * 0.5;
      ctx.fillStyle = REND.C.foe;
      ctx.beginPath(); ctx.arc(px, py, hr, 0, 7); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(px - hr * 0.33, py - hr * 0.25, Math.max(1.2, hr * 0.16), 0, 7); ctx.fill();
      ctx.beginPath(); ctx.arc(px + hr * 0.33, py - hr * 0.25, Math.max(1.2, hr * 0.16), 0, 7); ctx.fill();
      continue;
    }
    // —— 降级：缩小红圈（贴边完整可见）+ 短宽箭头指向真实方向（v1.6.52）——
    var sr = r * 0.55;                                          // 缩小红圈半径
    var cx = Math.max(visL + sr + 3, Math.min(visR - sr - 3, px));
    var cy = Math.max(visTop + sr + 3, Math.min(visBot - sr - 3, py));
    // 方向向量必须用**固定边界**（不带呼吸的 sr）算 clamp —— 2026-10-15 大王实报
    //   "顶部箭头一直在朝上和朝右切换"：呼吸让 sr 每帧变 ⇒ clamp 边界移动 ⇒ 骑在
    //   边界上的点 ang 在贴边/偏转间抖动。用固定边界求方向 ⇒ 恒定；小圈位置微移无碍。
    var ang = Math.atan2(py - Math.max(visTop, Math.min(visBot, py)),
                         px - Math.max(visL, Math.min(visR, px)));
    // 缩小红圈：小光晕 + 主圈 + 头像（同比缩小，无数量文字）
    ctx.fillStyle = 'rgba(232,70,58,0.14)';
    ctx.beginPath(); ctx.arc(cx, cy, sr * 1.3, 0, 7); ctx.fill();
    ctx.strokeStyle = '#e8463a';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(cx, cy, sr, 0, 7); ctx.stroke();
    var shr = sr * 0.5;
    ctx.fillStyle = REND.C.foe;
    ctx.beginPath(); ctx.arc(cx, cy, shr, 0, 7); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(cx - shr * 0.33, cy - shr * 0.25, Math.max(1, shr * 0.16), 0, 7); ctx.fill();
    ctx.beginPath(); ctx.arc(cx + shr * 0.33, cy - shr * 0.25, Math.max(1, shr * 0.16), 0, 7); ctx.fill();
    // 短宽箭头：从小圈外缘伸出，钝三角（v1.6.52 更短更宽）
    var st = sr + 2;
    var al = Math.max(5, L.cell * 0.2);                         // 短
    var hw = al * 0.85;                                         // 宽（钝三角）
    ctx.save();
    ctx.translate(cx + Math.cos(ang) * st, cy + Math.sin(ang) * st);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(232,70,58,0.9)';
    ctx.beginPath();
    ctx.moveTo(al, 0); ctx.lineTo(0, -hw); ctx.lineTo(0, hw);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  ctx.restore();
};

// 进度条左端语义徽章（v1.8y 反馈·大王拍板「左端徽章块」）：带底色圆角小徽章 +
//   8px 白字直书功能名，替代原裸图形徽标（经验 ◆ / 提速 ⏩）——两条常驻进度条
//   并排后语义不明（大王报「看不懂两条各代表什么」），徽章写名字一眼可读。
//   徽章压在条身左端（填充从底下穿过，与原 ◆/⏩ 压条同语言），比条身内缩 0.5px
//   露出条底色一圈，呈「嵌在条上」的层次。expBar 专用（coreLvBar 的 lv 徽章自绘）。
//   返回徽章宽（调用方如需避让可用；当前填充照旧全宽口径，不需避让）。
REND.barBadge = function (ctx, x, y, h, bg, border, text) {
  var w = 7 + text.length * 8 + 7;
  ctx.save();
  REND.rr(ctx, x, y, w, h, h / 2);
  ctx.fillStyle = bg;
  ctx.fill();
  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#f4f2ff';
  ctx.font = 'bold 8px "PingFang SC",system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 0.5);
  ctx.restore();
};

// 词条经验条（v1.6.34 建为左上角小条；v1.6.41 大王令改版 = **C 全宽细条 × A 胶囊语言**；
//   v1.6.42 大王令：数字移到条的正中间、条的上层）：
//   · 全宽胶囊贴 HUD 下沿（高 9px，占地近零、不挡建造、不进 HUD DOM —— HUD 一行已满）；
//   · 左端「经验」徽章块（v1.8y 反馈·大王拍板，替代裸 ◆ 徽标）+ 紫色进度条
//     （**v1.8u 四拍板：数字退役**——cur/need 居中压条整段删，只留条身）；
//   · v1.8y 反馈补丁九·大王令：「快满闪烁」退役——经验条恒常亮（hot/pulse 全清）；
//   · 调用序在 battleBanner 之后 ⇒ 夜晚浮在横幅底条上。
REND.expBar = function (ctx, L) {
  if (typeof EXP === 'undefined') return;
  var p = EXP.progress();
  if (!p.need) return;
  var ratio = Math.min(1, p.cur / p.need);
  // v1.8y 反馈补丁九·大王令：取消「快满闪烁」——经验条恒常亮（呼吸脉冲退役）
  var W = CFG.CANVAS_W, H = 9;
  ctx.save();
  // ① 底槽：全宽胶囊，深底 + 紫描边（A 的胶囊语言拉成全宽 —— C 的占地）
  REND.rr(ctx, 0.5, 0.5, W - 1, H - 1, 4.5);
  ctx.fillStyle = 'rgba(19,22,33,0.92)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(83,74,183,0.55)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // ② 进度：内缩 2px 的亮紫胶囊（比例 = cur/need）
  if (ratio > 0.02) {
    REND.rr(ctx, 2.5, 2.5, (W - 5) * ratio, H - 5, 2.5);
    ctx.fillStyle = '#7F77DD';
    ctx.fill();
  }
  // ③ 左端「经验」徽章块（v1.8y 反馈·大王拍板，替代裸 ◆ 徽标——两条进度条并排
  //    后语义不明，徽章直书功能名一眼可读；压在条身左端，填充从底下穿过）
  REND.barBadge(ctx, 1.5, 1, 8, 'rgba(83,74,183,0.92)', 'rgba(175,169,236,0.8)', '经验');
  // ④ （v1.8u 四拍板）数字 cur/need 退役——只留胶囊 + 进度 + 徽章（v1.8y 补丁九：闪烁退役）
  ctx.restore();
};

// 镇中心 lv 刻度条（v1.8y 反馈补丁四，大王拍板「进度条改为镇中心经验进度条、
//   位置不放上面、初始 lv1 最多 lv9、沿用每级刻度方案」——顶部青条 spendBar 退役）：
//   画在镇中心格底边（骑线居中，宽 1.1 格、高 9px），**青色系**（疾速坊速度家族色）：
//   · 「lv N」角标：镇中心图标**左下角压角**（v1.8y 反馈补丁六·大王令，从条内徽章
//     移出）——镇中心等级就是速度等级（lv1 = 1× → lv9 = 1.8×，每级 +10%）；
//   · 条身 = **本级内进度**（v1.8y 反馈补丁五·大王拍板「每级经验就是 4，抽 4 次
//     进度条就满，然后升级；升级后清零，等级提升」）：填充 = ratio（0~1），4 抽
//     满条升级清零；3 道刻度线均分 4 格（每抽 1 格），跨过亮青 / 未跨暗青；
//     档内 ≥75% 呼吸脉冲（还差 1 抽），封顶满条常亮；数据源 GS.spendProgress()。
//   · 补丁六随角标移出：条不再让位徽章 → 宽度 1.4→1.1 格、加高 7→9px、内缩
//     2→1.5px（填充更饱满）；角标为静态事实不随呼吸（呼吸只作用于条身）。
REND.coreLvBar = function (ctx, L) {
  if (typeof GS.spendProgress !== 'function' || !GS.core) return;
  var p = GS.spendProgress();
  var W = L.cell * 1.1, H = 7;
  var x = CFG.ccx(L, GS.core.c) - W / 2;
  // 收进本格（v1.8y 补丁七·大王令「lv/进度条都上移、血条一并纳入、不要过多压边
  // 出框」）：条贴格底 0.5px 边距、H 回落 9→7（图标下方余量仅 0.14 格），填充内缩
  // 2→1 保饱满；条顶与图标底间隙 ~0.3px、与角标上下错开不再重叠，零出框
  var y = L.y + (GS.core.r + 1) * L.cell - H - 0.5;
  var fill = p.capped ? 1 : p.ratio;                // 本级内进度（封顶满条）
  // v1.8y 反馈补丁九·大王令：取消「快满闪烁」——进度条恒常亮（呼吸脉冲退役）
  ctx.save();
  // ① 底槽：深底 + 青描边（圆角胶囊）
  REND.rr(ctx, x, y, W, H, H / 2);
  ctx.fillStyle = 'rgba(19,22,33,0.88)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,220,180,0.45)';
  ctx.lineWidth = 1;
  ctx.stroke();
  // ② 进度填充：内缩 1px 的青色胶囊（本级 4 折算；封顶换亮青）
  if (fill > 0.02) {
    REND.rr(ctx, x + 1, y + 1, Math.max(0, (W - 2) * fill), H - 2, (H - 2) / 2);
    ctx.fillStyle = p.capped ? '#3fd0af' : '#2b9a7f';
    ctx.fill();
  }
  // ③ 内部刻度线（本级 4 格 → 3 道分隔）：第 k 抽后 k/4 处以内的亮青、以外的暗青
  var inner = W - 4;
  for (var ti = 1; ti < 4; ti++) {
    var tx = x + 2 + inner * (ti / 4);
    ctx.beginPath();
    ctx.moveTo(tx, y + 1.5); ctx.lineTo(tx, y + H - 1.5);
    ctx.strokeStyle = fill >= ti / 4 ? 'rgba(130,235,205,0.9)' : 'rgba(80,220,180,0.28)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
  // ④ 「lv N」角标：镇中心图标左下角（v1.8y 补丁七定稿+微调·大王令「LV 再上移，
  //    不要遮挡进度条」——底与图标底对齐后再上提 2px，给条顶留 ~2px 净隙；
  //    青底白字 7px 小方块，静态事实不随呼吸；图标边长同 REND.building core）
  var s2 = L.cell * 0.72;
  var bx0 = CFG.ccx(L, GS.core.c) - s2 / 2, by0 = CFG.ccy(L, GS.core.r) + s2 / 2;
  var bw = 17, bh = 11, blift = 2;                  // blift：额外上提量
  ctx.save();
  REND.rr(ctx, bx0 - bw / 2, by0 - bh - blift, bw, bh, 2.5);
  ctx.fillStyle = 'rgba(31,122,104,0.95)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(130,235,205,0.95)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = '#eafff8';
  ctx.font = 'bold 7px "PingFang SC",system-ui,sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('lv' + p.lv, bx0, by0 - bh / 2 - blift + 0.5);
  ctx.restore();
};

// 镇中心 tips 气泡（v1.8y 反馈补丁八·大王令「点击镇中心出现 tips，告知等级和速度」）：
//   UI.coreTip 开关由 ui.js onDown 控制（点镇中心切换、点其他任意处关闭，昼夜可用）；
//   气泡悬在镇中心格上方（血条之上），青描边深底，三行文案：
//   ①「镇中心 lv N」 ②「列车速度 ×M」 ③升级进度（再抽 X 次升级 / 已达满级）。
//   UI 未加载（沙箱测试）或开关关闭时直接跳过。
REND.coreTip = function (ctx, L) {
  if (typeof UI === 'undefined' || !UI.coreTip) return;
  if (!GS.core || typeof GS.spendProgress !== 'function') return;
  var p = GS.spendProgress();
  var cx = CFG.ccx(L, GS.core.c);
  var cyTop = L.y + GS.core.r * L.cell;             // 镇中心格顶
  var mul = (1 + p.tier * CFG.SPEND_SPEED_STEP).toFixed(1);
  // 车头伤害行（v1.8y 反馈补丁十·大王拍板「tips 告知等级和速度」扩展 +「伤害值
  //   应变化」可视化）——ENG 未加载（沙箱）时省略该行
  var headDmg = (typeof ENG !== 'undefined' && ENG.TRAIN_COMBAT && ENG.TRAIN_COMBAT.dmg)
    ? ENG.TRAIN_COMBAT.dmg(p.tier) : null;
  var lines = [
    '镇中心 lv' + p.lv,
    '列车速度 ×' + mul
  ];
  if (headDmg !== null) lines.push('车头伤害 ' + headDmg);
  lines.push(p.capped ? '已达满级' : '再抽 ' + (4 - Math.floor(p.ratio * 4 + 1e-6)) + ' 次升级');
  var bw = 118, bh = headDmg !== null ? 60 : 46;
  var bx = cx - bw / 2, by = cyTop - bh - 8;
  ctx.save();
  // 底板 + 青描边（速度家族色）+ 底部小三角指向镇中心
  REND.rr(ctx, bx, by, bw, bh, 5);
  ctx.fillStyle = 'rgba(19,22,33,0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,220,180,0.5)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - 5, by + bh); ctx.lineTo(cx + 5, by + bh); ctx.lineTo(cx, by + bh + 6);
  ctx.closePath();
  ctx.fillStyle = 'rgba(19,22,33,0.94)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(80,220,180,0.5)';
  ctx.stroke();
  // 四行文字：标题亮青、正文白（左对齐，行高 14）
  ctx.font = '9px "PingFang SC",system-ui,sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (var li = 0; li < lines.length; li++) {
    ctx.fillStyle = li === 0 ? 'rgba(130,235,205,0.95)' : '#e8f6f1';
    ctx.fillText(lines[li], bx + 10, by + 12 + li * 14);
  }
  ctx.restore();
};
