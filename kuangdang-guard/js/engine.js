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
  // v1.6.91（§14.59）：特效闸与波内奖励痕迹一并归零
  ENG.boostFx = false;
  ENG.rewardFx = false;
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

// ---- v1.6.23 建筑卡落位（铸币所 / 加油站）--------------------------------------
//   · 落点：**任意空地**（判据 = GS.isFreeSpot，与抽塔同一口径：已清空 + 无建筑 +
//     非金币/爱心 + 非铁轨）—— 不要求贴轨（大王令"可以摆放在任意空地位置"）。
//   · 建筑 = 建筑格模型第 4/5 种 type：`cell.b = {type:'mint'|'gas'}`，天然进
//     "不可铺轨 / 不可再建"判定；
//   · **不触发 recomputeRails**：落点必不在轨上（isFreeSpot 排了铁轨格），环形状不受影响
//     —— 与塔放置同一口径（TOWERS.placeAt 也不重算）。
//   · 效果是**查询式**、不是落位时写死：铸币所见 GS.goldValue(c,r)（v1.8u 带格，
//     §14.82）、加油站见 GS.gasCoverAt()，所以多座叠加/拆除都自动成立。
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
  // v1.8u 十五令（§14.86，大王令）：奖励时间/dusk 收尾 = **全局时间快进** ——
  //   dt × (1+boost) 作用于"游戏推进"两端：CLOCK 相位/倒计时 + trainFlow 列车
  //   推进/拾取/交付；**战斗链不快进**（TOWERS/FOES/弹丸/车头撞按常速，大王令
  //   "全局游戏时间快进并不需要战斗相关的东西"）。快进用上一帧 boost（连续帧
  //   下平滑等价，差 ~1 帧无感）；boost 爬升本身用常速 dt（防自我加速）。
  //   trainSpeedMul 回归纯加油站口径（boost 不再进速度系数，避免与 dt 快进算两次）。
  var dtFast = dt * (1 + (ENG.boost || 0));
  if (typeof CLOCK !== 'undefined') CLOCK.tick(dtFast);
  // dusk 加速回站（v1.3.1，规格 §13.4 第 3 条）+ 奖励时间加速（2026-10-11 大王令）：
  //   dusk 收尾且场上无怪 → boost 每秒 +0.9 封顶 3（dt 快进 4×，dtFast 承担）；
  //   奖励时间 → 同款快进同款上限（封顶 3，最高 4× 快进）——"清得越快跑得越久"
  //   的奖励窗口整体快进（跑圈收金币/倒计时同步加速，战斗链除外，§14.86）；
  //   其余相位归零。v1.8u 十八令（§14.89）：收车段**不降档**——奖励时间转 dusk
  //   时 boost 维持原速继续（reward→dusk 无缝衔接），overtime 纯收车同样爬到 3。
  // v1.6.91（规格 §14.59，大王两令定稿）：加特效闸 ENG.boostFx —— 只在"奖励时间"
  //   及"本波享受过奖励时间的后续收车段"为 true；overtime 纯收车（从未进奖励时间）
  //   无特效。波内痕迹 = ENG.rewardFx（reward=true 时置位，白天相位重置）。
  //   消费点 = main.js zBoost（镜头推进）+ REND.speedLines（速度线）。
  var boostCap = 0, boostFx = false;
  if (typeof CLOCK !== 'undefined') {
    if (CLOCK.reward) { boostCap = 3; boostFx = true; ENG.rewardFx = true; }
    else if (CLOCK.isDusk() && (!GS.foes || GS.foes.length === 0)) {
      boostCap = 3; boostFx = !!ENG.rewardFx;    // v1.8u 十八令 §14.89：收车不降档（同 3）
    }
    if (CLOCK.phase === 'day') ENG.rewardFx = false;   // 每波白天重置痕迹
  }
  if (boostCap > 0) ENG.boost = Math.min(boostCap, ENG.boost + dt * 0.9);
  else ENG.boost = 0;
  ENG.boostFx = boostCap > 0 && boostFx;
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
  // 车厢弹丸（v1.8n）：开火帧生成、追踪飞行、命中帧结算 —— 挂在 wagonCombat 后同帧首飞
  ENG.bulletUpdate(dt);
  // v1.6 求解后台化：夜晚挂起的求解结果，回到建造阶段（白天）立即落位。
  //   落位后下一帧 parkAtStation 把车头对齐新站台 —— 夜晚绝不换环（防 train.index 越界）。
  if (window.SOLVER_ASYNC) SOLVER_ASYNC.tryFlush();
  ENG.trainFlow(dtFast);   // v1.8u 十五令 §14.86：列车推进/拾取/交付随全局快进
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
  // v1.6.77 大王令：车头伤害不再与波次挂钩，改为**与摆放建筑数量挂钩**——
  //   n = GS.buildings.length − 1（buildings[0] 恒为镇中心，非玩家摆放；多清理
  //   多摆放建筑，车头才强 = 建设驱动成长）。公式结构/斜率不变（8+4n），只换
  //   自变量；车厢 v1.6.79 起固定基数 12×star（不随波次/建筑数，§14.55）。撞击伤害 =
  //   dmg×BUMP_DMG_MUL 同吃新锚点。
  dmg: function (n) { return 8 + 4 * n; },
  RATE: 1.0,           // 塔式攻击间隔秒
  RANGE: 4.5,          // 塔式射程（格，欧氏距离）⚠️ v1.4.3d 大王令：2.5×1.5=3.75；v1.6.8 大王令 2026-10-09：3.75→4.5（车厢同步）
  BUMP_RANGE: 0.8,     // 撞击判定半径（格，车头中心到怪中心）—— v1.8k：1.2→0.8 贴合车头体量（车头占格面积≈2 ⇒ r=√(2/π)≈0.8）
  BUMP_GAP: 0.8,       // 同一只怪的撞击冷却秒
  // v1.6.63 大王令"降低车厢撞击伤害、大幅提升击退"：撞击从**杀伤手段**转型**控制手段**——
  //   伤害减半（塔式不变），换来击退（v1.6.63 时 2.5 格；**v1.6.75 大王令降为 1 格**
  //   ——位移太大看着假；0.3 格/s 下 1 格 = 3.3s 额外行程）。方向口径与 c2 一致："远离镇中心"。
  //   ▍v1.6.74 大王令"伤害再降低一点"：0.5 → 0.35（w1 6→4.2、w10 24→16.8）。
  //     击退 2.5 格不动（后又于 v1.6.75 降为 1）——撞击进一步纯控制化。
  BUMP_DMG_MUL: 0.25,  // 撞击伤害系数：dmg×0.25（dmg=8+4×建筑数：2 座=4、10 座=12；v1.8k：0.35→0.25，撞击进一步纯控制化）
  BUMP_KNOCKBACK: 1,   // 撞击击退格数（v1.6.75 大王令：2.5 → 1——位移太大，1 格与 c2 同距）
  BUMP_HITSTOP: 0.09   // v1.6.74 撞击顿帧（秒，≈5~6 帧）；▍v1.6.80 口径改为**怪定身**：
                       //   逐怪挂 fo.stun——只顿被撞的敌方单位，游戏/列车照常（§14.56）
};

