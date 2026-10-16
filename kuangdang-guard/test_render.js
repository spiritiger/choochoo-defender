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
  c.texts = [];                                  // 记录 fillText（连同当时的 fillStyle / globalAlpha），
  c.fillText = (t, x, y) => c.texts.push({ t: t, x: x, y: y, fill: c.fillStyle, a: c.globalAlpha });
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
function drawAt(index) {
  GS.train.picked = BAG.slice();
  GS.train.index = index;
  rec.length = 0;
  REND.draw(makeCtx(), L, null, null);
  return rec.slice(-BAG.length);
}
const head = () => ENG.trainPos();
const fwd = () => { const a = ENG.trainAngle(); return { x: Math.cos(a), y: Math.sin(a) }; };

// ============================================================================
// [R1] 屁股货堆的**堆叠方向恒为屏幕上方**（v1.6.29 大王实报"车头朝左时朝下了"）
//   病因：整堆曾画在车头的旋转系里，"上"跟着车头转。修法 = 挪到 ctx.restore() 之后。
//   ⚠️ 谁再把这段挪回车头的 save/translate/rotate 块内，本组用例立刻红。
//   初始 12 格环上的朝向：i0/i1=+x(东) i2~i5=+y(南) i6/i7=−x(西) i8~i11=−y(北)。
// ============================================================================
const HEADING = [[0, '朝右(E)'], [6, '朝左(W)'], [2, '朝下(S)'], [8, '朝上(N)']];
for (const [idx, name] of HEADING) {
  const r = drawAt(idx);
  const g = r.filter(x => x.k === 'gold'), h = r.filter(x => x.k === 'heart');
  check('[R1] ' + name + ' 金币列逐枚朝屏幕上方（世界 y 单调递减）',
    g.every((v, i) => i === 0 || v.w.y < g[i - 1].w.y - 0.5), g.map(x => x.w.y.toFixed(1)).join('>'));
  check('[R1] ' + name + ' 爱心列逐枚朝屏幕上方',
    h.every((v, i) => i === 0 || v.w.y < h[i - 1].w.y - 0.5), h.map(x => x.w.y.toFixed(1)).join('>'));
  check('[R1] ' + name + ' 每列内部 x 恒定（竖直列）',
    new Set(g.map(x => x.w.x.toFixed(3))).size === 1 &&
    new Set(h.map(x => x.w.x.toFixed(3))).size === 1);
  check('[R1] ' + name + ' 两列屏幕左右并排（同索引等高、x 不同）',
    Math.abs(g[0].w.y - h[0].w.y) < 1e-9 && g[0].w.x !== h[0].w.x);
  const h0 = head();
  const maxD = Math.max(...r.map(x => Math.hypot(x.w.x - h0.x, x.w.y - h0.y)));
  check('[R1] ' + name + ' 堆挂在车上不脱钩（离车头 < 50px）', maxD < 50, 'maxD=' + maxD.toFixed(1));
  if (idx === 0 || idx === 6) {
    const f = fwd();
    check('[R1] ' + name + ' 整堆落在车尾侧（·前进方向 ≤ 0）',
      r.every(x => (x.w.x - h0.x) * f.x + (x.w.y - h0.y) * f.y <= 0.01));
  }
}

