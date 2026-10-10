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
    if (!CFG.inBounds(c, r)) continue;                 // 越界格不参与（v1.4.12 起）
    if (GS.grid[r][c].b) continue;                     // ⚠️ v1.6.6：建筑格跳过 —— 压塔
    self[c + ',' + r] = 1;                             //   的边不许借塔轮廓相接（塔不是
    list.push({ c: c, r: r });                         //   本次清理产物，也不该当桥板）
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

// v1.4.12（大王拍板"以指针为中心"）：形状**包围盒几何中心**对准指针格。
//   旧口径锚点=指针格=形状左上角 → 形状永远朝指针右下铺开，指针坐在形状角上，
//   越界只偏右/下一侧，边缘要"偏着瞄准"。居中后四个边缘体验对称，配合 applyShape
//   的"越界忽略"裁剪，指针指哪形状就罩哪。
//   偶数边长无法完美居中，floor((min+max)/2) 把指针放在中间偏左上一格（惯例取法）。
//   对 min/max 包围盒取中（而非 w/2）→ 天然兼容将来可能出现负偏移的异形卡。
ENG.shapeAnchor = function (cell, cells) {
  var minC = 0, maxC = 0, minR = 0, maxR = 0;
  for (var i = 0; i < cells.length; i++) {
    if (cells[i][0] < minC) minC = cells[i][0];
    if (cells[i][0] > maxC) maxC = cells[i][0];
    if (cells[i][1] < minR) minR = cells[i][1];
    if (cells[i][1] > maxR) maxR = cells[i][1];
  }
  return { c: cell.c - Math.floor((minC + maxC) / 2), r: cell.r - Math.floor((minR + maxR) / 2) };
};

ENG.applyShape = function (oc, or_, cells) {
  // v1.4.12（大王拍板"允许形状超出地图"）：越界部分**直接忽略**（裁剪到地图内），
  //   指针指哪清哪，底边/右边缘不再有"往左上偏着瞄准"的摩擦。
  //   · 形状偏移全为非负（CFG.randomShape 保证），锚点必在图内 ⇒ 至少锚点格参与结算；
  //   · 越界格没有地形可清，也不产生相接 —— shapeContacts/shapeHitsInner 对越界格
  //     天然免疫（isRegion 有 inBounds 守卫），无需特判；
  //   · 全越界不存在，但"图内部分没有废墟"仍会被下面 rubbleCount===0 拦住。
  var rubbleCount = 0;
  var pts = [];
  for (var i = 0; i < cells.length; i++) {
    var c = oc + cells[i][0], r = or_ + cells[i][1];
    if (!CFG.inBounds(c, r)) continue;                    // 越界：忽略，不报错
    var cell = GS.grid[r][c];
    if (cell.b) continue;   // v1.6.6（大王令）：压到建筑格直接跳过 —— 塔不能也不该被清，
                            // 其余废墟照常清（与"越界忽略"同一哲学：罩到清不了的
                            // 东西就跳过它）。旧版整体拒绝，实测 2×4 擦到塔边
                            // 两次 cleanFail（sid=ouxk6f at 1,4/2,4）。
    pts.push({ c: c, r: r, was: cell.t });               // v1.4.5：记清理前 t 值，供撤销还原
    if (cell.t === 'rubble') rubbleCount++;
  }
  if (rubbleCount === 0) return '形状内没有废墟';
  var ct = ENG.shapeContacts(oc, or_, cells);
  if (ct.count < ENG.MIN_CONTACT && !ct.inner) {
    return '需与区域相邻 ' + ENG.MIN_CONTACT + ' 格（或压住内区）';
  }
  for (var j = 0; j < pts.length; j++) GS.grid[pts[j].r][pts[j].c].t = 'blank';
  // v1.6 求解后台化：Worker 可用时异步求解（主线程不冻结），否则同步（file:// 降级）
  GS.recomputeRailsAsync();
  // v1.4.5 撤销（大王需求"路径规划失败时把拖上场的地块回撤"）：
  //   成功清理时记下**逐格清理前的 t 值**快照（含形状里本来就是 blank 的格，保证还原精确）。
  //   UI 层把它连同被消耗的卡打包进 GS.undoClean（新局清零）；ENG.undoShape 消费。
  ENG.lastShapeApply = pts.map(function (p) {
    return { c: p.c, r: p.r, was: p.was };
  });
  return true;
};

// v1.4.5 撤销最近一次形状卡清理：废墟逐格还原 → 铁轨重算 → 卡原位退回牌库。
//   · 单层撤销：只认 GS.undoClean（最近一次成功清理），再清一次就被覆盖。
//   · 任一清理格上已建塔/建筑 → 拒绝（否则会把建筑压在废墟底下，盘面损坏）。
//   · 铁轨/站台不用手动拆：还原后 recomputeRails() 会整体重算（白天列车停靠，安全）。
ENG.undoShape = function () {
  var u = GS.undoClean;
  if (!u || !u.pts || !u.pts.length) return '没有可撤销的清理';
  for (var i = 0; i < u.pts.length; i++) {
    var cell = GS.grid[u.pts[i].r] && GS.grid[u.pts[i].r][u.pts[i].c];
    if (!cell) return '撤销范围超出地图（盘面已被改动）';
    if (cell.b) return '清理格上已建造，不能撤销';
  }
  for (var j = 0; j < u.pts.length; j++) {
    GS.grid[u.pts[j].r][u.pts[j].c].t = u.pts[j].was;
  }
  GS.recomputeRailsAsync();              // v1.6：同 applyShape，走后台化降级链
  var at = Math.min(u.cardIdx || 0, GS.deck.length);   // 原位退回（库已变化就钳到尾部）
  GS.deck.splice(at, 0, u.card);
  GS.undoClean = null;
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
  // 车厢独立战斗（v1.4.1）：与车头同帧序（FOES 后），尸体下一帧清，无碍
  ENG.wagonCombat(dt);
  // v1.6 求解后台化：夜晚挂起的求解结果，回到建造阶段（白天）立即落位。
  //   落位后下一帧 parkAtStation 把车头对齐新站台 —— 夜晚绝不换环（防 train.index 越界）。
  if (window.SOLVER_ASYNC) SOLVER_ASYNC.tryFlush();
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
  RANGE: 4.5,          // 塔式射程（格，欧氏距离）⚠️ v1.4.3d 大王令：2.5×1.5=3.75；v1.6.8 大王令 2026-10-09：3.75→4.5（车厢同步）
  BUMP_RANGE: 1.2,     // 撞击判定半径（格，车头中心到怪中心）
  BUMP_GAP: 0.8        // 同一只怪的撞击冷却秒
};

