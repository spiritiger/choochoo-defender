// ============================================================================
// 渲染层回归（v1.6.29 新建）—— 铁轨/列车这类"纯表现"的东西此前没有常驻回归，
//   每轮都靠临时脚本取证（跑完就删）。本套件把最容易被改坏、又最影响观感的几条
//   钉死，防"改 A 忘 B"。
//
//   ▍测法：**无头抓绘制指令** —— 用一个记录型假 ctx 跑 REND.draw，
//     拦截 REND.coin / REND.heart 等基元的调用（附世界坐标换算：假 ctx 维护
//     变换栈，save/restore/translate/rotate 逐条记账），于是"本地坐标"能还原成
//     "屏幕上到底画在哪"。这比截图比对稳定得多，也不需要浏览器。
//   ▍边界：renderer.js 只写 `window.REND = {}`、不碰 DOM ⇒ 可在裸沙箱里加载。
//     ui.js / main.js 需 DOM，不在本套件范围。
// ============================================================================
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname);
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; failures.push(name + (extra ? '  <' + extra + '>' : '')); console.log('  ✗ ' + name + (extra ? '  <' + extra + '>' : '')); }
}

// ---- 记录型假 ctx（带变换栈，可把本地坐标换算成世界坐标）----
function makeCtx() {
  const st = [{ x: 0, y: 0, a: 0 }];
  const cur = () => st[st.length - 1];
  const c = {};
  for (const m of ['clearRect', 'fillRect', 'strokeRect', 'beginPath', 'closePath', 'fill', 'stroke',
    'scale', 'moveTo', 'lineTo', 'arc', 'arcTo', 'bezierCurveTo', 'fillText', 'strokeText',
    'setLineDash', 'clip', 'rect', 'quadraticCurveTo', 'ellipse']) c[m] = () => {};
  c.measureText = () => ({ width: 10 });
  // v1.8u 八令：gradient mock —— mintStack 叠币的呼吸金光走 createRadialGradient，
  //   此前假 ctx 没有它 ⇒ n>0 分支一进就 TypeError（测试从未摆铸币所所以没炸过）
  c.createRadialGradient = () => ({ addColorStop: () => {} });
  c.createLinearGradient = () => ({ addColorStop: () => {} });
  // v1.8u 六令：记录 fillRect（连同 fillStyle）—— 拖拽预览两态（标准淡底/命中高亮）断言用
  c._rects = [];
  c.fillRect = (x, y, w, h) => c._rects.push({ x: x, y: y, w: w, h: h, fill: c.fillStyle });
  c.texts = [];                                  // 记录 fillText（连同当时的 fillStyle / globalAlpha），
  c.fillText = (t, x, y) => c.texts.push({ t: t, x: x, y: y, fill: c.fillStyle, a: c.globalAlpha });
  // v1.8u：记录 arc 参数（仿 texts）——此前 arc 是全空函数，"弯道弧画错"这类
  //   形状问题零告警漏网（大王两报"加油站的弧线不对"的病根之一）
  c._arcs = [];
  c.arc = (x, y, r, a0, a1, ccw) =>
    c._arcs.push({ x: x, y: y, r: r, a0: a0, a1: a1, ccw: !!ccw, stroke: c.strokeStyle, w: c.lineWidth });
  // v1.8u：记录 moveTo/lineTo 线段（T 岔贴轨中心线断言用；moveTo 起笔、lineTo 落段）
  c._segs = [];
  let _pen = null;
  c.moveTo = (x, y) => { _pen = { x: x, y: y }; };
  c.lineTo = (x, y) => {
    if (_pen) c._segs.push({ x1: _pen.x, y1: _pen.y, x2: x, y2: y, stroke: c.strokeStyle, w: c.lineWidth });
    _pen = { x: x, y: y };
  };
  c.globalAlpha = 1;                             // 供"文字浮标 / 淡出"类断言
  c.save = () => st.push({ x: cur().x, y: cur().y, a: cur().a });
  c.restore = () => { if (st.length > 1) st.pop(); };
  c.translate = (dx, dy) => {
    const q = cur(), a = q.a;
    q.x += dx * Math.cos(a) - dy * Math.sin(a);
    q.y += dx * Math.sin(a) + dy * Math.cos(a);
  };
  c.rotate = (th) => { cur().a += th; };
  c.world = (lx, ly) => {
    const q = cur();
    return { x: q.x + lx * Math.cos(q.a) - ly * Math.sin(q.a),
             y: q.y + lx * Math.sin(q.a) + ly * Math.cos(q.a) };
  };
  return c;
}

const sandbox = { console, Math, Array, Object, JSON, Date, parseInt, parseFloat,
                  isNaN, String, Number, Boolean, RegExp, Error };
sandbox.window = sandbox;
sandbox.performance = { now: () => Date.now() };
sandbox.document = { getElementById: () => null,
                     createElement: () => ({ getContext: () => makeCtx(), style: {} }) };
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js', 'js/resources.js', 'js/cards.js', 'js/station.js',
                 'js/towers.js', 'js/foes.js', 'js/clock.js', 'js/transport.js', 'js/solver-async.js',
                 'js/exp.js', 'js/engine.js', 'js/renderer.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS, REND = sandbox.REND, ENG = sandbox.ENG;
GS.debugNoDeadline = true;
GS.newGame();
const L = CFG.layout();
sandbox.LAY = L;

// ---- 拦截基元，记世界坐标 ----
const rec = [];
REND.coin = (ctx, x, y) => rec.push({ k: 'gold', w: ctx.world(x, y) });
REND.heart = (ctx, x, y) => rec.push({ k: 'heart', w: ctx.world(x, y) });

const BAG = ['gold', 'gold', 'gold', 'gold', 'heart', 'heart'];   // 4 金 2 心
function drawAt(index, frac) {
  GS.train.picked = BAG.slice();
  GS.train.index = index;
  GS.train.frac = frac || 0;
  rec.length = 0;
  REND.draw(makeCtx(), L, null, null);
  return rec.slice(-BAG.length);
}
const head = () => ENG.trainPos();