// [R2] 车朝右时货堆锚点 = 车头屁股（尾巴方向退 PK_D，金右/心左）——
//   v1.6.27 原值 15.5/25；v1.6.74 火车放大（TRAIN_SCALE=1.15）⇒ 锚点随车头
//   半长外移，断言改按公式跟缩放系数（PK_D=20.25×s，金 = −PK_D+4.75、
//   心 = −PK_D−4.75），车再缩放不用改这里。
{
  const r = drawAt(0), h0 = head();
  const gx = r.filter(x => x.k === 'gold')[0].w.x;
  const hx = r.filter(x => x.k === 'heart')[0].w.x;
  const PKD = 20.25 * REND.TRAIN_SCALE;
  check('[R2] 朝右时锚点跟车尾（金列 head.x−(PK_D−4.75) / 心列 head.x−(PK_D+4.75)）',
    Math.abs(gx - (h0.x - (PKD - 4.75))) < 1e-9 && Math.abs(hx - (h0.x - (PKD + 4.75))) < 1e-9,
    'Δ金=' + (gx - h0.x).toFixed(2) + ' Δ心=' + (hx - h0.x).toFixed(2));
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

  // v1.7.3 终局预览（§14.63）：UI.finalPreview 开 → 主 draw 走 finalPreview 绘制
  //   路径不抛（沙箱无 ui.js —— 手动塞 UI 桩；CLOCK 真载入，白天态）；关 → 早退
  sandbox.UI = { finalPreview: true };
  sandbox.CLOCK.phase = 'day';
  err = '';
  try { REND.draw(makeCtx(), L, null, null); } catch (e) { err = (e && e.message) || 'throw'; }
  check('[R9] 终局预览开（白天）draw 不抛异常', !err, err);
  // v1.7.4 画法二改：fillRect 次数 == |U|（走廊区极淡填充），轨道双线 lineTo>0
  let fills = 0, lines = 0, strokes2 = 0;
  const pctx = makeCtx();
  pctx.fillRect = () => { fills++; };
  pctx.lineTo = () => { lines++; };
  pctx.stroke = () => { strokes2++; };
  try { REND.finalPreview(pctx, L); } catch (e) {}
  const pvU = Object.keys(GS.finalPreviewCells().u).length;
  check('[R9] 终局预览走廊填充（fillRect ' + fills + ' == |U| ' + pvU + '）',
    fills === pvU && pvU > 0, 'fills=' + fills + ' |U|=' + pvU);
  check('[R9] 透明真轨贴片（lineTo ' + lines + '>0 且逐格 stroke ' + strokes2 + '>1）',
    lines > 0 && strokes2 > 1, 'lines=' + lines + ' stroke=' + strokes2);
  sandbox.UI.finalPreview = false;
  fills = 0;
  const pctx2 = makeCtx();
  pctx2.fillRect = () => { fills++; };
  try { REND.finalPreview(pctx2, L); } catch (e) {}
  check('[R9] 终局预览关 → 零绘制', fills === 0, 'fills=' + fills);
  delete sandbox.UI;
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
// [R9] 经验条改版（v1.6.41 大王令 = C 全宽细条 × A 胶囊语言）：
//      全宽胶囊贴 HUD 下沿 + ◆ 徽标 + 右端数字 + ≥80% 呼吸脉冲
// ============================================================================
{
  // 拦截 REND.rr 记录胶囊尺寸（进度宽 = (390-5) × ratio）
  const rrCalls = [];
  const rrOrig = REND.rr;
  REND.rr = (ctx, x, y, w, h, r) => { rrCalls.push({ x, y, w, h, r }); return rrOrig(ctx, x, y, w, h, r); };

  const savedExp = { exp: GS.exp, taken: GS.expTaken, pending: GS.expPending };
  const cN = makeCtx();

  // ① 中段进度（12/30 = 40%）：全宽底槽 + 进度宽 154 + 数字文本
  GS.exp = 12; GS.expTaken = 2; GS.expPending = 0;
  rrCalls.length = 0;
  REND.expBar(cN, L);
  check('[R9] 全宽底槽（W-1=389 × 8，贴 HUD 下沿）',
    rrCalls.some(c => c.w === 389 && c.h === 8 && c.r === 4.5),
    JSON.stringify(rrCalls));
  check('[R9] 进度条宽 = (W-5)×ratio（12/30 ⇒ 154）',
    rrCalls.some(c => Math.abs(c.w - 154) < 0.01 && c.h === 4),
    JSON.stringify(rrCalls));
  check('[R9] 数字文本 12/30（v1.6.42 起居中压条）', cN.texts.some(x => x.t === '12/30'),
    JSON.stringify(cN.texts.map(x => x.t)));

  // ② 快满（24/30 = 80%）：呼吸分支不抛异常（pulse 走 performance.now）
  let errH = null;
  GS.exp = 24;
  try { REND.expBar(makeCtx(), L); } catch (e) { errH = (e && e.message) || 'throw'; }
  check('[R9] ≥80% 呼吸脉冲分支执行不抛异常', !errH, errH);

  // ③ 满（30/30）：进度宽 = 全宽 385
  rrCalls.length = 0;
  GS.exp = 30;
  REND.expBar(makeCtx(), L);
  check('[R9] 满进度 ⇒ 进度宽 385（整条填满）',
    rrCalls.some(c => Math.abs(c.w - 385) < 0.01), JSON.stringify(rrCalls));

  // ④ 经验为 0：条仍画（0/30 提醒攒头一杀），进度胶囊跳过
  rrCalls.length = 0;
  GS.exp = 0;
  const cZ = makeCtx();
  REND.expBar(cZ, L);
  check('[R9] 经验 0 ⇒ 画底槽与数字、不画进度胶囊',
    rrCalls.length === 1 && cZ.texts.some(x => x.t === '0/30'),
    'rr=' + rrCalls.length + ' texts=' + JSON.stringify(cZ.texts.map(x => x.t)));

  REND.rr = rrOrig;
  GS.exp = savedExp.exp; GS.expTaken = savedExp.taken; GS.expPending = savedExp.pending;
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

console.log('\n' + '='.repeat(64));
console.log('渲染层：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
if (fail) { console.log(failures.join('\n')); process.exit(1); }
