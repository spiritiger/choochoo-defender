// ============================================================================
// affixes.js —— 词条系统（数据 + **全局生效** API）
//
//   来源：DIYPathTowerDefense 的 `src/data/affixes.json`（4 塔型 × 5 条 = 20 条，
//   原文只有"描述"、无实现）—— 归档见 `.workbuddy/archive/DIYPathTowerDefense-src-20261013/`。
//   移植口径（大王拍板 2026-10-13）：**等价落地**（不强求 1:1 复刻原描述）。
//
//   ▍v1.6.36 大王令**改版**（推翻 v1.6.34 的"装配"模型）：
//     「技能卡不需要装备，选择了之后对场上所有对应的建筑/车厢生效，不需要装备」
//     「技能卡在随机时，无视场上已有建筑，直接从所有 4 个角色里随机」
//     ⇒ 新模型 = **全局词条集合**（`GS.playerAffixes`）：
//       · 三选一选中 → **立即全局生效**，作用于场上**所有**对应塔型的车厢；
//       · 不进牌库、不需要拖拽装配；**同塔型多条词条可并存**（各次三选一独立获得）；
//       · 发牌 = 排除已获得后从全部词条**纯随机**（不看场上有没有对应塔）。
//     旧"拖到塔上装配、每塔上限 1"的 API 已随 2026-10-15 代码整理移除（原文见
//     归档 .workbuddy/archive/js-before-cleanup-20261015/affixes.js 文件尾）。
//
//   效果实现：**数据在这里，逻辑在 engine**（`ENG.affixOnHit` / wagonCombat 按
//   `GS.hasAffix(id)` 逐条查）—— 防止"数据与逻辑写两处漂移"。
//
//   依赖：GS / TOWERS（运行时读，仅文案用）。加载序：towers.js 之后、exp.js 之前。
// ============================================================================
window.AFFIXES = {};

// 20 条词条。字段：id / tower（属哪座塔型）/ name（DIY 原名）/ desc（DIY 原描述）/
//   land（**我们的等价落地效果**，卡面展示用；实现见 engine.js 的词条分支）
AFFIXES.DATA = {
  // ---- 🔫 机枪 arrow ----
  a1: { tower: 'arrow', name: '散射箭', desc: '攻击从单体变为扇形发射3支箭。',
        land: '单发 → 同时打射程内最近的 3 只（主目标 100%，其余 30%）' },
  a2: { tower: 'arrow', name: '钉刺', desc: '击中时有15%概率令目标定身0.5秒。',
        land: '命中 15% 概率强减速 1.5s（速度 ×0.15）' },
  a3: { tower: 'arrow', name: '撕裂标记', desc: '连续命中使敌人更易受伤。',
        land: '命中叠易伤 1 层（机枪对其伤害 +20%/层，上限 3 层，3s）' },
  a4: { tower: 'arrow', name: '影锁共鸣', desc: '击中目标时将其与附近怪物进行影锁链接。',
        land: '命中时与最近 1 只怪影锁 3s：命中伤害的 60% 传递给被锁怪' },
  a5: { tower: 'arrow', name: '箭雨', desc: '每攻击8次向怪群降下追踪箭雨。',
        land: '每第 8 次攻击，对全场怪降一次箭雨（每只 0.5×dmg）' },
  // ---- � 火炮 cannon ----
  c1: { tower: 'cannon', name: '哑弹布雷', desc: '爆炸后散落感应地雷，踩中引发短眩晕。',
        land: '爆炸后在命中格留 1 颗雷（怪踩中 → 减速 70% / 1.5s，雷消失）' },
  c2: { tower: 'cannon', name: '冲击震退', desc: '爆炸将范围内怪物向外物理击退1格。',
        land: '爆炸把溅射圈内的怪沿远离方向击退 1 格（不越界）' },
  c3: { tower: 'cannon', name: '弹头分裂', desc: '空中分裂成3颗子弹头，爆破范围扩大。',
        land: '溅射半径 1.3 → 1.65（约 3×3 九格）' },
  c4: { tower: 'cannon', name: '烈焰燃油', desc: '爆炸区产生持续3秒的魔法燃烧地带。',
        land: '爆炸区留 3s 灼烧地带（进入即 0.3×dmg/s）' },
  c5: { tower: 'cannon', name: '蓄势轰击', desc: '连续3秒未开火，下次爆炸半径增加50%。',
        land: '连续 6s 未开火 → 下次溅射半径 ×1.5、伤害 ×1.5' },
  // ---- ⚡ 闪电 magic ----
  m1: { tower: 'magic', name: '电弧弹射', desc: '攻击化为闪电链，额外弹射3个目标。',
        land: '命中后弹射 2 个额外目标（40% / 20% 伤害）' },
  m2: { tower: 'magic', name: '融穿', desc: '每次命中永久削减敌人15%魔抗。',
        land: '每次命中叠 1 层易伤（闪电对其伤害 +30%/层，上限 2 层，持续到该怪死亡）' },
  m3: { tower: 'magic', name: '能量溢出', desc: '过量击杀伤害对周围产生聚能爆破法伤。',
        land: '闪电车厢击杀时对 3×3 内其他怪造成 0.5×过量伤害（这一击打穿的富余量）' },
  m4: { tower: 'magic', name: '极化磁场', desc: '击中前两个目标产生磁极吸引物理重叠。',
        land: '命中把目标朝最近的其他怪拉 1 格（纯聚怪，不改变赶路进度）' },
  m5: { tower: 'magic', name: '超频', desc: '连击同目标叠加攻速，最高提升60%。',
        land: '连续命中同一目标，攻速递增：每击间隔 ×0.925，最多 −37.5%' },
  // ---- ❄️ 冰环 ice ----
  i1: { tower: 'ice', name: '深层冻结', desc: '攻击已减速目标有概率使其完全冰冻。',
        land: '对已减速目标命中时 20% 概率冻结（速度 ×0.1，1.5s）' },
  i2: { tower: 'ice', name: '寒流破裂', desc: '命中冰冻怪引发冰爆，使全图减速加深。',
        land: '命中已减速目标 → 冰爆：3×3 内全体附加 1.5s 减速' },
  i3: { tower: 'ice', name: '霜痕路径', desc: '受击怪物身后留下一条减速霜痕地带。',
        land: '受击怪身后留减速地面（该格经过的怪减速 40%，持续 4s）' },
  i4: { tower: 'ice', name: '极寒禁锢', desc: '冰环的伤害和减速作用光环半径扩大。',
        land: '该车厢射程 +0.6 格（2.2 → 2.8），减速时长 +0.5s' },
  i5: { tower: 'ice', name: '冷血追击', desc: '对受控目标伤害倍增，并延长控制时间。',
        land: '对已减速目标伤害 ×1.6，并刷新减速至 2s' }
};

