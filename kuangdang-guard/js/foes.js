// ============================================================================
// 怪物模块（v1.3-rc 临时迭代）—— 近战 · 无视地形直线冲 · 波次制
//
// 大王拍板（2026-09-28，规格 §13）：
//   · 近战怪**无视地形直线冲**向镇中心（不走铁轨），贴近后近战攻击镇中心；
//   · **一波 = 一个夜晚**：「发车」= 开波（白天施工 → 夜晚刷怪 + 列车照常跑圈）；
//   · 杀完所有怪进入下一波（触发 CLOCK.onCleared → dusk 收尾 → 白天）；
//   · 镇中心血量跨波**继承不重置**；归零 = 挑战失败（GS.gameOver + 重开）。
//
// v1.3.3（2026-09-29）刷怪位置偏置：**铁轨离哪段边缘近，怪就更偏向从那段来**。
//   · 只偏**位置**、不动数量公式 —— 数量/血量/速度已随波次成长，"位置偏置"是
//     "发展方向 = 引怪方向"的策略层，两件事混在一起就没法单独调了；
//   · 落法：每只怪抽 SPAWN.CANDS 个边缘候选点，按 w = BASE + BOOST·max(0, R_MAX−d)/R_MAX
//     （d = 候选点到最近轨格的欧氏距离）加权择一 —— 不直接取最近点，保留随机性，
//     不然每只怪都从同一个点出，站位与预判全变味；
//   · 设计推理：往哪边铺轨收金币 = 主动引怪到哪边，而那条直冲走廊恰好穿过
//     你的塔区（塔有输出）—— 自洽的风险回报。BASE 保底让远边照常出怪，
//     玩家不能把某条边完全锁死；前期铁轨小而居中（距边 3~4 格）偏置天然弱，
//     随外扩自然增强，正好贴合难度曲线。想前期更明显 → 调大 BOOST / R_MAX。
//
// 与 v0.9.2 昼夜骨架的接线（clock.js 逻辑零改动，用的就是预留桩）：
//   · FOES.update 每帧维护 CLOCK.hasFoes（= 场上还有活怪）；
//   · 怪全灭 → CLOCK.onCleared()（倒计时内清空 → 立即 dusk；超时 overtime → 此时 dusk）；
//   · 开波由 engine.js 的 ENG.startNight 调 FOES.startWave()。
//
// 怪坐标：**浮点格坐标**（f.c/f.r 可以是小数），渲染时换算像素。移动 = 每帧
// 朝镇中心方向推进 speed*dt（无视地形 = 不查 grid，直线就是直线）。
//
// 依赖：GS / CFG。运行时引用 CLOCK（typeof 守卫，test 沙箱可只载部分模块）。
// ============================================================================
window.FOES = {};