ENG.trainCombat = function (dt) {
  if (GS.gameOver || !GS.railPath.length) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;            // 没怪没战斗；bumpCd 也无需衰减
  if (typeof FOES === 'undefined') return;
  // ⚠️ v1.4.1 纠偏（规格 §14.2）：车厢是独立作战单位，**不再**给车头加成 ——
  //   旧"+2 伤/节 + 全局元素特效"作废，车头伤害回归纯 8+4×wave。
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

// ============================================================================
// 车厢战斗（v1.4.1，规格 §14.2）—— 大王拍板：车厢是**独立作战单位**。
//   · 车厢 = GS.towers 的镜像投影：每座英雄塔派生一节同元素同星车厢
//     （塔合成升星 → 车厢跟着变强；塔移除 → 车厢消失，无需独立维护列表）；
//   · 第 i 节位置 = 车头弧长位置后退 (i+1)×GAP 格，railPath 环形取模；
//   · 每节独立炮位：自己射程内挑离镇中心最近的怪，伤害 (8+4×wave)×star（v1.4.6：1星=车头）；
//   · 特效挂每节自己的攻击：火=burn / 冰=slow / 毒=poison / 雷=该节冷却 0.9s；
//   · 冷却存塔对象 t.wcd（塔删了冷却自然消失，零同步成本）。
// ============================================================================
ENG.WAGON = {
  GAP: 1,                                  // 相邻车厢弧长间隔（格）⚠️ v1.4.3 大王拍板"贴身短编组"：2→1，战斗位置同步变化
  RATE: 1.2,                               // 攻击间隔秒（雷 0.9）
  THUNDER_RATE: 0.9,
  RANGE: 4.5,                              // 射程（格）⚠️ v1.4.3d 大王令：与车头同步 2.5×1.5=3.75；v1.6.8 大王令 2026-10-09：3.75→4.5（与车头同步）
  dmg: function (star, wave) { return (8 + 4 * (wave || 0)) * star; }
  // ⚠️ v1.4.6（大王令 2026-10-08）：1 星车厢伤害与车头一致 = 8+4×wave（旧 6×star），
  //   星级保持乘法线性（2星=2倍车头、3星=3倍…）。wave 由 wagonCombat 传入 FOES.wave。
};

// 第 i 节（0 起）的浮点格坐标。headPos = 车头弧长位置（index+frac，单位格），
//   后退 (i+1)×GAP 后对 railPath 长度取模（环形：退过头绕到车头前方）。
ENG.wagonPos = function (i) {
  var n = GS.railPath.length;
  if (!n) return null;
  var head = GS.train.index + GS.train.frac;
  var p = ((head - (i + 1) * ENG.WAGON.GAP) % n + n) % n;
  var k = Math.floor(p), fr = p - k;
  var a = GS.railCell(k), b = GS.railCell(k + 1);
  return { c: a.c + (b.c - a.c) * fr, r: a.r + (b.r - a.r) * fr };
};

ENG.wagonCombat = function (dt) {
  if (GS.gameOver || !GS.railPath.length) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;
  var core = GS.core;

  for (var i = 0; i < GS.towers.length; i++) {
    var t = GS.towers[i];
    if (t.wcd > 0) { t.wcd -= dt; continue; }
    var pos = ENG.wagonPos(i);
    var best = null, bestD = Infinity;
    for (var j = 0; j < foes.length; j++) {
      var fe = foes[j];
      var dx = fe.c - pos.c, dy = fe.r - pos.r;
      if (dx * dx + dy * dy > ENG.WAGON.RANGE * ENG.WAGON.RANGE) continue;
      var dc = fe.c - core.c, dr = fe.r - core.r;
      var dCore = dc * dc + dr * dr;
      if (dCore < bestD) { bestD = dCore; best = fe; }
    }
    if (!best) continue;
    best.hp -= ENG.WAGON.dmg(t.star, FOES.wave);
    best.hitFlash = 0.25;
    // 特效挂**本节自己的元素**（v1.4.1：不再是"有火节就全局灼烧"）
    if (t.elem === 'ice') best.slow = 1.5;
    else if (t.elem === 'fire') best.burn = 2;
    else if (t.elem === 'poison') best.poison = 4;
    t.wcd = (t.elem === 'thunder') ? ENG.WAGON.THUNDER_RATE : ENG.WAGON.RATE;
    if (typeof TOWERS !== 'undefined') {
      TOWERS.beams.push({ ac: pos.c, ar: pos.r, bc: best.c, br: best.r,
                          t: 0.12, rgb: ENG.wagonRgb(t.elem) });
    }
  }
};
// 车厢连线元素色（renderer 拼淡出 alpha 用）
ENG.wagonRgb = function (elem) {
  return { fire: '255,120,80', ice: '110,200,255',
           poison: '150,230,120', thunder: '255,220,90' }[elem] || '200,200,200';
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