// ============================================================================
// [R1] v1.8u 十六令：资源堆**锁定朝 Y**（屏幕系恒朝上方堆叠）—— 金币列在左
//   （x = head.x − PK_SEP）、爱心列在右（x = head.x + PK_SEP），同类逐枚**垂直向上**
//   递增 PK_STEP（y = head.y − PK_D − i×PK_STEP，上枚压下枚）。整堆随车头平移、
//   不随车头转向旋转 ⇒ **四种朝向下每枚资源相对车头的偏移逐枚恒等**（强断言）。
//   ⚠️ 沿革：v1.8g B 案（刚性挂车尾、车体局部坐标）已退役 —— 大王令"资源甩来甩去
//     不好看，锁定朝 Y"：转向时的角速度甩动比距离小幅摆动更扎眼，两害相权取朝向恒定。
//   环上朝向取**直线段中点**（整数下标格 = 拐角顶点，行进角 45°）：ed0/1=东、ed3=南、ed6/7=西、ed10=北。
// ============================================================================
const HEADING = [[1, 0.25, '朝右(E)'], [6, 0.75, '朝左(W)'], [3, 0.5, '朝下(S)'], [10, 0.5, '朝上(N)']];
const PKD = 16 * REND.TRAIN_SCALE, PKSEP = 4.75, PKSTEP = 3.6;   // PK_D 系数 v1.8i 下限（车头上缘外沿起叠）
const localSig = [];
for (const [idx, fr, name] of HEADING) {
  const r = drawAt(idx, fr);
  const h0 = head();
  const rel = r.map(x => {
    const dx = x.w.x - h0.x, dy = x.w.y - h0.y;
    return { k: x.k, dx: dx, dy: dy };
  });
  localSig.push(rel);
  const g = rel.filter(v => v.k === 'gold'), h = rel.filter(v => v.k === 'heart');
  check('[R1] ' + name + ' 金币列在左（x 恒 = −PK_SEP）',
    g.every(v => Math.abs(v.dx - (-PKSEP)) < 1e-9), g.map(v => v.dx.toFixed(2)).join(','));
  check('[R1] ' + name + ' 爱心列在右（x 恒 = +PK_SEP）',
    h.every(v => Math.abs(v.dx - PKSEP) < 1e-9), h.map(v => v.dx.toFixed(2)).join(','));
  check('[R1] ' + name + ' 全列朝上：y = −PK_D − i×PK_STEP（上枚压下枚）',
    g.every((v, i) => Math.abs(v.dy - (-PKD - i * PKSTEP)) < 1e-9) &&
    h.every((v, i) => Math.abs(v.dy - (-PKD - i * PKSTEP)) < 1e-9),
    g.map(v => v.dy.toFixed(1)).join(','));
  const maxD = Math.max(...rel.map(v => Math.hypot(v.dx, v.dy)));
  check('[R1] ' + name + ' 堆挂在车上不脱钩（离车头 < 50px）', maxD < 50, 'maxD=' + maxD.toFixed(1));
}
{ // 锁定朝 Y 的本质断言：四种朝向下每枚资源相对车头的偏移**逐枚恒等**（堆不随车转）
  const ref = localSig[0];
  let maxDev = 0;
  for (const cur of localSig) for (let i = 0; i < cur.length; i++) {
    if (cur[i].k !== ref[i].k) maxDev = 1e9;
    maxDev = Math.max(maxDev, Math.abs(cur[i].dx - ref[i].dx), Math.abs(cur[i].dy - ref[i].dy));
  }
  check('[R1] 四种朝向下每枚资源相对车头的偏移逐枚恒等（锁定朝 Y，不随车转）',
    maxDev < 1e-9, 'maxDev=' + maxDev.toFixed(6));
}

// [R2] 任意朝向（取朝右）**首枚** = (head.x ∓ PK_SEP, head.y − PK_D)：
//   金首枚在左上、心首枚在右上，对称分列车头正上方两侧。
//   PK_D = 16×TRAIN_SCALE（v1.8i 下限），车再缩放不用改这里。
{
  const r = drawAt(1, 0.25), h0 = head();
  const g0 = r.filter(x => x.k === 'gold')[0].w;
  const h1 = r.filter(x => x.k === 'heart')[0].w;
  check('[R2] 首枚 = (head.x±PK_SEP, head.y−PK_D)（金左/心右，正上方起叠）',
    Math.abs(g0.x - (h0.x - PKSEP)) < 1e-9 && Math.abs(g0.y - (h0.y - PKD)) < 1e-9 &&
    Math.abs(h1.x - (h0.x + PKSEP)) < 1e-9 && Math.abs(h1.y - (h0.y - PKD)) < 1e-9,
    '金Δ=(' + (g0.x - h0.x).toFixed(2) + ',' + (g0.y - h0.y).toFixed(2) + ') 心Δ=(' +
      (h1.x - h0.x).toFixed(2) + ',' + (h1.y - h0.y).toFixed(2) + ')');
}

// [R12] 转弯平滑（v1.8f）+ 资源堆锁定朝 Y（v1.8u 十六令）：圆角路径下**行进角连续**（无 90° 跳变），
//   且每枚资源**相对车头的偏移沿全环恒定**（堆随车平移、不随车转向旋转）。
//   旧口径沿革：v1.8g B 案"刚性挂车尾"（局部坐标恒 ⇒ 距离恒，但转向甩动）→ v1.8u 十六令
//   改屏幕系锁定朝 Y（大王令"甩来甩去不好看"）⇒ 改为断言偏移恒等（朝向恒定）。
{
  const n = GS.railPath.length;
  const step = n / 800;                              // 名义弧长步长（格/采样）
  let maxJump = 0, prevAng = null, prevP = null, maxStep = 0;
  for (let s = 0; s <= n + 1e-9; s += step) {
    const pt = ENG.railPoint(s);
    if (prevAng !== null) {
      let d = pt.ang - prevAng;
      while (d > Math.PI) d -= 2 * Math.PI;
      while (d < -Math.PI) d += 2 * Math.PI;
      maxJump = Math.max(maxJump, Math.abs(d));
    }
    if (prevP) maxStep = Math.max(maxStep, Math.hypot(pt.c - prevP.c, pt.r - prevP.r));
    prevAng = pt.ang; prevP = pt;
  }
  check('[R12] 走一圈行进角连续（单步角差 < 10°，旧阶梯实现为 90°）',
    maxJump < 10 * Math.PI / 180, 'maxJump=' + (maxJump * 180 / Math.PI).toFixed(2) + '°');
  check('[R12] 走一圈位置连续（单步位移 ≤ 1.2×名义步长，无跳变/断口）',
    maxStep <= 1.2 * step, 'maxStep=' + maxStep.toFixed(4) + ' 名义=' + step.toFixed(4));

  // 每枚资源相对车头的偏移（dx,dy）须**与朝向/位置无关**（锁定朝 Y 的根本保证）——
  //   全环逐格采样比对：参考值 = idx0 各枚偏移，其余 idx 逐枚比对（顺序稳定：金×4 后 心×2）。
  const ref = (() => {
    const r = drawAt(0, 0.5), h0 = head();
    return r.map(x => ({ dx: x.w.x - h0.x, dy: x.w.y - h0.y }));
  })();
  let maxErr = 0;
  for (let idx = 0; idx < n; idx++) {
    const r = drawAt(idx, 0.5), h0 = head();
    for (let i = 0; i < r.length; i++) {
      maxErr = Math.max(maxErr,
        Math.abs(r[i].w.x - h0.x - ref[i].dx), Math.abs(r[i].w.y - h0.y - ref[i].dy));
    }
  }
  check('[R12] 每枚资源相对车头偏移沿全环恒定（锁定朝 Y ⇒ 堆不随车转向旋转）',
    maxErr < 1e-6, 'maxErr=' + maxErr.toFixed(6));
}

// [R3] 粒度口径（v1.6.27 大王三条）：金币/爱心**分开成列**、计数**按总数合并**
{
  GS.train.picked = ['gold', 'heart', 'gold', 'heart', 'gold']; GS.train.index = 0;
  rec.length = 0;
  REND.draw(makeCtx(), L, null, null);
  const r = rec.slice(-5);
  check('[R3] 3金1心1金 → 3 枚金币 + 2 枚爱心（与拾取顺序无关）',
    r.filter(x => x.k === 'gold').length === 3 && r.filter(x => x.k === 'heart').length === 2);
  check('[R3] 只拾一种时不画另一种',
    (() => { GS.train.picked = ['heart', 'heart']; rec.length = 0;
      REND.draw(makeCtx(), L, null, null);
      const q = rec.slice(-2); return q.every(x => x.k === 'heart'); })());
}

