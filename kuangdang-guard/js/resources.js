// ============================================================================
// resources.js（v1.6.25 从 state.js 切出）—— 资源格（金币 / 爱心）+ 建筑（铸币所 / 加油站）查询
//
//   为什么独立：这些是"资源/建筑规则"，与"铁轨求解器"完全无关的两类代码，
//   原先一起塞在 state.js（3000+ 行）里。搬运时**逐行原样**，只换了宿主文件。
//
//   内容：① 开局资源格撒点统一规则（金币 / 爱心共用最远点采样 + 最小间距）
//         ② 金币价值（含铸币所加成）/ 加油站覆盖查询 / 唯一的"空地"判据 isFreeSpot
//   依赖：CFG / GS。被 state.js 的 newGame、transport.js、engine.js、towers.js 调用。
//   加载序：紧跟 state.js 之后（函数体只在运行时被调，先定义后调用无环）。
// ============================================================================
// ============================================================================
// 开局资源格撒点（金币 / 爱心）—— **一套规则**（v1.6.22b 大王令 2026-10-13：
//   "关于离散分布方面，爱心和金币都使用一套规则。现在这俩有些时候离太近了"）
// ============================================================================
//
// 统一规则 = 「最远点采样 + 最小间距」，金币与爱心**完全同款**：
//   ① 每落一枚先随机抽 K 个候选（落在 band 内、不是资源/建筑、且在 5×7 初始圈之外）；
//   ② 候选须满足**最小间距** `CFG.RES_GAP`（切比雪夫距离 —— 3×3 邻域内不许有第二枚资源）；
//   ③ 在合格候选里取"到**已有全部资源格**（金币 ∪ 爱心）的最近距离"最大者落子。
//   ⇒ 两类资源共用同一个"已落集合"，新资源对金币和爱心**一视同仁地拉开**，不再出现
//      "爱心贴着金币"。间距凑不齐时自动降一档（2 → 1）重试，保证"能放满就放满、不欠数"。
//
// 两者只有两处参数不同（是同一个规则的**参数**，不是两套规则）：
//   · 金币：全区可落（5×7 之外任意格）；爱心：外圈档 = 地图最外一圈、中圈档 = 5×7 之外非外圈。
//   · 数量不同（GOLD_TILES / HEART_TILES）。
//
// 撒放顺序：**先爱心（受限，先放）、后金币（全区，后放）** —— 先把没得选的放掉，
//   金币再用剩余空间铺开，全局更散（反过来会让爱心被金币挤到贴边）。
//
// 为什么要间距：① 两枚资源贴着看着像"一堆"；② 清一块形状会一次挖出好几枚，
//   削弱"往外扩去收资源"的牵引力。规则对两类资源同款 ⇒ 金币之间也不再扎堆。
//
// 每圈结算见 transport.js：金币驶入 +CFG.GOLD_RATE / 爱心 +1 枚，一圈只算一次。

// 到"已有全部资源格（金币 ∪ 爱心）"的最近**切比雪夫**距离（Infinity = 尚无资源）
GS.resourceMinDist = function (c, r) {
  var m = Infinity, i, d;
  for (i = 0; i < GS.goldTiles.length; i++) {
    d = Math.max(Math.abs(c - GS.goldTiles[i].c), Math.abs(r - GS.goldTiles[i].r));
    if (d < m) m = d;
  }
  for (i = 0; i < GS.heartTiles.length; i++) {
    d = Math.max(Math.abs(c - GS.heartTiles[i].c), Math.abs(r - GS.heartTiles[i].r));
    if (d < m) m = d;
  }
  return m;
};