FOES.CFG = {
  // 镇中心血量放 CFG.CORE_HP（config/map.js）—— state.js 加载序在 foes.js 之前，
  // newGame 初始化 coreHP 时 FOES 还不存在，不能引用这里。
  atkGap: 1.0,          // 怪攻击间隔秒
  dmg: 1,               // 怪单次攻击伤害（v1.6.14 大王令：2→1；沿革：v1.4.15 方案乙 3→2）
  REACH: 1.01,          // 贴近判定：怪中心距核心中心 ≤1.01 格 = 停下开打（相邻格）
  // 波次成长公式（wave 从 1 起）—— 调优只动这里
  //   ⚠️ v1.3.2（2026-09-29 大王令）：移速整体减半（原 0.7+0.05w 封顶 1.4）
  //   ⚠️ v1.4.13（2026-10-08 大王令）：数量提升 + 单怪血量减少 + 节奏刷怪——
  //       压力来自"怪多而碎、间隔进场"的节奏，而非单只肉度。
  //   ⚠️ v1.4.14/v1.4.18（2026-10-08 大王令）：hp 与车头攻击的相对口径——
  //       w1 恒一刀（hp(1) ≤ 车头 12）、w2 起恒两刀（2×(8+4w) 恒 > hp）。
  //       【v1.6.77 大王令改锚点】车头伤害 = 8+4×**建筑数**（不再随波次）⇒
  //       上两刀口径从恒等式变**条件式**（建筑数 ≈ 波次时成立；见规格 §14.53）。
  //       本文件 hp 公式本身不动。
  //   ⚠️ v1.6.14（2026-10-10 大王令五连）：①数量**再**翻倍（12+6w→24+12w）
  //       ②成批刷（BURST=3 只/批，批间隔 = 逐只 gap×3，平均速率守恒、瞬时脉冲）
  //       ③hp 更陡（斜率 6→8；起点 6→4 反向回调，保"w1 一刀"口径不变：
  //         hp(1)=12=车头一刀、hp(2)=20∈(16,32] 两刀、hp(10)=84≤96 两刀）
  //       ④移速降一点（封顶 0.7→0.6，起点 0.35→0.28，斜率 0.025→0.02）
  //   ⑤dmg 2→1（泄漏怪单次威胁减半，与数量翻倍对冲）
  //   ⚠️ v1.8z（2026-10-21 大王令「难度太低，血量上调」）：hp 8w → **12w−4**——
  //      斜率 +50%（w1=8 仍被车头开局 8 伤一刀收掉，保住「w1 一刀」口径；
  //      w2=20 与旧 4+8w 同值，w10=116（原 80），第 10 波总血量 4960→7192）。
  //      ⚠️ 不能直接用 12w：车头开局伤害是 8（4+(0+2)²），12w 会让第 1 波变两刀。
  //   ⚠️ v1.8ac（2026-10-21 大王令「提升数量和生命的增幅」）：数量与血量**双双抬增幅**——
  //      数量 8+6(w−1) → 8+7(w−1)（每波 +7）；血量 12w−4 → **8+14(w−1)+(w−1)²**
  //      （线性斜率 12→14 + 二次项，w10 单怪 116→215、第 10 波总血 7192→15265 ≈2.1×）；
  //      w1 仍 8 血（车头开局一刀口径不变）。依据：10 波通关记录 coreHit=0、
  //      coreHP 全程 100、每波时长 9~12s 无增长 ⇒ 纯线性追不上玩家 DPS 膨胀。
  count: function (w) { return Math.round((8 + 7 * (w - 1)) * FOES.levelMul('count')); }, // 怪数量（v1.8ac：6→7/波；v1.8ad：关卡模式乘 LEVELS[i].diff.count；w1=8、w10=71 为 L1 基准）
  hp:    function (w) { var k = w - 1; return Math.max(1, Math.round((8 + 14 * k + k * k) * FOES.levelMul('hp'))); }, // 单怪血量（v1.8ac 基准 w1=8、w10=215；v1.8ad 乘关卡系数，L2~L5 首波 >8 属预期）
  speed: function (w) { return 0.3; },                            // 格/秒（v1.6.59 大王令"提速拉开分散"：0.2→0.3 +50%——批间距=速度×批间隔3s 由 0.6→0.9 格、±8% 抖动绝对差同步 +50%，怪才分得开；仍恒定不随 wave 增长（v1.6.19 大王令保持）；沿革 v1.6.19~58 恒 0.2、v1.6.18 曾 0.2+0.01w、v1.6.17 曾 0.22+0.015w、v1.6.14 曾 0.28+0.02w、v1.3.2 曾整体减半）
  gap:   function (w) { return Math.max(0.8, 1.6 - 0.1 * (w - 1)); }, // 逐只间隔秒（v1.6.16 起无消费者，留作历史参数与批数推导参考）
  // v1.6.16（大王令"固定批数和时间"）+ v1.6.20（大王令"缩短至 15s 或以内"）：
  //   **批数与批间隔全部定常**——每波恒 BURSTS 批、批间隔恒 BURST_GAP ⇒
  //   总刷怪时长 = (BURSTS-1)×BURST_GAP = 15s（≤15s 达标，与 wave 无关）；
  //   每批数量 = ceil(count/BURSTS) 随波次增长（w1 每批 2 只 → w10 每批 11 只），
  //   压力全压在"批更挤"上。v1.8u 十一令起 count=6w+2 不再恒被 6 整除 ⇒ 实际放批数
  //   随 count 收缩（尾批由 min(·, pending) 收口，下方防御分支转正）。
  BURSTS: 6,                                           // 每波固定批数
  BURST_GAP: 3.0,                                      // 固定批间隔秒（总时长 5×3.0 = 15s；沿革 v1.6.16 曾 3.6=18s）
  // 刷怪位置偏置（v1.3.3，见文件头）—— 调优只动这里
  SPAWN: {
    CANDS: 12,   // 每只怪抽几个边缘候选点加权择一
    R_MAX: 6,    // 候选点距最近轨格 ≥ R_MAX 格 → 只剩基准权重
    BASE: 1,     // 基准权重（均匀保底：远处边缘照常出怪，玩家不能完全锁边）
    BOOST: 2,    // 0 距离时的加成上限（线性衰减到 R_MAX 处归零）—— 想偏得更狠调大它
    OUT: 2,      // 出生点距地图边缘的格数（v1.6.49 大王令"刷怪的位置再远一点"：
                 //   0.5 → 2 格；怪直线冲镇中心无视地形 ⇒ 外推天然安全；夜晚 cell 28
                 //   下 2 格 = 56px，出生点仍在画布内的荒野深处可见）
    JITTER: 0.4  // 出生切向抖动（v1.6.55 之 C，大王令"怪物有重叠"）：同点怪沿切向
                 //   ±0.4 格错开 ⇒ 源头不同线（速度 ±8% 抖动已随 v1.6.60 退役）
  },
  // 软分离（v1.6.55 之 A，大王令"怪物有重叠…是否需要碰撞体积"⇒ 用柔推不用硬碰撞）：
  SEP: 0.55,         // 分离半径（格）：怪对距离 < 此值时柔推（渲染怪半径 0.3 格，
                     //   留一点贴脸感不散成沙）
  SEP_PUSH: 0.35     // 每帧修正比例：各退 overlap×0.35/2 —— 柔和收敛不弹开
};

