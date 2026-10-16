// ============================================================================
// 关卡模式（v1.7.0，规格 §14.62，大王令 2026-10-16）：固定线性挑战关卡
// ----------------------------------------------------------------------------
// 【一句话】随机模式是"每局随机撒一张图、无限波"；关卡模式是"内置 5 张手工
//   设计的固定地图、每关统一打 10 波，清完第 10 波 = 通关"。
//
// ▍地形形态（v1.7.1 大王纠偏："关卡模式也应该 3×5 开局，只是金币爱心的分布
//   有区别"）—— 与随机模式**同构**：整图废墟、只有内区 3×5（c3..5×r4..8）
//   是空地保底开局环，镇中心恒 (4,6)；五关的区别**只在资源（金币/爱心）的
//   撒点分布**，扩张路线由玩家围绕资源分布自己选。
//
// ▍关卡表 LEVELS[5]（大王拍板 A 案：手工设计内置）
//   · 每关 = { name, rows }，rows = 13 行 × 9 列 ASCII，图例与导出格式同源：
//     '#'废墟 '.'空地 'C'镇中心 'g'埋在废墟的金币格 'h'埋在废墟的爱心格。
//   · 硬约束（test_levels.js 逐关校验）：
//       - 恒 10 金币格 + 5 爱心格（与随机模式同量）；
//       - 任意两资源格切比雪夫距离 ≥ CFG.RES_GAP(2)（3×3 邻域内不许有第二枚）；
//       - 内区 3×5（c3..5 × r4..8）全空地 —— 保底开局环（与随机模式同构）；
//       - 非内区格一律废墟（资源格埋在废墟里，清出来才拿得到）；
//       - 镇中心恒 (4,6)（地图几何中心）。
//   · 五关资源分布（难度递进一句话）：
//       ①均衡 —— 全图均匀撒点，四平八稳（入门）；
//       ②四角 —— 资源压四角 + 中轴上下各一枚，中心近处干净（扩张必须选边）；
//       ③双翼 —— 资源集中左右两条竖翼，中路只有孤零零几枚（先通哪翼的抉择）；
//       ④环心 —— 8 枚贴着内区一圈 + 7 枚外围（近但挤，开局环外立刻见资源）；
//       ⑤边陲 —— 资源全贴地图四边（最远征：清轨纵深最大，路上全是废墟）。
//
// ▍开局落法（规格 §14.62）
//   GS.startLevel(idx) = ENG.restart()（全量重置：塔/怪/词条/牌库/CLOCK/
//   FOES.prepareNext/newGame 地形铁轨——复用全套重置逻辑不另抄）→
//   _applyTerrain 按 rows 重建 grid（沿用 newGame 的 core 建筑对象）→
//   资源列表重建 → 金币 30 → 重算铁轨 + 异步缓存作废。
//   （restart 先在随机地形上解过一次开局环，这里覆盖后再解一次——开局环
//   毫秒级，双解可接受；换来的是不复制 restart 的重置清单，防漂移。）
//
// ▍进度存档：localStorage 'kdg.level.progress' = 已通关的最深关（0-based，-1 无）。
//   通关 idx 解锁 idx+1（封顶最后一关）；读写全 try/catch（file:// 或隐私模式
//   下降级为不存档，游戏照玩）。
// ============================================================================

// 每关波次上限（大王拍板：5 关统一 10 波）。clock.js 胜利钩子读它（typeof 守卫）。
var LEVEL_WAVES = 10;

// ---- 五关地图表（rows 逐行 9 字符，硬约束见 test_levels.js） ----------------
//   模板：内区行 r4/r5/r7/r8 = '###...###'，r6 = '###.C.###'（C 恒 (4,6)）；
//   其余行除资源字母外全 '#'。资源坐标均为手工核算（两两切比雪夫 ≥2 且不进内区）。
var LEVELS = [
  { name: '均衡', rows: [
    'g#######g',
    '#########',
    '#g#####g#',
    '####h####',
    '###...###',
    'g##...##g',
    '###.C.###',
    'h##...###',
    '###...##h',
    '####g####',
    'h#g######',
    '#######g#',
    'g###h####'
  ] },
  { name: '四角', rows: [
    'g###g###g',
    '##g###g##',
    '####h####',
    '#h#####h#',
    '###...###',
    '###...###',
    '###.C.###',
    '###...###',
    '###...###',
    '#h#####h#',
    '#########',
    '##g###g##',
    'g###g###g'
  ] },
  { name: '双翼', rows: [
    'g#######g',
    '####h####',
    '#g#######',
    '#######g#',
    'g##...###',
    '###...##g',
    '###.C.###',
    '#g#...###',
    '###...#g#',
    'h#h######',
    '####h###h',
    '#########',
    '#g#####g#'
  ] },
  { name: '环心', rows: [
    'h#######g',
    '####g####',
    '#########',
    '##g#h#g##',
    '###...###',
    '###...###',
    'g#h.C.g#g',
    '###...###',
    '###...###',
    '##g#g#h##',
    '#########',
    '#########',
    'g#######h'
  ] },
  { name: '边陲', rows: [
    'g##g##g##',
    '########g',
    'h#####h##',
    '#########',
    'g##...##g',
    '###...###',
    '###.C.##h',
    'h##...###',
    '###...##g',
    '#########',
    'g########',
    '#########',
    '##h#g###g'
  ] }
];

