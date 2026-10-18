# 退役记录 · 死代码/失活代码清理（2026-10-18）

> 大王令：「有没有其他可以丢进退役记录的代码？」
> 本批 = A 档 5 项（零引用/纯留档）+ B1（econ 经济建筑全链路）。
> 下列为**从源码切除的原文**，仅供回溯；代码已不再被任何路径引用。
> 已知影响：导出文本里含 `E`（旧经济建筑）的**旧盘将不再可导入**（报「不识别字符：E」）。

## js/engine.js — ENG.hitStop（v1.6.80 全场静止顿帧退役 helper，调用点已清空）

```js
// ⚠️【v1.6.80 退役】全场静止顿帧：大王令"顿的应该是敌方单位，不是游戏"（§14.56）——
//   撞击改挂 fo.stun（怪定身，foes.js 行动闸）。helper 保留代码备查（无 VCS 惯例），
//   调用点已清空、main.js 消费已退役——请勿再调用。
// 顿帧（v1.6.74 大王令"最好还能有顿帧之类的停顿效果"）：GS.hitStop 秒内 main.js
//   跳过整个模拟（渲染照常）——全场静止一瞬。取 max 不叠加：同帧撞一片怪只停一次。
ENG.hitStop = function (s) {
  GS.hitStop = Math.max(GS.hitStop || 0, s);
};
```

## js/engine.js — ENG.placeEcon（v1.3-rc 经济建筑建造，冻结未调用）

```js
// ---- 建造经济建筑（需已清空空白格 + 紧贴铁轨；金币地块是资源格，不可占用）----
// ⚠️【v1.3-rc 退役】经济建筑随三选一一起退役（拍板分叉 ①），本函数冻结保留不调用
//   （test_rules 既有用例仍依赖；TRANS.serviceCell 的 econ 收款分支同理保留——
//   旧存档/回退盘面可能还有 econ 建筑）。转正后可整体清理。
ENG.placeEcon = function (c, r) {
  var cell = GS.grid[r][c];
  if (cell.t !== 'blank') return '这里是废墟，先清理';
  if (cell.gold) return '金币地块，不可建造';
  if (cell.heart) return '爱心地块，不可建造';
  if (GS.onRail(c, r)) return '铁轨地块，不可建造';
  if (cell.b) return '已有建筑';
  if (!GS.railNeighbor(c, r)) return '需紧贴铁轨';
  var b = { type: 'econ', c: c, r: r, rate: CFG.ECON_RATE, flash: 0 };
  cell.b = b;
  GS.buildings.push(b);
  GS.recomputeRails();
  return true;
};

```

## js/towers.js — TOWERS.__towerAtk_retired（旧塔单体攻击循环，v1.4.2 退役留档）

```js
// ⚠️ 退役留档：旧"塔单体攻击"循环（v1.3-rc~v1.4.1）。复活要点：塔对象带
//   cd/flash 字段、TOWERS.CFG.STATS 提供元素伤害表、连线塞 TOWERS.beams。
TOWERS.__towerAtk_retired = function (dt) {
  if (GS.gameOver) return;
  var foes = GS.foes;
  if (!foes || !foes.length) return;
  var core = GS.core;
  for (var i = 0; i < GS.towers.length; i++) {
    var t = GS.towers[i];
    if (t.flash > 0) t.flash -= dt;
    t.cd -= dt;
    if (t.cd > 0) continue;
    var st = TOWERS.CFG.STATS[t.elem];
    // 选目标：射程内、离镇中心最近（直线冲的怪里最前面的）
    var best = null, bestD = Infinity;
    for (var j = 0; j < foes.length; j++) {
      var f = foes[j];
      var dx = f.c - t.c, dy = f.r - t.r;
      if (dx * dx + dy * dy > TOWERS.CFG.RANGE * TOWERS.CFG.RANGE) continue;
      var dc = f.c - core.c, dr = f.r - core.r;
      var dCore = dc * dc + dr * dr;
      if (dCore < bestD) { bestD = dCore; best = f; }
    }
    if (!best) continue;
    best.hp -= st.dmg * t.star;             // 星级倍率
    t.cd = st.rate;
    t.flash = 0.25;
    TOWERS.beams.push({ ac: t.c, ar: t.r, bc: best.c, br: best.r, t: 0.12 });
  }
};

```

