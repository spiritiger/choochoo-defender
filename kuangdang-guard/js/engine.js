// 主引擎：清理/建造、列车跑圈发钱
window.ENG = {};

ENG.init = function () { ENG.restart(); };

// 重开一局（v1.3-rc：失败遮罩的「重来」按钮也走这里）。
//   GS.newGame 负责地形/列车/核心血量；塔与怪的列表各自 reset（模块自治）。
ENG.restart = function () {
  GS.newGame();
  if (typeof TOWERS !== 'undefined') TOWERS.reset();
  if (typeof FOES !== 'undefined') FOES.reset();
  // 车头战斗状态（v1.3.1）：攻速冷却 / dusk 加速累计，重开一律归零
  ENG.trainAtkCd = 0;
  ENG.boost = 0;
  // 行为记录（v1.3.5）：开局/重开标记（含金币快照），流水靠它切分局
  if (typeof LOG !== 'undefined') LOG.add('newGame', { gold: GS.gold });
};

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

// ---- 建造经济建筑（需已清空空白格 + 紧贴铁轨；金币地块是资源格，不可占用）----
// ⚠️【v1.3-rc 退役】经济建筑随三选一一起退役（拍板分叉 ①），本函数冻结保留不调用
//   （test_rules 既有用例仍依赖；TRANS.serviceCell 的 econ 收款分支同理保留——
//   旧存档/回退盘面可能还有 econ 建筑）。转正后可整体清理。
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
  // dusk 加速回站（v1.3.1，规格 §13.4 第 3 条）：收尾相位且场上无怪 → boost 每秒
  //   +0.9 封顶 2（实际速度系数 1+boost，最高 3×）；否则归零。消灭"怪杀完了干等车"。
  if (typeof CLOCK !== 'undefined' && CLOCK.isDusk() &&
      (!GS.foes || GS.foes.length === 0)) {
    ENG.boost = Math.min(2, ENG.boost + dt * 0.9);
  } else {
    ENG.boost = 0;
  }
  // 塔防迭代（v1.3-rc）：塔攻击 / 怪移动每帧推进。⚠️ 顺序：先塔后怪 ——
  //   塔这帧打死的怪由 foes.update 当帧清尸，不留"死人再打一下"的窗口。
  if (typeof TOWERS !== 'undefined') TOWERS.update(dt);
  if (typeof FOES !== 'undefined') FOES.update(dt);
  // 车头战斗（v1.3.1）：在 FOES.update 之后调 —— 本帧打掉的 hp 由下一帧清尸
  //   （与塔的"当帧清尸"差一帧，无碍：尸体 hp≤0 不会再攻击/移动）。
  ENG.trainCombat(dt);
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

// ============================================================================
// 车头战斗（v1.3.1，规格 §13.4 第 2 条）—— 大王拍板：撞击式 + 塔式双攻击，
//   伤害随波次自动涨（与塔的拖拽合成升星走两套成长轨，车头零投入纯被动）。
//   · 塔式：每 TRAIN_COMBAT.RATE 秒打射程内离镇中心最近的怪（昼夜不限、停跑不限）；
//   · 撞击式：行进位置 BUMP_RANGE 内的怪，每怪独立 BUMP_GAP 冷却（f.bumpCd）；
//   · 只扣血不删怪：尸体统一由 FOES.update 清（与塔同约定）。
//   车头浮点格坐标由 railCell(index)/(index+1) + frac 插值得出 —— 不依赖 LAY，
//   test 沙箱（无 main.js）可直调。
// ============================================================================
ENG.TRAIN_COMBAT = {
  dmg: function (wave) { return 8 + 4 * wave; },   // wave1=12，与 1 星火塔同档
  RATE: 1.0,           // 塔式攻击间隔秒
  RANGE: 2.5,          // 塔式射程（格，欧氏距离，同塔口径）
  BUMP_RANGE: 1.2,     // 撞击判定半径（格，车头中心到怪中心）
  BUMP_GAP: 0.8        // 同一只怪的撞击冷却秒
};