FOES.wave = 0;        // 已完成的波次号（startWave 后 = 当前正在打的波）
FOES.active = false;  // 本波是否进行中（防止 dusk/白天残留怪被误判）
FOES.pending = 0;     // v1.4.13 节奏刷怪：本波还没放出来的怪数（startWave 置、update 消化）
FOES.spawnCd = 0;     // 距下一次放怪的倒计时秒

// ---- 关卡难度系数（v1.8ad · 规格 §14.97 / 待办「方案三」）---------------------
//   只缩放**敌人两系数**（count / hp），关卡模式读 LEVELS[GS.levelIdx].diff[key]：
//   L1 = 1.00 基准（当前标准难度）、L2~L5 逐关递增；随机模式 / 未开局 / 表缺项恒 1。
//   移速、波数、镇中心血量、每波时长、WAVE_EXP、开局金币 30 一律不参与难度。
//   ⚠️ 守卫全部用 typeof：精简沙箱（只载 state/foes 的测试）里 GS/LEVELS 可能不存在。
FOES.levelMul = function (key) {
  if (typeof GS === 'undefined' || GS.mode !== 'level') return 1;
  if (typeof LEVELS === 'undefined') return 1;
  var lv = LEVELS[GS.levelIdx];
  if (!lv || !lv.diff || lv.diff[key] == null) return 1;
  return (typeof lv.diff[key] === 'number' && lv.diff[key] > 0) ? lv.diff[key] : 1;
};

// ---- 刷怪落点（v1.3.3 加权偏置 → v1.6.50 固定刷怪点，大王令）-----------------
// 边缘随机点：四边等概率、沿边均匀取点（含角），出生在地图外 OUT 格（v1.6.49
//   大王令"刷怪的位置再远一点"：0.5 → SPAWN.OUT=2 —— 怪从荒野深处走进来）。
FOES.randEdgePoint = function () {
  var out = FOES.CFG.SPAWN.OUT;
  var side = Math.floor(Math.random() * 4);
  var t = Math.random() * (side < 2 ? CFG.MAP_COLS : CFG.MAP_ROWS);
  if (side === 0) return { c: t, r: -out };
  if (side === 1) return { c: t, r: CFG.MAP_ROWS - 1 + out };
  if (side === 2) return { c: -out, r: t };
  return { c: CFG.MAP_COLS - 1 + out, r: t };
};