// [R4] 空货堆不画
{
  GS.train.picked = []; GS.train.index = 0; rec.length = 0;
  REND.draw(makeCtx(), L, null, null);
  check('[R4] picked 为空 → 不画货堆（只画地图上的资源格）',
    rec.length === GS.goldTiles.length + GS.heartTiles.length, 'rec=' + rec.length);
}

// [R6] 车顶浮标**全退役**（v1.6.30 爱心 / v1.6.31 金币，大王令"不需要为玩家强调"）：
//   · 爱心浮标（v1.6.22）：货堆本身按枚堆 ⇒ 数字与图标数重复；且固定画在车头正上方，
//     车头朝上/朝下时与货堆叠在一起。
//   · 金币 `+N`（v0.9.2）：车斗金额是**到站才结算**的东西，途中不必报数。
//   ⚠️ 只是**不画**，`cargo` / `hearts` 仍是数值权威（交付 / HUD / LOG 照旧读）。
{
  const c1 = makeCtx();
  GS.train.picked = ['heart', 'heart', 'heart']; GS.train.index = 0;
  GS.train.hearts = 3; GS.train.cargo = 0;
  REND.draw(c1, L, null, null);
  check('[R6] 拾到爱心时车顶不出现任何数字浮标（无玫红文字）',
    c1.texts.every(x => x.fill !== REND.C.heart), JSON.stringify(c1.texts));

  const c2 = makeCtx();
  GS.train.picked = ['gold', 'heart']; GS.train.hearts = 1; GS.train.cargo = 40;
  REND.draw(c2, L, null, null);
  check('[R6] 车斗有 40 金额时车顶也不再出现金币 `+N`',
    !c2.texts.some(x => x.t === '+40'), JSON.stringify(c2.texts));
  check('[R6] 车顶不出现任何 `+数字` 形式的浮标',
    c2.texts.every(x => !/^\+\d/.test(x.t)), JSON.stringify(c2.texts));
}

// [R7] 交付飘字（v1.6.32 大王令"交付的时候飘字，包括生命和金币，注意不要重叠"）：
//   屏幕系两个 13px 粗体行 + 行首小图标；**两行固定错开 20px**（> 字号 ⇒ 不重叠）；
//   金币行在下、生命行在上；图标在文字左侧、与文字同一水平线；随 t 上飘 + 淡出。
//   逻辑侧（生成/去重/满血不飘/到期出队）在 test_rules.js「飘字 1–8」。
{
  GS.floats = [];
  const c0 = makeCtx();
  REND.draw(c0, L, null, null);
  check('[R7] 队列为空 → 不画任何飘字', c0.texts.filter(x => /^\+/.test(x.t)).length === 0);

  ENG.spawnDeliverFloats(40, 4);          // 直接按"交付结果"生成（不经 TRANS，单测本层）
  const c1 = makeCtx();
  rec.length = 0;
  REND.draw(c1, L, null, null);
  const txt = c1.texts.filter(x => /^\+/.test(x.t));
  check('[R7] 两行文字都画出来了（+40 / +4）',
    txt.length === 2 && txt.map(x => x.t).sort().join(',') === '+4,+40', JSON.stringify(txt.map(x => x.t)));

  const tGold = txt.find(x => x.t === '+40'), tHeal = txt.find(x => x.t === '+4');
  check('[R7] **两行不重叠**：纵向错开 20px（> 13px 字号）',
    Math.abs(tGold.y - tHeal.y) === 20 && Math.abs(tGold.y - tHeal.y) > 13,
    'Δy=' + Math.abs(tGold.y - tHeal.y));
  check('[R7] 金币行在下、生命行在上', tGold.y > tHeal.y);
  check('[R7] 颜色区分：金币行金色 / 生命行玫红',
    tGold.fill === REND.C.gold && tHeal.fill === REND.C.heart,
    tGold.fill + ' / ' + tHeal.fill);

  const icons = rec.slice(-2);            // 飘字最后画 ⇒ 尾部两条就是它的行首图标
  check('[R7] 每行行首各有一个图标（金币 / 爱心）',
    icons.length === 2 && icons[0].k === 'gold' && icons[1].k === 'heart',
    JSON.stringify(icons.map(x => x.k)));
  check('[R7] 图标在文字左侧、与文字同一水平线',
    icons[0].w.x < tGold.x && icons[1].w.x < tHeal.x &&
    Math.abs(icons[0].w.y - tGold.y) < 1e-9 && Math.abs(icons[1].w.y - tHeal.y) < 1e-9,
    JSON.stringify([icons[0].w, tGold.x, tGold.y]));

  // 上飘 + 淡出：把 t 推大再看
  GS.floats.forEach(f => { f.t = f.ttl * 0.5; });
  const c2 = makeCtx();
  REND.draw(c2, L, null, null);
  const txt2 = c2.texts.filter(x => /^\+/.test(x.t));
  const g2 = txt2.find(x => x.t === '+40');
  check('[R7] 随时间**向上飘**（同一数字的 y 变小）', g2.y < tGold.y, tGold.y + ' → ' + g2.y);
  check('[R7] 随时间**淡出**（globalAlpha 变小）', g2.a < 1 && g2.a > 0, 'alpha=' + g2.a);
  GS.floats.forEach(f => { f.t = f.ttl * 0.99; });
  const c3 = makeCtx();
  REND.draw(c3, L, null, null);
  check('[R7] 接近 ttl 时透明度趋近 0（淡出干净）',
    c3.texts.filter(x => /^\+/.test(x.t)).every(x => x.a < 0.05));
  GS.floats = [];
}

// [R7b] 消耗提速飘字（v1.8y 反馈补丁十一/十二）：镇中心锚、两行块状、描边、ttl 2.4s。
//   state 侧 emitSpeedFloat 的逻辑（锚点/挂起补飘）在 test_rules [SS]；此处只验渲染：
//   text 带 \n ⇒ split 两行、行距 20px、每行都走 strokeText（描边）+ fillText。
{
  GS.floats = [];
  ENG.spawnFloat('speed', '提速 +30%\n车头攻击 +7', 200, 200, 2.4);
  check('[R7b] 入队带 ttl 2.4s', GS.floats.length === 1 && GS.floats[0].ttl === 2.4);
  const cS = makeCtx();
  let errS = '';
  try { REND.draw(cS, L, null, null); } catch (e) { errS = (e && e.message) || 'throw'; }
  check('[R7b] 两行 speed 飘字渲染不抛异常（描边+分行）', !errS, errS);
  const sTxt = cS.texts.filter(x => x.t === '提速 +30%' || x.t === '车头攻击 +7');
  check('[R7b] 两行都画出、纵向错开 20px（> 16px 字号）',
    sTxt.length === 2 && Math.abs(sTxt[0].y - sTxt[1].y) === 20,
    JSON.stringify(sTxt.map(x => ({ t: x.t, y: x.y }))));
  GS.floats = [];
  // 补丁十三格式：真走 GS.emitSpeedFloat（需要 core/LAY/ENG）——行1「提速 +X%」、
  //   行2「车头攻击 +增量」（增量 = dmg(tier) − dmg(tier−1)，二次曲线递增）。
  const savedCoreF = GS.core, savedTierF = GS.speedTier;
  GS.core = { c: 5, r: 5 }; GS.speedTier = 2;
  GS.floats = [];
  GS.emitSpeedFloat();
  const pct2 = Math.round((GS.spentSpeedMul() - 1) * 100);        // tier2 ⇒ 20
  const gain2 = ENG.TRAIN_COMBAT.dmg(2) - ENG.TRAIN_COMBAT.dmg(1); // 20−13 = 7
  const fTxt = GS.floats.length === 1 ? GS.floats[0].text : '';
  check('[R7b] emitSpeedFloat 行1 =「提速 +' + pct2 + '%」',
    fTxt === '提速 +' + pct2 + '%\n车头攻击 +' + gain2,
    JSON.stringify(fTxt));
  GS.core = savedCoreF; GS.speedTier = savedTierF; GS.floats = [];
}

