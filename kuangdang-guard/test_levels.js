// ============================================================================
// 关卡模式回归测试（Node 直接跑，不需要浏览器）：node test_levels.js
//
// 覆盖 v1.7.0/v1.7.1 §14.62（大王令"两种挑战模式" + "关卡也 3×5 开局"纠偏）：
//   1) 关卡表硬约束：13×9、字符集、C 恒 (4,6)、内区 3×5 全空地、
//      **非内区格一律废墟（与随机模式同构）**、金 EXP_GOLD[li] + 5 爱心格、
//      资源无同格叠放（切比雪夫 ≥ 1；2026-10-18 手绘关卡图允许 1 格相邻）
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
// 2026-10-18 大王令：**初始进入游戏默认有限关卡制**（levels.js 默认值 'level'，
//   main.js 开机据此直接 startLevel(0)）。此处断言默认值本身（尚未被本套件改动）。
check('默认模式 = level（初始进入游戏即有限关卡制）', GS.mode === 'level', 'mode=' + GS.mode);

const RES = [[], [], [], [], []];   // 每关资源坐标 [(c,r)]
// 每关金币格数（2026-10-18 大王令：关卡资源量与随机模式 CFG.GOLD_TILES=10 解耦）：
//   五关**已全部**按新标准重排 = 金 13；爱心五关恒 5。
const EXP_GOLD = [13, 13, 13, 13, 13];
// 已按 2026-10-18 新标准重排的关卡（禁 3×3 三连 / 带位配额 / 金 13）：2026-10-18 五关
//   全部重排完毕（外郭/双轴/四缘/环心/边陲），逐关启用 3×3 密度门。
const REWORKED = [true, true, true, true, true];
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
  check('第' + (li + 1) + '关 资源量 ' + EXP_GOLD[li] + ' 金 + 5 爱心',
        nG === EXP_GOLD[li] && nH === 5, 'g=' + nG + ' h=' + nH);
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
  // 资源间距（2026-10-18 大王令：手绘关卡图 1/3/6/9/10 允许 1 格相邻——随机模式
  //   CFG.RES_GAP=2 只管自动撒点；手工关卡以设计图点位为准，硬约束只有"不落同一格"）
  let gapBad = '';
  for (let a = 0; a < RES[li].length; a++) for (let b = a + 1; b < RES[li].length; b++) {
    const d = Math.max(Math.abs(RES[li][a][0] - RES[li][b][0]),
                       Math.abs(RES[li][a][1] - RES[li][b][1]));
    if (d < 1) gapBad += '(' + RES[li][a] + ')-(' + RES[li][b] + ')d' + d + ' ';
  }
  check('第' + (li + 1) + '关 资源无同格叠放（切比雪夫 ≥ 1）', gapBad === '', gapBad);
  // 3×3 密度禁令（2026-10-18 大王令："把禁 3 连斜边改成不允许任意 3×3 范围内出现
  //   3 个资源点"）：逐 3×3 窗口统计资源数，>2 即违规。比只禁对角三连更严——
  //   横/竖三连、任意三点挤进一个 3×3 都会被这条否掉。
  //   ⚠️ 仅对已按新标准重排的关卡生效（REWORKED）；旧手绘关 ②③④⑤ 重排后再启用。
  if (REWORKED[li]) {
    let bad3 = '';
    const rset = new Set(RES[li].map(p => p[0] + ',' + p[1]));
    for (let wr = 0; wr <= CFG.MAP_ROWS - 3; wr++)
      for (let wc = 0; wc <= CFG.MAP_COLS - 3; wc++) {
        let n = 0;
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++)
          if (rset.has((wc + dc) + ',' + (wr + dr))) n++;
        if (n > 2) bad3 += '窗口(' + wc + ',' + wr + ')=' + n + ' ';
      }
    check('第' + (li + 1) + '关 任意 3×3 内资源 ≤2', bad3 === '', bad3);
  }
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
  check('startLevel(' + li + ') 资源列表与网格一致（' + EXP_GOLD[li] + '+5）',
        lg === EXP_GOLD[li] && lh === 5, 'g=' + lg + ' h=' + lh);
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

// ---- 4) newGame 归零 levelDone / 不重置模式元状态 -------------------------------
//   v1.7.0（§14.62）：mode 是"元状态"——newGame 只管这一局，不重置它
//   （2026-10-18 大王令：默认值已改为 'level'）。restart 经 newGame 同样归零 levelDone。
GS.mode = 'level';
GS.levelDone = true;
GS.newGame();
check('newGame 归零 levelDone（restart 经 newGame 同样归零）', GS.levelDone === false);
check('newGame 不重置 GS.mode（元状态：关卡模式重开后仍是关卡）',
  GS.mode === 'level' && typeof GS.startLevel === 'function');


console.log(pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项已列出'); process.exit(1); }
