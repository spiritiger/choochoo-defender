// ============================================================================
// solver-async.js（v1.6）—— 铁轨求解后台化 + 并行分片：松手/撤销不再冻结主线程
//
//   ▍背景（2026-10-09 解剖定案，详见 .workbuddy/memory/2026-10-09.md）
//     最难盘面单次求解 ~1s（阶梯"证明无解"851ms + ②择优 519ms + ⑤支线 150ms），
//     全部烧在主线程 = 白天松手瞬间画面冻结。运算本身已到头（2-core 必要条件
//     预检已证伪：零误杀但一个难盘都判不死），唯一根治 = 把求解挪出主线程。
//
//   ▍方案（大王拍板"全做"，2026-10-09）
//     · Worker 常驻，内含 map/state/station 三份源码（与页面同版，blob 拼接）；
//     · 主线程发「盘面 ASCII + 当前环」快照，worker 内全链求解（含 STATION.solve），
//       回传 7 个派生字段（railPath/railSet/railRect/railInner/contourB/
//       railGrowHints/station），主线程整体引用替换 —— 与 v1.4.11 预览还原同一套
//       bit-exact 字段（recomputeRails 只整体替换从不原地改 ⇒ 替换即一致）；
//     · 当前环一并传过去：worker 里 finalRing 的「反缩水保险」照常生效（prevRing）；
//     · 盘面指纹守卫：套用前重算当前盘面 ASCII 比对，期间盘面变过（连放/新局）
//       → 结果作废，绝不套旧环（newGame 另加 invalidate 双保险）；
//     · 落位闸门：只在建造阶段（CLOCK.isDay）套用 —— 夜晚列车在旧环上跑，
//       换环会让 train.index 越界；结果先挂起，回白天每帧 tryFlush 再落位，
//       落位后下一帧 parkAtStation 自动把车头对齐新站台（衔接与 dusk 哲学一致）。
//
//   ▍并行分片（v1.6 第三步，已实现）
//     state.js 的 GS.__shard={n,k} 旋钮把 ②择优/⑤支线 的起点循环按 si≡k (mod n)
//     划分（①定档各片都跑 ⇒ k* 一致；各片搜索空间互不重叠、并起恰为全量）。
//     本模块把池扩成 N 个 worker，同一盘面广播 N 份（各带 shard{k:i}），每个
//     worker 独立跑全链（含⑤⑥⑦）并回传终环三量统计（GS.ringStatsOf）；
//     主线程按 ringBetter 同判据（覆盖↑→十字↓→格数↓）合并取最优。
//     ▍为什么合并结果永不劣于同步版：持有同步全局最优起点的分片，其②胜者=
//       同步胜者、⑤的 cov0 也一致 ⇒ 该片输出=同步输出；其余分片只会再往上加
//       候选 ⇒ 合并取最优 ≥ 同步输出（ringBetter 序）。实测差异方向由 A/B 验证。
//     ▍分片数按核数自适应（大王拍板）：hardwareConcurrency ≥4 → 3 片 / 2~3 → 2 片
//       / 其余 1 片；worker 构建失败自动减员，最后退同步路径。
//     ▍代价（已知并接受）：①定档各片重复跑（并行下不占墙钟，只费 CPU）；跨片
//       早停闸做不到（worker 同步循环里收不到消息）——满覆盖盘各片自己停，其余片
//       多烧一点，换难盘 ~3 倍提速，值。
//
//   ▍降级链（手机/老浏览器/file://）
//     Worker 构造失败 / 源码 XHR 失败 / location.protocol==='file:'
//       → ready=false → GS.recomputeRailsAsync() 直接走同步 recomputeRails()
//       （与 v1.5 现状完全一致，行为零变化）。手机必然经 http 访问 ⇒ 完整生效。
//       （file:// 下 blob Worker 能建但 importScripts/fetch/XHR 全被浏览器拦，
//         冒烟实验 2026-10-09 实锤，源码通道只有 http 一条。）
//
//   ▍测试边界
//     Node 沙箱无 Worker ⇒ 测试路径恒为同步 recomputeRails（三套回归不受影响）；
//     分片 A/B 在 Node 用 GS.__shard 直接模拟（顺序跑 n 片再合并）。
// ============================================================================