// ---- 固定刷怪点（v1.6.50 大王令）---------------------------------------------
// 每波抽定 N 个固定点位，本波所有怪只从这些点出：
//   · N = min(8, max(3, round(每批数量/3)))——v1.6.62 大王拍板 B 案：点位跟着
//     每批数量走，**恒保持每点每批 ≈3 只**（团密度不随波次涨，治批团纵深吃掉
//     批间隙）；3 起保底、8 封顶。沿革：v1.6.50 min(2+⌊(w-1)/2⌋,5)（2→5 递增）
//     → v1.6.56 min(3+⌊(w-1)/2⌋,6)（3 起 6 封顶）；
//   · 位置 = 地图外 OUT 格的边缘线上**均匀随机**（无偏置），每波重抽；
//   · 点间距 ≥ 3 格（2a）、与上一波点位距离 ≥ 2 格（3a 避重）；
//   · 波内怪数均分到各点（余数随机补）⇒ 预警 ×数量与实际严格守恒。
// 数据流：prepareNext() 生成 GS.nextSpawns（白天布阵预警画它）→ startWave 接管为
//   waveSpawns + 洗牌出怪队列 spawnQueue → spawnOne 依序弹出。
FOES.nextPointCount = function (wave) {
  // v1.6.62 大王令（B 案落地）：每批数量/3 = 每点每批 ≈3 只；w1=3（3 起不变）、
  // w4=4、w7=6、w10=8（首次封顶）、w11+ 恒 8。
  return Math.min(8, Math.max(3, Math.round(FOES.CFG.count(wave) / FOES.CFG.BURSTS / 3)));
};
FOES.genSpawns = function (wave, prev) {
  var n = FOES.nextPointCount(wave);
  var pts = [], guard = 0;
  while (pts.length < n && guard++ < 200) {
    var p = FOES.randEdgePoint();
    var ok = true, i;
    for (i = 0; i < pts.length; i++) {                       // 2a：点间 ≥ 3 格
      if (Math.hypot(p.c - pts[i].c, p.r - pts[i].r) < 3) { ok = false; break; }
    }
    if (ok && prev) for (i = 0; i < prev.length; i++) {      // 3a：避上波 ≥ 2 格
      if (Math.hypot(p.c - prev[i].c, p.r - prev[i].r) < 2) { ok = false; break; }
    }
    if (ok) pts.push({ c: p.c, r: p.r, count: 0 });
  }
  while (pts.length < n) {                                   // 兜底：放宽约束补齐（边缘周长 44 格，理论不触发）
    var q = FOES.randEdgePoint();
    pts.push({ c: q.c, r: q.r, count: 0 });
  }
  var total = FOES.CFG.count(wave), base = Math.floor(total / n), rem = total - base * n;
  var order = pts.slice();
  for (var sh = order.length - 1; sh > 0; sh--) {            // 余数随机分给谁：洗牌定
    var rr = Math.floor(Math.random() * (sh + 1));
    var tmp = order[sh]; order[sh] = order[rr]; order[rr] = tmp;
  }
  for (var k = 0; k < order.length; k++) order[k].count = base + (k < rem ? 1 : 0);
  return pts;
};
// 生成下一波点位（newGame / 波次结束时调）：wave+1 波、避开 lastSpawns
FOES.prepareNext = function () {
  GS.nextSpawns = FOES.genSpawns(FOES.wave + 1, FOES.lastSpawns);
};

