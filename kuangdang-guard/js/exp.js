// ============================================================================
// exp.js（v1.6.34 新建；v1.8u 四拍板改版 §14.83）—— 经验系统（词条的唯一获取途径）
//
//   流程（v1.8u 四拍板 2026-10-19）：
//     夜晚每击杀 1 只怪 → 经验 +killGain（= 本波总经验 CFG.WAVE_EXP[波] / 本波怪数，
//       **波次均分**：波总额按怪数平均分配，总和恰 = 波总额不超发）
//       ▼ 经验满（阈值 = 等级曲线 3500 + (等级-1)×300，等级 = 已得词条数+1；
//         L1→L2 = 3500 … L24→L25 = 10400；**25 级封顶**不再升级）
//     记一次"待发牌"（`GS.expPending++`）→ UI 弹三选一（**全是词条卡**）
//       ▼ 选 1 张进牌库 → 拖到**场上任意一座塔**上松手（见 affixes.js）
//
//   旧口径退役：每怪固定 +1、阈值 10+10×已得词条数（10/20/30…）。
//
//   ⚠️ 状态放 `GS`（`GS.exp` / `GS.expTaken` / `GS.expPending`），与 `GS.drawCount`
//      同款 —— 这样 `GS.newGame`（state.js，加载序在前）能直接重置，不依赖本文件。
//   ⚠️ 发牌只**记数**（`expPending`），真正弹层由 UI 层（main 循环）消费 ——
//      本模块不碰 DOM，保持可测。
//
//   依赖：GS / CFG / FOES（killGain 查波次与怪数）。加载序：affixes.js 之后
//   （发牌用 cards.js 的 pickAffixCard；运行时才查 FOES，加载序无环）。
// ============================================================================
window.EXP = {};

// 波次经验取值：w≤10 取表第 w 项；w>10 封顶取最后一项（关卡模式 10 波全清即胜，
//   无限模式后期按顶格处理）
CFG.waveExp = function (w) {
  var t = CFG.WAVE_EXP;
  return t[Math.min(Math.max(w, 1), t.length) - 1];
};

// 每怪击杀经验 = 本波总经验 / 本波怪数（无状态均分，波内每只相同）
EXP.killGain = function () {
  return CFG.waveExp(FOES.wave) / FOES.CFG.count(FOES.wave);
};

// 升到"第 n+1 条词条"所需经验（n = 已得词条数；等级 = n+1）：
//   3500 + (等级-1)×300 → 3500 / 3800 / … / 10400（L24→L25）；**25 级封顶**（Infinity
//   = 永不满，EXP.add 的 while 自然停摆，不再发牌）
EXP.need = function () {
  var lvl = (GS.expTaken || 0) + 1;
  if (lvl >= 25) return Infinity;
  return 3500 + (lvl - 1) * 300;
};

// 击杀记经验（foes.js 清尸时调 EXP.add(EXP.killGain())）。经验够就消耗并记一次待发牌。
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

// 进度（HUD 经验条用）：{ cur, need }；25 级封顶 → 满条（cur=need=1）
EXP.progress = function () {
  var need = EXP.need();
  if (!isFinite(need)) return { cur: 1, need: 1 };
  return { cur: Math.floor(GS.exp || 0), need: need };
};

// 新局重置（GS.newGame 里直接置字段，这里留一个便利入口给重开链路）
EXP.reset = function () { GS.exp = 0; GS.expTaken = 0; GS.expPending = 0; };
