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
  if (typeof CLOCK !== 'undefined') CLOCK.tick(dt);
  ENG.trainFlow(dt);
};

// ============================================================================
// 列车（v0.9.2 拆分：调度 / 推进 / 停靠 / 交付 四个独立环节，便于分别修改）
//
// 规则 4：白天车头停在站台 → parkAtStation()
// 规则 5：夜晚才移动 → trainFlow() 按 CLOCK 相位决定"跑"还是"停"
// 规则 6：到站交付 → advanceTrain() 的到站判定 + deliverAtStation()
//
// 四个环节的边界刻意画成"互不知道对方细节"：
//   · trainFlow        只问 CLOCK 现在是不是该跑；
//   · advanceTrain     **纯推进**，不判断昼夜（测试可直接调用它跑圈）；
//   · parkAtStation    每帧幂等：铁轨/站台一变就自动对上，不需要任何挂钩子；
//   · deliverAtStation 只管交付，不关心怎么走到站台的。
// ⚠️ CLOCK / STATION 用 typeof 守卫：test_rail.js 的沙箱不加载这两个文件。
// ============================================================================

// 调度器：白天停车，夜晚/收尾行驶
ENG.trainFlow = function (dt) {
  if (typeof CLOCK !== 'undefined' && !CLOCK.isRunning()) { ENG.parkAtStation(); return; }
  ENG.advanceTrain(dt);
};

// 白天停靠：把车头对齐到站台格（index = 站台在 railPath 上的下标）。
//   每帧都调 → 站台随铁轨漂移后列车自动跟上。
ENG.parkAtStation = function () {
  if (typeof STATION === 'undefined') return;
  var st = STATION.slot();
  if (!st) return;
  GS.train.index = st.index;
  GS.train.frac = 0;
};

// 纯推进 + 到站判定。不判断昼夜：白天由 trainFlow 拦在外面。
ENG.advanceTrain = function (dt) {
  var tr = GS.train;
  var n = GS.railPath.length;
  if (!n) return;
  // 站台下标（-1 = 没解出站台 → 永不判到站）。判"回到站台下标"而不是"踩到站台格"：
  //   站台若是十字格（railPath 里出现两次），按格子判会一圈交付两次。
  var si = (typeof STATION !== 'undefined') ? STATION.index() : -1;
  tr.frac += CFG.TRAIN_SPEED * dt;
  while (tr.frac >= 1) {
    tr.frac -= 1;
    tr.index = (tr.index + 1) % n;
    // 顺序要紧：**先装载本站**（站台格自身若有金币也算进本次交付），再判到站
    TRANS.serviceCell(GS.railCell(tr.index));
    if (tr.index !== si) continue;
    ENG.deliverAtStation();                    // 规则 6：走满一圈回到站台 → 交付
    if (ENG.stopAtStation()) { tr.frac = 0; break; }   // 收尾相位 → 这一夜结束，停车
  }
};

// 到站交付（规则 6）：车斗金币一次性入账 → 金币地块重置
ENG.deliverAtStation = function () {
  var got = TRANS.deliver();
  TRANS.resetGoldLap();
  return got;
};

// 到了站台，这一夜要不要就此结束（回白天、停站台）？
//   只有收尾相位（dusk）才算 —— 夜晚倒计时/等清场期间到站只是完成一圈、继续跑。
//   没有昼夜模块时返回 false（等于旧行为：一直跑圈）。
ENG.stopAtStation = function () {
  if (typeof CLOCK === 'undefined') return false;
  return CLOCK.notifyStation();
};

// 天亮发车（UI「发车」按钮）：先对齐站台，再让昼夜模块入夜
ENG.startNight = function () {
  if (typeof CLOCK === 'undefined' || !CLOCK.isDay()) return false;
  if (typeof STATION !== 'undefined' && !STATION.ready()) return false;   // 还没成环 → 发不了车
  ENG.parkAtStation();
  CLOCK.startNight();
  return true;
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
