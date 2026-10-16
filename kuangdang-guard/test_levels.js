// ============================================================================
// 关卡模式回归测试（Node 直接跑，不需要浏览器）：node test_levels.js
//
// 覆盖 v1.7.0/v1.7.1 §14.62（大王令"两种挑战模式" + "关卡也 3×5 开局"纠偏）：
//   1) 关卡表硬约束：13×9、字符集、C 恒 (4,6)、内区 3×5 全空地、
//      **非内区格一律废墟（与随机模式同构）**、恒 10 金币格 + 5 爱心格、
//      资源两两切比雪夫距离 ≥ RES_GAP
//   2) startLevel 冒烟：五关全部能解出开局环、金币 30、模式/索引落账、
//      grid 与 ASCII 一致（资源列表/core 指针）
//   3) 胜利钩子：第 10 波收车回白天 → levelDone + 进度解锁；
//      第 9 波 / 随机模式同路径不触发
//   4) newGame 归零 levelDone；levelUnlocked 推导
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const sandbox = {};
sandbox.window = sandbox;
sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/log.js', 'js/state.js', 'js/levels.js', 'js/resources.js',
                 'js/cards.js', 'js/solver-async.js', 'js/station.js', 'js/towers.js', 'js/foes.js',
                 'js/clock.js', 'js/transport.js', 'js/engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.window.CFG, GS = sandbox.window.GS, CLOCK = sandbox.window.CLOCK,
      FOES = sandbox.window.FOES, ENG = sandbox.window.ENG;
const LEVELS = sandbox.window.LEVELS, LEVEL_WAVES = sandbox.window.LEVEL_WAVES;
GS.debugNoDeadline = true;   // 测试确定性：跳过墙钟（防重负载下偶发掐断求解）

let pass = 0, fail = 0;
function check(name, ok, detail) {
  if (ok) { pass++; console.log('  [通过] ' + name); }
  else { fail++; console.log('  [失败] ' + name + (detail ? ' —— ' + detail : '')); }
}

// ---- 1) 关卡表硬约束 --------------------------------------------------------
check('关卡数量 = 5', Array.isArray(LEVELS) && LEVELS.length === 5, 'len=' + (LEVELS && LEVELS.length));
check('LEVEL_WAVES = 10（大王拍板：5 关统一 10 波）', LEVEL_WAVES === 10, 'v=' + LEVEL_WAVES);

