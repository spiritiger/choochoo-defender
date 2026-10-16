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
  window.CAM = { t: 0, e: 0, target: 0 };
  var CAM_DUR = 0.55;                       // 过渡时长（秒，真实时间不受倍速影响）
  function camEase(x) { return x * x * (3 - 2 * x); }   // smoothstep：两端减速、中段最快

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
    window.LAY = (e <= 0) ? Ld : (e >= 1 ? Lb : {
      cell: Ld.cell + (Lb.cell - Ld.cell) * e,
      x: Ld.x + (Lb.x - Ld.x) * e,
      y: Ld.y + (Lb.y - Ld.y) * e,
      w: Ld.w + (Lb.w - Ld.w) * e,
      h: Ld.h + (Lb.h - Ld.h) * e
    });
    // v1.6.37 大王令"抽词条的时候游戏暂停"：GS.paused 期间**跳过整个模拟**
    //   （昼夜/刷怪/列车/战斗/飘字全停），渲染与 HUD 照常 —— 画面静止但可见，
    //   玩家能对着当前战局挑词条。`last` 照常推进 ⇒ 恢复瞬间无跳帧。
    if (!GS.paused) ENG.update(dt);
    REND.draw(ctx, LAY, UI.move, UI.drag);
    UI.tick();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', function () { UI.resize(); });
})();