// 词条按塔型分组（渲染角标用）
AFFIXES.BY_TOWER = function (tower) {
  var out = [];
  for (var k in AFFIXES.DATA) if (AFFIXES.DATA[k].tower === tower) out.push(k);
  return out;
};
// 全部 id
AFFIXES.IDS = (function () {
  var a = [];
  for (var k in AFFIXES.DATA) a.push(k);
  return a;
})();

AFFIXES.get = function (id) { return AFFIXES.DATA[id] || null; };

// ---- 全局生效 API（v1.6.36，唯一入口）---------------------------------------
// 玩家是否已获得某条词条（**全局**：一旦获得，场上所有对应塔型的车厢都吃到效果）
GS.hasAffix = function (id) { return !!(GS.playerAffixes && GS.playerAffixes[id]); };

// 获得词条：选中即全局生效（场上所有对应塔型的塔闪一下，作"生效中"反馈）
GS.gainAffix = function (id) {
  var d = AFFIXES.get(id);
  if (!d || GS.hasAffix(id)) return false;
  GS.playerAffixes[id] = 1;
  for (var i = 0; i < GS.towers.length; i++) {
    if (GS.towers[i].elem === d.tower) GS.towers[i].flash = 0.4;
  }
  if (typeof LOG !== 'undefined') LOG.add('affix',
    { id: id, name: d.name, tower: d.tower, global: true });
  return true;
};

// 某塔型已获得的词条数（渲染角标用，≤5）
GS.affixCountOf = function (tower) {
  var list = AFFIXES.BY_TOWER(tower), n = 0;
  for (var i = 0; i < list.length; i++) if (GS.hasAffix(list[i])) n++;
  return n;
};

// 经验满时弹的**三选一（全是词条卡）**。
//   ▍v1.6.36 大王令：「随机时无视场上已有建筑，直接从所有 4 个角色里随机」
//   ⇒ 不再看场上有没有对应塔型，从**全部词条**里纯随机取 3；唯一过滤 = **排除
//   已获得的**（重复获得无效，发了就是废牌）。
GS.drawAffixOffer = function () {
  var pool = [], i;
  for (i = 0; i < AFFIXES.IDS.length; i++) {
    if (!GS.hasAffix(AFFIXES.IDS[i])) pool.push(AFFIXES.IDS[i]);
  }
  for (var k = pool.length - 1; k > 0; k--) {
    var j = Math.floor(Math.random() * (k + 1));
    var tmp = pool[k]; pool[k] = pool[j]; pool[j] = tmp;
  }
  var cards = [];
  for (i = 0; i < 3 && i < pool.length; i++) cards.push(GS.pickAffixCard(pool[i]));
  return cards;
};


// ---- 词条卡（kind:'affix'，只在经验三选一里出现，选中即生效不进牌库）--------
GS.pickAffixCard = function (id) {
  if (!id) id = AFFIXES.IDS[Math.floor(Math.random() * AFFIXES.IDS.length)];
  return { kind: 'affix', id: ++GS._cardSeq, aid: id };
};
