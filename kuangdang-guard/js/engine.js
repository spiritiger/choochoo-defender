// 主引擎：清理/建造、列车跑圈发钱
window.ENG = {};

ENG.init = function () { GS.newGame(); };

// ---- 清理工具：用形状覆盖格清空废墟 ----
// 形状必须与"当前区域"**至少 MIN_CONTACT 格相接**，或者**压住内区**（v0.6.10 收窄）。
// ⚠️ 门槛沿革：v0.6.9 定 2 格 → **v0.7.0 降为 1 格**（大王 2026-09-24 拍板：只放宽相接数，
//    豁免与金币格判定全部不动）。下面的"收窄"口径都是为 2 格门槛设计的防漏洞，保留不动。
// 相接 = 形状**外侧紧邻的区域格**数（v0.6.10 修订，4 向去重）。要点：
//   · **只数形状外圈的邻格**：形状自身压住的已有空地**不算**相接 —— 旧版把它算进去，
//     于是"大半压在空地上、只探出 1 格"的形状也能过，玩家看到的就是"1 格相邻也放行"
//     （大王的盘面复现：3×2 形状压住 row9 三格、只往 row10 探出一行）。
//   · 金币地块**分情况**（v0.6.13）：在铁轨上 / 铁轨圈内的金币格 → **算区域**；
//     荒野里孤立的金币格 → 不算（防清飞地，见 v0.6.9b 定案）。
//     起因：铁轨已经铺到金币格、甚至把它圈进环里了，它理所当然属于"已开发区"，
//     却被旧口径一律排除，导致贴着它的位置只能凑到 1 格相接、清不动
//     （大王盘面复现：最右两列 2×2 / 2×3 贴着 (8,8) 那枚在轨金币往外长，被拒）。
//   · 压着建筑的空地也不算。
//   · 豁免（inner）：形状**盖到 ≥1 格 3×5 内区**时，允许不足 2 格相接 —— 否则贴着
//     内区角往外长会被卡死。注意是"压住内区"，不是"挨着内区"（v0.6.10 收窄）。
// 返回 { count: 相接格数, cells: 相接格坐标[], inner: 是否压住内区 }。
ENG.shapeContacts = function (oc, or_, cells) {
  var self = {};
  var list = [];
  for (var i = 0; i < cells.length; i++) {
    var c = oc + cells[i][0], r = or_ + cells[i][1];
    self[c + ',' + r] = 1;
    list.push({ c: c, r: r });
  }
  var hit = {}, out = [];
  // 只有"真正属于当前区域"的格子才算：非金币空白格、或"已并入区域"的金币格
  var isRegion = function (c, r) {
    if (!CFG.inBounds(c, r)) return false;
    var g = GS.grid[r][c];
    if (g.b) return false;
    if (!g.gold) return g.t === 'blank';
    return GS.goldInRegion(c, r);
  };
  var add = function (c, r) {
    var k = c + ',' + r;
    if (hit[k]) return;
    hit[k] = 1;
    out.push({ c: c, r: r });
  };
  var DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (var j = 0; j < list.length; j++) {
    var p = list[j];
    for (var d = 0; d < 4; d++) {
      var nc = p.c + DIRS[d][0], nr = p.r + DIRS[d][1];
      if (self[nc + ',' + nr]) continue;               // 形状自己的格子不算
      if (isRegion(nc, nr)) add(nc, nr);               // 形状外圈的邻格才算相接
    }
  }
  return { count: out.length, cells: out, inner: ENG.shapeHitsInner(list) };
};

// 内区（开局 3×5 城镇地块）矩形范围
ENG.innerRect = function () {
  var cC = Math.floor(CFG.MAP_COLS / 2), cR = Math.floor(CFG.MAP_ROWS / 2);
  return { c0: cC - 1, c1: cC + 1, r0: cR - 2, r1: cR + 2 };
};
// 形状是否"贴住内区"（豁免 2 格相接用）。
// v0.6.10 收窄：必须**真的压住内区**（形状盖到 ≥1 格 3×5 内区格）才算，
//   旧版只要"挨着内区边界"就算 —— 那等于给内区旁边一大片区域都开了后门，
//   大王盘面上「只探出 1 格」的清理正是从这儿漏过去的（形状压住 row9 三格、
//   其中 (3,9) 挨着内区角格 (4,9)，于是被当成"贴内区"放行）。
ENG.shapeHitsInner = function (list) {
  var R = ENG.innerRect();
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    if (p.c >= R.c0 && p.c <= R.c1 && p.r >= R.r0 && p.r <= R.r1) return true;
  }
  return false;
};