// ---- 放一只怪（v1.4.13 从 startWave 抽出：节奏刷怪每只单独放）----------------
// 落点（v1.6.50 固定刷怪点）：从洗牌出怪队列依序弹出 —— 各点出怪数与白天预警
//   ×数量严格守恒；队列异常为空时兜底随机边缘点（不中断刷怪）。
FOES.spawnOne = function () {
  var p = (FOES.spawnQueue && FOES.spawnQueue.length)
    ? FOES.spawnQueue.shift() : FOES.randEdgePoint();
  var hp = FOES.CFG.hp(FOES.wave);
  var f = { c: p.c, r: p.r };
  // v1.6.55 之 C（大王令"怪物有重叠"）：出生抖动 —— 沿"指向镇心"的切向 ±JITTER
  //   格错开 ⇒ 同点同批怪不同线，配合软分离散开（源头治理）。
  // v1.6.60（大王令"把速度抖动干掉"）：**批内抱团获准**（2026-10-15 需求重述：
  //   批次之间要拉开、批内允许连着），±8% 随机速度（原 f.speedMul = 0.92+rand*0.16）
  //   失去存在意义，只剩"批次拖尾糊开"副作用——拖尾量 ∝ 路程与速度无关，会把
  //   批间距（0.3 格/s × 3s = 0.9 格）吃掉。速度恒 1，属性保留，update 消费处
  //   (f.speedMul || 1) 不动。
  var jdx = GS.core.c - p.c, jdy = GS.core.r - p.r;
  var jl = Math.sqrt(jdx * jdx + jdy * jdy) || 1;
  var off = (Math.random() - 0.5) * 2 * (FOES.CFG.SPAWN.JITTER || 0.4);
  f.c += -jdy / jl * off;
  f.r += jdx / jl * off;
  f.speedMul = 1;       // v1.6.60：恒 1（±8% 抖动退役，沿革见上）
  f.hp = hp; f.maxHp = hp;
  f.speed = FOES.CFG.speed(FOES.wave);
  f.cd = 0;             // 攻击冷却
  // 车厢特效状态计时（v1.4 起：engine 挂 / 这里衰减）。v1.6.34 词条扩容：
  //   slow 普通减速(×0.7) / slowHard 钉刺强减速(×0.15) / freeze 冻结(×0.1)
  //   / mine 地雷减速(×0.3) / zoneSlow 霜痕地带(×0.6，由 i3 霜痕给)
  f.slow = 0;   // burn/poison 计时字段随 v1.8k DoT 退役（塔型特效只剩 slow）
  f.slowHard = 0; f.freeze = 0; f.mine = 0; f.zoneSlow = 0;
  // 易伤双槽（v1.8o 拆分，规格 §14.76）：a3 撕裂 → vulnA 层数 / vulnAT 计时（3s 衰减）；
  //   m2 融穿 → vulnM 层数（永久到该怪死亡）。旧版共用 vuln/vulnPct 时两词条互踩。
  f.vulnA = 0; f.vulnAT = 0; f.vulnM = 0;
  f.overkill = 0; f.overkillSrc = null;   // 过量击杀快照（v1.8p m3）：击穿帧由 ENG._snapOverkill 写入（v1.8q 带来源塔型）
  // 影锁（a4）：lock 指向被链的另一只怪，lockT 剩余秒
  f.lock = null; f.lockT = 0;
  f.bumpCd = 0;         // 被车头撞击的独立冷却（v1.3.1，engine.js 用）
  f.hitFlash = 0;       // 被塔打中的闪白（renderer 用）
  f.dmgFloatT = 0;      // 伤害飘字节流冷却（v1.8s，engine.dmgFloat 用）
  GS.foes.push(f);
};