ENG.trainCombat = function (dt) {
  if (GS.gameOver || !GS.railPath.length) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;            // 没怪没战斗；bumpCd 也无需衰减
  if (typeof FOES === 'undefined') return;
  var dmg = ENG.TRAIN_COMBAT.dmg(FOES.wave);
  var core = GS.core;

  // 车头浮点格坐标（advanceTrain 的插值同源）
  var a = GS.railCell(GS.train.index), b = GS.railCell(GS.train.index + 1);
  var f = GS.train.frac;
  var fc = a.c + (b.c - a.c) * f, fr = a.r + (b.r - a.r) * f;

  // ---- 撞击式：贴身怪逐个判定（每怪独立冷却）----
  for (var i = 0; i < foes.length; i++) {
    var fo = foes[i];
    if (fo.bumpCd > 0) { fo.bumpCd -= dt; continue; }
    var bdx = fo.c - fc, bdy = fo.r - fr;
    if (bdx * bdx + bdy * bdy > ENG.TRAIN_COMBAT.BUMP_RANGE * ENG.TRAIN_COMBAT.BUMP_RANGE) continue;
    fo.hp -= dmg;
    fo.bumpCd = ENG.TRAIN_COMBAT.BUMP_GAP;
    fo.hitFlash = 0.3;
  }

  // ---- 塔式：射程内挑离镇中心最近的怪，攻速冷却命中 ----
  ENG.trainAtkCd -= dt;
  if (ENG.trainAtkCd > 0) return;
  var best = null, bestD = Infinity;
  for (var j = 0; j < foes.length; j++) {
    var fe = foes[j];
    var dx = fe.c - fc, dy = fe.r - fr;
    if (dx * dx + dy * dy > ENG.TRAIN_COMBAT.RANGE * ENG.TRAIN_COMBAT.RANGE) continue;
    var dc = fe.c - core.c, dr = fe.r - core.r;
    var dCore = dc * dc + dr * dr;
    if (dCore < bestD) { bestD = dCore; best = fe; }
  }
  if (!best) return;
  best.hp -= dmg;
  best.hitFlash = 0.25;
  ENG.trainAtkCd = ENG.TRAIN_COMBAT.RATE;
  // 攻击连线：浅紫（车斗同色系），rgb 模板给 renderer 拼淡出 alpha
  if (typeof TOWERS !== 'undefined') {
    TOWERS.beams.push({ ac: fc, ar: fr, bc: best.c, br: best.r, t: 0.12, rgb: '143,134,255' });
  }
};

// 调度器：建造阶段停车，防守/收尾行驶
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
  // v1.3.1 dusk 加速回站：boost 由 ENG.update 维护（dusk 无怪每秒 +0.9 封顶 2）
  tr.frac += CFG.TRAIN_SPEED * (1 + (ENG.boost || 0)) * dt;
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

// 开波（UI「开波」按钮）＝ 建造 → 防守（v1.3-rc 拍板：一波 = 一夜；v1.3.4 昼夜概念退役，
//   只剩建造/防守两阶段，函数名沿用历史口径）：
//   先对齐站台、让阶段模块进入防守，再让怪物模块按波次刷怪。
//   怪清空 → CLOCK.onCleared → dusk 收尾 → 到站回建造 —— 骨架与 v0.9.2 完全一致。
ENG.startNight = function () {
  if (typeof CLOCK === 'undefined' || !CLOCK.isDay()) return false;
  if (typeof STATION !== 'undefined' && !STATION.ready()) return false;   // 还没成环 → 发不了车
  ENG.parkAtStation();
  CLOCK.startNight();
  if (typeof FOES !== 'undefined') FOES.startWave();
  // 行为记录（v1.3.5 经济类）：开波（带波次号与金币快照，时间差 = 波时长）
  if (typeof LOG !== 'undefined') LOG.add('waveStart',
    { wave: (typeof FOES !== 'undefined') ? FOES.wave : 0, gold: GS.gold });
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
