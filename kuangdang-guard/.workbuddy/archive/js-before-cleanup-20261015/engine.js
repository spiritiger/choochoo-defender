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
  // 只有"真正属于当前区域"的格子才算：非资源空白格、或"已并入区域"的金币/爱心格
  var isRegion = function (c, r) {
    if (!CFG.inBounds(c, r)) return false;
    var g = GS.grid[r][c];
    if (g.b) return false;
    if (!g.gold && !g.heart) return g.t === 'blank';
    return GS.goldInRegion(c, r);   // 金币/爱心同口径：在轨或圈内才算，防清飞地
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
  if (cell.heart) return '爱心地块，不可建造';
  if (GS.onRail(c, r)) return '铁轨地块，不可建造';
  if (cell.b) return '已有建筑';
  if (!GS.railNeighbor(c, r)) return '需紧贴铁轨';
  var b = { type: 'econ', c: c, r: r, rate: CFG.ECON_RATE, flash: 0 };
  cell.b = b;
  GS.buildings.push(b);
  GS.recomputeRails();
  return true;
};

// ---- v1.6.23 建筑卡落位（铸币所 / 加油站）--------------------------------------
//   · 落点：**任意空地**（判据 = GS.isFreeSpot，与抽塔同一口径：已清空 + 无建筑 +
//     非金币/爱心 + 非铁轨）—— 不要求贴轨（大王令"可以摆放在任意空地位置"）。
//   · 建筑 = 建筑格模型第 4/5 种 type：`cell.b = {type:'mint'|'gas'}`，天然进
//     "不可铺轨 / 不可再建"判定；
//   · **不触发 recomputeRails**：落点必不在轨上（isFreeSpot 排了铁轨格），环形状不受影响
//     —— 与塔放置同一口径（TOWERS.placeAt 也不重算）。
//   · 效果是**查询式**、不是落位时写死：铸币所见 GS.goldValue()、加油站见 GS.gasCoverAt()，
//     所以多座叠加/拆除都自动成立。
ENG.placeBuilding = function (c, r, bkey) {
  if (!CFG.inBounds(c, r)) return '越界';
  if (!GS.isFreeSpot(c, r)) return '只能建在空地（非轨/非金币/非爱心/无建筑）';
  var b = { type: bkey, c: c, r: r, flash: 0 };
  GS.grid[r][c].b = b;
  GS.buildings.push(b);
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
  // 爱心地块收款闪光衰减（v1.6.22）
  for (var kh = 0; kh < GS.heartTiles.length; kh++) {
    var ht = GS.heartTiles[kh], hfc = GS.grid[ht.r][ht.c];
    if (hfc.flash > 0) hfc.flash -= dt;
  }
  // 交付飘字衰减（v1.6.32）：t 推进到 ttl 即出队（渲染那一帧算 alpha/位移）
  if (GS.floats && GS.floats.length) {
    for (var kfl = GS.floats.length - 1; kfl >= 0; kfl--) {
      GS.floats[kfl].t += dt;
      if (GS.floats[kfl].t >= GS.floats[kfl].ttl) GS.floats.splice(kfl, 1);
    }
  }
  // 粒子衰减（v1.6.43）：死亡碎屑/爆炸火光随模拟走 —— 暂停（GS.paused）时一起冻住
  if (typeof ENG.updateFx === 'function') ENG.updateFx(dt);
  if (typeof CLOCK !== 'undefined') CLOCK.tick(dt);
  // dusk 加速回站（v1.3.1，规格 §13.4 第 3 条）+ 奖励时间加速（2026-10-11 大王令）：
  //   dusk 收尾且场上无怪 → boost 每秒 +0.9 封顶 2（速度系数 1+boost，最高 3×）；
  //   奖励时间 → 同款加速、**上限提升 50%**（封顶 3，最高 4×）——"清得越快跑得越久"
  //   的奖励窗口再添速度收益（跑圈收金币更快）；其余相位归零。
  var boostCap = 0;
  if (typeof CLOCK !== 'undefined') {
    if (CLOCK.reward) boostCap = 3;
    else if (CLOCK.isDusk() && (!GS.foes || GS.foes.length === 0)) boostCap = 2;
  }
  if (boostCap > 0) ENG.boost = Math.min(boostCap, ENG.boost + dt * 0.9);
  else ENG.boost = 0;
  // 塔防迭代（v1.3-rc）：塔攻击 / 怪移动每帧推进。⚠️ 顺序：先塔后怪 ——
  //   塔这帧打死的怪由 foes.update 当帧清尸，不留"死人再打一下"的窗口。
  if (typeof TOWERS !== 'undefined') TOWERS.update(dt);
  // 地面物（v1.6.34 词条）：地雷 / 烈焰地带 / 霜痕 —— 放在 FOES.update **之前**，
  //   让本帧被烧死的怪当帧就被清尸（与"塔这帧打死的怪当帧清"同口径）
  ENG.groundUpdate(dt);
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
// 车厢战斗（v1.4.1，规格 §14.2；v1.6.34 塔型化；**v1.6.36 词条全局化**）
//   —— 大王拍板：车厢是**独立作战单位**。
//   · 车厢 = GS.towers 的镜像投影：每座塔派生一节同塔型同星车厢
//     （塔合成升星 → 车厢跟着变强；塔移除 → 车厢消失，无需独立维护列表）；
//   · 第 i 节位置 = 车头弧长位置后退 (i+1)×GAP 格，railPath 环形取模；
//   · 每节独立炮位：自己射程内挑离镇中心最近的怪；伤害 / 间隔 / 射程 / 目标数
//     **按塔型取**（`TOWERS.TYPES`，方案 A 等 DPS 包络），基础伤害 = `(8+4×wave)×star`；
//   · 塔型基础特效：炮=灼烧 / 魔法=中毒 / 寒冰=减速 / 箭=无；
//   · ▍词条（v1.6.36 大王令"选中即全场生效"）：按 `GS.hasAffix(id)` **逐条全局查询**
//     —— 同塔型多条词条**并存**（各次三选一独立获得），对**所有**对应塔型的车厢生效；
//     效果逻辑集中在 `ENG.affixOnHit` / 本节命中分支，数据在 affixes.js。
//   · 冷却存塔对象 `t.wcd`（塔删了冷却自然消失，零同步成本）。
// ============================================================================
ENG.WAGON = {
  GAP: 1,                                  // 相邻车厢弧长间隔（格）⚠️ v1.4.3 大王拍板"贴身短编组"：2→1，战斗位置同步变化
  RATE: 1.2,                               // 攻击间隔秒（**兜底**，正常按 TOWERS.TYPES 取）
  THUNDER_RATE: 0.9,                       // （旧雷元素加速；塔型化后由 TYPES.interval 接管，保留兼容）
  RANGE: 4.5,                              // 射程（格，**兜底**，正常按 TOWERS.TYPES 取）
  dmg: function (star, wave) { return (8 + 4 * (wave || 0)) * star; }
  // ⚠️ v1.4.6（大王令 2026-10-08）：1 星车厢伤害与车头一致 = 8+4×wave（旧 6×star），
  //   星级保持乘法线性（2星=2倍车头、3星=3倍…）。wave 由 wagonCombat 传入 FOES.wave。
};

// 词条数值常量（调优只动这里）
ENG.AFFIX = {
  V3_PCT: 0.15, V3_MAX: 3, V3_TTL: 3,      // a3 撕裂标记：+15%/层，≤3 层，3s
  V5_PCT: 0.10, V5_MAX: 5,                 // m2 融穿：+10%/层，≤5 层（永久，用 V5_TTL 表示"很久"）
  V5_TTL: 999,
  MINE_TTL: 8, MINE_SLOW: 1.5, MINE_MUL: 0.3,   // c1 布雷
  FIRE_TTL: 3, FIRE_DPS: 0.3,              // c4 烈焰燃油（每秒 0.3×dmg）
  FROST_TTL: 4, FROST_SLOW: 0.5,           // i3 霜痕（覆盖 0.5s，乘子见 foes 移动）
  A5_EVERY: 8, A5_MUL: 0.5,                // a5 箭雨
  M5_STEP: 0.08, M5_MAX: 0.4,              // m5 超频：每击 −8%，最多 −40%
  C5_CHARGE: 3, C5_MUL: 1.5                // c5 蓄势：静默 3s → 半径/伤害 ×1.5
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
  var wave = (typeof FOES !== 'undefined') ? FOES.wave : 0;
  // v1.6.36：词条全局查询（选中即全场生效）。⚠️ 防御式取用：沙箱可能不载 affixes.js
  //   （test_tower 等）⇒ 缺席时恒 false，不得让整个战斗循环崩掉。
  var H = (typeof GS.hasAffix === 'function') ? GS.hasAffix : function () { return false; };

  for (var i = 0; i < GS.towers.length; i++) {
    var t = GS.towers[i];
    var T = (typeof TOWERS !== 'undefined') ? TOWERS.TYPES[t.elem] : null;
    var range = (T ? T.range : ENG.WAGON.RANGE);
    var interval = (T ? T.interval : ENG.WAGON.RATE);
    if (H('i4')) range *= 1.3;                           // 极寒禁锢：射程 +30%
    if (t.wcd > 0) { t.wcd -= dt; t.chargeT = (t.chargeT || 0) + dt; continue; }
    var pos = ENG.wagonPos(i);
    if (!pos) continue;
    // —— 索敌：射程内、离镇中心最近 ——
    var best = null, bestD = Infinity;
    for (var j = 0; j < foes.length; j++) {
      var fe = foes[j];
      var dx = fe.c - pos.c, dy = fe.r - pos.r;
      if (dx * dx + dy * dy > range * range) continue;
      var dc = fe.c - core.c, dr = fe.r - core.r;
      var dCore = dc * dc + dr * dr;
      if (dCore < bestD) { bestD = dCore; best = fe; }
    }
    if (!best) { t.chargeT = (t.chargeT || 0) + dt; continue; }   // 没目标：蓄势累计（c5）

    var dmg = ENG.WAGON.dmg(t.star, wave) * (T ? T.dmgMul : 1);
    dmg *= (1 + (GS.wagonAtkBonus ? GS.wagonAtkBonus() : 0));   // 军工厂加成（v1.6.35，全局乘区）
    if (H('i5') && (best.slow > 0 || best.freeze > 0)) dmg *= 1.5;        // 冷血追击
    var boosted = false;
    if (H('c5') && (t.chargeT || 0) >= ENG.AFFIX.C5_CHARGE) { dmg *= ENG.AFFIX.C5_MUL; boosted = true; }

    // ---- 命中集合：单体 / AOE（cannon）/ 散射（a1）/ 弹射（m1）----
    var hits = [{ f: best, mul: 1 }];
    if (T && T.targets === 'aoe') {
      var radius = H('c3') ? 2 : 1;                      // 弹头分裂：5×5
      if (boosted) radius = Math.max(radius, Math.ceil(radius * 1.5));
      hits = [];
      for (var k = 0; k < foes.length; k++) {
        var fo2 = foes[k];
        if (Math.max(Math.abs(fo2.c - best.c), Math.abs(fo2.r - best.r)) <= radius) hits.push({ f: fo2, mul: 1 });
      }
      // v1.6.43 爆炸视觉（E）：命中格中心炸一圈，半径跟实际 AOE 范围走
      //   （3×3→1.5 格、c3 5×5→2.5 格、c5 蓄势再放大 ⇒ "炸得更大"看得见）
      if (typeof ENG.explosionFx === 'function') ENG.explosionFx(best.c, best.r, radius + 0.5);
    } else {
      if (H('a1')) {                                     // 散射箭：最近的另 2 只（60%）
        var o1 = ENG._nearestFoes(foes, best, 2);
        for (var q1 = 0; q1 < o1.length; q1++) hits.push({ f: o1[q1], mul: 0.6 });
      }
      if (H('m1')) {                                     // 电弧弹射：另 2 只（60% / 40%）
        var o2 = ENG._nearestFoes(foes, best, 2);
        if (o2[0]) hits.push({ f: o2[0], mul: 0.6 });
        if (o2[1]) hits.push({ f: o2[1], mul: 0.4 });
      }
    }

    // ---- 结算 ----
    for (var h = 0; h < hits.length; h++) {
      var hf = hits[h].f, hd = dmg * hits[h].mul;
      if (hf.vuln > 0) hd *= (1 + (hf.vulnPct || ENG.AFFIX.V3_PCT) * hf.vuln);   // 易伤
      hf.hp -= hd;
      hf.hitFlash = 0.25;
      ENG.affixOnHit(t, hf, hd, dmg, T, wave);
    }
    // a5 箭雨：每第 8 次攻击，对全场降一次（0.5×dmg）
    if (H('a5')) {
      t.a5n = (t.a5n || 0) + 1;
      if (t.a5n % ENG.AFFIX.A5_EVERY === 0) {
        for (var r5 = 0; r5 < foes.length; r5++) { foes[r5].hp -= dmg * ENG.AFFIX.A5_MUL; foes[r5].hitFlash = 0.2; }
      }
    }
    // ---- 冷却（m5 超频：连击同目标加速）----
    var iv = interval;
    if (H('m5')) {
      if (t.lastT === best) t.m5s = Math.min(ENG.AFFIX.M5_MAX, (t.m5s || 0) + ENG.AFFIX.M5_STEP);
      else t.m5s = 0;
      t.lastT = best;
      iv *= (1 - (t.m5s || 0));
    }
    t.wcd = iv;
    t.chargeT = 0;
    if (typeof TOWERS !== 'undefined') {
      TOWERS.beams.push({ ac: pos.c, ar: pos.r, bc: best.c, br: best.r,
                          t: 0.12, rgb: ENG.wagonRgb(T ? T.id : t.elem) });
    }
  }
};

// 取离 ref 最近的 n 只（不含 ref）—— a1 散射 / m1 弹射共用
ENG._nearestFoes = function (foes, ref, n) {
  var arr = [];
  for (var i = 0; i < foes.length; i++) {
    var f = foes[i];
    if (f === ref) continue;
    var dc = f.c - ref.c, dr = f.r - ref.r;
    arr.push({ f: f, d: dc * dc + dr * dr });
  }
  arr.sort(function (p, q) { return p.d - q.d; });
  var out = [];
  for (var k = 0; k < n && k < arr.length; k++) out.push(arr[k].f);
  return out;
};

// 命中钩子：塔型基础特效 + 已获得词条的"命中时"效果。**唯一入口**，别在别处再写一份。
//   ▍v1.6.36：词条全局化 ⇒ 逐条 `GS.hasAffix` 查（同塔型多条词条并存，各自独立判定）。
ENG.affixOnHit = function (t, f, hd, dmg, T, wave) {
  // —— 塔型基础特效（箭=无 / 炮=灼烧 / 魔法=中毒 / 寒冰=减速）——
  if (T) {
    if (T.effect === 'burn') f.burn = 2;
    else if (T.effect === 'poison') f.poison = 4;
    else if (T.effect === 'slow') f.slow = 1.5 + (GS.hasAffix('i4') ? 0.5 : 0);
  }
  var H = (typeof GS.hasAffix === 'function') ? GS.hasAffix : function () { return false; },
      A = ENG.AFFIX;
  if (H('a2') && Math.random() < 0.15) f.slowHard = 1.5;                        // 钉刺
  if (H('a3')) {                                                                // 撕裂标记
    f.vuln = Math.min(A.V3_MAX, (f.vuln || 0) + 1); f.vulnPct = A.V3_PCT; f.vulnT = A.V3_TTL;
  }
  if (H('a4')) {                                                                // 影锁共鸣
    var near = ENG._nearestFoes(GS.foes, f, 1)[0];
    if (near) { f.lock = near; f.lockT = 3; }
    if (f.lock && f.lockT > 0 && hd > 0) f.lock.hp -= hd * 0.3;
  }
  if (H('c1')) GS.mines.push({ c: Math.round(f.c), r: Math.round(f.r), t: A.MINE_TTL });   // 哑弹布雷
  if (H('c2')) ENG._knockback(f);                                               // 冲击震退
  if (H('c4')) GS.fireZones.push({ c: Math.round(f.c), r: Math.round(f.r), t: A.FIRE_TTL, dps: A.FIRE_DPS * dmg });  // 烈焰燃油
  if (H('m2')) {                                                                // 融穿
    f.vuln = Math.min(A.V5_MAX, (f.vuln || 0) + 1); f.vulnPct = A.V5_PCT; f.vulnT = A.V5_TTL;
  }
  if (H('m4')) ENG._pullToCore(f);                                              // 极化磁场
  if (H('i1') && f.slow > 0 && Math.random() < 0.2) f.freeze = 1.5;             // 深层冻结
  if (H('i2') && f.slow > 0) ENG._slowAround(f, 1.5);                           // 寒流破裂
  if (H('i3')) GS.frostZones.push({ c: Math.round(f.c), r: Math.round(f.r), t: A.FROST_TTL });  // 霜痕路径
  if (H('i5')) f.slow = Math.max(f.slow || 0, 2);                               // 冷血追击：刷新减速
};

// 击退 1 格（沿"远离镇中心"方向；不越界、坐标夹在地图内）—— c2
ENG._knockback = function (f) {
  var core = GS.core;
  var dx = f.c - core.c, dy = f.r - core.r;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  var nc = f.c + dx / len, nr = f.r + dy / len;
  f.c = Math.max(0, Math.min(CFG.MAP_COLS - 1, nc));
  f.r = Math.max(0, Math.min(CFG.MAP_ROWS - 1, nr));
};
// 朝镇中心拉 1 格 —— m4
ENG._pullToCore = function (f) {
  var core = GS.core;
  var dx = core.c - f.c, dy = core.r - f.r;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  f.c = Math.max(0, Math.min(CFG.MAP_COLS - 1, f.c + dx / len));
  f.r = Math.max(0, Math.min(CFG.MAP_ROWS - 1, f.r + dy / len));
};
// 以 f 为中心 3×3 内全体附加 slow —— i2
ENG._slowAround = function (f, sec) {
  var foes = GS.foes;
  for (var i = 0; i < foes.length; i++) {
    var g = foes[i];
    if (Math.max(Math.abs(g.c - f.c), Math.abs(g.r - f.r)) <= 1) g.slow = Math.max(g.slow || 0, sec);
  }
};

// 地面物（v1.6.34）：地雷 c1 / 烈焰地带 c4 / 霜痕 i3 —— 每帧推进，命中判给踩上去的怪
ENG.groundUpdate = function (dt) {
  var foes = GS.foes || [];
  var i, g, f, k;
  // 地雷：怪踩中 → 强减速 + 消耗；超时移除
  for (i = (GS.mines || []).length - 1; i >= 0; i--) {
    g = GS.mines[i]; g.t -= dt;
    if (g.t <= 0) { GS.mines.splice(i, 1); continue; }
    for (k = 0; k < foes.length; k++) {
      f = foes[k];
      if (Math.round(f.c) === g.c && Math.round(f.r) === g.r) { f.mine = ENG.AFFIX.MINE_SLOW; GS.mines.splice(i, 1); break; }
    }
  }
  // 烈焰地带：每秒伤 dps；超时移除
  for (i = (GS.fireZones || []).length - 1; i >= 0; i--) {
    g = GS.fireZones[i]; g.t -= dt;
    if (g.t <= 0) { GS.fireZones.splice(i, 1); continue; }
    for (k = 0; k < foes.length; k++) {
      f = foes[k];
      if (Math.round(f.c) === g.c && Math.round(f.r) === g.r) { f.hp -= g.dps * dt; f.hitFlash = 0.15; }
    }
  }
  // 霜痕地带：踩上去持续减速；超时移除
  for (i = (GS.frostZones || []).length - 1; i >= 0; i--) {
    g = GS.frostZones[i]; g.t -= dt;
    if (g.t <= 0) { GS.frostZones.splice(i, 1); continue; }
    for (k = 0; k < foes.length; k++) {
      f = foes[k];
      if (Math.round(f.c) === g.c && Math.round(f.r) === g.r) f.zoneSlow = 0.5;
    }
  }
};

// ---- 粒子地基（v1.6.43 大王令 B/E：怪死亡特效 + 爆炸视觉共用）--------------
// GS.fx 数组（state.newGame 清空）。**纯表现**：不进任何数值公式。
//   kind：'ring' 扩张淡出圆环 ｜ 'puff' 扩张淡出实心圆 ｜ 'spark' 漂移碎屑。
//   坐标一律**画布像素**（生成瞬间用当时 LAY 换算；昼夜过渡 0.55s 内生成的粒子
//   会随镜头略漂，寿命 ≤0.4s 可忽略）。颜色统一 'r,g,b' 模板（renderer 拼 alpha）。
ENG.spawnFx = function (list) {
  var fx = GS.fx || (GS.fx = []);
  for (var i = 0; i < list.length; i++) {
    if (fx.length >= 200) fx.shift();          // 护栏：极端场面丢最旧，防数组无界
    fx.push(list[i]);
  }
};
// 粒子取布局：LAY 优先（运行时 main.js 每帧挂）；测试沙箱无 LAY 退 CFG.layout()
ENG.fxLay = function () {
  return (typeof LAY !== 'undefined' && LAY) ? LAY
       : (typeof CFG !== 'undefined' && CFG.layout ? CFG.layout() : null);
};
ENG.updateFx = function (dt) {
  var fx = GS.fx; if (!fx || !fx.length) return;
  for (var i = fx.length - 1; i >= 0; i--) {
    var p = fx[i];
    p.life += dt;
    if (p.kind === 'spark') {                   // 碎屑：漂移 + 减速（×0.92/帧近似）
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.92; p.vy *= 0.92;
    }
    if (p.life >= p.ttl) fx.splice(i, 1);
  }
};
// 怪死亡（B）：暗红尸影收缩外扩 + 白色冲击细环 + 4 片红色碎屑向四周散
ENG.deathFx = function (f) {
  var lay = ENG.fxLay(); if (!lay) return;
  var x = CFG.ccx(lay, f.c), y = CFG.ccy(lay, f.r), r = lay.cell * 0.32;
  var list = [
    { kind: 'puff', x: x, y: y, r0: r, r1: r * 1.6, life: 0, ttl: 0.28, color: '150,45,35' },
    { kind: 'ring', x: x, y: y, r0: r * 0.6, r1: r * 2.2, life: 0, ttl: 0.35, color: '255,235,220', lw: 2 }
  ];
  for (var i = 0; i < 4; i++) {
    var a = (i / 4) * 6.283 + 0.7, sp = lay.cell * (2 + (i % 2) * 0.8);
    list.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 0, ttl: 0.4, size: lay.cell * 0.09, color: '232,86,63' });
  }
  ENG.spawnFx(list);
};
// 爆炸（E）：橙色火光 + 黄亮心 + 冲击环 + 6 粒火星。c/r = 命中格（浮点），
//   rad = 格半径（cannon 3×3 → 1.5、c3 5×5 → 2.5，c5 蓄势再放大 ⇒ 炸得大圈也大）。
ENG.explosionFx = function (c, r, rad) {
  var lay = ENG.fxLay(); if (!lay) return;
  var x = CFG.ccx(lay, c), y = CFG.ccy(lay, r), R = rad * lay.cell;
  var list = [
    { kind: 'puff', x: x, y: y, r0: R * 0.3, r1: R, life: 0, ttl: 0.22, color: '255,140,66' },
    { kind: 'puff', x: x, y: y, r0: R * 0.15, r1: R * 0.5, life: 0, ttl: 0.16, color: '255,220,120' },
    { kind: 'ring', x: x, y: y, r0: R * 0.4, r1: R * 1.25, life: 0, ttl: 0.32, color: '255,170,90', lw: 3 }
  ];
  for (var i = 0; i < 6; i++) {
    var a = (i / 6) * 6.283 + 0.4, sp = lay.cell * (3 + (i % 3));
    list.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 0, ttl: 0.38, size: lay.cell * 0.10, color: '255,184,77' });
  }
  ENG.spawnFx(list);
};