// ---- 开波（一波 = 一个夜晚；ENG.startNight 调）-------------------------------
// v1.4.13 节奏刷怪（大王令）：不再一波全涌出，pending 队列按间隔放。
// v1.6.16（大王令）：**固定批数 + 固定时长**——首放一批（ceil(count/BURSTS) 只）立即
//   进场，剩下的进 pending 队列每 BURST_GAP 秒放一批；总刷怪时长恒
//   (BURSTS-1)×BURST_GAP = 15s（v1.6.20 由 18s 压至 15s），与 wave 无关。波次结束
//   判定（update 尾）必须等 pending 清零且场上无怪，防"怪还没刷完就开白天"。
FOES.startWave = function () {
  FOES.wave += 1;
  FOES.active = true;
  // v1.6.50 固定刷怪点：接管本波点位（白天预警就是它）+ 构建洗牌出怪队列 ——
  //   队列长度 = 总怪数、各点占比 = 预警 ×数量 ⇒ 严格守恒；洗牌让各点交替出怪不扎堆。
  FOES.waveSpawns = (GS.nextSpawns && GS.nextSpawns.length)
    ? GS.nextSpawns : FOES.genSpawns(FOES.wave, FOES.lastSpawns);   // 兜底：旧存档/测试无 nextSpawns
  FOES.lastSpawns = FOES.waveSpawns;
  GS.nextSpawns = null;
  FOES.fadeSpawns = { pts: FOES.waveSpawns, t: 1 };                 // 4a：开波后标记淡出 1s
  FOES.spawnQueue = [];
  for (var pi = 0; pi < FOES.waveSpawns.length; pi++)
    for (var k = 0; k < FOES.waveSpawns[pi].count; k++) FOES.spawnQueue.push(FOES.waveSpawns[pi]);
  for (var sh = FOES.spawnQueue.length - 1; sh > 0; sh--) {         // Fisher-Yates 洗牌
    var sr = Math.floor(Math.random() * (sh + 1));
    var st = FOES.spawnQueue[sh]; FOES.spawnQueue[sh] = FOES.spawnQueue[sr]; FOES.spawnQueue[sr] = st;
  }
  var per = Math.ceil(FOES.CFG.count(FOES.wave) / FOES.CFG.BURSTS);  // 每批 = ceil(count/6)（v1.8u 十一令起 count=6w+2 不恒整除，尾批靠 min 收口）
  var first = Math.min(per, FOES.CFG.count(FOES.wave));
  for (var bi = 0; bi < first; bi++) FOES.spawnOne();     // 首批立即进场
  FOES.pending = Math.max(0, FOES.CFG.count(FOES.wave) - first);
  FOES.spawnCd = FOES.CFG.BURST_GAP;                      // 之后每 BURST_GAP(3.0)s 放一批
  return FOES.wave;
};

