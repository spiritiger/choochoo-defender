// ============================================================================
// 【点击清除 · 控制台调试模式】（rail-v2 试玩工具，2026-10-11）
//
// 用法：
//   1. 打开游戏（index.html，双击或 http 均可）
//   2. F12 → Console → 把本文件全部内容粘贴回车
//   3. 左键点地图上的废墟格 = 清除；右键点空地 = 恢复废墟；每次操作后立刻用
//      新算法（rail-v2）同步重算铁轨，控制台打印 三个量 + 来源 + 耗时
//   4. 退出：输入 railDebugOff()；切回旧算法：GS.railV2 = false
//
// 附加工具（粘贴后可用）：
//   railStats()  —— 打印当前环的 三个量（步数/格数/重走）
//   railProbe()  —— 打印求解器世界观 ASCII（区域/轮廓/补格/半岛加回/来源）
//
// 注意：本工具用同步重算（即时见效果）。夜间测试时换环会让列车索引取模回绕
// （火车可能跳位）——调试工具可接受；游戏正常流程不受影响。
// ============================================================================
(function () {
  if (!window.GS || !window.CFG) { console.warn('[rail-v2] 未找到游戏全局（GS/CFG），请在游戏页面里粘贴'); return; }
  if (window.railDebugOff) window.railDebugOff();

  var cv = document.querySelector('canvas');
  if (!cv) { console.warn('[rail-v2] 未找到画布'); return; }
  GS.railV2 = true;

  function stats() {
    var ring = GS.railPath || [], m = {}, i;
    for (i = 0; i < ring.length; i++) { var k = ring[i].c + ',' + ring[i].r; m[k] = (m[k] || 0) + 1; }
    var cells = 0, cross = 0, k2;
    for (k2 in m) { cells++; if (m[k2] >= 2) cross++; }
    var last = GS.__v2last || {};
    return 'rail(' + ring.length + ')  格数=' + cells + '  重走=' + cross +
      '  来源=' + (last.provenance || '?') + '  耗时=' + (last.ms != null ? last.ms + 'ms' : '?');
  }

  function cellAt(e) {
    var rect = cv.getBoundingClientRect();
    var x = (e.clientX - rect.left) * (cv.width / rect.width);
    var y = (e.clientY - rect.top) * (cv.height / rect.height);
    return CFG.pickCell(CFG.layout(), x, y);
  }

  function recompute(what) {
    var t0 = Date.now();
    GS.recomputeRails();
    console.log('%c[rail-v2] ' + what + ' → ' + stats() + '（本次合计 ' + (Date.now() - t0) + 'ms）',
      'color:#1faa5a');
  }

  function onClick(e) {
    var cell = cellAt(e);
    if (!cell) return;
    var g = GS.grid[cell.r][cell.c];
    if (g.b) { console.log('[rail-v2] (' + cell.c + ',' + cell.r + ') 上有建筑，跳过'); return; }
    if (g.t === 'rubble') {
      g.t = 'blank';                 // 埋在废墟里的金币格：gold 标记保留（与游戏清理语义一致）
      recompute('清除 (' + cell.c + ',' + cell.r + ')');
    }
  }

  function onRight(e) {
    e.preventDefault();
    var cell = cellAt(e);
    if (!cell) return;
    var g = GS.grid[cell.r][cell.c];
    if (!g.b && g.t === 'blank' && !g.gold) {   // 金币格不回填，防状态错乱
      g.t = 'rubble';
      recompute('回填 (' + cell.c + ',' + cell.r + ')');
    }
  }

  cv.addEventListener('click', onClick);
  cv.addEventListener('contextmenu', onRight);
  console.log('%c[rail-v2] 点击清除模式已开启：左键=清废墟，右键=回填，每步用新算法重算。railDebugOff() 退出',
    'color:#e07b1f;font-weight:bold');

  window.railDebugOff = function () {
    cv.removeEventListener('click', onClick);
    cv.removeEventListener('contextmenu', onRight);
    delete window.railDebugOff;
    console.log('[rail-v2] 点击清除模式已关闭（railV2 开关保持现状）');
  };
  window.railStats = function () { console.log('[rail-v2] ' + stats()); return stats(); };
  window.railProbe = function () {
    GS.railProbeOn = true; GS.recomputeRails(); GS.railProbeOn = false;
    console.log(GS.railProbeText());
  };
})();
