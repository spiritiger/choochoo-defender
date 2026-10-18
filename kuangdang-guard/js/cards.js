// ============================================================================
// cards.js（v1.6.25 从 state.js 切出）—— 卡牌系统（三选一 / 牌库 / 卡面数据）
//
//   为什么独立：卡牌是"经济/建造入口"这一类规则，与"铁轨求解器"无关，
//   原先一起塞在 state.js 里。搬运时**逐行原样**，只换了宿主文件。
//
//   三类卡：清理形状卡（kind:shape）/ 英雄卡（kind:hero）/ 建筑卡（kind:building）
//   概率：CFG 化的 GS.CARD_RATE（40% / 35% / 25%，大王拍板）；去重按尺寸家族 / 元素 / 建筑种类
//   依赖：CFG / GS / TOWERS（英雄元素表，仅运行时读）。
//   加载序：resources.js 之后（函数体只在运行时被调，先定义后调用无环）。
// ============================================================================
// v1.6.15（大王令 2026-10-10）：下一抽的价格 = 10 + 10 × 已抽次数
//   （首抽 10 → 20 → 30 → …，无上限封顶；沿革：v1.4.4 首抽 10 / v1.4.8 改 5 / 本次改回 10 起步步进 10）。
//   UI 层（按钮文案 / 禁用判断 / 扣费）一律走这里。
GS.drawCost = function () {
  return 10 + 10 * (GS.drawCount || 0);
};

// ---- 三选一：清理形状 + 经济建筑 ----
// v0.6.6：形状随机生成（CFG.randomShape），每张卡自带独立 id，
// 供 UI 高亮/刷新签名用（旧版用 CFG.SHAPES 下标 si，已废）。
GS._cardSeq = 0;
GS.pickShapeCard = function (size) {
  var sh = CFG.randomShape(size);
  return { kind: 'shape', id: ++GS._cardSeq, name: sh.name, cells: sh.cells };
};

// 卡牌去重签名（v0.6.11）：判断"两张卡是不是同一个选项"，也是去重规则的可执行定义。
//   · 形状按**尺寸家族**去重：只看外框两维（小的在前），所以 2×3 和 3×2
//     视为同一形状 —— 大王反馈"偶尔出现三个一样的形状选项"，把旋转也算重。
//   （经济建筑签名 'econ' 随经济建筑退役一并移除；本函数只被形状卡调用。）
GS.cardSig = function (card) {
  var w = 0, h = 0;
  for (var i = 0; i < card.cells.length; i++) {
    if (card.cells[i][0] + 1 > w) w = card.cells[i][0] + 1;
    if (card.cells[i][1] + 1 > h) h = card.cells[i][1] + 1;
  }
  return Math.min(w, h) + 'x' + Math.max(w, h);
};


// ============================================================================
// v1.4 卡牌大改（规格 §14）：新三选一 + 牌库 + 车厢
//   · v1.6.23：三类卡同池 —— 清理形状卡 / 英雄卡 / **建筑卡**（铸币所、加油站）；
//     每张独立概率 CFG 化的 GS.CARD_RATE = 清理 40% / 英雄 35% / 建筑 25%（大王拍板）；
//     去重（形状按尺寸家族、英雄按元素、建筑按种类）；
//   · 形状卡进牌库 ≤ GS.DECK_SHAPE_MAX 张（满了该位顺延英雄卡）；
//   · 抽卡收费在 UI 层（价格 = GS.drawCost()，v1.6.15 起线性递增 10/20/30…），这里只管发牌。
// ============================================================================
GS.DECK_SHAPE_MAX = 3;    // 牌库形状卡上限（大王拍板 ③：一次性消耗、攒≤3）

GS.pickHeroCard = function (elem) {
  return { kind: 'hero', id: ++GS._cardSeq, elem: elem || TOWERS.ELEMS[Math.floor(Math.random() * 4)] };
};