// ---- 每帧（engine.js 调）------------------------------------------------------
FOES.update = function (dt) {
  if (typeof CLOCK !== 'undefined') {
    // hasFoes 桩接线（v0.9.2 预留口）：夜里还有活怪**或还有怪没放完** = 真
    //   （v1.4.13：pending 不算完，波次就不算结束，夜晚不能提前收）
    CLOCK.hasFoes = FOES.active && (GS.foes.length > 0 || FOES.pending > 0);
  }
  if (GS.gameOver) return;
  // 开波标记淡出（v1.6.50 4a）：fadeSpawns.t 随模拟推进到 0 移除 —— 渲染层按 t 画淡出
  if (FOES.fadeSpawns) {
    FOES.fadeSpawns.t -= dt;
    if (FOES.fadeSpawns.t <= 0) FOES.fadeSpawns = null;
  }
  // 节奏刷怪（v1.4.13 逐只 → v1.6.14 成批 → v1.6.16 固定批数+固定时长）：
  //   pending > 0 时倒计时，到点放一批（= ceil(count/BURSTS)，尾批由 pending 收口）。
  //   必须排在下方 `!GS.foes.length 早退` 之前 —— 队列消化期间场上可能空无一只。
  if (FOES.active && FOES.pending > 0) {
    FOES.spawnCd -= dt;
    if (FOES.spawnCd <= 0) {
      var bn = Math.min(Math.ceil(FOES.CFG.count(FOES.wave) / FOES.CFG.BURSTS), FOES.pending);
      for (var bi2 = 0; bi2 < bn; bi2++) FOES.spawnOne();
      FOES.pending -= bn;
      // 带上 dt 溢出（此刻为负）→ 放批周期严格 = BURST_GAP，不随帧率漂移
      FOES.spawnCd = FOES.CFG.BURST_GAP + FOES.spawnCd;
    }
  }
  if (!FOES.active) return;
  // 波次清空（场上无怪**且**队列已放完）→ 交回昼夜骨架（倒计时内清空 → 立即收尾；
  // overtime → 此时收尾）。⚠️ 必须在 `!GS.foes.length` 早退**之前**判——杀光最后一
  // 只的那一帧之后，场上可能已经空了，靠这早退就永远走不到结束判定。
  if (!GS.foes.length) {
    if (!FOES.pending) {
      FOES.active = false;
      // v1.8z 清场加时（大王令）：倒计时内清完一波 → 奖励时间 +5s（每波最多一次），
      //   返回值 = 本次加时秒数；onCleared 内部守卫 overtime / 已结算。
      var clearBonus = (typeof CLOCK !== 'undefined' && CLOCK.onCleared) ? CLOCK.onCleared() : 0;
      if (clearBonus > 0 && typeof GS.emitTimeBonus === 'function') GS.emitTimeBonus(clearBonus);
      if (typeof FOES.prepareNext === 'function') FOES.prepareNext();  // v1.6.50：白天预警就绪
    }
    return;                                // 队列还有：等下一只放出来再演
  }
  var core = GS.core;
  for (var i = GS.foes.length - 1; i >= 0; i--) {
    var f = GS.foes[i];
    if (f.hitFlash > 0) f.hitFlash -= dt;
    if (f.dmgFloatT > 0) f.dmgFloatT -= dt;   // 伤害飘字节流冷却（v1.8s）
    // 击退滑动演出衰减（v1.6.74，规格 §14.50）：_knockback 挂的 kbAnim 走完即清。
    //   ⚠️ 纯表现：逻辑坐标已在 _knockback 里立即落到目标，这里只推动画进度，
    //   renderer.js 读它画插值偏移。死亡清尸无需处理（怪没了动画自然消失）。
    if (f.kbAnim) { f.kbAnim.t += dt; if (f.kbAnim.t >= f.kbAnim.dur) f.kbAnim = null; }
    // 车厢特效状态衰减（v1.4，规格 §14.2；v1.6.34 词条扩容）：slow 系计时。
    //   ⚠️ burn/poison DoT（3/2 hp·s）随 v1.8k 退役——塔型特效只剩 slow，唯二挂点已清
    //   （c4 烈焰燃油是地带直伤，不依赖 DoT，保留）。
    if (f.slow > 0) f.slow -= dt;
    if (f.slowHard > 0) f.slowHard -= dt;
    if (f.freeze > 0) f.freeze -= dt;
    if (f.stun > 0) f.stun -= dt;   // v1.6.80 撞击定身（§14.56）：顿敌方单位不顿游戏
    if (f.mine > 0) f.mine -= dt;
    if (f.zoneSlow > 0) f.zoneSlow -= dt;
    if (f.vulnAT > 0) { f.vulnAT -= dt; if (f.vulnAT <= 0) f.vulnA = 0; }   // a3 易伤超时清层；m2 vulnM 永久不衰减（v1.8o）
    if (f.lockT > 0) { f.lockT -= dt; if (f.lockT <= 0) f.lock = null; }
    // 塔的伤害结算后 hp<=0 → 死亡移除（塔/车头模块只扣血不删怪，尸体在这里清）
    if (f.hp <= 0) {
      GS.foes.splice(i, 1);
      if (typeof EXP !== 'undefined') EXP.add(EXP.killGain());      // v1.8u 四拍板 §14.83：波次均分（波总额/本波怪数）；旧「击杀 +1」退役
      if (typeof ENG !== 'undefined') ENG.onFoeDeath(f, FOES.wave); // v1.6.34：m3 能量溢出
      continue;
    }
    var dx = core.c - f.c, dy = core.r - f.r;
    var dist = Math.sqrt(dx * dx + dy * dy);
    // v1.6.80 撞击定身（§14.56）：stun 期间停走停打（状态照常衰减）——
    //   被撞的怪懵 0.09s 再继续，列车/其余怪不受影响。
    if (f.stun > 0) continue;
    if (dist > FOES.CFG.REACH) {
      // 直线冲：无视地形（拍板 ②），不做任何 grid 查询。
      //   减速取**最强的那一条**（不连乘，防多状态叠到零速）：
      //     冻结 ×0.1 > 钉刺 ×0.15 > 地雷 ×0.3 > 霜痕 ×0.6 > 普通减速 ×0.7
      var mul = 1;
      if (f.freeze > 0) mul = Math.min(mul, 0.1);
      if (f.slowHard > 0) mul = Math.min(mul, 0.15);
      if (f.mine > 0) mul = Math.min(mul, 0.3);
      if (f.zoneSlow > 0) mul = Math.min(mul, 0.6);
      if (f.slow > 0) mul = Math.min(mul, 0.7);
      var spd = f.speed * mul * (f.speedMul || 1);   // v1.6.60：speedMul 恒 1（±8% 抖动退役）
      f.c += dx / dist * spd * dt;
      f.r += dy / dist * spd * dt;
    } else {
      // 贴身近战：站桩输出镇中心
      f.cd -= dt;
      if (f.cd <= 0) {
        f.cd = FOES.CFG.atkGap;
        GS.coreHP -= FOES.CFG.dmg;
        f.atkFlash = 0.2;                      // 攻击动作提示（renderer 用）
        // 行为记录（v1.3.5 战斗类）：每次受伤后的城防血量
        if (typeof LOG !== 'undefined') LOG.add('coreHit', { hp: GS.coreHP });
        if (GS.coreHP <= 0) {
          GS.coreHP = 0;
          GS.gameOver = true;                  // 挑战失败（规格 §13.1 第 5 条）
          if (typeof LOG !== 'undefined') LOG.add('gameOver', { wave: FOES.wave });
          return;                              // 直接停：局面已定
        }
      }
    }
  }
  // 软分离（v1.6.55 之 A）：怪间重叠柔推散开 —— 位置微调不改速度语义
  if (typeof FOES.separate === 'function') FOES.separate();
};