## js/towers.js — TOWERS.CFG.RANGE + TOWERS.CFG.STATS（仅退役函数引用）

```js
  RANGE: 2.5,          // （旧字段，仅 __towerAtk_retired 用）
  // ⚠️ 旧元素数值表（仅 `__towerAtk_retired` 那个退役函数还引用）。**新塔型数值走
  //    `TOWERS.TYPES`**；这张表只为"退役函数万一被复活时不至于崩"而保留。
  STATS: {
    arrow:  { dmg: 12, rate: 1.2 },
    cannon: { dmg: 30, rate: 3.0 },
    magic:  { dmg: 24, rate: 2.4 },
    ice:    { dmg: 8,  rate: 1.0 }
  }
```

## js/towers.js — TOWERS.CFG 收尾（去掉末项逗号）

```js
  COST: 10,            // 抽塔价格（大王定案 10 金币/次）
```

## js/clock.js — CLOCK.darkness（恒 0 兼容残留，0 调用点）

```js
// v1.3.4 遮罩已删：防守/建造画面亮度一致，darkness 恒 0（renderer 兼容保留）。
CLOCK.darkness = function () { return 0; };

```

## js/renderer.js — REND.C.econ（经济建筑主色）

```js
  econ: '#35b06a',
```

## js/renderer.js — REND.C.towerRGB（塔射程环色板，环已退役）

```js
  // 攻击范围环用的 rgb 模板串（与上面一一对应；车头 = 攻击连线同款浅紫）
  towerRGB: { arrow: '247,217,76', cannon: '232,86,63', magic: '168,85,247', ice: '110,198,255' },
```

## js/renderer.js — REND.building 的 econ 绘制分支

```js
  } else if (b.type === 'econ') {
    ctx.fillStyle = REND.C.econ;
    ctx.fillRect(cx - s / 2, cy - s / 2, s, s);
    // 屋顶
    ctx.fillStyle = '#1f7a4d';
    ctx.beginPath();
    ctx.moveTo(cx - s / 2, cy - s * 0.05);
    ctx.lineTo(cx, cy - s / 2 - s * 0.18);
    ctx.lineTo(cx + s / 2, cy - s * 0.05);
    ctx.closePath(); ctx.fill();
    // 金币点
    ctx.fillStyle = REND.C.gold; ctx.beginPath(); ctx.arc(cx, cy + s * 0.2, 3.4, 0, 7); ctx.fill();
    if (b.flash > 0) {
      ctx.strokeStyle = 'rgba(240,180,41,' + (b.flash * 3) + ')'; ctx.lineWidth = 2;
      ctx.strokeRect(cx - s / 2 - 1, cy - s / 2 - 1, s + 2, s + 2);
    }
```

## js/renderer.js — 塔绘制注释：去掉失效的 towerRGB 引用

```js
    //   星点与命中闪光沿用 v1.3-rc 口径。元素色板与 towerRGB 不动（牵连车厢/范围环）。
```

## js/renderer.js — 夜遮罩注释：去掉失效的 CLOCK.darkness() 引用

```js
  //   阶段区分只靠开波按钮文案与状态栏；CLOCK.darkness() 恒 0 保留兼容。
```

## js/transport.js — TRANS.serviceCell 的 econ 贴轨收款分支

```js
  var n = GS.neighbors(cell.c, cell.r);
  for (var i = 0; i < n.length; i++) {
    var b = GS.buildingAt(n[i][0], n[i][1]);
    if (!b || b.type !== 'econ') continue;
    TRANS.load(b.rate);            // 同上：车斗累积
    TRANS.picked('gold');          // v1.6.25：经济建筑每经过一次也算一次拾取
    b.flash = 0.35;
  }
```

## js/state.js — GS.newGame 内 GS.offer 清空（只写不读，nextOffer 已移除）

```js
  GS.offer = [];

```

## js/state.js — GS.importMap 的 E 字符（旧盘经济建筑）兼容分支：else-if 去掉 E

```js
      } else if (ch === 'M' || ch === 'F' || ch === 'A' || ch === 'E') {
```

## js/state.js — GS.importMap 的 E 字符兼容分支：建筑三元折叠为 factory 兜底