// [R5] REND.draw 全程不抛（各拖动/悬停态也走一遍）
{
  let err = '';
  try {
    REND.draw(makeCtx(), L, { c: 4, r: 4 }, null);
    REND.draw(makeCtx(), L, null, { kind: 'clean', px: 100, py: 200, shape: { name: '2×2', cells: [[0,0],[1,0],[0,1],[1,1]] } });
    REND.draw(makeCtx(), L, null, { kind: 'hero', elem: 'arrow', px: 100, py: 200 });
    REND.draw(makeCtx(), L, null, { kind: 'building', bkey: 'gas', px: 100, py: 200 });
  } catch (e) { err = (e && e.message) || 'throw'; }
  check('[R5] 悬停 / 拖形状 / 拖英雄 / 拖建筑 四种态下 REND.draw 不抛异常', !err, err);
  // v1.6.76 镜头速度线：boost>0 走全屏径向流线绘制路径（boost=0 时 speedLines 早退，
  //   上面各态没覆盖到新画法 —— 专门开一次 boost；v1.6.91 起特效闸 boostFx 须同开）
  sandbox.ENG.boostFx = true;
  sandbox.ENG.boost = 2;
  err = '';
  try { REND.draw(makeCtx(), L, null, null); } catch (e) { err = (e && e.message) || 'throw'; }
  // v1.6.91（§14.59）：overtime 纯收车（boostFx=false）速度线零绘制 ——
  //   直接调 speedLines 数 stroke（boost=2 但闸关 ⇒ 0 次）
  sandbox.ENG.boostFx = false;
  let strokes = 0;
  const sctx = makeCtx();
  sctx.stroke = () => { strokes++; };
  try { REND.speedLines(sctx); } catch (e) {}
  sandbox.ENG.boostFx = true;
  let strokesOn = 0;
  const octx = makeCtx();
  octx.stroke = () => { strokesOn++; };
  try { REND.speedLines(octx); } catch (e) {}
  sandbox.ENG.boost = 0;
  check('[R5] boost=2（镜头速度线全屏径向流线）draw 不抛异常', !err, err);
  check('[R5] v1.6.91 特效闸：纯收车 boostFx=false 速度线零绘制 / 闸开正常出线（stroke 0 vs ' + strokesOn + '>0）',
    strokes === 0 && strokesOn > 0, 'off=' + strokes + ' on=' + strokesOn);

}

// ============================================================================
// [R15] v1.8u 六令：拖 gas/mint 悬停 3×3 范围格**两态**（§4d/§14.82）——
//   标准态 = 淡底（gas 0.16 / mint 0.14）；高亮态 = 3×3 内命中有效目标
//   （gas=在轨格 GS.onRail → 0.38 / mint=金币格 grid.gold → 0.35）整格高亮。
// ============================================================================
{
  const px = L.x + 2.5 * L.cell, py = L.y + 1.5 * L.cell;   // 悬停格 (2,1) → 范围 c1..3 × r0..2
  // gas：手摆 (2,2) 为轨道 → 该格高亮 0.38，其余 8 格标准淡底 0.16
  GS.railSet = { '2,2': 1 };
  const cg = makeCtx();
  REND.draw(cg, L, null, { kind: 'building', bkey: 'gas', px: px, py: py });
  const ghi = cg._rects.filter(x => x.fill === 'rgba(94,200,240,0.38)');
  const glo = cg._rects.filter(x => x.fill === 'rgba(94,200,240,0.16)');
  check('[R15] gas 范围内在轨格整格高亮 0.38（恰 1 格、落在 (2,2)）',
    ghi.length === 1 && ghi[0].x === L.x + 2 * L.cell && ghi[0].y === L.y + 2 * L.cell,
    'n=' + ghi.length);
  check('[R15] gas 范围内非轨格保持标准淡底 0.16（8 格）', glo.length === 8, 'n=' + glo.length);
  GS.railSet = {};
  // mint：3×3 内清金币后只摆 (1,1) → 该格高亮 0.35，其余 8 格标准淡底 0.14
  for (let rr = 0; rr <= 2; rr++) for (let cc = 1; cc <= 3; cc++) GS.grid[rr][cc].gold = false;
  GS.grid[1][1].gold = true;
  const cm = makeCtx();
  REND.draw(cm, L, null, { kind: 'building', bkey: 'mint', px: px, py: py });
  const mhi = cm._rects.filter(x => x.fill === 'rgba(240,180,41,0.35)');
  const mlo = cm._rects.filter(x => x.fill === 'rgba(240,180,41,0.14)');
  check('[R15] mint 范围内金币格整格高亮 0.35（恰 1 格、落在 (1,1)）',
    mhi.length === 1 && mhi[0].x === L.x + 1 * L.cell && mhi[0].y === L.y + 1 * L.cell,
    'n=' + mhi.length);
  check('[R15] mint 范围内非金币格保持标准淡底 0.14（8 格）', mlo.length === 8, 'n=' + mlo.length);
  GS.grid[1][1].gold = false;
}