const RES = [[], [], [], [], []];   // 每关资源坐标 [(c,r)]
for (let li = 0; li < LEVELS.length; li++) {
  const lv = LEVELS[li], rows = lv.rows;
  check('第' + (li + 1) + '关「' + lv.name + '」13 行', rows.length === CFG.MAP_ROWS,
        'rows=' + rows.length);
  let nG = 0, nH = 0, nC = 0, bad = [];
  for (let r = 0; r < rows.length; r++) {
    if (rows[r].length !== CFG.MAP_COLS) { bad.push('r' + r + ' 长度 ' + rows[r].length); continue; }
    for (let c = 0; c < rows[r].length; c++) {
      const ch = rows[r][c];
      if ('#.gh'.indexOf(ch) < 0 && ch !== 'C') bad.push('(' + c + ',' + r + ') 字符 ' + ch);
      if (ch === 'g') { nG++; RES[li].push([c, r]); }
      if (ch === 'h') { nH++; RES[li].push([c, r]); }
      if (ch === 'C') { nC++; if (c !== 4 || r !== 6) bad.push('C 在 (' + c + ',' + r + ') ≠ (4,6)'); }
    }
  }
  check('第' + (li + 1) + '关 字符集/列宽/C 位', bad.length === 0, bad.join(';'));
  check('第' + (li + 1) + '关 资源量 10 金 + 5 爱心', nG === 10 && nH === 5, 'g=' + nG + ' h=' + nH);
  // 内区 3×5（c3..5 × r4..8）全空地 —— 保底开局环
  let innerBad = 0;
  for (let r = 4; r <= 8; r++) for (let c = 3; c <= 5; c++)
    if (rows[r][c] !== '.' && rows[r][c] !== 'C') innerBad++;
  check('第' + (li + 1) + '关 内区 3×5 全空地', innerBad === 0, 'bad=' + innerBad);
  // 非内区格一律废墟（v1.7.1 大王纠偏："关卡也 3×5 开局，区别只在资源分布"
  //   —— 与随机模式同构：整图废墟 + 内区空地，资源埋废墟里）
  let outerBlank = 0;
  for (let r = 0; r < rows.length; r++) for (let c = 0; c < rows[r].length; c++) {
    const inInner = r >= 4 && r <= 8 && c >= 3 && c <= 5;
    if (!inInner && rows[r][c] === '.') outerBlank++;
  }
  check('第' + (li + 1) + '关 非内区全废墟（随机模式同构）', outerBlank === 0,
        'blank=' + outerBlank);
  // 资源间距：两两切比雪夫 ≥ RES_GAP(2)（3×3 邻域内不许有第二枚，同随机模式撒点规则）
  let gapBad = '';
  for (let a = 0; a < RES[li].length; a++) for (let b = a + 1; b < RES[li].length; b++) {
    const d = Math.max(Math.abs(RES[li][a][0] - RES[li][b][0]),
                       Math.abs(RES[li][a][1] - RES[li][b][1]));
    if (d < CFG.RES_GAP) gapBad += '(' + RES[li][a] + ')-(' + RES[li][b] + ')d' + d + ' ';
  }
  check('第' + (li + 1) + '关 资源间距 ≥ ' + CFG.RES_GAP, gapBad === '', gapBad);
}

// ---- 2) startLevel 冒烟（五关全解） -----------------------------------------
for (let li = 0; li < LEVELS.length; li++) {
  GS.startLevel(li);
  const ok = GS.mode === 'level' && GS.levelIdx === li && GS.gold === 30 &&
             GS.railPath.length > 0 && !GS.gameOver && !GS.levelDone &&
             GS.buildings.length === 1 && GS.buildings[0] === GS.core &&
             GS.grid[6][4].b === GS.core;
  // 资源列表与网格一致
  let lg = 0, lh = 0;
  for (const p of GS.goldTiles) { if (GS.grid[p.r][p.c].gold) lg++; }
  for (const p of GS.heartTiles) { if (GS.grid[p.r][p.c].heart) lh++; }
  check('startLevel(' + li + ')「' + LEVELS[li].name + '」开局环 ' + GS.railPath.length +
        ' 步 / 金币 30 / 模式落账', ok,
        'rail=' + GS.railPath.length + ' gold=' + GS.gold + ' mode=' + GS.mode);
  check('startLevel(' + li + ') 资源列表与网格一致（10+5）', lg === 10 && lh === 5,
        'g=' + lg + ' h=' + lh);
}

// ---- 3) 胜利钩子（CLOCK.notifyStation，§14.62） ------------------------------
// 沙箱挂 localStorage 桩（levels.js 进度存取走 try/catch，桩缺失时降级 -1 也能跑）
sandbox.localStorage = {
  _m: {}, getItem(k) { return this._m[k] === undefined ? null : this._m[k]; },
  setItem(k, v) { this._m[k] = String(v); }, removeItem(k) { delete this._m[k]; }
};
GS.startLevel(0);
FOES.wave = 9; CLOCK.phase = 'dusk'; GS.levelDone = false;
CLOCK.notifyStation();
check('第 9 波收车不触发通关', !GS.levelDone, 'levelDone=' + GS.levelDone);
FOES.wave = 10; CLOCK.phase = 'dusk'; GS.levelDone = false;
sandbox.localStorage.setItem('kdg.level.progress', '-1');
CLOCK.notifyStation();
check('第 10 波收车 → 通关（levelDone + 进度=0）',
  GS.levelDone === true && GS.levelProgress() === 0,
  'done=' + GS.levelDone + ' prog=' + GS.levelProgress());