// 单一撒放器 —— 金币与爱心都走这里，这就是"一套规则"。
//   kind='gold'|'heart'；n 枚；band(c,r) 落点带（null = 全区）。
//   gap = **硬**最小间距（切比雪夫）：3×3 邻域内不许有第二枚资源。
//   放不满 n 枚就返回实际枚数（< n），由外层 `GS.placeResourceInit` 决定整体重试。
GS._placeResource = function (kind, n, band, gap) {
  var cC = Math.floor(CFG.MAP_COLS / 2), cR = Math.floor(CFG.MAP_ROWS / 2);
  var cols = CFG.MAP_COLS, rows = CFG.MAP_ROWS;
  var K = 40;                 // 快路径每枚的随机候选抽样数
  var out = (kind === 'gold') ? GS.goldTiles : GS.heartTiles;
  var legal = function (c, r) {
    if (Math.abs(c - cC) <= 2 && Math.abs(r - cR) <= 3) return false;   // 5×7 初始圈内不放
    if (band && !band(c, r)) return false;                              // 落点带
    var cell = GS.grid[r][c];
    return !(cell.gold || cell.heart || cell.b);                        // 同一格不叠放
  };
  // 挑一枚：① 随机抽 K 个，取"到已有资源最近距离"最大者（保留随机铺开的观感）；
  //   ② 抽到的都不合格 → **全场枚举**取最远者（不能只靠抽样："没抽到"会被误判成
  //      "放不下"而提前退让，实测会直接造成贴身）。
  var pick = function () {
    var best = null, bestScore = -1, k, c, r, d;
    for (k = 0; k < K; k++) {
      c = Math.floor(Math.random() * cols);
      r = Math.floor(Math.random() * rows);
      if (!legal(c, r)) continue;
      d = GS.resourceMinDist(c, r);
      if (d < gap) continue;
      if (d > bestScore) { bestScore = d; best = { c: c, r: r }; }
    }
    if (best) return best;
    var tied = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) {
      if (!legal(c, r)) continue;
      d = GS.resourceMinDist(c, r);
      if (d < gap) continue;
      if (d > bestScore) { bestScore = d; tied = [{ c: c, r: r }]; }
      else if (d === bestScore) tied.push({ c: c, r: r });
    }
    return tied.length ? tied[Math.floor(Math.random() * tied.length)] : null;
  };
  var placed = 0;
  while (placed < n) {
    var b = pick();
    if (!b) break;                                  // 该带内已无满足间距的格 → 交外层重试
    var bc = GS.grid[b.r][b.c];
    if (kind === 'gold') bc.gold = true; else bc.heart = true;    // 注意：**不动 t** —— 埋在废墟里
    bc.harvested = false;
    bc.flash = 0;
    out.push({ c: b.c, r: b.r });
    placed++;
  }
  return placed;
};

// 开局撒金币地块（大王定案 2026-09-21；v0.6.12 修订为"初始即障碍物"：t='rubble' + gold=true，
//   要用清理形状清出成空地后才可铺轨/驶入 +CFG.GOLD_RATE）。
//   v1.6.22b 起与爱心共用 `GS._placeResource`（同一套最远点采样 + 最小间距规则）。
GS.placeGoldInit = function (n, gap) {
  if (gap === undefined) gap = CFG.RES_GAP;
  GS.goldTiles = [];
  if (!GS.heartTiles) GS.heartTiles = [];
  return GS._placeResource('gold', n, null, gap);
};

// 开局撒爱心地块（v1.6.22 大王令）：与金币同构的"埋在废墟里的资源格"，但**偏外圈**
//   （大王令"外圈占比更高"，为路径规划分层：想收满必须把轨一路推到地图边）。
//   撒点走 `GS._placeResource`（与金币同一套规则）：先放外圈的 CFG.HEART_OUTER 枚，
//   再放中圈的其余枚。每枚送到站台回血 CFG.HEART_HEAL 点（交付/重置见 transport.js）。
GS.placeHeartInit = function (gap) {
  if (gap === undefined) gap = CFG.RES_GAP;
  var cols = CFG.MAP_COLS, rows = CFG.MAP_ROWS;
  var cC = Math.floor(cols / 2), cR = Math.floor(rows / 2);
  var isOuter = function (c, r) { return c === 0 || c === cols - 1 || r === 0 || r === rows - 1; };
  var isMid = function (c, r) {
    if (Math.abs(c - cC) <= 2 && Math.abs(r - cR) <= 3) return false;   // 5×7 内不放
    return !isOuter(c, r);
  };
  GS.heartTiles = [];
  if (!GS.goldTiles) GS.goldTiles = [];
  var outerN = Math.min(CFG.HEART_OUTER, CFG.HEART_TILES);
  return GS._placeResource('heart', outerN, isOuter, gap) +
         GS._placeResource('heart', CFG.HEART_TILES - outerN, isMid, gap);
};

// 统一撒点入口（newGame 调用）—— 金币 + 爱心一起放，**整体可重试**：
//   要求"两类资源彼此之间、同类之间都 ≥ CFG.RES_GAP（切比雪夫）"；放不满就清空重来，
//   重试 12 次仍不满 → 退到间距 1 兜底（只保证不叠格；300 局实测从未走到这一步）。
//   为什么是"整体重试"而不是"就地降档"：贪心可能把自己走死——该环带上限 26 枚 > 需求 19 枚
//   （行 DP 精确解），换个起点/顺序就放得下；就地降档会让个别盘直接贴身。
GS.placeResourceInit = function () {
  var ok = false;
  for (var attempt = 0; attempt < 12 && !ok; attempt++) {
    GS._clearResources();
    ok = (GS.placeHeartInit() === CFG.HEART_TILES) &&
         (GS.placeGoldInit(CFG.GOLD_TILES) === CFG.GOLD_TILES);
  }
  if (!ok) {
    GS._clearResources();
    GS.placeHeartInit(1);
    GS.placeGoldInit(CFG.GOLD_TILES, 1);
  }
};