// ============================================================================
// [R16] v1.8u 十令（大王亲定）：格内多币布阵 —— 格内币数 = 总枚数 piles = 座数+1；
//   2 枚 = 右上+左下对角、3 枚 = 顶点朝上三角形、币随枚数缩小、相邻币轻微相切。
//   钉死：对角对称 / 三角朝向 / 币径递减 / n=0 单币原尺寸。
// ============================================================================
{
  const savedCover = GS.mintCoverAt;
  const mctx = makeCtx();
  const got = [];
  const realCoin = REND.coin;
  REND.coin = (ctx, x, y, rr2) => got.push({ x: x, y: y, r: rr2 });
  GS.mintCoverAt = function () { return 1; };               // 覆盖 1 座 → piles=2
  REND.mintStack(mctx, 100, 100, 10, false, 3, 3);
  check('[R16] 覆盖 1 座 → 布阵 2 枚', got.length === 2, 'n=' + got.length);
  const a = got[0], b = got[1];
  const hi = a.y < b.y ? a : b, lo = a.y < b.y ? b : a;     // hi=右上、lo=左下
  check('[R16] 2 枚对角布阵（右上 + 左下，对角对称）',
    hi.x > 100 && hi.y < 100 && lo.x < 100 && lo.y > 100 &&
    Math.abs((hi.x - 100) - (100 - lo.x)) < 1e-9 &&
    Math.abs((100 - hi.y) - (lo.y - 100)) < 1e-9,
    JSON.stringify(got.map(p => [p.x, p.y])));
  check('[R16] 2 枚币径缩小 0.78r 且轻微相切（心距 < 两倍币径）',
    Math.abs(hi.r - 7.8) < 1e-9 &&
    Math.hypot(hi.x - lo.x, hi.y - lo.y) < hi.r + lo.r,
    'r=' + hi.r);
  GS.mintCoverAt = function () { return 2; };               // 覆盖 2 座 → piles=3
  got.length = 0;
  REND.mintStack(mctx, 100, 100, 10, false, 3, 3);
  check('[R16] 覆盖 2 座 → 布阵 3 枚（三角形）', got.length === 3, 'n=' + got.length);
  const top = got.find(p => p.y < 100), bl = got.filter(p => p.y > 100);
  check('[R16] 三角朝向：顶点朝上 + 底边两枚左右对称',
    top && top.x === 100 && bl.length === 2 &&
    Math.abs((bl[0].x - 100) + (bl[1].x - 100)) < 1e-9 && bl[0].x !== bl[1].x,
    JSON.stringify(got.map(p => [p.x, p.y])));
  check('[R16] 3 枚币径再缩 0.66r', got.every(p => Math.abs(p.r - 6.6) < 1e-9), 'r=' + got[0].r);
  GS.mintCoverAt = function () { return 0; };               // 无覆盖 → 单币原尺寸
  got.length = 0;
  REND.mintStack(mctx, 100, 100, 10, false, 3, 3);
  check('[R16] n=0 → 单币原尺寸零开销', got.length === 1 && got[0].r === 10 && got[0].x === 100,
    JSON.stringify(got[0]));
  REND.coin = realCoin;
  GS.mintCoverAt = savedCover;
}

// ============================================================================
// [R17] 场上建筑拖动（bmove）同样铺效果范围 —— 与手牌拖上场共用 REND.buildingRange，
//   落点格即预览中心（含停在原格时也显示）。钉死 gas 两态与"原地悬停也预览"。
// ============================================================================
{
  const px = L.x + 2.5 * L.cell, py = L.y + 1.5 * L.cell;   // 落点 (2,1)
  GS.railSet = { '2,2': 1 };
  const cb = makeCtx();
  REND.draw(cb, L, null, { kind: 'bmove', building: { type: 'gas', c: 0, r: 0 }, px: px, py: py });
  const bhi = cb._rects.filter(x => x.fill === 'rgba(94,200,240,0.38)');
  const blo = cb._rects.filter(x => x.fill === 'rgba(94,200,240,0.16)');
  check('[R17] 拖动场上 gas 显示 3×3 范围（在轨格高亮 0.38 恰 1 格）',
    bhi.length === 1 && bhi[0].x === L.x + 2 * L.cell && bhi[0].y === L.y + 2 * L.cell,
    'n=' + bhi.length);
  check('[R17] 拖动场上 gas 其余 8 格标准淡底 0.16', blo.length === 8, 'n=' + blo.length);
  // 停在建筑原格：范围照显（落点即预览，不因"没移动"而消失）
  const cs = makeCtx();
  REND.draw(cs, L, null, { kind: 'bmove', building: { type: 'gas', c: 2, r: 1 },
                           px: px, py: py });
  const shi = cs._rects.filter(x => x.fill === 'rgba(94,200,240,0.38)');
  check('[R17] 拖动但没有移动（悬停回原格）范围仍显示', shi.length === 1, 'n=' + shi.length);
  GS.railSet = {};
}

// ============================================================================
// [R8] 作战拉远：真缩小布局 + 大字横幅（v1.6.38 建凭；v1.6.39 大王二令
//      "不是平移要缩小 + 平滑过渡"，cell 41→34、荒野带/横幅吃 CAM 淡入淡出）
// ============================================================================
{
  // ① 夜晚布局：**真缩小**（cell 28 < 白天 41，v1.6.42 大王三令"荒野更大而非环绕一圈"）
  //    且整个 9×13 在物理画布（792）里垂直居中
  const nb = CFG.battleLayout(), nd = CFG.layout();
  const top = nb.y, bottom = CFG.battleFieldH() - (nb.y + nb.h);
  check('[R8] battle 布局：真缩小（cell=BATTLE_CELL=28 < 白天 BUILD_CELL=37，缩小约 24%）+ 地图居中（上/下余量差 ≤2）',
    nb.cell === CFG.BATTLE_CELL && nb.cell === 28 && nb.cell < nd.cell && Math.abs(top - bottom) <= 2,
    'top=' + top + ' bottom=' + bottom + ' cell=' + nb.cell + ' dayCell=' + nd.cell);
  check('[R8] 荒野比重大：地图高 ≤ 画布高一半（城镇是荒野包围中的一小块）',
    nb.h <= CFG.battleFieldH() / 2, 'h=' + nb.h);
  check('[R8] battle 可视高 = CANVAS_H - HUD_H（footer 夜晚隐藏后全画布可见）',
    CFG.battleFieldH() === CFG.CANVAS_H - CFG.HUD_H);

  // ② 横幅：夜晚画大字（含 CLOCK.label 文本）、白天不画
  const CLOCK = sandbox.CLOCK;
  const saved = { phase: CLOCK.phase, label: CLOCK.label };
  CLOCK.phase = 'night';
  const cN = makeCtx();
  REND.draw(cN, nb, null, null);
  check('[R8] 夜晚 → 顶部大字横幅出现（含 CLOCK.label 文本，20px 粗体）',
    cN.texts.some(x => x.t === '防守 ' + Math.ceil(CLOCK.remain) + 's'),
    JSON.stringify(cN.texts.map(x => x.t)));
  CLOCK.phase = 'day';
  const cD = makeCtx();
  REND.draw(cD, nd, null, null);
  check('[R8] 白天 → 横幅不画（提示留在开波按钮上）',
    !cD.texts.some(x => String(x.t).indexOf('防守') >= 0),
    JSON.stringify(cD.texts.map(x => x.t)));
  // ③ 奖励时间 → 金色（正反馈色）
  CLOCK.phase = 'night'; CLOCK.reward = true;
  const cR = makeCtx();
  REND.draw(cR, nb, null, null);
  check('[R8] 奖励时间 → 横幅金色（REND.C.gold）',
    cR.texts.some(x => x.fill === REND.C.gold),
    JSON.stringify(cR.texts.map(x => x.fill)));
  CLOCK.reward = false;

  // ④ v1.6.39 平滑过渡：横幅 alpha 跟 CAM.t
  sandbox.CAM = { t: 0.4, e: 0.352, target: 1 };   // 过渡中段（夜晚正在淡入）
  const cM = makeCtx();
  REND.draw(cM, nb, null, null);
  const bannerM = cM.texts.find(x => String(x.t).indexOf('防守') >= 0);
  check('[R8] 过渡中（CAM.t=0.4）→ 横幅以 0.4 透明度浮现（随镜头淡入）',
    !!bannerM && Math.abs(bannerM.a - 0.4) < 1e-6,
    bannerM ? 'a=' + bannerM.a : '横幅未画');
  sandbox.CAM = { t: 1, e: 1, target: 1 };         // 拉远到位
  let errW = null;
  try { REND.draw(makeCtx(), nb, null, null); } catch (e) { errW = (e && e.message) || 'throw'; }
  check('[R8] 拉远到位 → 荒野世界层（土地底色+羽化+残片+点缀）绘制不抛异常', !errW, errW);

  // ⑤ v1.6.48 场景一致：荒野世界层**常驻渲染**，白天也画（仅 UI/镜头不同）
  delete sandbox.CAM;                              // 无 CAM（沙箱常态）
  let wcDay = 0, wcNight = 0, errDay = null;
  const wOrig = REND.wilderness;
  REND.wilderness = (c, l) => { wcDay++; try { return wOrig(c, l); } catch (e) { errDay = (e && e.message) || 'throw'; } };
  REND.draw(makeCtx(), nd, null, null);            // 白天布局
  REND.wilderness = (c, l) => { wcNight++; return wOrig(c, l); };
  CLOCK.phase = 'night';
  REND.draw(makeCtx(), nb, null, null);            // 夜晚布局
  REND.wilderness = wOrig;
  CLOCK.phase = 'day';
  check('[R8] 场景一致 → 白天/夜晚都画荒野世界层（各恰 1 次）且不抛异常',
    wcDay === 1 && wcNight === 1 && !errDay,
    'day=' + wcDay + ' night=' + wcNight + ' err=' + errDay);
  CLOCK.phase = saved.phase;
}