ENG.trainCombat = function (dt) {
  if (GS.gameOver || !GS.railPath.length) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;            // 没怪没战斗；bumpCd 也无需衰减
  if (typeof FOES === 'undefined') return;
  // ⚠️ v1.4.1 纠偏（规格 §14.2）：车厢是独立作战单位，**不再**给车头加成 ——
  //   旧"+2 伤/节 + 全局元素特效"作废。
  // ▍v1.6.77 大王令：伤害锚点 wave → **摆放建筑数**（§14.53）——GS.buildings[0]
  //   恒为镇中心（state.newGame 初始 push，非玩家摆放）⇒ 排除：n = length − 1。
  var dmg = ENG.TRAIN_COMBAT.dmg(Math.max(0, GS.buildings.length - 1));
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
    // v1.6.63 大王令：撞击伤害 ×BUMP_DMG_MUL + 击退 BUMP_KNOCKBACK（v1.6.75 起 1 格）——
    //   击退复用 c2 的 _knockback（远离镇心、夹地图内）；怪被推离后重新赶路，
    //   相当于把贴轨磨血换成"撞开 + 塔补输出"。
    //   ▍v1.6.74 演出化：顿帧 + 白色冲击环 + 滑动击退（_knockback 内挂 kbAnim，见下）
    //     ——"看着像闪过去"→ 看得见的撞击。
    //   ▍v1.6.80 大王令：顿的是**敌方单位**不是游戏（§14.56）——逐怪挂 fo.stun
    //     （0.09s 停走停打），hitStop 全场静止机制退役；_knockback 自动读 f.stun
    //     把滑动演出延迟到顿完后接力。
    var preBump = fo.hp;
    fo.hp -= dmg * ENG.TRAIN_COMBAT.BUMP_DMG_MUL;
    ENG._snapOverkill(fo, preBump, 'train');   // v1.8p/q：撞击击穿快照（来源车头）
    ENG.dmgFloat(fo, dmg * ENG.TRAIN_COMBAT.BUMP_DMG_MUL, preBump > 0 && fo.hp <= 0);   // v1.8s：撞击伤害/击杀飘字
    fo.bumpCd = ENG.TRAIN_COMBAT.BUMP_GAP;
    fo.hitFlash = 0.3;
    fo.stun = ENG.TRAIN_COMBAT.BUMP_HITSTOP;
    ENG.bumpFx(fo);
    ENG._knockback(fo, ENG.TRAIN_COMBAT.BUMP_KNOCKBACK);
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
  var preShot = best.hp;
  best.hp -= dmg;
  ENG._snapOverkill(best, preShot, 'train');   // v1.8p/q：车头炮击快照（来源车头）
  ENG.dmgFloat(best, dmg, preShot > 0 && best.hp <= 0);   // v1.8s：车头炮击伤害/击杀飘字
  best.hitFlash = 0.25;
  ENG.trainAtkCd = ENG.TRAIN_COMBAT.RATE;
  // 攻击连线：浅紫（车斗同色系），rgb 模板给 renderer 拼淡出 alpha
  if (typeof TOWERS !== 'undefined') {
    TOWERS.beams.push({ ac: fc, ar: fr, bc: best.c, br: best.r, t: 0.12, rgb: '143,134,255' });
  }
};

// ============================================================================
// 车厢战斗（v1.4.1，规格 §14.2；v1.6.34 塔型化；**v1.8j 车厢改版**）
//   —— 大王拍板：车厢是**独立作战单位**。
//   · 车厢 = GS.towers 的镜像投影：每座塔派生一节同塔型同星车厢
//     （塔合成升星 → 车厢跟着变强；塔移除 → 车厢消失，无需独立维护列表）；
//   · 第 i 节位置 = 车头弧长位置后退 (i+1)×GAP 格，railPath 环形取模；
//   · 每节独立炮位：伤害 / 间隔 / 射程 / 目标数**按塔型取**（`TOWERS.TYPES`），
//     基础伤害 = `12×star` 固定基数（v1.6.79，§14.55）；
//     ▍v1.8j 四型：机枪=快速单体物理 / 火炮=慢速溅射物理（命中点半径 splash 圆）/
//       冰环=近距离以自身为圆心的环绕 AOE 魔法（+减速） / 闪电=慢速单体魔法；
//   · 塔型基础特效：只剩冰环=减速（i 系词条依赖）；灼烧随 v1.8k、中毒随 v1.8j 退役；
//   · ▍词条（v1.6.36 大王令"选中即全场生效"；▍v1.6.78 A 案收口为
//     **按塔型过滤**：`ENG.affixOf(t, id)` = hasAffix 且词条归属塔型 === t.elem）
//     —— 同塔型多条词条**并存**（各次三选一独立获得），对**所有**对应塔型的车厢生效；
//     效果逻辑集中在 `ENG.affixOnHit` / 本节命中分支，数据在 affixes.js。
//   · 冷却存塔对象 `t.wcd`（塔删了冷却自然消失，零同步成本）。
// ============================================================================
ENG.WAGON = {
  GAP: 1,                                  // 相邻车厢弧长间隔（格）⚠️ v1.4.3 大王拍板"贴身短编组"：2→1，战斗位置同步变化
  RATE: 1.2,                               // 攻击间隔秒（**兜底**，正常按 TOWERS.TYPES 取）
  THUNDER_RATE: 0.9,                       // （旧雷元素加速；塔型化后由 TYPES.interval 接管，保留兼容）
  RANGE: 4.5,                              // 射程（格，**兜底**，正常按 TOWERS.TYPES 取）
  dmg: function (star) { return 12 * star; }
  // ⚠️ v1.4.6（2026-10-08）：1 星车厢伤害与车头一致 = 8+4×wave，星级乘法线性。
  // ▍v1.6.79 大王令（规格 §14.55）：车厢**不再随波次成长**、也不随建筑数——
  //   固定基数 12（=原 wave1 基准 8+4×1，开局手感不变；第二参数 wave 废弃）。
  //   成长只来自：①车厢数量（每节独立开火，数量×输出）、②星级 ×star、
  //   ③词条/猛攻坊乘区（i5/c5/猛攻坊，wagonCombat 后段照旧相乘）。
  //   车头公式（v1.6.77 8+4×摆放建筑数）不动——车头看建设、车厢看数量×星级×词条。
};