// ---- 模式状态（默认随机模式；跨新局保持，重开不清） -------------------------
//   ⚠️ 放 levels.js 挂 GS 而不进 newGame 重置清单 —— 模式是"元状态"，
//   newGame 负责"这一局"，不负责"玩哪个模式"。test 沙箱只载 state 时兜底 undefined。
if (typeof GS.mode !== 'string') GS.mode = 'random';
if (typeof GS.levelIdx !== 'number') GS.levelIdx = -1;
GS.levelDone = false;                       // 通关旗（newGame/ENG.restart 经 newGame 归零）

// ---- 进度存档（localStorage，全 try/catch 降级） ----------------------------
var _LEVEL_LS_KEY = 'kdg.level.progress';
// ⚠️ 临时全解锁（2026-10-16 大王令"临时帮我解锁 1-5 关的可选择"）：true = 五关全部
//   可选（试玩调参用）。**调试结束请改回 false**，恢复"通关上一关才解锁下一关"。
var LEVEL_UNLOCK_ALL = true;
GS.levelProgress = function () {            // 已通关的最深关（0-based），没通 = -1
  try { var v = localStorage.getItem(_LEVEL_LS_KEY); return (v === null || v === '') ? -1 : +v; }
  catch (e) { return -1; }
};
GS.levelUnlock = function (idx) {           // 通关 idx → 记最深（解锁 idx+1 由 UI 按此推导）
  try {
    if (idx > GS.levelProgress()) localStorage.setItem(_LEVEL_LS_KEY, String(idx));
  } catch (e) { /* 存不了就当会话内进度，不拦通关 */ }
};
GS.levelUnlocked = function (idx) {         // 第 idx 关是否可玩：全解锁开关直通；否则首关恒开、其余须通过关 idx-1
  if (LEVEL_UNLOCK_ALL) return true;
  return idx === 0 || GS.levelProgress() >= idx - 1;
};

// ---- 开局一关（工具菜单/胜利层「下一关」/失败层「重打本关」统一入口） --------
GS.startLevel = function (idx) {
  GS.mode = 'level';
  GS.levelIdx = idx;
  // ① 全量重置（ENG.restart = newGame + TOWERS/FOES.reset + 车头状态归零 + LOG newGame）
  if (typeof ENG !== 'undefined' && ENG.restart) ENG.restart();
  else GS.newGame();                        // 精简沙箱（只载 state 前段）兜底
  // ② 覆盖地形（restart 已在随机图上解过一次开局环，这里重建后再解）
  GS._applyLevelTerrain(LEVELS[idx]);
  if (typeof LOG !== 'undefined') LOG.add('levelStart', { idx: idx, name: LEVELS[idx].name });
};

// 按 ASCII rows 重建 grid / 资源列表 / 铁轨（importMap 同款字符语义的 terrain 子集：
//   关卡表只有地形与资源，不带塔/怪/列车状态 —— 全部由 restart 的新局重置承担）。
GS._applyLevelTerrain = function (lv) {
  var core = GS.core;
  GS.grid = [];
  GS.buildings = [core];
  GS.goldTiles = [];
  GS.heartTiles = [];
  for (var r = 0; r < CFG.MAP_ROWS; r++) {
    var rowS = lv.rows[r];
    var row = [];
    for (var c = 0; c < CFG.MAP_COLS; c++) {
      var cell = { t: 'rubble', gold: false, heart: false, harvested: false, b: null };
      var ch = rowS.charAt(c);
      if (ch === '.') cell.t = 'blank';
      else if (ch === 'g') cell.gold = true;                        // 仍埋废墟（同随机开局）
      else if (ch === 'h') cell.heart = true;
      else if (ch === 'C') { cell.t = 'blank'; cell.b = core; }     // 镇中心（恒 (4,6)）
      // '#' 与其它字符一律废墟（表内不该出现，test_levels 兜字符集校验）
      row.push(cell);
    }
    GS.grid.push(row);
  }
  // 资源块列表从网格标记重建（transport/engine 按列表遍历拾取，与 importMap 同口径）
  for (var rg = 0; rg < CFG.MAP_ROWS; rg++) {
    for (var rc = 0; rc < CFG.MAP_COLS; rc++) {
      if (GS.grid[rg][rc].gold) GS.goldTiles.push({ c: rc, r: rg });
      if (GS.grid[rg][rc].heart) GS.heartTiles.push({ c: rc, r: rg });
    }
  }
  GS.gold = 30;                             // 大王拍板：统一 30 金币（与随机模式一致）
  // 铁轨重解 + 求解缓存全作废（防 skip 闸/异步飞行结果拿旧地形指纹坑新盘）
  GS.__v2cache = null;
  if (typeof SOLVER_ASYNC !== 'undefined' && SOLVER_ASYNC.invalidate) SOLVER_ASYNC.invalidate();
  GS.recomputeRails();
};