ENG.MIN_CONTACT = 1;   // 清理形状与当前区域的最少相接格数（v0.7.0 由 2 降为 1，大王拍板；压内区可豁免）

ENG.applyShape = function (oc, or_, cells) {
  var rubbleCount = 0;
  var pts = [];
  for (var i = 0; i < cells.length; i++) {
    var c = oc + cells[i][0], r = or_ + cells[i][1];
    if (!CFG.inBounds(c, r)) return '形状超出地图';
    var cell = GS.grid[r][c];
    if (cell.b) return '范围内已有建筑';
    pts.push({ c: c, r: r });
    if (cell.t === 'rubble') rubbleCount++;
  }
  if (rubbleCount === 0) return '形状内没有废墟';
  var ct = ENG.shapeContacts(oc, or_, cells);
  if (ct.count < ENG.MIN_CONTACT && !ct.inner) {
    return '需与区域相邻 ' + ENG.MIN_CONTACT + ' 格（或压住内区）';
  }
  for (var j = 0; j < pts.length; j++) GS.grid[pts[j].r][pts[j].c].t = 'blank';
  GS.recomputeRails();
  return true;
};

// ---- 建造经济建筑（需已清空空白格 + 紧贴铁轨；金币地块是资源格，不可占用） ----
ENG.placeEcon = function (c, r) {
  var cell = GS.grid[r][c];
  if (cell.t !== 'blank') return '这里是废墟，先清理';
  if (cell.gold) return '金币地块，不可建造';
  if (GS.onRail(c, r)) return '铁轨地块，不可建造';
  if (cell.b) return '已有建筑';
  if (!GS.railNeighbor(c, r)) return '需紧贴铁轨';
  var b = { type: 'econ', c: c, r: r, rate: CFG.ECON_RATE, flash: 0 };
  cell.b = b;
  GS.buildings.push(b);
  GS.recomputeRails();
  return true;
};

ENG.update = function (dt) {
  // 经济建筑收款闪光衰减
  for (var kf = 0; kf < GS.buildings.length; kf++) {
    var bf = GS.buildings[kf];
    if (bf.flash > 0) bf.flash -= dt;
  }
  // 金币地块收款闪光衰减
  for (var kg = 0; kg < GS.goldTiles.length; kg++) {
    var gt = GS.goldTiles[kg], gf = GS.grid[gt.r][gt.c];
    if (gf.flash > 0) gf.flash -= dt;
  }
  ENG.tickTrain(dt);
};

// ---- 列车：沿铁轨环行驶；经过贴轨经济建筑发钱，驶入金币地块收钱 ----
ENG.tickTrain = function (dt) {
  var tr = GS.train;
  var n = GS.railPath.length;
  if (!n) return;
  tr.frac += CFG.TRAIN_SPEED * dt;
  while (tr.frac >= 1) {
    tr.frac -= 1;
    var prev = tr.index;
    tr.index = (tr.index + 1) % n;
    // index 回绕（从 n-1 跳回 0）= 跑完一圈 → 金币地块全部重置
    if (tr.index < prev) TRANS.resetGoldLap();
    TRANS.serviceCell(GS.railCell(tr.index));
  }
};

ENG.trainAngle = function () {
  var a = GS.railCell(GS.train.index);
  var b = GS.railCell(GS.train.index + 1);
  return Math.atan2(CFG.ccy(LAY, b.r) - CFG.ccy(LAY, a.r), CFG.ccx(LAY, b.c) - CFG.ccx(LAY, a.c));
};
ENG.trainPos = function () {
  var a = GS.railCell(GS.train.index);
  var b = GS.railCell(GS.train.index + 1);
  var f = GS.train.frac;
  return {
    x: CFG.ccx(LAY, a.c) + (CFG.ccx(LAY, b.c) - CFG.ccx(LAY, a.c)) * f,
    y: CFG.ccy(LAY, a.r) + (CFG.ccy(LAY, b.r) - CFG.ccy(LAY, a.r)) * f
  };
};