// 词条数值常量（调优只动这里）
//   ▍v1.8m 词条调平（大王令：每条伤害/乘区词条 ≈ +60% 增幅，乘法叠加 = 指数成长；
//     纯控制 7 条 a2/c1/c2/m4/i1/i2/i3 豁免不动；a5/c4/m3 现值已达线不动）：
//     a3 0.15→0.20 · a4 0.3→0.6 · c3 2.3→1.65 · c5 CHARGE 3→6（火炮 3s 间隔下
//     每 3 发蓄 1 发，+79% 微超）· m1 60/40→40/20 · m2 0.10→0.12 ·
//     m5 0.08/0.4→0.075/0.375（间隔 ×0.625）· i4 射程 ×1.3→+0.6 格 · i5 1.5→1.6
ENG.AFFIX = {
  V3_PCT: 0.20, V3_MAX: 3, V3_TTL: 3,      // a3 撕裂标记：+20%/层，≤3 层，3s（满层 +60%）
  V5_PCT: 0.30, V5_MAX: 2,                 // m2 融穿：+30%/层，≤2 层（永久到该怪死亡；满层 +60%）
                                           //   v1.8r：5×12%→2×30% —— 满层等值，但闪电 2.4s/击
                                           //   叠满 12s 太慢（怪射程内只挨 3-5 击，吃不满），改 2 击 4.8s 叠满
  MINE_TTL: 8, MINE_SLOW: 1.5, MINE_MUL: 0.3,   // c1 布雷（控制类，v1.8m 豁免）
  FIRE_TTL: 3, FIRE_DPS: 0.3,              // c4 烈焰燃油（每秒 0.3×dmg；v1.8m 中位 ~+60%，不动）
  FROST_TTL: 4, FROST_SLOW: 0.5,           // i3 霜痕（覆盖 0.5s，乘子见 foes 移动；控制类豁免）
  A5_EVERY: 8, A5_MUL: 0.5,                // a5 箭雨（v1.8m：10 怪口径 +62%，不动）
  M5_STEP: 0.075, M5_MAX: 0.375,           // m5 超频：每击 −7.5%，最多 −37.5%（间隔 ×0.625 ⇒ DPS +60%）
  C5_CHARGE: 6, C5_MUL: 1.5                // c5 蓄势：静默 6s → 半径/伤害 ×1.5（火炮 3s 一发 ⇒ 每 3 发蓄 1 发）
};

// ---- 圆角轨道路径（v1.8f 平滑转弯，大王令"转弯不平滑"）-------------------------
// 铁轨贴片在拐格画的是**半径 = 半格**（h = L.cell/2）的四分之一圆弧（见 REND.railTiles），
//   但列车此前按"格心直线折线"行走 ⇒ 车头/车厢每到拐角**瞬间 90° 跳转**，挂车尾的
//   资源堆锚点方向随之跳变（"与车头距离一会儿近一会儿远"）。本函数把 railPath 折线
//   按**同一半径 0.5 格**在拐角处倒角成圆弧：位置与切线角都连续，列车正好贴着画出来
//   的轨道中心线走。直线段仍是格心直线（几何不变）。
//   ▍参数 p = 弧长参数（格）= train.index + train.frac（对环长取模）。
//   ▍返回 {c, r, ang}：**格坐标**（浮点；战斗 wagonPos 直接复用）+ 行进方向角（弧度，
//     与 CFG.ccx/ccy 同构 ⇒ 画布角与格坐标角一致）。
//   ▍安全退化：任一边非正交相邻（斜步/退化）时该处不倒角，回退成旧的线性插值。
ENG.RAIL_R = 0.5;                       // 倒角半径（格），= 贴片弧半径 h
ENG.railPoint = function (p) {
  var n = GS.railPath.length;
  if (!n) return null;
  var R = ENG.RAIL_R;
  p = ((p % n) + n) % n;
  var k = Math.floor(p), f = p - k;      // 当前边起点格下标 k、边内进度 f∈[0,1)
  var a = GS.railCell(k), b = GS.railCell(k + 1);
  var ux = (b.c > a.c) ? 1 : (b.c < a.c ? -1 : 0);   // 当前边方向（轴单位）
  var uy = (b.r > a.r) ? 1 : (b.r < a.r ? -1 : 0);
  var pv = GS.railCell((k - 1 + n) % n);             // 前格 → 起点拐角入方向
  var ix = a.c - pv.c, iy = a.r - pv.r;
  var nx = GS.railCell((k + 2) % n);                 // 后格 → 终点拐角出方向
  var ox = nx.c - b.c, oy = nx.r - b.r;
  // 轴正交判定（两方向都是轴单位且互相垂直；斜步/折返 → false，走直线退化）
  function perp(mx, my, px, py) {
    return mx * px + my * py === 0 && mx * mx + my * my === 1 && px * px + py * py === 1;
  }
  // 拐角弧取点：顶点 V、入方向 I、出方向 O、t∈[0,1]（0=入点 1=出点）
  function arcAt(vc, vr, Ix, Iy, Ox, Oy, t) {
    var cx = vc - Ix * R + Ox * R, cy = vr - Iy * R + Oy * R;   // 弧心 = V − I·R + O·R
    var t0 = Math.atan2(-Oy, -Ox);                              // 入点（相对弧心 = −O·R）
    var d = Math.atan2(Iy, Ix) - t0;                            // 出点方向 − 入点方向（±90°）
    if (d > Math.PI) d -= 2 * Math.PI; else if (d < -Math.PI) d += 2 * Math.PI;
    var th = t0 + d * t, sd = d < 0 ? -1 : 1;
    return { c: cx + R * Math.cos(th), r: cy + R * Math.sin(th),
             ang: Math.atan2(sd * Math.cos(th), -sd * Math.sin(th)) };   // 切线 = 半径转 90°
  }
  if (perp(ix, iy, ux, uy) && f < R)      // 起点拐角（占当前边前段 f∈[0,R]）
    return arcAt(a.c, a.r, ix, iy, ux, uy, 0.5 + 0.5 * (f / R));
  if (perp(ux, uy, ox, oy) && f > 1 - R)  // 终点拐角（占当前边后段 f∈[1−R,1]）
    return arcAt(b.c, b.r, ux, uy, ox, oy, 0.5 * (f - (1 - R)) / R);
  return { c: a.c + ux * f, r: a.r + uy * f, ang: Math.atan2(uy, ux) };
};