// ============================================================================
// [R9] 经验条（v1.6.41 全宽胶囊；v1.8u 四拍板 §14.83：等级曲线 + 数字退役）：
//      全宽胶囊贴 HUD 下沿 + 「经验」徽章块（v1.8y 反馈·大王拍板，替代裸 ◆）+
//      ≥80% 呼吸脉冲；25 级封顶显示满条；数字退役口径 = 无数字字符（徽章语义标签放行）
// ============================================================================
{
  // 拦截 REND.rr 记录胶囊尺寸（进度宽 = (390-5) × ratio）
  const rrCalls = [];
  const rrOrig = REND.rr;
  REND.rr = (ctx, x, y, w, h, r) => { rrCalls.push({ x, y, w, h, r }); return rrOrig(ctx, x, y, w, h, r); };

  const savedExp = { exp: GS.exp, taken: GS.expTaken, pending: GS.expPending };
  const cN = makeCtx();

  // ① 中段进度（1640/4100 = 40%，expTaken=2 ⇒ L3 → need 4100）：全宽底槽 + 进度宽 154 + 无数字
  GS.exp = 1640; GS.expTaken = 2; GS.expPending = 0;
  rrCalls.length = 0;
  REND.expBar(cN, L);
  check('[R9] 全宽底槽（W-1=389 × 8，贴 HUD 下沿）',
    rrCalls.some(c => c.w === 389 && c.h === 8 && c.r === 4.5),
    JSON.stringify(rrCalls));
  check('[R9] 进度条宽 = (W-5)×ratio（1640/4100 ⇒ 154）',
    rrCalls.some(c => Math.abs(c.w - 154) < 0.01 && c.h === 4),
    JSON.stringify(rrCalls));
  check('[R9] 数字退役：条上无数字字符（「经验」徽章标签放行，v1.8u 拍板 + v1.8y 徽章补丁）',
    cN.texts.every(x => !/[0-9]/.test(x.t)) && cN.texts.some(x => x.t === '经验'),
    JSON.stringify(cN.texts.map(x => x.t)));

  // ② 快满（3280/4100 = 80%）：v1.8y 补丁九·大王令「取消快满闪烁」——呼吸分支退役，
  //    恒常亮 #7F77DD（曾因删定义漏改此处 hot 引用致 ReferenceError 每帧炸停主循环=卡死）
  let errH = null;
  GS.exp = 3280;
  const cHot = makeCtx();
  const fillsH = [];
  cHot.fill = function () { fillsH.push(this.fillStyle); };   // 记录每次 fill 时的填充色
  try { REND.expBar(cHot, L); } catch (e) { errH = (e && e.message) || 'throw'; }
  check('[R9] ≥80% 快满分支执行不抛异常（呼吸脉冲退役）', !errH, errH);
  check('[R9] 快满填充恒 #7F77DD（无 #AFA9EC 高亮闪烁）',
    fillsH.includes('#7F77DD') && !fillsH.includes('#AFA9EC'),
    JSON.stringify(fillsH));

  // ③ 满（4100/4100）：进度宽 = 全宽 385
  rrCalls.length = 0;
  GS.exp = 4100;
  REND.expBar(makeCtx(), L);
  check('[R9] 满进度 ⇒ 进度宽 385（整条填满）',
    rrCalls.some(c => Math.abs(c.w - 385) < 0.01), JSON.stringify(rrCalls));

  // ④ 经验为 0：条仍画（提醒攒头一杀），进度胶囊跳过（徽章照画）、无数字
  rrCalls.length = 0;
  GS.exp = 0;
  const cZ = makeCtx();
  REND.expBar(cZ, L);
  check('[R9] 经验 0 ⇒ 画底槽+徽章、不画进度胶囊、无数字',
    rrCalls.some(c => c.w === 389) && !rrCalls.some(c => c.h === 4) &&
    cZ.texts.every(x => !/[0-9]/.test(x.t)),
    'rr=' + JSON.stringify(rrCalls) + ' texts=' + JSON.stringify(cZ.texts.map(x => x.t)));

  // ⑤ 25 级封顶（expTaken=24 ⇒ need=Infinity）：progress 满条 {1,1} ⇒ 进度宽 385
  rrCalls.length = 0;
  GS.expTaken = 24; GS.exp = 99999;
  REND.expBar(makeCtx(), L);
  check('[R9] 25 级封顶 ⇒ progress 满条、进度宽 385',
    rrCalls.some(c => Math.abs(c.w - 385) < 0.01), JSON.stringify(rrCalls));

  REND.rr = rrOrig;
  GS.exp = savedExp.exp; GS.expTaken = savedExp.taken; GS.expPending = savedExp.pending;
}

// ============================================================================
// [R9b] 镇中心 lv 刻度条（v1.8y 反馈补丁四，大王拍板「进度条改为镇中心经验进度条、
//       初始 lv1 最多 lv9、沿用每级刻度方案」）：左端「lv N」徽章（lv 即速度等级，
//       数字允许——是等级读数而非经验数值）+ 每级刻度；锚 GS.core，无镇中心跳过
// ============================================================================
{
  const savedSS = { spent: GS.goldSpent, tier: GS.speedTier };
  GS.goldSpent = 100; GS.speedTier = 1;   // tier=1 ⇒ lv2（本级 ratio=0，条空只画徽章+底槽）
  const cB = makeCtx();
  REND.coreLvBar(cB, L);
  check('[R9b] 「lv2」徽章入队（lv 即速度等级，含数字为等级读数）',
    cB.texts.some(x => x.t === 'lv2') && cB.texts.length === 1,
    JSON.stringify(cB.texts.map(x => x.t)));
  const cC = makeCtx();
  GS.goldSpent = 99999; GS.speedTier = 8;   // 封顶（8 档 = lv9）⇒ 满填充分支不抛异常
  let errC = null;
  try { REND.coreLvBar(cC, L); } catch (e) { errC = (e && e.message) || 'throw'; }
  check('[R9b] 封顶分支执行不抛异常', !errC, errC);
  GS.goldSpent = savedSS.spent; GS.speedTier = savedSS.tier;
}