```js
        var bt = (ch === 'M') ? 'mint' : (ch === 'F') ? 'gas'
               : (ch === 'A') ? 'factory' : 'econ';                   // E = 退役经济建筑（旧盘兼容）
```

## js/state.js — GS.importMap 的 E 字符兼容分支：econ 的 rate 赋值

```js
        if (bt === 'econ') bl.rate = CFG.ECON_RATE;
```

## js/state.js — GS.importMap 落账行内的 GS.offer 清空

```js
  GS.fx = []; GS.floats = []; GS.undoClean = null; GS.offer = [];
```

## js/cards.js — GS.cardSig 的非形状卡 econ 签名分支（死分支，调用方全为形状卡）

```js
  if (card.kind !== 'shape') return 'econ';
```

## js/cards.js — GS.cardSig 注释校正

```js
//   · 经济建筑只有一种，签名固定 'econ' → 最多出现一张。
```

## js/config/map.js — CFG.ECON_RATE（贴轨经济建筑收款常量）

```js
  ECON_RATE: 6,       // 列车每经过一次贴轨经济建筑 +6 金币
```

## js/affixes.js — [D] 注释校正：留档块已不在文件尾

```js
//     旧"拖到塔上装配、每塔上限 1"的 API 冻结留档在文件尾（无 VCS 回退保险）。
```

## test_tower.js — [测试同步] [23] 改为断言退役函数确实不存在

```js
check('[23] 塔攻击循环已退役（__towerAtk_retired 留档）',
  typeof TOWERS.__towerAtk_retired === 'function' && typeof TOWERS.update === 'function');
```

## test_rules.js — [测试同步] 规则 4c/4c2（ENG.placeEcon 金币格建造拒绝）

```js
    // 规则 4c：金币地块不可建经济建筑
    //   v0.6.12：未清理时它是废墟 → 先报"这里是废墟，先清理"；
    //   清出来（空地 + 金币）之后 → 报"金币地块，不可建造"。
    const res1 = ENG.placeEcon(gt.c, gt.r);
    check('规则4c：未清理的金币格不可建造（视作废墟）', res1 === '这里是废墟，先清理', String(res1));
    const gtT = GS.grid[gt.r][gt.c].t;
    GS.grid[gt.r][gt.c].t = 'blank';
    const res = ENG.placeEcon(gt.c, gt.r);
    GS.grid[gt.r][gt.c].t = gtT;
    check('规则4c2：金币地块（已清出）不可建造经济建筑', res === '金币地块，不可建造', String(res));
```

## test_rules.js — [测试同步] 爱心 8/9（ENG.placeEcon 爱心格建造拒绝）

```js
  // 建造拒绝
  GS.newGame();
  const h1 = GS.heartTiles[0];
  check('爱心8：未清理的爱心格不可建造（视作废墟）',
    ENG.placeEcon(h1.c, h1.r) === '这里是废墟，先清理');
  GS.grid[h1.r][h1.c].t = 'blank';
  check('爱心9：清出后的爱心格不可建造经济建筑',
    ENG.placeEcon(h1.c, h1.r) === '爱心地块，不可建造');
```

## test_rules.js — [测试同步] 货堆 5（贴轨经济建筑拾取记账）

```js
  // 贴轨经济建筑每经过一次也算一次拾取（金币图标）
  let rail0 = null, host = null;
  for (const rc of GS.railPath) {
    for (const [nc, nr] of GS.neighbors(rc.c, rc.r)) {
      const cell = GS.grid[nr][nc];
      if (cell.t === 'blank' && !cell.b && !cell.gold && !cell.heart && !GS.onRail(nc, nr)) { rail0 = rc; host = { c: nc, r: nr }; break; }
    }
    if (host) break;
  }
  if (host) {
    const nb = GS.train.picked.length;
    ENG.placeEcon(host.c, host.r);
    TRANS.serviceCell({ c: rail0.c, r: rail0.r });
    check('货堆5：贴轨经济建筑每经过一次 → picked +1 枚 gold',
      GS.train.picked.length === nb + 1 && GS.train.picked[nb] === 'gold',
      JSON.stringify(GS.train.picked));
  } else {
    check('货堆5：（本盘开局轨旁无空地，跳过）', true);
  }
```