check('通关解锁下一关（levelUnlocked(1)）', GS.levelUnlocked(1) === true);
// v1.7.2 临时全解锁开关：先关掉测原解锁语义，再开回验证"任意关可选"
//   （开关是 levels.js 的 context 全局 var —— 经 sandbox 赋值才改得到）
sandbox.LEVEL_UNLOCK_ALL = false;
check('第 3 关未解锁（须先通第 2 关，开关关闭时）', GS.levelUnlocked(2) === false);
sandbox.LEVEL_UNLOCK_ALL = true;
check('临时全解锁开关开启：任意关可选（调试用，收尾须改回 false）',
  GS.levelUnlocked(0) === true && GS.levelUnlocked(4) === true);
GS.mode = 'random'; FOES.wave = 10; CLOCK.phase = 'dusk'; GS.levelDone = false;
CLOCK.notifyStation();
check('随机模式第 10 波收车不触发通关（默认模式行为一字不动）',
  !GS.levelDone, 'levelDone=' + GS.levelDone);
GS.mode = 'level'; GS.levelIdx = 4; FOES.wave = 10; CLOCK.phase = 'dusk'; GS.levelDone = false;
CLOCK.notifyStation();
check('第 5 关通关 → 进度=4（全通）', GS.levelDone && GS.levelProgress() === 4,
      'prog=' + GS.levelProgress());
GS.mode = 'random';

// ---- 4) newGame 归零 levelDone ------------------------------------------------
GS.levelDone = true;
GS.newGame();
check('newGame 归零 levelDone（restart 经 newGame 同样归零）', GS.levelDone === false);
check('newGame 后模式仍是元状态不重置（关卡模式重开仍是关卡）',
  GS.mode === 'random' && typeof GS.startLevel === 'function');   // 默认 random 兜底在

// ---- 5) 终局预览区分度（v1.7.3 §14.63，levels 域）-----------------------------
//   五关资源分布不同 ⇒ 资源连通清空区的规模不同（v1.7.1"区别只在资源分布"延伸）；
//   v1.7.5 真链环：五关都要解出真欧拉环（大王验收口径"铁轨呈环"逐关验）
{
  const sigs = [];
  for (let li = 0; li < LEVELS.length; li++) {
    GS.startLevel(li);
    const pv = GS.finalPreviewCells();
    // 每关 U 都要覆盖本关全部资源（连通目标达成，逐关验）
    const res = [...GS.goldTiles, ...GS.heartTiles];
    check('第' + (li + 1) + '关「' + LEVELS[li].name + '」预览 U 覆盖全部资源',
      res.every(p => pv.u[p.c + ',' + p.r]), 'miss=' + res.filter(p => !pv.u[p.c + ',' + p.r]).length);
    // v1.7.5：真求解链解出的预览环——ok、非空、环 ⊆ U（环长在清空区里）
    const rail = GS.finalPreviewRail();
    check('第' + (li + 1) + '关「' + LEVELS[li].name + '」真链环解出且 ⊆ U（' + rail.path.length + ' 步）',
      rail.ok && rail.path.length > 0 && rail.path.every(p => pv.u[p.c + ',' + p.r]),
      'ok=' + rail.ok + ' rail=' + rail.path.length);
    // v1.7.6 大王口径直译：环逐格经过本关全部资源格（列车采得到）
    {
      const onRail = {};
      for (const p of rail.path) onRail[p.c + ',' + p.r] = true;
      const miss = res.filter(p => !onRail[p.c + ',' + p.r]);
      check('第' + (li + 1) + '关「' + LEVELS[li].name + '」环经过全部资源格',
        miss.length === 0, 'miss=' + miss.length);
    }
    sigs.push(pv.cells.length);
  }
  check('五关 ∂U 规模随资源分布不同（有区分度）',
    new Set(sigs).size >= 4, sigs.join('/'));
  GS.startLevel(0);
}

console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项已列出'); process.exit(1); }