// ---- v1.6.23 建筑卡（铸币所 / 加油站）----
//   · 铸币所 mint：落位后**全场**金币价值 +CFG.MINT_BONUS（多座叠加，大王拍板）；
//   · 加油站 gas ：落位后 3×3 内车头提速（每座 +1 倍速、求和；boost 加速期不生效）。
GS.BUILDINGS = ['mint', 'gas', 'factory'];   // v1.6.35：+军工厂
// ⚠️ 卡面文案（v1.6.33 大王令）：**去掉"（可叠加）"字样** —— 卡面只讲"做什么"，
//   叠加规则是系统口径（多座叠加照旧生效，见 resources.js GS.goldValue / GS.gasCoverAt），
//   不再往卡面堆说明。别为了"提示完整"又加回来。
GS.BUILDING_INFO = {
  mint:    { name: '铸币所', sub: '全场金币价值 +' + CFG.MINT_BONUS },
  gas:     { name: '加油站', sub: '3×3 内列车提速' },
  factory: { name: '军工厂', sub: '车厢攻击 +20%' }   // 相邻聚集 +10% 是系统口径，不上卡面
};
GS.pickBuildingCard = function (bkey) {
  return { kind: 'building', id: ++GS._cardSeq,
           bkey: bkey || GS.BUILDINGS[Math.floor(Math.random() * GS.BUILDINGS.length)] };
};
// （2026-10-15 代码整理：GS.bKey(card) 已删 —— 全项目 0 调用，调用方历来直取
//   card.bkey；清理前版本见 .workbuddy/archive/js-before-code-tidy-20261015/）

// 牌库里形状卡张数
GS.deckShapeCount = function () {
  var n = 0;
  for (var i = 0; i < GS.deck.length; i++) if (GS.deck[i].kind === 'shape') n++;
  return n;
};

// 三类卡的独立出现概率（大王拍板 40/35/25）；改动只动这里
GS.CARD_RATE = { shape: 0.40, hero: 0.35, building: 0.25 };
GS.rollCardKind = function () {
  var r = Math.random();
  if (r < GS.CARD_RATE.shape) return 'shape';
  if (r < GS.CARD_RATE.shape + GS.CARD_RATE.hero) return 'hero';
  return 'building';
};

// 三选一发牌（v1.4 起三张独立随机；v1.6.23 加入建筑卡）
//   ▍2026-10-18 大王令：「首次抽卡三选一时，至少有 1 个废墟清理区域」——
//      本局**第一次**发牌时首张强制为清理形状卡（否则三张全英雄/建筑，开局没牌清废墟、
//      扩张断链）。"首次"按**局**计：标记 `GS.__offerSeen` 由 newGame 清零（重开/换关/
//      切模式都重置），发过一轮即置 true，之后按概率正常发牌。
//   去重：形状按尺寸家族 / 英雄按元素 / 建筑按种类；撞重就重抽。
//   ⚠️ 兜底：建筑只有 2 种，若长时间撞重（重抽 >30 次）改补**英雄卡**（4 种元素，
//      三张必不撞）——保证一定凑满 3 张，且不写"抽重就重抽整组"的循环。
GS.drawCardOffer = function () {
  var cards = [], sigs = {}, guard = 0;
  var first = !GS.__offerSeen;      // 本局首次发牌：首张保底清理形状卡
  GS.__offerSeen = true;
  while (cards.length < 3) {
    guard++;
    var full = GS.deckShapeCount() >= GS.DECK_SHAPE_MAX;   // 形状卡满 → 顺延英雄
    var kind = GS.rollCardKind();
    if (first && cards.length === 0) kind = 'shape';       // 首次三选一：保底一张清理形状
    if (kind === 'shape' && full) kind = 'hero';
    var card, sig;
    if (kind === 'shape') { card = GS.pickShapeCard(); sig = 'shape:' + GS.cardSig(card); }
    else if (kind === 'hero') { card = GS.pickHeroCard(); sig = 'hero:' + card.elem; }
    else { card = GS.pickBuildingCard(); sig = 'bld:' + card.bkey; }
    if (sigs[sig]) {
      if (guard <= 30) continue;
      card = GS.pickHeroCard(); sig = 'hero:' + card.elem;   // 兜底顺延英雄
      if (sigs[sig]) continue;
    }
    sigs[sig] = 1;
    cards.push(card);
  }
  return cards;
};