// 第 i 节（0 起）的浮点格坐标（沿**圆角路径**）。headPos = 车头弧长位置（index+frac，单位格），
//   后退 (i+1)×GAP 后对 railPath 长度取模（环形：退过头绕到车头前方）。
//   ⚠️ 与渲染 wagonPos 严格同源（renderer 的 arcPix 也走 ENG.railPoint）——改一处必改另一处。
ENG.wagonPos = function (i) {
  var head = GS.train.index + GS.train.frac;
  var pt = ENG.railPoint(head - (i + 1) * ENG.WAGON.GAP);
  return pt ? { c: pt.c, r: pt.r } : null;
};

// 词条查询唯一入口（v1.6.78 大王拍板 A 案，规格 §14.54）：GS.hasAffix(id) 之外
//   还要求 **词条归属塔型 = 查询方塔型**（AFFIXES.get(id).tower === t.elem）——
//   对齐 affixes.js 设计口径"词条只对对应塔型的车厢生效"。此前纯全局查询是
//   超标投放（箭塔车厢吃 c1 布雷/c4 烈焰等炮系词条）。
//   ⚠️ 防御式：affixes.js 缺席的沙箱（test_tower 等）退化为纯 GS.hasAffix，
//   缺席时恒 false——两档退路都与 v1.6.36 全局化的旧口径一致，不炸测试。
//   特例：m3 走 onFoeDeath 击杀钩子，无归属塔（DOT 击杀来源不可得）⇒ 维持
//   GS.hasAffix 全局（规格 §14.54 待办标注），不走本入口。
ENG.affixOf = function (t, id) {
  if (typeof GS.hasAffix !== 'function' || !GS.hasAffix(id)) return false;
  if (typeof AFFIXES === 'undefined' || !AFFIXES.get) return true;   // affixes.js 缺席退化
  var d = AFFIXES.get(id);
  return !!(d && t && d.tower === t.elem);
};