// 怪死亡钩子（foes.js 清尸时调）—— m3 能量溢出：击杀时 3×3 内其他怪吃 0.5×dmg
//   ▍v1.6.36：词条全局化 ⇒ 查 `GS.hasAffix('m3')`（不再看某座塔装没装）
//   ▍v1.6.43：死亡特效（B）挂在最前 —— 必须在 m3 早退之前，否则无 m3 时没特效
ENG.onFoeDeath = function (f, wave) {
  if (typeof ENG.deathFx === 'function') ENG.deathFx(f);
  if (!(typeof GS.hasAffix === 'function' && GS.hasAffix('m3'))) return;
  var dmg = 0.5 * ENG.WAGON.dmg(1, wave) * 2;   // 基准 0.5×(8+4w)×2（1 星魔法塔口径）
  var foes = GS.foes;
  for (i = 0; i < foes.length; i++) {
    var g = foes[i];
    if (g === f) continue;
    if (Math.max(Math.abs(g.c - f.c), Math.abs(g.r - f.r)) <= 1) { g.hp -= dmg; g.hitFlash = 0.2; }
  }
};

// 车厢连线塔型色（renderer 拼淡出 alpha 用）
ENG.wagonRgb = function (elem) {
  return { arrow: '247,217,76', cannon: '232,86,63',
           magic: '168,85,247', ice: '110,198,255' }[elem] || '200,200,200';
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
  // 速度系数见 ENG.trainSpeedMul（v1.6.23：boost 加速 / 加油站提速二选一）
  tr.frac += CFG.TRAIN_SPEED * ENG.trainSpeedMul() * dt;
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

// 列车速度系数（v1.6.23 大王拍板）：
//   · boost 加速中（清怪后的奖励时间 / dusk 收尾回站，见 ENG.update）→ **加油站不生效**，
//     系数 = 1 + boost（沿革 v1.3.1/v2026-10-11）；
//   · 平时 → 系数 = 1 + 覆盖**车头所在格**的加油站座数（求和、非连乘：两座 = 3×）；
//   · 车头格取整数格（GS.railCell(train.index)）—— 3×3 判定按车头格算，车厢跟随车头。
ENG.trainSpeedMul = function () {
  if ((ENG.boost || 0) > 0) return 1 + ENG.boost;
  var cell = GS.railCell(GS.train.index);
  if (!cell) return 1;
  return 1 + GS.gasCoverAt(cell.c, cell.r);
};

// ---- 交付飘字（v1.6.32 大王令"我需要交付的时候飘字，包括生命和金币"）--------------
//   纯表现：队列 `GS.floats`（`{kind:'gold'|'heal', text, x, y, t, ttl}`），
//   ENG 在这里生成 + 在 ENG.update 里按 dt 衰减，REND 在屏幕系里画。
//   ▍"不重叠导致看不清"的四条保证：
//     ① **一次交付 = 一次播报**：`spawnDeliverFloats` 先把旧队列清空 ⇒ 上一圈的字
//        还没飘完时不会与本次混读（连续两圈只看到最新一次的数字）；
//     ② 两行**固定错开 20px**（金币行在下、生命行在上），一起朝上飘 ⇒ 间距恒定；
//     ③ **同类只留最新一条**（`spawnFloat` 按 kind 去重）⇒ 同帧重复调用也不会叠字；
//     ④ 锚点取**站台格**再上移 32 / 52px —— 交付时车头就在站台，躲开列车本体；
//        且交付同一瞬间货堆已被清空（`TRANS.deliver` 清了 `picked`）⇒ 不会压到货堆。
//   ▍生命行只在**真回血**时飘（`healed > 0`）：满血交付不显示 "+0"，免得误导。
ENG.FLOAT_TTL = 1.15;        // 飘字存活秒数（越长越容易被下一圈追尾，1.1s 约等于半个身位）
ENG.FLOAT_DY_GOLD = -32;     // 金币行相对锚点的 y 偏移
ENG.FLOAT_DY_HEAL = -52;     // 生命行相对锚点的 y 偏移（与金币行固定差 20px）

// 入队一条（同 kind 的旧条目先清掉 —— 保证"同类只有一条"）
ENG.spawnFloat = function (kind, text, x, y) {
  if (!GS.floats) GS.floats = [];
  var keep = [];
  for (var i = 0; i < GS.floats.length; i++)
    if (GS.floats[i].kind !== kind) keep.push(GS.floats[i]);
  GS.floats = keep;
  GS.floats.push({ kind: kind, text: text, x: x, y: y, t: 0, ttl: ENG.FLOAT_TTL });
};

// 交付瞬间生成两行。gold = 本次入账金币（已含站台 +10）；heal = **实际**回血量
//   （TRANS.deliver 落下的封顶后真值；满血时为 0 ⇒ 不飘生命行）。
ENG.spawnDeliverFloats = function (gold, heal) {
  GS.floats = [];                       // ① 一次交付 = 一次播报：清掉上一圈的残留，防混读
  var sl = (typeof STATION !== 'undefined' && STATION.slot) ? STATION.slot() : null;
  var lay = (typeof LAY !== 'undefined' && LAY) ? LAY : CFG.layout();
  var cx, cy;
  if (sl) { cx = CFG.ccx(lay, sl.c); cy = CFG.ccy(lay, sl.r); }
  else if (typeof LAY !== 'undefined' && LAY) {          // 没站台就退到车头
    var tp = ENG.trainPos(); cx = tp.x; cy = tp.y;
  } else return;                                          // 纯逻辑沙箱（无布局）→ 不生成
  if (gold > 0) ENG.spawnFloat('gold', '+' + Math.floor(gold), cx, cy + ENG.FLOAT_DY_GOLD);
  if (heal > 0) ENG.spawnFloat('heal', '+' + Math.round(heal), cx, cy + ENG.FLOAT_DY_HEAL);
};

// 到站交付（规则 6）：车斗金币一次性入账 → 金币/爱心地块重置
//   v1.6.22：车上攒的爱心也在 TRANS.deliver 里一并交付（回血，封顶 coreMaxHP）。
ENG.deliverAtStation = function () {
  var hearts = GS.train.hearts || 0;
  var got = TRANS.deliver();
  TRANS.resetLap();
  // v1.6.32 交付飘字：读 TRANS.deliver 落下的明细快照（金币 + 实际回血）
  var ld = GS.train.lastDeliver;
  if (ld) ENG.spawnDeliverFloats(ld.gold, ld.healed);
  if (hearts > 0 && typeof UI !== 'undefined') {
    UI.setStatus('爱心送达：镇中心 +' + (hearts * CFG.HEART_HEAL) +
      '（' + Math.max(0, Math.ceil(GS.coreHP)) + '/' + GS.coreMaxHP + '）');
  }
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