window.SOLVER_ASYNC = (function () {

  // —— 状态 ——
  var ready = false;            // worker 池可用（http + 源码拉取成功）
  var workers = [];             // 常驻池（分片数 = 池大小）
  var seq = 0;                  // 请求流水号：新请求作废旧结果
  var collect = null;           // 分片收集器 {seq, want, got:[]}：等齐 n 片再合并
  var pending = null;           // 夜间到达的结果（回白天再落位）
  var lastReqFp = '';           // 最近一次请求的盘面指纹
  var initErr = '';             // 初始化失败原因（诊断用）

  // 分片数按核数自适应（大王 2026-10-09 拍板）：≥4 核 3 片 / 2~3 核 2 片 / 其余 1 片。
  //   留核给游戏本身（渲染/刷怪都在主线程）；3 是甜点位，再多定档重复开销不划算。
  var SHARD_N = (function () {
    var hc = (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2;
    return hc >= 4 ? 3 : (hc >= 2 ? 2 : 1);
  })();

  // —— worker 胶水：三份源码文本由主线程拼接进来（blob 里 importScripts/XHR 全被拦）——
  var GLUE_HEAD = 'self.window = self;\n';
  var GLUE_TAIL = [
    'onmessage = function (e) {',
    '  var d = e.data;',
    "  if (!d || d.type !== 'solve') return;",
    '  var rows = d.rows;',
    '  GS.__shard = d.shard || null;',     // 分片旋钮：{n,k} | null（同步全量）
    '  GS.grid = []; GS.goldTiles = []; GS.buildings = [];',
    '  for (var r = 0; r < rows.length; r++) {',
    '    var row = [];',
    '    for (var c = 0; c < rows[r].length; c++) {',
    '      var ch = rows[r][c], b = null, t = "blank";',
    '      if (ch === "#") t = "rubble";',
    "      else if (ch === 'C') { b = { type: 'core', c: c, r: r }; GS.core = b; }",
    "      else if (ch === 'T' || ch === 'E') { b = { type: 'tower', c: c, r: r }; }",  // 仅建筑不可铺轨
    '      row.push({ t: t, gold: false, harvested: false, b: b });',
    '    }',
    '    GS.grid.push(row);',
    '  }',
    '  GS.buildings = [GS.core];',
    '  GS.railPath = d.prevRing || [];',   // 反缩水保险的 prevRing（覆盖数不降才换）
    '  GS.railSet = {}; GS.railRect = null; GS.railInner = {};',
    '  GS.railGrowHints = []; GS.station = null;',
    '  GS.railFast = false;',
    '  var __err = "";',
    '  try { GS.recomputeRails(); } catch (e) { __err = (e && e.message) || "throw"; }',
    '  var __st = null;',                  // 终环三量统计（ringBetter 合并用）
    '  try { __st = GS.ringStatsOf ? GS.ringStatsOf(GS.railPath) : null; } catch (e2) {}',
    "  postMessage({ type: 'result', seq: d.seq, k: d.shard ? d.shard.k : 0, st: __st, err: __err,",
    '    railPath: GS.railPath, railSet: GS.railSet, railRect: GS.railRect,',
    '    railInner: GS.railInner, contourB: GS.contourB,',
    '    railGrowHints: GS.railGrowHints, station: GS.station });',
    '  GS.__shard = null;',                // 用完即清，防残留影响下一发
    '};'
  ].join('\n');

  // 同步 XHR 拉源码（http 下毫秒级一次性成本）。
  //   ⚠️ 不用 fetch+Promise：实测（playwright headless，2026-10-09）页面加载阶段
  //   发起的 fetch Promise 永久挂起、setTimeout 里同样的请求却正常 —— 时序之谜
  //   不值得排查，同步 XHR 简单且必然 settle；file:// 下 send() 直接 throw → 降级。
  function fetchTextSync(url) {
    var x = new XMLHttpRequest();
    x.open('GET', url, false);
    x.send(null);
    if (x.status !== 200 && x.status !== 0) throw new Error('http ' + x.status + ' ' + url);
    if (!x.responseText || x.responseText.length < 50) throw new Error('empty ' + url);
    return x.responseText;
  }

  function init() {
    if (typeof Worker === 'undefined') { initErr = 'no Worker'; return; }
    if (location.protocol === 'file:') { initErr = 'file:'; return; }
    try {
      var srcs = ['js/config/map.js', 'js/state.js', 'js/station.js'].map(fetchTextSync);
      var code = GLUE_HEAD + srcs.join('\n') + '\n' + GLUE_TAIL;
      var url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      // 逐个建，失败自动减员（部分浏览器对 blob worker 数量有限制）——
      //   池缩了分片数跟着缩，最差退回 1 片（= v1.6 单 worker 行为）。
      for (var i = 0; i < SHARD_N; i++) {
        var w = new Worker(url);
        w.onmessage = onResult;
        w.onerror = function (e) {
          ready = false; workers = []; collect = null; pending = null;
          initErr = 'worker: ' + ((e && e.message) || '?') + (e && e.lineno ? ' @' + e.lineno : '');
        };
        workers.push(w);
      }
      ready = true;
      initErr = '';
    } catch (e) {
      ready = false; workers = [];
      initErr = (e && e.message) || 'init fail';   // 单文件产物无 js/ 目录等 → 降级
    }
  }

  // 盘面 → ASCII（求解只需 t + b；金币/装饰不影响 usable = t==='blank' && !b）
  //   '#'=废墟  '.'=空地  'C'=镇中心  'T'=塔/其他建筑
  function serializeBoard() {
    var rows = [];
    for (var r = 0; r < CFG.MAP_ROWS; r++) {
      var s = '';
      for (var c = 0; c < CFG.MAP_COLS; c++) {
        var cell = GS.grid[r][c];
        if (cell.b) s += cell.b.type === 'core' ? 'C' : 'T';
        else s += cell.t === 'rubble' ? '#' : '.';
      }
      rows.push(s);
    }
    return rows;
  }

  // 落位：bit-exact 引用替换（与 v1.4.11 预览还原同一套字段）
  function apply(p) {
    GS.railPath = p.railPath;
    GS.railSet = p.railSet;
    GS.railRect = p.railRect;
    GS.railInner = p.railInner;
    GS.contourB = p.contourB;
    GS.railGrowHints = p.railGrowHints;
    GS.station = p.station;                 // STATION.solve 已在 worker 内跑过
  }

  // ringBetter 同判据（state.js 闭包内实现主线程拿不到，这里按定义复刻一行版）；
  //   ⚠️ 三级字典序口径变更时两处必须同步改（见 state.js ringBetter 注释）。
  function betterSt(a, b) {
    return a.cov > b.cov ||
      (a.cov === b.cov && a.cross < b.cross) ||
      (a.cov === b.cov && a.cross === b.cross && a.cells < b.cells);
  }
  function stEq(a, b) {
    return a && b && a.cov === b.cov && a.cross === b.cross && a.cells === b.cells;
  }

  function onResult(e) {
    var d = e.data;
    if (!d || d.type !== 'result') return;
    if (!collect || d.seq !== collect.seq) return;   // 过期结果（期间又有新请求）→ 丢弃
    collect.got.push(d);
    if (collect.got.length < collect.want) return;   // 还没等齐 n 片
    var batch = collect; collect = null;
    // —— 合并：ringBetter 同判据取最优；三量全同（并列解）取 k 小者，贴同步"先命中"偏置 ——
    var best = null;
    for (var i = 0; i < batch.got.length; i++) {
      var r = batch.got[i];
      if (r.err || !r.st || !r.railPath || r.railPath.length < 4) continue;  // 失败片不进池
      if (!best || betterSt(r.st, best.st) ||
          (stEq(r.st, best.st) && r.k < best.k)) best = r;
    }
    if (!best) return;   // 全体失败 → 保留当前环（与同步"求解失败不动旧环"一致）
    // 指纹守卫：请求发出后盘面若变过（连放/撤销/新局），结果一律作废
    if (serializeBoard().join('|') !== lastReqFp) return;
    if (typeof CLOCK !== 'undefined' && !CLOCK.isDay()) { pending = best; return; }   // 夜间挂起
    apply(best);
  }

  // 每帧检查（ENG.update 调）：夜晚到达的结果，回到建造阶段立即落位。
  //   落位后下一帧 ENG.parkAtStation 把车头对齐新站台，衔接无感。
  function tryFlush() {
    if (!pending) return;
    if (typeof CLOCK !== 'undefined' && !CLOCK.isDay()) return;
    var p = pending; pending = null;
    if (serializeBoard().join('|') !== lastReqFp) return;   // 挂起期间盘面又变了
    apply(p);
  }

  // —— 对外主入口：替代「松手/撤销」处的同步重算 ——
  GS.recomputeRailsAsync = function () {
    if (!ready || !workers.length) { GS.recomputeRails(); return; }   // 降级链
    seq++;
    var rows = serializeBoard();
    lastReqFp = rows.join('|');
    pending = null;
    collect = { seq: seq, want: workers.length, got: [] };
    var n = workers.length;
    for (var i = 0; i < n; i++) {
      workers[i].postMessage({ type: 'solve', seq: seq, rows: rows, prevRing: GS.railPath,
                               shard: n > 1 ? { n: n, k: i } : null });
    }
  };

  // 新局作废飞行中的结果（state.js newGame 尾调；指纹守卫之外的双保险）
  function invalidate() {
    seq++;                                  // 所有 in-flight 结果过期
    collect = null;
    pending = null;
  }

  init();

  var api = { ready: function () { return ready; },
              tryFlush: tryFlush,
              poolSize: function () { return workers.length; },
              shardN: function () { return workers.length; },
              invalidate: invalidate,
              initError: function () { return initErr; } };
  return api;
})();