ENG.wagonCombat = function (dt) {
  if (GS.gameOver || !GS.railPath.length) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;
  var core = GS.core;
  var wave = (typeof FOES !== 'undefined') ? FOES.wave : 0;

  for (var i = 0; i < GS.towers.length; i++) {
    var t = GS.towers[i];
    // v1.6.36：词条全局查询（选中即全场生效）。⚠️ 防御式取用：沙箱可能不载 affixes.js
    //   （test_tower 等）⇒ 缺席时恒 false，不得让整个战斗循环崩掉。
    //   ▍v1.6.78 A 案：查询收口到 ENG.affixOf —— 按塔型过滤（H 的定义挪进循环，
    //     闭包捕获 t；每帧至多 6 节车厢，开销可忽略）。body 内 H() 调用点零改动。
    var H = function (id) { return ENG.affixOf(t, id); };
    var T = (typeof TOWERS !== 'undefined') ? TOWERS.TYPES[t.elem] : null;
    var range = (T ? T.range : ENG.WAGON.RANGE);
    var interval = (T ? T.interval : ENG.WAGON.RATE);
    if (H('i4')) range += 0.6;                           // 极寒禁锢：射程 +0.6 格（2.2→2.8，v1.8m）
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

    // v1.6.79（§14.55）：车厢伤害 = 12×star 固定基数（不随波次/建筑数），塔型倍率/
    //   猛攻坊/词条乘区在后段照旧相乘。wave 实参废弃（变量保留喂 affixOnHit 签名）。
    var dmg = ENG.WAGON.dmg(t.star) * (T ? T.dmgMul : 1);
    // 猛攻坊加成（v1.8u 十三令，§14.84）：同行**左右邻格**每座 +100%，求和非连乘，
    //   查询式乘区（用车厢固定格 t.c/t.r 判定，非移动投影；原军工厂全局乘区退役）。
    dmg *= (1 + (GS.atkBoostAt ? GS.atkBoostAt(t.c, t.r) : 0));
    if (H('i5') && (best.slow > 0 || best.freeze > 0)) dmg *= 1.6;        // 冷血追击（v1.8m：1.5→1.6）
    var boosted = false;
    if (H('c5') && (t.chargeT || 0) >= ENG.AFFIX.C5_CHARGE) { dmg *= ENG.AFFIX.C5_MUL; boosted = true; }

    // ---- 命中集合（v1.8n 弹丸化）：冰环即时结算（无弹）；火炮/机枪/闪电改
    //   "开火帧生成追踪弹 → 命中帧结算"——伤害/乘区仍在开火帧算好随弹携带，
    //   易伤/特效（affixOnHit）按命中帧怪状态判定。散射 a1 / 弹射 m1 = 额外目标各一颗弹。
    var hits, shots;   // hits = 冰环即时名单；shots = 弹丸名单 [{ f, mul }]
    if (T && T.targets === 'ring') {
      // 冰环（v1.8j）：以**车厢自身**为圆心、射程为半径，环内全体吃范围魔法伤害。
      //   能进这段 = 射程内必有怪（上面 best 已按同一 range 筛过），hits 非空。
      hits = [];
      for (var kr = 0; kr < foes.length; kr++) {
        var fr2 = foes[kr];
        var rdx = fr2.c - pos.c, rdy = fr2.r - pos.r;
        if (rdx * rdx + rdy * rdy <= range * range) hits.push({ f: fr2, mul: 1 });
      }
      if (typeof ENG.iceRingFx === 'function') ENG.iceRingFx(pos.c, pos.r, range);
      ENG.applyHits(t, T, hits, dmg, wave);
    } else if (T && T.targets === 'aoe') {
      // 火炮（v1.8j 收敛）：追踪炮弹飞向目标，命中帧以命中点为圆心溅射——
      //   半径判定（c3 → 1.65 / c5 ×1.5）随命中帧走（见 ENG.bulletHit），视觉爆炸圈同步。
      shots = [{ f: best, mul: 1 }];
    } else {
      // 机枪 / 闪电：追踪弹；a1 散射 = 另 2 只各 30%、m1 弹射 = 另 2 只 40%/20%（v1.8m）
      shots = [{ f: best, mul: 1 }];
      if (H('a1')) {
        var o1 = ENG._nearestFoes(foes, best, 2);
        for (var q1 = 0; q1 < o1.length; q1++) shots.push({ f: o1[q1], mul: 0.3 });
      }
      if (H('m1')) {
        var o2 = ENG._nearestFoes(foes, best, 2);
        if (o2[0]) shots.push({ f: o2[0], mul: 0.4 });
        if (o2[1]) shots.push({ f: o2[1], mul: 0.2 });
      }
    }
    if (shots) for (var sb = 0; sb < shots.length; sb++)
      ENG.spawnBullet(t, T, pos, shots[sb].f, dmg, shots[sb].mul, boosted, wave);

    // a5 箭雨：每第 8 次攻击，对全场降一次（0.5×dmg）——开火帧结算（视觉即时，无弹）
    if (H('a5')) {
      t.a5n = (t.a5n || 0) + 1;
      if (t.a5n % ENG.AFFIX.A5_EVERY === 0) {
        for (var r5 = 0; r5 < foes.length; r5++) {
          var preR5 = foes[r5].hp;   // v1.8p：箭雨是整段直伤，击穿同样快照过量
          foes[r5].hp -= dmg * ENG.AFFIX.A5_MUL;
          ENG._snapOverkill(foes[r5], preR5, t.elem);   // 来源=机枪车厢（a5 是机枪词条）
          foes[r5].hitFlash = 0.2;
        }
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
    // 疾速坊攻速（v1.8u 十三令，§14.84）：同列**上下邻格**每座 +100%，间隔 ÷(1+加成)
    //   （+300% ⇒ ÷4 = 间隔 −75%，大王锚点）；在 m5 之后相除，两乘区独立可交换。
    if (GS.aspBoostAt) iv /= (1 + GS.aspBoostAt(t.c, t.r));
    t.wcd = iv;
    t.chargeT = 0;
    // v1.8n 弹丸化：车厢不再画瞬时连线（TOWERS.beams 只剩车头 trainCombat 用）
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

// ============================================================================
// 车厢弹丸（v1.8n，§15 待办立项"车厢弹丸化表现"）：
//   · 机枪 / 火炮 / 闪电改**真飞行弹丸**——开火帧在 wagonCombat 生成（伤害/军工/
//     词条乘区当帧算好随弹携带），追踪目标怪飞，命中帧才结算掉血；
//   · 冰环不走弹（开火帧即时结算 + iceRingFx 扩散环，原样）；
//   · 追踪口径：每帧朝目标怪**当前位置**飞（被击退/磁拉也会跟过去），
//     步进 ≥ 剩距 or 距离 ≤ HIT_R 判命中；
//   · 目标死亡：对象被清尸后字段仍在（引用不空）⇒ 弹丸飞到最后位置——
//     火炮照样炸圈（溅射活怪）、单体/散射/弹射弹消散不结算；
//   · TOWERS.beams 车厢侧退役（只剩车头 trainCombat 的连线）。
ENG.BULLET = {
  SPEED: { arrow: 12, cannon: 5, magic: 8 },   // 格/s：机枪快弹 / 火炮慢炮弹 / 闪电中速
  HIT_R: 0.3                                   // 命中阈值（格）
};
ENG.spawnBullet = function (t, T, from, target, dmg, mul, boosted, wave) {
  if (!GS.bullets) GS.bullets = [];
  GS.bullets.push({ kind: t.elem, c: from.c, r: from.r, target: target,
                    t: t, T: T, dmg: dmg, mul: mul, boosted: boosted, wave: wave });
};
ENG.bulletUpdate = function (dt) {
  var bs = GS.bullets; if (!bs || !bs.length) return;
  for (var i = bs.length - 1; i >= 0; i--) {
    var b = bs[i], tg = b.target;
    if (!tg) { bs.splice(i, 1); continue; }                  // 无目标（异常）直接消
    var dx = tg.c - b.c, dy = tg.r - b.r, d = Math.sqrt(dx * dx + dy * dy) || 0;
    var sp = ENG.BULLET.SPEED[b.kind]; if (sp === undefined) sp = 6;   // 未知塔型兜底（T=null 哨兵/老存档）
    var step = sp * dt;
    if (d <= Math.max(step, ENG.BULLET.HIT_R)) { ENG.bulletHit(b); bs.splice(i, 1); continue; }
    b.c += dx / d * step; b.r += dy / d * step;
  }
};
// 命中帧结算：火炮以命中点为圆心溅射（c3/c5 半径在此判定）+ 爆炸圈；其余单体（目标已死则消散）。
//   易伤/词条钩子走 ENG.applyHits（与冰环共用一份结算，别处别再写）。
ENG.bulletHit = function (b) {
  var t = b.t, T = b.T, tg = b.target, hx = tg.c, hy = tg.r;
  if (T && T.targets === 'aoe') {
    var H = function (id) { return ENG.affixOf(t, id); };
    var radius = H('c3') ? 1.65 : (T.splash || 1.3);
    if (b.boosted) radius *= 1.5;
    var hits = [];
    for (var k = 0; k < GS.foes.length; k++) {
      var fo = GS.foes[k], sdx = fo.c - hx, sdy = fo.r - hy;
      if (sdx * sdx + sdy * sdy <= radius * radius) hits.push({ f: fo, mul: 1 });
    }
    if (typeof ENG.explosionFx === 'function') ENG.explosionFx(hx, hy, radius + 0.3);
    ENG.applyHits(t, T, hits, b.dmg, b.wave);
  } else {
    if (tg.hp <= 0) return;                                  // 单体：目标已死，弹丸消散
    ENG.applyHits(t, T, [{ f: tg, mul: b.mul }], b.dmg, b.wave);
  }
};
// 过量击杀快照（v1.8p m3，规格 §14.77）：整段直接伤害把怪打到 hp≤0 时，记录击穿
//   富余量（= 本段伤害超出剩余血的部分）到 f.overkill，供 onFoeDeath 算动态溢出。
//   只在**首次击穿**时记——hp 已 ≤0 的补刀不再刷新（防把补刀全额误算成过量）。
//   不记的口径：DoT（c4 火区每帧微量）、旁路伤（a4 影锁传递、m3 溢出本身、箭雨以外
//   的词条直伤）——只有"整段直接命中"才有过量。
ENG._snapOverkill = function (f, preHp, src) {
  if (preHp > 0 && f.hp <= 0) { f.overkill = -f.hp; f.overkillSrc = src; }
};
// 结算唯一入口：易伤加成 → 扣血 → hitFlash → affixOnHit（v1.8n 从 wagonCombat 抽出，
//   冰环（开火帧）与弹丸（命中帧）共用）。
ENG.applyHits = function (t, T, hits, dmg, wave) {
  for (var h = 0; h < hits.length; h++) {
    var hf = hits[h].f, hd = dmg * hits[h].mul;
    // 易伤双槽（v1.8o 拆分）+ 严格收口（v1.8q，大王总纲"词条只对对应车厢生效"）：
    //   vulnA（a3 机枪叠）只对机枪来源伤害生效、vulnM（m2 闪电叠）只对闪电来源伤害生效
    //   ——旧版任何车厢打都吃（闪电叠融穿机枪受益），辅助定位退役、改纯自益。
    //   车头撞击/塔式不走 applyHits（自带扣血），天然不吃。
    if (t.elem === 'arrow' && hf.vulnA) hd *= 1 + hf.vulnA * ENG.AFFIX.V3_PCT;
    if (t.elem === 'magic' && hf.vulnM) hd *= 1 + hf.vulnM * ENG.AFFIX.V5_PCT;
    var preHp = hf.hp;
    hf.hp -= hd;
    ENG._snapOverkill(hf, preHp, t.elem);   // v1.8p/q：击穿快照过量伤 + 记来源车厢塔型
    hf.hitFlash = 0.25;
    ENG.dmgFloat(hf, hd, preHp > 0 && hf.hp <= 0);   // v1.8s：伤害/击杀飘字（旁路伤不飘）
    ENG.affixOnHit(t, hf, hd, dmg, T, wave);
  }
};

// 命中钩子：塔型基础特效 + 已获得词条的"命中时"效果。**唯一入口**，别在别处再写一份。
//   ▍v1.6.36：词条全局化 ⇒ 逐条 `GS.hasAffix` 查（同塔型多条词条并存，各自独立判定）。
//   ▍v1.6.78 A 案：查询改走 `ENG.affixOf(t, ·)` —— 按塔型过滤（规格 §14.54）。
ENG.affixOnHit = function (t, f, hd, dmg, T, wave) {
  // v1.6.78 A 案：查询收口到 ENG.affixOf（按塔型过滤）；H 定义上移到塔型特效
  //   分支之前，i4（slow 分支里原直查 GS.hasAffix）一并收口。
  var H = function (id) { return ENG.affixOf(t, id); },
      A = ENG.AFFIX;

  // —— 塔型基础特效（只剩冰环=减速；火炮灼烧随 v1.8k、闪电中毒随 v1.8j 退役）——
  if (T && T.effect === 'slow') f.slow = 1.5 + (H('i4') ? 0.5 : 0);
  if (H('a2') && Math.random() < 0.15) f.slowHard = 1.5;                        // 钉刺
  if (H('a3')) {                                                                // 撕裂标记
    // v1.8o 拆双槽：a3 写 vulnA（≤3 层，vulnAT 3s 衰减），不再与 m2 的 vulnM 互踩
    f.vulnA = Math.min(A.V3_MAX, (f.vulnA || 0) + 1); f.vulnAT = A.V3_TTL;
  }
  if (H('a4')) {                                                                // 影锁共鸣
    var near = ENG._nearestFoes(GS.foes, f, 1)[0];
    if (near) { f.lock = near; f.lockT = 3; }
    if (f.lock && f.lockT > 0 && hd > 0) f.lock.hp -= hd * 0.6;   // v1.8m：传递 30%→60%（+60% 线）
  }
  if (H('c1')) GS.mines.push({ c: Math.round(f.c), r: Math.round(f.r), t: A.MINE_TTL });   // 哑弹布雷
  if (H('c2')) ENG._knockback(f);                                               // 冲击震退
  if (H('c4')) GS.fireZones.push({ c: Math.round(f.c), r: Math.round(f.r), t: A.FIRE_TTL, dps: A.FIRE_DPS * dmg });  // 烈焰燃油
  if (H('m2')) {                                                                // 融穿
    // v1.8o 拆双槽：m2 写 vulnM（≤2 层，永久；v1.8r 5×12%→2×30% 提速爬升），不再与 a3 的 vulnA 互踩
    f.vulnM = Math.min(A.V5_MAX, (f.vulnM || 0) + 1);
  }
  if (H('m4')) ENG._pullToFoe(f);                                               // 极化磁场（v1.8o：聚怪，见 _pullToFoe）
  if (H('i1') && f.slow > 0 && Math.random() < 0.2) f.freeze = 1.5;             // 深层冻结
  if (H('i2') && f.slow > 0) ENG._slowAround(f, 1.5);                           // 寒流破裂
  if (H('i3')) GS.frostZones.push({ c: Math.round(f.c), r: Math.round(f.r), t: A.FROST_TTL });  // 霜痕路径
  if (H('i5')) f.slow = Math.max(f.slow || 0, 2);                               // 冷血追击：刷新减速
};

// 击退 dist 格（默认 1；沿"远离镇中心"方向；不越界、坐标夹在地图内）——
//   c2 词条传参省略 = 1 格；v1.6.63 撞击击退传 BUMP_KNOCKBACK=2.5。
//   ▍v1.6.74 大王令"要能看到击退过程"：**逻辑坐标立即落到目标**（战斗判定/塔索敌/
//     软分离零感知，test_tower c2 断言不变），同时挂 f.kbAnim（纯表现）：
//     fx/fy = 原坐标、t/dur 动画进度；dur = min(0.35, 0.1+0.09×k)（1 格 0.19s、
//     2.5 格 0.325s）。渲染侧 easeOutCubic 插值画出滑动（renderer.js 怪循环），
//     衰减在 foes.js（hitFlash 旁）。c2 与撞击自动同享，不用各挂一遍。
ENG._knockback = function (f, dist) {
  var k = dist || 1;
  var core = GS.core;
  var dx = f.c - core.c, dy = f.r - core.r;
  var len = Math.sqrt(dx * dx + dy * dy) || 1;
  var nc = f.c + dx / len * k, nr = f.r + dy / len * k;
  f.kbAnim = { fx: f.c, fy: f.r, t: -(f.stun || 0), dur: Math.min(0.35, 0.1 + 0.09 * k) };  // v1.6.74 滑动演出；v1.6.80：t 从 −stun 起步——撞击场景先顿再滑（c2 无 stun 照旧即滑）
  f.c = Math.max(0, Math.min(CFG.MAP_COLS - 1, nc));
  f.r = Math.max(0, Math.min(CFG.MAP_ROWS - 1, nr));
};
// 撞击冲击环（v1.6.74）：白色细环从撞击点外扩，fx 地基复用（同 deathFx ring 风格）。
ENG.bumpFx = function (fo) {
  var lay = ENG.fxLay(); if (!lay) return;
  ENG.spawnFx([{ kind: 'ring', x: CFG.ccx(lay, fo.c), y: CFG.ccy(lay, fo.r),
                 r0: lay.cell * 0.35, r1: lay.cell * 1.2, life: 0, ttl: 0.3,
                 color: '255,245,230', lw: 2.5 }]);
};
// 朝**最近的其他怪**拉 1 格 —— m4（v1.8o 大王令改口径：原"拉向镇中心"等于帮怪赶路
//   1 格/击，聚怪收益要配 AOE 才兑现；改为纯聚怪——被击怪向怪群靠拢，不改变其到镇中心的进度）。
//   场上没有别的怪时无事可聚（早退）。坐标夹在地图内，与 _knockback 同口径。
ENG._pullToFoe = function (f) {
  var near = ENG._nearestFoes(GS.foes, f, 1)[0];
  if (!near) return;
  var dx = near.c - f.c, dy = near.r - f.r;
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
//   rad = 格半径（cannon 溅射 v1.8j：splash 1.3 → 1.6、c3 → 2.6，c5 蓄势再放大 ⇒ 炸得大圈也大）。
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
// 冰环（v1.8j）：冰车厢开火时以自身为圆心炸开一圈淡蓝冰环 + 4 粒冰晶。
//   c/r = 车厢当前格（浮点），rad = 实际伤害半径（= 塔型射程，格）——环到哪伤到哪。
ENG.iceRingFx = function (c, r, rad) {
  var lay = ENG.fxLay(); if (!lay) return;
  var x = CFG.ccx(lay, c), y = CFG.ccy(lay, r), R = rad * lay.cell;
  var list = [
    { kind: 'puff', x: x, y: y, r0: R * 0.2, r1: R * 0.55, life: 0, ttl: 0.2, color: '190,235,255' },
    { kind: 'ring', x: x, y: y, r0: R * 0.35, r1: R * 1.05, life: 0, ttl: 0.35, color: '110,198,255', lw: 3 }
  ];
  for (var i = 0; i < 4; i++) {
    var a = (i / 4) * 6.283 + 0.8, sp = lay.cell * 2.5;
    list.push({ kind: 'spark', x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                life: 0, ttl: 0.3, size: lay.cell * 0.08, color: '160,220,255' });
  }
  ENG.spawnFx(list);
};

// 怪死亡钩子（foes.js 清尸时调）—— m3 能量溢出：击杀时 3×3 内其他怪吃 0.5×过量伤
//   ▍v1.6.78 A 案特例 → **v1.8q 销账**：旧无归属塔（DoT 击杀来源不可得）维持全局查询，
//     规格 §14.54 待办标注；v1.8p 过量快照落地后来源可记（overkillSrc），据大王总纲
//     "词条只对对应车厢生效"收口为**只认闪电车厢来源的击穿**（§14.78）。
//   ▍v1.6.43：死亡特效（B）挂在最前 —— 必须在 m3 早退之前，否则无 m3 时没特效
ENG.onFoeDeath = function (f, wave) {
  if (typeof ENG.deathFx === 'function') ENG.deathFx(f);
  if (!(typeof GS.hasAffix === 'function' && GS.hasAffix('m3'))) return;
  // v1.8q（大王总纲"词条只对对应车厢生效"，规格 §14.78）：**只有闪电车厢来源的击穿**
  //   才爆溢出（overkillSrc 由 _snapOverkill 在击穿帧记下伤害来源）——车头撞击/炮击、
  //   机枪箭雨、其他车厢的过量不再触发。§14.54 遗留待办（m3 全局查询未收口）就此销账。
  // v1.8p：溢出 = 0.5 × **过量伤害**（击杀这一击打穿的富余量）——固定 12 退役，回归
  //   DIY 原描述"过量击杀伤害"。无快照 = 0 ⇒ 不爆：DoT 烧死（c4 火区）、a4 传递杀、
  //   m3 溢出连锁杀（防无限连锁）都不再触发。
  if (f.overkillSrc !== 'magic') return;
  var dmg = 0.5 * (f.overkill || 0);
  if (dmg <= 0) return;
  var foes = GS.foes;
  for (var i = 0; i < foes.length; i++) {
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

// ---- 加油站提速（v1.6.23 查询式 · v1.8u 十二令 2026-10-20 改回初版）--------------
//   【十二令 大王令「改回初版」】火车在加油站（3×3）覆盖的轨道上行驶时速度
//   +100%/座、可叠加（两座 = 3×、三座 = 4×，无上限），离开覆盖格立即回落（无尾巴）。
//   v1.8t~v1.8u 三令的「跨格触发独立实例 buff（每层 20%、上限 3 层、1.5s 尾巴）」
//   整机制退役（gasBuffs / updateGasBuffs / gasBuffSum / GAS_BUFF_* 一并拆除）。
ENG.trainSpeedMul = function () {
  var cell = GS.railCell(GS.train.index);
  if (!cell) return 1;
  return 1 + GS.gasCoverAt(cell.c, cell.r);   // 每座 +1（=+100%），求和非连乘
};

// 列车速度系数（v1.6.23 大王拍板；v1.8u 十二令改回初版查询式，§14.81）：
//   · **全程生效**（v1.8u 十五令 §14.86 改版）：boost 短路退役——奖励时间/dusk 收尾
//     的加速改由全局时间快进承担（dtFast = dt×(1+boost)，见 ENG.update），boost 不再
//     进速度系数；加油站与快进自然相乘（峰值 4× 快进 × 3× 双座 = 12× 体感）；
//   · 平时 → 系数 = 1 + 覆盖**车头所在格**的加油站座数（每座 +100%、求和非连乘、
//     无上限）——查询式即时生效/即时回落，无尾巴。实现见上方 ENG.trainSpeedMul。

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
  // ① 一次交付 = 一次播报：清掉上一圈的**交付行**（gold/heal）残留，防混读；
  //    v1.8s 起战斗伤害/击杀飘字（dmg/kill）与交付不同源，保留不清（战斗是持续事件，
  //    交付是整圈一次，互不干扰——列车到站瞬间正打的伤害数字不被抹掉）。
  if (!GS.floats) GS.floats = [];
  var keepD = [];
  for (var i = 0; i < GS.floats.length; i++) {
    var fk = GS.floats[i].kind;
    if (fk !== 'gold' && fk !== 'heal') keepD.push(GS.floats[i]);
  }
  GS.floats = keepD;
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

// ---- 伤害/击杀飘字（v1.8s 大王令 C，特效盘点清单销账）---------------------------
//   口径：
//   · 只飘「整段直接命中」：applyHits 主命中（车厢/冰环/火炮溅射）+ 车头撞击/塔式
//     —— a5 箭雨、DoT（火区每帧微量）、a4 影锁传递、m3 溢出等旁路伤**不飘**（防糊屏）；
//   · 数值 = hd（易伤乘区叠加后的**实扣血量**，玩家看到的即真实掉血）；
//   · 击杀金色：本段伤害把怪打到 hp≤0（首次击穿，preHp>0）⇒ kind 'kill'（金、放大）；
//     否则 'dmg'（白）。已死怪的补刀不报击杀（preHp≤0）；
//   · 同怪节流：f.dmgFloatT 冷却内的新命中不飘（机枪 0.4s/发 + 多节同帧齐射时只留
//     首条，避免数字叠成一片）；**击杀无视节流必报**（死亡瞬间必须给玩家反馈）；
//   · 锚点 = 命中瞬间怪的像素位（LAY 换算，上移 14px 让出怪本体）；纯逻辑沙箱
//     （无 LAY）不生成——与交付飘字同一退化口径。
ENG.DMG_FLOAT_TTL = 0.75;    // 比交付飘字（1.15s）短：战斗高频，长寿命会叠成一片
ENG.DMG_FLOAT_CD = 0.3;      // 同怪节流冷却（秒）
ENG.dmgFloat = function (f, hd, killed) {
  if (!(typeof LAY !== 'undefined' && LAY)) return;    // 纯逻辑沙箱 / 无布局：跳过
  if (!killed && (f.dmgFloatT || 0) > 0) return;       // 节流：冷却中不飘（击杀必报）
  f.dmgFloatT = ENG.DMG_FLOAT_CD;
  if (!GS.floats) GS.floats = [];
  GS.floats.push({
    kind: killed ? 'kill' : 'dmg',
    text: String(Math.max(1, Math.round(hd))),
    x: CFG.ccx(LAY, f.c),
    y: CFG.ccy(LAY, f.r) - 14,
    t: 0, ttl: ENG.DMG_FLOAT_TTL
  });
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

// 车头行进方向 / 像素坐标：**同源走 ENG.railPoint（圆角路径）**，与车厢、资源堆一致。
//   v1.8f 前直取"当前轨段方向 / 格心线性插值"⇒ 拐角瞬间 90° 跳变（见 railPoint 头注释）。
ENG.trainAngle = function () {
  var pt = ENG.railPoint(GS.train.index + GS.train.frac);
  return pt ? pt.ang : 0;
};
ENG.trainPos = function () {
  var pt = ENG.railPoint(GS.train.index + GS.train.frac);
  if (!pt) return { x: 0, y: 0 };
  return { x: CFG.ccx(LAY, pt.c), y: CFG.ccy(LAY, pt.r) };
};
