// 引导脚本：布局、初始化、缩放适配、主循环
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  canvas.width = CFG.CANVAS_W;
  // v1.6.38 作战拉远：画布物理上 = HUD 以下**全部**（792），不再只 560 ——
  //   白天被 footer（absolute，v1.6.40 起 148px）盖住下部；夜晚 footer 淡出
  //   （CSS opacity .5s）⇒ 全画布可见，LAY 切 battleLayout（CAM 插值平滑过渡）。
  canvas.height = CFG.battleFieldH();

  // 全局地图布局（各模块共用）
  window.LAY = CFG.layout();

  ENG.init();
  UI.init(canvas);
  UI.resize();
  UI.tick();

  // v1.6.39 作战拉远·平滑过渡（大王令"不要生硬地切"）：
  //   CAM.t = 镜头进度（0=白天建设视角，1=夜晚拉远视角），昼夜相位翻转后每帧
  //   向目标推进，CAM.e = smoothstep(t) 为插值系数；LAY = 两套布局的逐项插值
  //   （cell/x/y/w/h 同步动画 ⇒ 格子是**真缩小**，不是瞬间跳变）。
  //   渲染荒野暗角（REND.wilderness）与横幅淡入淡出都吃 CAM ⇒ 一处驱动全局跟随。
  //   ▍v1.6.76 boost 镜头推进（大王令"加速时镜头随时间轻微靠近，停车恢复"）：
  //     CAM.zoom = 当前缩放（1=原样）；v1.6.86 起 = 固定初速 + 动态衰减率 k 的指数
  //     减速曲线（k 由"剩余时间 T 内恰好走完幅度 A"反解），状态在 CAM.zDir/zt/
  //     zA/zT/zFrom/zk（rawDt 真实时间，与 CAM_DUR 同口径，不受倍速影响）。
  window.CAM = { t: 0, e: 0, target: 0, zoom: 1, zDir: 0, zt: 0, zA: 0, zT: 0, zFrom: 1, zk: 0, zEff0: 0 };
  var CAM_DUR = 0.55;                       // 过渡时长（秒，真实时间不受倍速影响）
  var ZOOM_V0 = 0.12;                       // v1.6.87 镜头拉近固定起步速度（缩放/秒；大王旋钮）
                                            //   ▍v1.6.86 为 0.03；v1.6.87 随幅度 0.06→0.25 等比放大
                                            //   （0.03×0.25/0.06≈0.125 取 0.12）——保持大王认可的
                                            //   曲线形状（r、k 不变），只整体提速 4 倍。
  function camEase(x) { return x * x * (3 - 2 * x); }   // smoothstep：两端减速、中段最快
  // v1.6.86：给定幅度 A 与时长 T，反解指数衰减率 k，使固定初速 ZOOM_V0 恰好走完 A：
  //   ∫ZOOM_V0·e^(−kt)dt = A。令 u=kT、r=A/(ZOOM_V0·T)，解 1−e^(−u) = r·u（超越方程
  //   无闭式解 → 二分求根 40 轮，精度充足）。r≥1 ⇒ 恒速都不够走 ⇒ k=0（超时继续
  //   恒速走完兜底）。仅在 boost 升/降沿调用（每局几次），开销可忽略。
  function zoomSolveK(A, T) {
    var r = A / (ZOOM_V0 * T);
    if (r >= 1 || r <= 0) return 0;
    var lo = 1e-4, hi = 2 / r + 1;                 // f(hi)=1−e^(−hi)−r·hi 必为负
    for (var i = 0; i < 40; i++) {
      var mid = (lo + hi) / 2;
      if (1 - Math.exp(-mid) - r * mid > 0) lo = mid; else hi = mid;
    }
    return (lo + hi) / 2 / T;
  }

  var last = performance.now();
  function frame(now) {
    // 原始帧时长（真实秒）：镜头过渡用它，与游戏倍速无关。
    var rawDt = Math.min(0.05, (now - last) / 1000);
    // 倍速（v1.6.2）：真实帧时长 × CLOCK.timeScale，再钳 0.05 防大跳帧。
    // 60fps 下 ×3 = 每帧 0.05 恰好达上限，三档全速有效；掉帧时游戏只慢不炸。
    var dt = Math.min(0.05, rawDt * CLOCK.timeScale);
    last = now;
    // v1.6.38+39 作战拉远：夜晚 ⇒ battleLayout（真缩小 41→34 + 全画布居中）+ footer 隐藏；
    //   白天 ⇒ 原 layout。CAM.t 朝目标平滑推进，LAY 在两套布局间插值 ⇒
    //   渲染/索敌/拖拽换算全部自动跟上，无额外同步点。
    var battle = !CLOCK.isDay();
    var target = battle ? 1 : 0;
    if (CAM.target !== target) CAM.target = target;
    if (CAM.t !== target) {
      CAM.t = Math.max(0, Math.min(1, CAM.t + (target > CAM.t ? 1 : -1) * rawDt / CAM_DUR));
      CAM.e = camEase(CAM.t);
    } else CAM.e = camEase(CAM.t);
    var Ld = CFG.layout(), Lb = CFG.battleLayout(), e = CAM.e;
    var lay = (e <= 0) ? Ld : (e >= 1 ? Lb : {
      cell: Ld.cell + (Lb.cell - Ld.cell) * e,
      x: Ld.x + (Lb.x - Ld.x) * e,
      y: Ld.y + (Lb.y - Ld.y) * e,
      w: Ld.w + (Lb.w - Ld.w) * e,
      h: Ld.h + (Lb.h - Ld.h) * e
    });
    // v1.6.76 boost 镜头推进：v1.6.86 定稿 = 固定初速 + 动态衰减率 k 的指数减速曲线。
    //   ▍演进：v1.6.82 速率 1.8→0.5 → v1.6.83 C 案线性匀速 → v1.6.84 easeOutQuad+4s
    //     → v1.6.85 时长=阶段剩余+每秒 −10% → **v1.6.86 大王定稿"起步速度固定，
    //     衰减率动态"**：v(t)=ZOOM_V0·e^(−kt)，k 在升/降沿由"剩余时间 T 内恰好走完
    //     幅度 A"反解（zoomSolveK 二分求根）——起步手感恒定，剩余越短 k 越大减得
    //     越急、剩余越长 k 越小走得越远；r=A/(v0·T)≥1 时 k=0 恒速兜底永不卡住；
    //     位移闭式 d(t)=v0(1−e^(−kt))/k，走满 A 即冻结。
    // v1.6.91（规格 §14.59，大王两令）：overtime 纯收车不推进镜头 —— zBoost 改挂
    //   ENG.boostFx（engine 特效闸：奖励时间及其后续收车段 true，纯收车 false）。
    var zBoost = (ENG.boost || 0) > 0 && !!ENG.boostFx;
    // v1.6.76 boost 镜头推进：v1.6.86 固定初速 + 动态衰减率 k 的指数减速曲线。
    //   ▍v1.6.87 大王拍板"试 L=0.25"（加速期无怪无预警，闸只剩夜战地图 0.55 与
    //     数学 L<V·T）：幅度 0.06→**0.25**（终点 1.25，夜战 28px 格→35px 贴脸看
    //     冲刺）；V0 等比放大 0.03→0.12（保持曲线形状）；切昼快速归位——zoom 若
    //     挂进白天，下一波预警点（GS.nextSpawns 走 LAY 吃 zoom）会被推出画外
    //     （L>0.107 侧箭头裁、L>0.171 地图侧列出画）⇒ 切昼必须归位
    //     （v1.6.87 瞬归位 → v1.6.88 快收均被大王报"回弹/UI 尺寸变"，v1.6.89
    //     改随过渡归位，见下）；
    //   ▍v1.6.88 大王令"切昼时镜头会回弹"：v1.6.87 的瞬归位（zoom 一帧 1.25→1）
    //     跳变掩不住 ⇒ 改 **切昼快收通道**（zDir=-2）：0.35s smoothstep 定时归位，
    //     与 0.55s 昼夜插值重叠复合——无跳变；预警点裁切窗口仅 0.35s（前 ~0.25s
    //     侧箭头短暂推移，圆心口径可接受）。快收不走 V0/K 体系（固定初速 0.12/s
    //     走不完 0.25/0.35s），直接 camEase 定时插值。夜晚中途退回仍 zDir=-1 走
    //     3s 指数缓退；缓退中途切昼（罕见）当场转快收。
    //   ▍v1.6.89 大王报"回弹没解决 + 白天 UI 尺寸被改"——病根实锤：**有效格宽 =
    //     插值 cell × zoom，切昼时两条曲线相乘打架**：cell 28→37 涨、zoom 1.25→1
    //     收，乘积必下潜（v1.6.88：35→34.4→37）甚至跳崩（v1.6.87 瞬归位：35→28→37，
    //     即"白天 UI 突然变小再长回来"）。**正解 = 切昼锁定有效格宽单调过渡**
    //     （zDir=-3）：eff 从 zEff0(=zoom×当前插值cell，≈35px) 平滑走到昼 cell(37)，
    //     zoom 每帧反推 = eff÷lay.cell——乘积全程单调 35→37，零回弹零跳变；
    //     过渡走完（CAM.t=0）zoom 恰好 =1 自然冻结。数学：zoom(e)=(37−2e)/(37−9e)
    //     （e=CAM.e），单调递减、恒 ≥1。取代 v1.6.88 的 -2 快收通道（已删）。
    if (zBoost && CAM.zDir !== 1) {                // 上升沿：锚定起点/幅度/时长/衰减率
      CAM.zDir = 1; CAM.zt = 0; CAM.zFrom = CAM.zoom;
      CAM.zA = 1.25 - CAM.zoom;
      var zRem = 4;                                // dusk 无倒计时 → 默认 4s
      if (typeof CLOCK !== 'undefined' && CLOCK.remain > 0)
        zRem = CLOCK.remain / (CLOCK.timeScale || 1);   // 游戏秒 → 真实秒（倍速换算）
      CAM.zT = Math.max(1, zRem);
      CAM.zk = zoomSolveK(CAM.zA, CAM.zT);
    } else if (!zBoost && CAM.zDir !== -1 && CAM.zDir !== -3) {   // 下降沿
      CAM.zt = 0; CAM.zFrom = CAM.zoom;
      CAM.zA = CAM.zoom - 1;
      if (typeof CLOCK !== 'undefined' && CLOCK.isDay && CLOCK.isDay()) {
        // 切昼随过渡归位：boost 切昼当帧清零（engine boostCap=0→boost=0）⇒ 此沿必在白天。
        CAM.zDir = -3;
        CAM.zEff0 = CAM.zoom * lay.cell;           // 锁定当前有效格宽（zoom×插值cell）
      } else {                                     // 夜晚中途退回（罕见）：3s 缓退
        CAM.zDir = -1; CAM.zT = 3;
        CAM.zk = zoomSolveK(CAM.zA, CAM.zT);
      }
    } else if (!zBoost && CAM.zDir === -1 &&
               typeof CLOCK !== 'undefined' && CLOCK.isDay && CLOCK.isDay()) {
      // 夜晚缓退中途切昼：转随过渡归位（防白天预警点/地图长裁切窗口）
      CAM.zDir = -3;
      CAM.zEff0 = CAM.zoom * lay.cell;
    }
    if (CAM.zDir === -3) {
      // 随过渡归位：eff 单调 zEff0→昼cell（用 1−CAM.e 作昼向进度），zoom 反推。
      var zEff = CAM.zEff0 + (CFG.layout().cell - CAM.zEff0) * (1 - CAM.e);
      CAM.zoom = zEff / lay.cell;
      if (CAM.t <= 0) { CAM.zoom = 1; CAM.zDir = 0; }
    }     else if (CAM.zDir !== 0 && CAM.zA > 1e-4) {
      CAM.zt += rawDt;
      var zD = (CAM.zk > 1e-6)
        ? ZOOM_V0 * (1 - Math.exp(-CAM.zk * CAM.zt)) / CAM.zk
        : ZOOM_V0 * CAM.zt;                        // k=0：恒速分支
      // ▍v1.6.90 大王报"还是有回弹"——病根实锤（仿真逐帧抓到）：下面钳位先把 zDir
      //   归 0，紧跟着的赋值读 `zDir===1?zD:-zD` 就走了 **负号分支** ⇒ zoom 在"走满"
      //   的瞬间反向弹回 zFrom−zA（L=0.25 档 = 1.25 砸到 0.75，格子 35→21px，再花
      //   4s+ 爬回来）——时机恰在奖励窗口末端 zt≈zT ≈ 切昼，故大王每次都在"切昼"
      //   看到回弹。v1.6.86 起就潜伏（当时幅度 0.06 只弹 6% 不显眼）。
      //   修法：①方向符号在改 zDir **之前**捕获；②冻结判据加贴近容差 0.002
      //   （指数曲线渐近逼近 zA，严格 >= 要等满 zT 才触发，贴近即冻结免爬尾）。
      var zSign = (CAM.zDir === 1) ? 1 : -1;       // 方向先取（本帧内不再变义）
      if (CAM.zA - zD < 0.002) { zD = CAM.zA; CAM.zDir = 0; }   // 走满/足够贴近即冻结
      CAM.zoom = CAM.zFrom + zSign * zD;
    } else CAM.zDir = 0;
    // 应用：以画布中心锚缩放 LAY（cell/x/y/w/h 同乘）—— 渲染/指针换算/粒子全走
    //   LAY 自动跟随，无额外同步点。纯视觉：战斗判定全格制坐标不经 LAY。
    if (CAM.zoom !== 1) {
      var z = CAM.zoom, cx = canvas.width / 2, cy = canvas.height / 2;
      lay = { cell: lay.cell * z, x: cx - (cx - lay.x) * z, y: cy - (cy - lay.y) * z,
              w: lay.w * z, h: lay.h * z };
    }
    window.LAY = lay;
    // v1.6.37 大王令"抽词条的时候游戏暂停"：GS.paused 期间**跳过整个模拟**
    //   （昼夜/刷怪/列车/战斗/飘字全停），渲染与 HUD 照常 —— 画面静止但可见，
    //   玩家能对着当前战局挑词条。`last` 照常推进 ⇒ 恢复瞬间无跳帧。
    //   ⚠️【v1.6.80 退役】v1.6.74 的 GS.hitStop 全场静止顿帧分支已撤（大王令：
    //   "顿的应该是敌方单位，不是游戏"——撞击改挂 fo.stun 怪定身，§14.56）。
    if (!GS.paused) ENG.update(dt);
    REND.draw(ctx, LAY, UI.move, UI.drag);
    UI.tick();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', function () { UI.resize(); });
})();