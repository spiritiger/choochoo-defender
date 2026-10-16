// ============================================================================
// exp.js（v1.6.34 新建）—— 经验系统（词条的唯一获取途径）
//
//   流程（大王拍板 2026-10-13）：
//     夜晚每击杀 1 只怪 → 经验 +1
//       ▼ 经验满（阈值 = 10 + 10 × 已得词条数 ⇒ 10 / 20 / 30 …）
//     记一次"待发牌"（`GS.expPending++`）→ UI 弹三选一（**全是词条卡**）
//       ▼ 选 1 张进牌库 → 拖到**场上任意一座塔**上松手（见 affixes.js）
//
//   ⚠️ 状态放 `GS`（`GS.exp` / `GS.expTaken` / `GS.expPending`），与 `GS.drawCount`
//      同款 —— 这样 `GS.newGame`（state.js，加载序在前）能直接重置，不依赖本文件。
//   ⚠️ 发牌只**记数**（`expPending`），真正弹层由 UI 层（main 循环）消费 ——
//      本模块不碰 DOM，保持可测。
//
//   依赖：GS / CFG。加载序：affixes.js 之后（发牌用 cards.js 的 pickAffixCard）。
// ============================================================================
window.EXP = {};

// 升到"第 n+1 条词条"（n = 已得词条数）所需的经验
EXP.need = function () { return 10 + 10 * (GS.expTaken || 0); };

// 击杀记经验（foes.js 清尸时调）。n 默认 1。经验够就消耗并记一次待发牌。
EXP.add = function (n) {
  if (n === undefined) n = 1;
  GS.exp = (GS.exp || 0) + n;
  var guard = 0;
  while (GS.exp >= EXP.need() && guard++ < 999) {
    GS.exp -= EXP.need();
    GS.expTaken = (GS.expTaken || 0) + 1;
    GS.expPending = (GS.expPending || 0) + 1;
  }
  if (typeof LOG !== 'undefined' && guard > 0) LOG.add('expLevel', { taken: GS.expTaken, pending: GS.expPending });
};

// 取走一次待发牌（UI 弹层时调）：返回是否真的取到
EXP.consume = function () {
  if (!(GS.expPending > 0)) return false;
  GS.expPending -= 1;
  return true;
};

// 进度（HUD 经验条用）：{ cur, need }
EXP.progress = function () { return { cur: Math.floor(GS.exp || 0), need: EXP.need() }; };

// 新局重置（GS.newGame 里直接置字段，这里留一个便利入口给重开链路）
EXP.reset = function () { GS.exp = 0; GS.expTaken = 0; GS.expPending = 0; };