// ============================================================================
// [R9c] 镇中心 tips 气泡（v1.8y 反馈补丁八，大王令「点击镇中心出现 tips，告知
//       等级和速度」）：UI.coreTip 开关控制（ui.js onDown 切换）；三行 =
//       「镇中心 lvN」/「列车速度 ×M」/ 升级进度（再抽 X 次升级 / 已达满级）
// ============================================================================
{
  const savedTier = GS.speedTier, savedDC = GS.drawCount;
  const savedUI = sandbox.UI;                        // renderer 用 typeof UI 守卫，无 UI 时跳过
  const cOff = makeCtx();
  let errOff = null;
  try { REND.coreTip(cOff, L); } catch (e) { errOff = (e && e.message) || 'throw'; }
  check('[R9c] 开关关闭（无 UI）时跳过不抛异常', !errOff && cOff.texts.length === 0,
    errOff || JSON.stringify(cOff.texts.map(x => x.t)));

  sandbox.UI = { coreTip: true };
  GS.speedTier = 1; GS.drawCount = 4;                // tier=1 ⇒ lv2、本级 ratio=0
  const cOn = makeCtx();
  REND.coreTip(cOn, L);
  check('[R9c] 开启后三行文案入队（lv2 / ×1.1 / 再抽 4 次升级）',
    cOn.texts.some(x => x.t === '镇中心 lv2') &&
    cOn.texts.some(x => x.t === '列车速度 ×1.1') &&
    cOn.texts.some(x => x.t === '再抽 4 次升级'),
    JSON.stringify(cOn.texts.map(x => x.t)));

  GS.speedTier = 8; GS.drawCount = 99;               // 封顶（8 档 = lv9）
  const cCap = makeCtx();
  let errCap = null;
  try { REND.coreTip(cCap, L); } catch (e) { errCap = (e && e.message) || 'throw'; }
  check('[R9c] 封顶分支（已达满级）不抛异常',
    !errCap && cCap.texts.some(x => x.t === '已达满级'), errCap);

  sandbox.UI = savedUI; GS.speedTier = savedTier; GS.drawCount = savedDC;
}

// ============================================================================
// [R10] 粒子层渲染（v1.6.43 B/E）：三种基元 + 空层跳过
// ============================================================================
{
  const savedFx = GS.fx;
  let err = null;
  GS.fx = [
    { kind: 'ring', x: 100, y: 100, r0: 5, r1: 20, life: 0.1, ttl: 0.3, color: '255,170,90', lw: 3 },
    { kind: 'puff', x: 100, y: 100, r0: 6, r1: 15, life: 0.05, ttl: 0.22, color: '255,140,66' },
    { kind: 'spark', x: 90, y: 90, vx: 40, vy: -30, life: 0.1, ttl: 0.4, size: 4, color: '232,86,63' },
    { kind: 'puff', x: 0, y: 0, r0: 1, r1: 2, life: 5, ttl: 0.2, color: '0,0,0' }   // 已过期 ⇒ 跳过
  ];
  try { REND.drawFx(makeCtx()); } catch (e) { err = (e && e.message) || 'throw'; }
  check('[R10] 三种基元（含过期粒子）绘制不抛异常', !err, err);
  GS.fx = [];
  let err2 = null;
  try { REND.drawFx(makeCtx()); } catch (e) { err2 = (e && e.message) || 'throw'; }
  check('[R10] 空 GS.fx ⇒ 直接跳过零绘制', !err2, err2);
  GS.fx = savedFx;
}

// ============================================================================
// [R11] 刷怪点预警（v1.6.50 大王令）：白天 nextSpawns / 夜晚 fadeSpawns 均可画
// ============================================================================
{
  const savedNs = GS.nextSpawns, savedFs = sandbox.FOES ? sandbox.FOES.fadeSpawns : null;
  const savedWave = sandbox.FOES ? sandbox.FOES.wave : 0;
  GS.nextSpawns = [{ c: 2, r: -2, count: 5 }, { c: 7, r: 14, count: 6 }];
  const CLOCK = sandbox.CLOCK;
  const savedPhase = CLOCK.phase;
  let err1 = null;
  CLOCK.phase = 'day';
  try { REND.draw(makeCtx(), L, null, null); } catch (e) { err1 = (e && e.message) || 'throw'; }
  check('[R11] 白天 + 下一波点位 → 预警标记（红圈+头像+×N）绘制不抛异常', !err1, err1);
  GS.nextSpawns = null;
  if (sandbox.FOES) {
    sandbox.FOES.fadeSpawns = { pts: [{ c: 2, r: -2, count: 5 }], t: 0.5 };
    let err2 = null;
    try { REND.draw(makeCtx(), L, null, null); } catch (e) { err2 = (e && e.message) || 'throw'; }
    check('[R11] 夜晚 + 开波淡出点位 → 标记随 t 淡出绘制不抛异常', !err2, err2);
    sandbox.FOES.fadeSpawns = null;
  }
  GS.nextSpawns = savedNs;
  if (sandbox.FOES) { sandbox.FOES.fadeSpawns = savedFs; sandbox.FOES.wave = savedWave; }
  CLOCK.phase = savedPhase;
}