// ---- 软分离（v1.6.55 之 A，大王令"怪物有重叠…是否需要碰撞体积"⇒ 柔推不用硬碰撞）--
// 每帧对距离 < SEP 的怪对沿连线各退 overlap×PUSH/2（位置微调、柔和收敛不弹开）。
// 贴身站桩的怪同样参与 ⇒ 自然围核心散成一圈。空间网格分桶（1 格桶 + 3×3 邻域）
// 防 O(n²)：后期波 144 只时每帧仅几百对检测。
FOES.separate = function () {
  var foes = GS.foes, SEP = FOES.CFG.SEP, PUSH = FOES.CFG.SEP_PUSH;
  if (foes.length < 2) return;
  var grid = {};
  for (var i = 0; i < foes.length; i++) {
    foes[i]._idx = i;                                        // 帧内下标（对去重用）
    var key = Math.floor(foes[i].c) + ',' + Math.floor(foes[i].r);
    (grid[key] || (grid[key] = [])).push(foes[i]);
  }
  for (var ci = 0; ci < foes.length; ci++) {
    var a = foes[ci];
    var ac = Math.floor(a.c), ar = Math.floor(a.r);
    for (var gx = ac - 1; gx <= ac + 1; gx++) for (var gy = ar - 1; gy <= ar + 1; gy++) {
      var bucket = grid[gx + ',' + gy];
      if (!bucket) continue;
      for (var k = 0; k < bucket.length; k++) {
        var b = bucket[k];
        if (b._idx <= ci) continue;                          // 每对只处理一次
        var dx = b.c - a.c, dy = b.r - a.r;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d >= SEP) continue;
        if (d < 1e-4) { dx = 1; dy = 0; d = 1; }             // 完全重合：固定向右推
        var push = (SEP - d) * PUSH / 2;                     // 各退一半
        var ux = dx / d, uy = dy / d;
        a.c -= ux * push; a.r -= uy * push;
        b.c += ux * push; b.r += uy * push;
      }
    }
  }
};

// ---- 重开清场（ENG.init / 失败重开时调）--------------------------------------
FOES.reset = function () {
  GS.foes = [];
  FOES.wave = 0;
  FOES.active = false;
  FOES.pending = 0;                     // v1.4.13：队列一并清
  FOES.spawnCd = 0;
  FOES.waveSpawns = null; FOES.lastSpawns = null; FOES.fadeSpawns = null;  // v1.6.50
  FOES.spawnQueue = [];
  if (typeof FOES.prepareNext === 'function') FOES.prepareNext();  // 重开即抽第 1 波点位（白天预警用）
  if (typeof CLOCK !== 'undefined') CLOCK.hasFoes = false;
};