// 清空资源格（重试用）：把已落标记从地形上抹掉，两个资源列表也清空
GS._clearResources = function () {
  var i, t;
  for (i = 0; i < GS.goldTiles.length; i++) { t = GS.goldTiles[i]; GS.grid[t.r][t.c].gold = false; }
  for (i = 0; i < GS.heartTiles.length; i++) { t = GS.heartTiles[i]; GS.grid[t.r][t.c].heart = false; }
  GS.goldTiles = [];
  GS.heartTiles = [];
};

// ---- v1.6.23 建筑（铸币所 / 加油站）：唯一的"空地"判据 ----
//   空地 = 已清空空白格 + 无任何建筑 + 非金币格 + 非爱心格 + 非铁轨格。
//   ⚠️ 塔（TOWERS.isFreeSpot）与建筑卡**共用这一条**（唯一定义，别再写第二份）。
GS.isFreeSpot = function (c, r) {
  if (!CFG.inBounds(c, r)) return false;
  var cell = GS.grid[r][c];
  if (cell.t !== 'blank') return false;   // 废墟/障碍不行
  if (cell.b) return false;               // 已有建筑（含塔、镇中心、铸币所、加油站）
  if (cell.gold) return false;            // 金币格 = 资源格，不占用
  if (cell.heart) return false;           // 爱心格 = 资源格，不占用（v1.6.22）
  if (GS.onRail(c, r)) return false;      // 铁轨格不占（列车不做碰撞，视觉重叠即逻辑荒谬）
  return true;
};
// 【铸币所】座数 → 金币价值 = CFG.GOLD_RATE + MINT_BONUS × 座数（叠加，大王拍板）
GS.mintCount = function () {
  var n = 0;
  for (var i = 0; i < GS.buildings.length; i++) if (GS.buildings[i].type === 'mint') n++;
  return n;
};
GS.goldValue = function () { return CFG.GOLD_RATE + CFG.MINT_BONUS * GS.mintCount(); };
// 【加油站】覆盖 (c,r) 的座数（3×3 ⇒ 切比雪夫 ≤ CFG.GAS_RANGE）
GS.gasCoverAt = function (c, r) {
  var n = 0;
  for (var i = 0; i < GS.buildings.length; i++) {
    var b = GS.buildings[i];
    if (b.type !== 'gas') continue;
    if (Math.max(Math.abs(b.c - c), Math.abs(b.r - r)) <= CFG.GAS_RANGE) n++;
  }
  return n;
};
// 【军工厂】（v1.6.35 大王令）车厢攻击加成（小数，0.2 = +20%）。
//   规则：每座 +CFG.FACTORY_BASE；**每有一对相互在十字范围内的军工厂（曼哈顿 ≤1），
//   额外 +CFG.FACTORY_ADJ**（按**相邻对**计一次，不逐厂重复计）。
//   ⇒ 总加成 = BASE×座数 + ADJ×相邻对数：1 座 20%、两座相邻 50%、两座远离 40%、
//     三座连成一线 80%（60% + 2 对）—— "堆在一起更强"的聚集激励。
//   ⚠️ 效果是**查询式**（不是落位时写死）：拆/加厂自动重算，与铸币所同款口径。
GS.wagonAtkBonus = function () {
  var fs = [], i, j, pairs = 0;
  for (i = 0; i < GS.buildings.length; i++) if (GS.buildings[i].type === 'factory') fs.push(GS.buildings[i]);
  for (i = 0; i < fs.length; i++) {
    for (j = i + 1; j < fs.length; j++) {
      if (Math.abs(fs[j].c - fs[i].c) + Math.abs(fs[j].r - fs[i].r) === 1) pairs++;
    }
  }
  return CFG.FACTORY_BASE * fs.length + CFG.FACTORY_ADJ * pairs;
};
// 单座军工厂自己的贡献（BASE + ADJ×它与多少座其他厂相邻）—— 生效反馈标注用
//   （v1.6.36 大王令"军工厂的生效 UI 反馈只针对军工厂"：在建筑上直接标 %，不标铁轨）
GS.factoryShare = function (b) {
  if (!b || b.type !== 'factory') return 0;
  var adj = 0;
  for (var i = 0; i < GS.buildings.length; i++) {
    var g = GS.buildings[i];
    if (g === b || g.type !== 'factory') continue;
    if (Math.abs(g.c - b.c) + Math.abs(g.r - b.r) === 1) adj++;
  }
  return CFG.FACTORY_BASE + CFG.FACTORY_ADJ * adj;
};
// （2026-10-15 代码整理：GS.factoryCovers(c,r) 已删 —— 全项目 0 调用（军工厂范围
//   高亮实为 renderer 内联实现），注释口径"是否覆盖"与实现（计数）也不符；
//   清理前版本见 .workbuddy/archive/js-before-code-tidy-20261015/）