// ============================================================================
// [R13] 加油站铁轨流光——弯道弧几何钉死（v1.8u 五改后：单轨中心线，railTiles 查表）：
//   v1.8u 流光改**单轨中心线 + 保留弧度**（大王令"改成单轨，居中于两条铁轨之间"）：
//   弯道 = 单四分之一弧（圆心=格角、半径 h=双轨正中、查表同轨贴片）。本块真摆一座
//   加油站罩住真实关卡环线上的弯道格，对每格 gas 色弧断言：恰 1 弧、圆心 = 格角
//   （|dx|=|dy|=h）、半径 = h、扫过角 = 90°、弧端点 = 两臂边中点（居中贯通）。
// ============================================================================
{
  // 弯道格 = 闭环上前后邻格方向垂直（与 rangeHighlights 的 use[] 同口径：只看
  // railPath 相邻对 —— 环线十字/T 岔按车实际走向归为弯道/直线，如实盘 (5,3)/(4,3)）
  const rail = GS.railPath, n = rail.length, corners = [];
  for (let i = 0; i < n; i++) {
    const a = rail[(i - 1 + n) % n], b = rail[i], c2 = rail[(i + 1) % n];
    const d1 = [Math.sign(b.c - a.c), Math.sign(b.r - a.r)];
    const d2 = [Math.sign(c2.c - b.c), Math.sign(c2.r - b.r)];
    if (d1[0] * d2[0] + d1[1] * d2[1] === 0) corners.push({ c: b.c, r: b.r, d1: d1, d2: d2 });
  }
  check('[R13] 真实关卡环线上存在弯道格（≥1）', corners.length >= 1, 'corners=' + corners.length);
  // 择优摆一座加油站（罩住弯道格最多），选点法复刻 test_rules [GB]
  let best = null;
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
    if (!GS.isFreeSpot(c, r)) continue;
    const cov = corners.filter(p => Math.max(Math.abs(p.c - c), Math.abs(p.r - r)) <= CFG.GAS_RANGE);
    if (cov.length && (!best || cov.length > best.cov.length)) best = { c: c, r: r, cov: cov };
  }
  check('[R13] 存在罩住弯道格的可建空地', !!best);
  if (best) {
    ENG.placeBuilding(best.c, best.r, 'gas');
    check('[R13] 摆位后覆盖弯道格 gasCoverAt > 0（查询接线通）',
      best.cov.every(p => GS.gasCoverAt(p.c, p.r) > 0));
    const h = L.cell / 2;
    const cA = makeCtx();
    REND.rangeHighlights(cA, L);
    const arcs = cA._arcs.filter(x => String(x.stroke).indexOf('94,200,240') >= 0);
    check('[R13] gas 色弧条数 = 被罩弯道格数（每弯道单弧，直线/T 岔贯通轴不产弧）',
      arcs.length === best.cov.length, 'arcs=' + arcs.length + ' cov=' + best.cov.length);
    for (const p of best.cov) {
      const cx = CFG.ccx(L, p.c), cy = CFG.ccy(L, p.r);
      // 臂 = 从本格指向邻格：前驱臂 = 行进入弯方向取反；后继臂 = 出弯方向原样
      const P1 = { x: cx - p.d1[0] * h, y: cy - p.d1[1] * h };
      const P2 = { x: cx + p.d2[0] * h, y: cy + p.d2[1] * h };
      const d = (P, Q) => Math.hypot(P.x - Q.x, P.y - Q.y);
      const hit = arcs.filter(ar => {
        if (Math.abs(ar.r - h) > 1e-9) return false;
        const S = { x: ar.x + ar.r * Math.cos(ar.a0), y: ar.y + ar.r * Math.sin(ar.a0) };
        const E = { x: ar.x + ar.r * Math.cos(ar.a1), y: ar.y + ar.r * Math.sin(ar.a1) };
        return (d(S, P1) < 1e-6 && d(E, P2) < 1e-6) || (d(S, P2) < 1e-6 && d(E, P1) < 1e-6);
      })[0];
      check('[R13] 弯道(' + p.c + ',' + p.r + ')：弧存在，起/终点 = 两臂边中点、半径 = h', !!hit);
      check('[R13] 弯道(' + p.c + ',' + p.r + ')：圆心 = 格角（|dx|=|dy|=h）',
        !!hit && Math.abs(Math.abs(hit.x - cx) - h) < 1e-9 &&
        Math.abs(Math.abs(hit.y - cy) - h) < 1e-9,
        hit ? '(' + hit.x.toFixed(1) + ',' + hit.y.toFixed(1) + ')' : '无弧');
      if (hit) {
        let sw = hit.a1 - hit.a0;
        while (sw > Math.PI) sw -= 2 * Math.PI;
        while (sw <= -Math.PI) sw += 2 * Math.PI;
        if (hit.ccw && sw > 0) sw -= 2 * Math.PI;
        if (!hit.ccw && sw < 0) sw += 2 * Math.PI;
        const M = { x: hit.x + hit.r * Math.cos(hit.a0 + sw / 2),
                    y: hit.y + hit.r * Math.sin(hit.a0 + sw / 2) };
        check('[R13] 弯道(' + p.c + ',' + p.r + ')：扫过角 90°、弧中点在格内',
          Math.abs(Math.abs(sw) - Math.PI / 2) < 1e-9 &&
          Math.abs(M.x - cx) <= h + 1e-9 && Math.abs(M.y - cy) <= h + 1e-9,
          'sw=' + (sw * 180 / Math.PI).toFixed(1) + '°');
      }
    }
  }
}

// ============================================================================
// [R14] T 岔流光喇叭口（v1.8u 五改：单轨中心线 + 保留弧度——贯通轴中线与弯道
//   单弧居中于 ±d 双轨之间；喇叭口单弧半径 h）：虚构 T 岔小环 + mock gasCoverAt，
//   断言——①T 岔 = 贯通轴 1 条中线 + 支臂喇叭口 1 弧（pass 驱动查表）；
//   ②三个弯道格各产 1 弧（圆心=格角、半径 h）。环：(tx,ty-1)→(tx,ty)→(tx,ty+1)→
//   (tx+1,ty+1)→(tx+1,ty)→(tx,ty) —— (tx,ty) 被两次经过 ⇒ use = N+S+E（T 岔，
//   支臂 E，转弯趟 E 进 N 出 ⇒ 喇叭口 = NE 角）；死头 (tx,ty-1) 不罩。
// ============================================================================
{
  const tx = 1, ty = 1;
  const ring = [{ c: tx, r: ty - 1 }, { c: tx, r: ty }, { c: tx, r: ty + 1 },
                { c: tx + 1, r: ty + 1 }, { c: tx + 1, r: ty }, { c: tx, r: ty }];
  const savedPath = GS.railPath, savedSet = GS.railSet, savedCover = GS.gasCoverAt;
  GS.railPath = ring; GS.railSet = {};
  ring.forEach(q => { GS.railSet[q.c + ',' + q.r] = true; });
  GS.gasCoverAt = (c, r) => ((c === tx || c === tx + 1) && r >= ty && r <= ty + 1) ? 1 : 0;
  const h = L.cell / 2;
  const cB = makeCtx();
  REND.rangeHighlights(cB, L);
  const gasK = s => String(s || '').indexOf('94,200,240') >= 0;
  const segs = cB._segs.filter(q => gasK(q.stroke));
  const arcsB = cB._arcs.filter(q => gasK(q.stroke));
  // gas 弧 = 3 弯道 + T 岔喇叭口 = 4；线段 = T 岔纵贯通轴中线 = 1
  check('[R14] gas 色弧 = 4（3 弯道 + T 岔喇叭口）', arcsB.length === 4, 'arcs=' + arcsB.length);
  check('[R14] gas 色线段 = 1（T 岔纵贯通轴中线）', segs.length === 1,
    'segs=' + JSON.stringify(segs));
  const cxT = CFG.ccx(L, tx), cyT = CFG.ccy(L, ty);
  const eq = (a, b) => Math.abs(a - b) < 1e-9;
  const hasV = segs.some(q => eq(q.x1, cxT) && eq(q.y1, cyT - h) && eq(q.x2, cxT) && eq(q.y2, cyT + h));
  check('[R14] T 岔(' + tx + ',' + ty + ')：纵贯通中线 (cx, cy−h)→(cx, cy+h)',
    hasV, 'V=' + hasV);
  // 喇叭口：E 进 N 出 → NE 角单弧（圆心 (cx+h, cy−h)、半径 h、ccw）
  const horn = arcsB.filter(ar => eq(ar.x, cxT + h) && eq(ar.y, cyT - h));
  check('[R14] T 岔喇叭口 = NE 角单弧（圆心 (cx+h,cy−h)、半径 h）',
    horn.length === 1 && horn[0] && eq(horn[0].r, h),
    'horn=' + horn.map(ar => ar.r.toFixed(1)).join(','));
  const cornerOk = arcsB.every(ar => {
    const fx = (ar.x - L.x) / L.cell, fy = (ar.y - L.y) / L.cell;
    return eq(ar.r, h) && Math.abs(fx - Math.round(fx)) < 1e-9 &&
           Math.abs(fy - Math.round(fy)) < 1e-9;
  });
  check('[R14] 每条弧半径 = h、圆心落在格角（整格坐标）', arcsB.length === 4 && cornerOk);
  GS.railPath = savedPath; GS.railSet = savedSet; GS.gasCoverAt = savedCover;   // 复原现场
}

console.log('\n' + '='.repeat(64));
console.log('渲染层：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
if (fail) { console.log(failures.join('\n')); process.exit(1); }
