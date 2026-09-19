// 引导脚本：布局、初始化、缩放适配、主循环
(function () {
  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');
  canvas.width = CFG.CANVAS_W;
  // 画布只覆盖「场地区」（HUD/底部面板是 HTML），内在等比=CSS显示，避免纵向压扁
  canvas.height = CFG.fieldH();

  // 全局地图布局（各模块共用）
  window.LAY = CFG.layout();

  ENG.init();
  UI.init(canvas);
  UI.resize();
  UI.tick();

  var last = performance.now();
  function frame(now) {
    var dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    ENG.update(dt);
    REND.draw(ctx, LAY, UI.move);
    UI.tick();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  window.addEventListener('resize', function () { UI.resize(); });
})();