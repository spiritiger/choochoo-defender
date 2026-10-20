// ============================================================================
// 卡面 / 牌库回归（v1.6.33 新建）—— 大王令改版式那一轮的常驻回归。
//
//   为什么单开一套：卡面是 **DOM + CSS**，画布那套（test_render.js）够不着；
//   而"版式顺序""文案"这类东西最容易在后续改动里被无声改回去，必须钉住。
//
//   ▍两块：
//     [C1~C4] **卡面结构**：用一个只有 appendChild/createElement 的轻量 DOM 桩跑
//        `UI.fillCardDom`，直接数"子元素顺序与类名" —— 验的是大王要的三行版式
//        （顶部形状样式 → 中间名字 → 下面描述）+ 三类卡同一套结构 + 去 kind 行 + 文案。
//     [G1~G4] **牌库手势轴锁定**：牌库卡溢出时可横滑滚动、竖拖用卡。用假 document
//        记录监听器、手动派发 pointermove/up，验"横滑不结算 / 竖拖才结算 /
//        pointercancel 会清理"。这是 v1.6.33 新写的交互，最容易藏 bug。
//
//   ▍边界：只加载 ui.js（**不调 UI.init**，故不需要真 DOM / canvas 元素）；
//     ui.js 顶层只定义函数、不碰 DOM ⇒ 可用极简桩加载。
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

// ---- 轻量 DOM 桩（只够 fillCardDom / showOffer 用）----
function mkEl(tag) {
  const el = {
    tagName: tag, className: '', textContent: '', style: {}, children: [], listeners: {},
    appendChild(c) { this.children.push(c); return c; },
    // v1.6.37：showOffer 会给卡挂 click 监听（选卡结算），桩记录以便手动派发
    addEventListener(t, fn) { (el.listeners[t] = el.listeners[t] || []).push(fn); },
    removeEventListener() {}
  };
  // innerHTML = '' 是 showOffer 清弹层的手法：桩上要真的清空 children，
  // 否则 children[0] 还是上一张卡（P3 用例踩过：点到的永远是 P1 的词条卡）
  Object.defineProperty(el, 'innerHTML', {
    get() { return ''; },
    set() { el.children.length = 0; }
  });
  return el;
}
const docListeners = {};
const sandbox = { console, Math, Array, Object, JSON, Date, parseInt, parseFloat,
                  isNaN, String, Number, Boolean, RegExp, Error };
sandbox.window = sandbox;
sandbox.document = {
  createElement: mkEl,
  getElementById: () => null,
  addEventListener: (t, fn) => { (docListeners[t] = docListeners[t] || []).push(fn); },
  removeEventListener: (t, fn) => {
    const a = docListeners[t] || [];
    const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
};
vm.createContext(sandbox);
// ⚠️ 必须带 renderer.js：ui.js 的卡面取色直接用 REND.C.tower（英雄卡元素色）/
//    REND.C.gold（铸币所色）—— 页面里 renderer 在 ui 之前加载（加载序=依赖序），
//    测试沙箱也得照办，否则 fillCardDom 会 ReferenceError。
for (const f of ['js/config/map.js', 'js/state.js', 'js/resources.js', 'js/cards.js',
                 'js/station.js', 'js/towers.js', 'js/affixes.js', 'js/exp.js',
                 'js/engine.js', 'js/renderer.js', 'js/ui.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS, UI = sandbox.UI, REND = sandbox.REND,
      ENG = sandbox.ENG, TOWERS = sandbox.TOWERS;   // [C6] 建筑拖动用例补 ENG/TOWERS
GS.debugNoDeadline = true;
GS.newGame();

function kids(el) { return el.children.map(c => ({ cls: c.className, txt: c.textContent })); }
function kindsOf(el) { return el.children.map(c => c.className); }

// ============================================================================
// [C1~C4] 卡面结构：**顶部形状样式 → 中间名字 → 下面描述**
// ============================================================================
{
  const shape = { kind: 'shape', id: 1, name: '2×2', cells: [[0,0],[1,0],[0,1],[1,1]] };
  const hero = { kind: 'hero', id: 2, elem: 'arrow' };
  const mint = { kind: 'building', id: 3, bkey: 'mint' };
  const gas = { kind: 'building', id: 4, bkey: 'gas' };
  const atk = { kind: 'building', id: 5, bkey: 'atk' };
  const asp = { kind: 'building', id: 7, bkey: 'asp' };
  const affix = { kind: 'affix', id: 6, aid: 'a1' };

  for (const [tag, card, isOffer] of [['p', shape, false], ['p', hero, false],
                                      ['p', mint, false], ['p', gas, false],
                                      ['o', shape, true], ['o', hero, true]]) {
    const el = mkEl('div');
    UI.fillCardDom(el, card, isOffer);
    const pre = isOffer ? 'o' : 'p';
    const k = kindsOf(el);
    const okArt = k[0] === pre + '-art' || k[0] === pre + '-shape' || k[0] === pre + '-range';
    const okName = k[1] === pre + '-name';
    const okDesc = k[2] === pre + '-desc';
    check('[C1] ' + (isOffer ? '大卡' : '小卡') + ' ' + card.kind + '：三行顺序 = 顶部样式 / 名字 / 描述',
      k.length === 3 && okArt && okName && okDesc, JSON.stringify(k));
    check('[C2] ' + card.kind + '：不再有 kind 行（无 "*-kind" 子元素）',
      k.every(c => c.indexOf('-kind') < 0));
  }

  // 顶部"形状样式"的画法：形状卡=方格网格，英雄卡=六边形，建筑卡=方块
  const eShape = mkEl('div'); UI.fillCardDom(eShape, shape, false);
  check('[C3] 形状卡顶部 = 方格网格，格数 = 面积（4 格）',
    eShape.children[0].className === 'p-shape' && eShape.children[0].children.length === 4,
    'dots=' + eShape.children[0].children.length);
  const eHero = mkEl('div'); UI.fillCardDom(eHero, hero, false);
  const heroGlyph = eHero.children[0].children[0];
  check('[C3] 英雄卡顶部 = 六边形（.art-hex，塔的形状语言）',
    eHero.children[0].className === 'p-art' && heroGlyph.className === 'art-hex');
  check('[C3] 英雄卡顶部上塔型色（与塔同色）',
    heroGlyph.style.background === REND.C.tower['arrow'], String(heroGlyph.style.background));
  check('[C3] 英雄卡名字 = 塔型名（v1.8j 车厢改版）', eHero.children[1].textContent === '机枪',
    eHero.children[1].textContent);
  const eBld = mkEl('div'); UI.fillCardDom(eBld, mint, false);
  // v1.8u 三拍板：铸币所卡顶从单块黄方块改 3×3 范围图（金系，大王令"卡牌样式参考加油站"）
  check('[C3] 铸币所卡顶 = 范围图（3×3 全 9 格，中心金色）',
    eBld.children[0].className === 'p-range' && eBld.children[0].children.length === 9 &&
    eBld.children[0].children[4].style.background === '#f0b429' &&
    eBld.children[0].children[0].style.background !== '#f0b429');

  // 文案：形状卡有"清理 N 格"描述；英雄卡"建造后 +1 车厢"
  check('[C4] 形状卡描述 = 清理 4 格', eShape.children[2].textContent === '清理 4 格',
    eShape.children[2].textContent);
  check('[C4] 英雄卡描述 = 建造后 +1 车厢', eHero.children[2].textContent === '建造后 +1 车厢',
    eHero.children[2].textContent);

  // ⭐ 大王令：建筑卡描述**干掉"（可叠加）"**（叠加规则照旧生效，只是不再写卡面）
  //   v1.8u（§14.82 三拍板）：铸币所 sub 改覆盖枚数口径「覆盖金币 +1 枚（3×3）」
  check('[C4] 铸币所描述 = 覆盖金币 +' + CFG.MINT_BONUS + ' 枚（3×3），无"可叠加"',
    eBld.children[2].textContent === '覆盖金币 +' + CFG.MINT_BONUS + ' 枚（3×3）' &&
    eBld.children[2].textContent.indexOf('叠加') < 0, eBld.children[2].textContent);
  const eGas = mkEl('div'); UI.fillCardDom(eGas, gas, false);
  check('[C4] 加油站描述无"可叠加"（= 3×3 内列车提速）',
    eGas.children[2].textContent === '3×3 内列车提速' &&
    eGas.children[2].textContent.indexOf('叠加') < 0, eGas.children[2].textContent);
  check('[C4] 建筑信息表里也不含"叠加"字样',
    JSON.stringify(GS.BUILDING_INFO).indexOf('叠加') < 0, JSON.stringify(GS.BUILDING_INFO));

  // ── v1.6.35 建筑范围图（大王令"3×3 地块：中间建筑、周围效果范围"）──
  const eGas2 = mkEl('div'); UI.fillCardDom(eGas2, gas, false);
  check('[C5] 加油站卡顶 = 范围图（3×3 全 9 格，中心建筑色）',
    eGas2.children[0].className === 'p-range' && eGas2.children[0].children.length === 9 &&
    eGas2.children[0].children[4].style.background === '#5ec8f0' &&
    eGas2.children[0].children[0].style.background !== '#5ec8f0');
  // ── v1.8u 十三令（§14.84）：军工厂退役 → 猛攻坊（横条）/ 疾速坊（竖条）──
  const eAtk = mkEl('div'); UI.fillCardDom(eAtk, atk, false);
  const atkCells = eAtk.children[0].children;
  const atkVisible = atkCells.filter(d => d.style.visibility !== 'hidden').length;
  check('[C5] 猛攻坊卡顶 = 范围图（横条 3 格：上下行隐藏，中心绯红）',
    eAtk.children[0].className === 'p-range' && atkCells.length === 9 && atkVisible === 3 &&
    atkCells[4].style.background === '#c9503f' &&
    atkCells[3].style.background === 'rgba(224,86,63,0.45)', 'visible=' + atkVisible);
  check('[C5] 猛攻坊描述 = 左右车厢攻击 +100%', eAtk.children[2].textContent === '左右车厢攻击 +100%',
    eAtk.children[2].textContent);
  const eAsp = mkEl('div'); UI.fillCardDom(eAsp, asp, false);
  const aspCells = eAsp.children[0].children;
  const aspVisible = aspCells.filter(d => d.style.visibility !== 'hidden').length;
  check('[C5] 疾速坊卡顶 = 范围图（竖条 3 格：左右列隐藏，中心青碧）',
    eAsp.children[0].className === 'p-range' && aspCells.length === 9 && aspVisible === 3 &&
    aspCells[4].style.background === '#3dbd9e' &&
    aspCells[1].style.background === 'rgba(61,189,158,0.45)', 'visible=' + aspVisible);
  check('[C5] 疾速坊描述 = 上下车厢攻速 +100%', eAsp.children[2].textContent === '上下车厢攻速 +100%',
    eAsp.children[2].textContent);

  // ── v1.6.34 词条卡（第 5 类卡）──
  const eAf = mkEl('div'); UI.fillCardDom(eAf, affix, false);
  check('[C5] 词条卡三行结构 + 顶部菱形（.art-dia，塔型色）',
    eAf.children.length === 3 && eAf.children[0].children[0].className === 'art-dia' &&
    eAf.children[0].children[0].style.background === REND.C.tower['arrow'],
    JSON.stringify(eAf.children.map(c => c.className)));
  check('[C5] 词条卡名字 = 散射箭、描述 = 等价落地文案',
    eAf.children[1].textContent === '散射箭' &&
    eAf.children[2].textContent.length > 4, eAf.children[2].textContent);
  check('[C5] cardLabel 五类齐（塔型名替换元素名）',
    UI.cardLabel(hero) === '塔·机枪' && UI.cardLabel(affix) === '词条·散射箭' &&
    UI.cardLabel(atk) === '建筑·猛攻坊' && UI.cardLabel(asp) === '建筑·疾速坊',
    UI.cardLabel(hero) + '/' + UI.cardLabel(affix) + '/' + UI.cardLabel(atk) + '/' + UI.cardLabel(asp));
}

// ============================================================================
// [G1~G4] 牌库手势轴锁定：横滑 = 滚牌库（不结算）/ 竖拖 = 用卡（结算）
// ============================================================================
{
  // 搭最小可用环境
  UI.setStatus = () => {};
  let settled = 0;
  UI.settleClean = () => { settled++; };
  UI.settleHero = () => { settled++; };
  UI.settleBuilding = () => { settled++; };
  UI.deckRow = { scrollWidth: 500, clientWidth: 366, scrollLeft: 0 };   // 有溢出
  UI.canvas = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 390, height: 560 }),
                setPointerCapture: () => {} };
  sandbox.LAY = CFG.layout();
  GS.deck = [{ kind: 'shape', id: 9, name: '2×2', cells: [[0,0],[1,0],[0,1],[1,1]] }];
  GS.railPath = [];

  function fire(type, ev) { (docListeners[type] || []).slice().forEach(fn => fn(ev)); }
  const down = () => ({ clientX: 200, clientY: 700, pointerId: 1,
                        target: { setPointerCapture() {} } });

  // ① 横向滑动（20px，纯横）⇒ 滚牌库，且**不结算**
  UI.startDeckDrag(down(), 0);
  fire('pointermove', { clientX: 180, clientY: 700 });
  check('[G1] 横滑 → 牌库滚动（scrollLeft 变化）', UI.deckRow.scrollLeft === 20,
    'scrollLeft=' + UI.deckRow.scrollLeft);
  check('[G1] 横滑 → 不生成拖拽幽灵（UI.drag 仍为 null）', UI.drag === null);
  fire('pointerup', { clientX: 180, clientY: 700 });
  check('[G1] 横滑松手 → **不结算**（卡不被用掉）', settled === 0, 'settled=' + settled);
  check('[G1] 松手后监听器已摘干净（无 pointerup 残留）', (docListeners['pointerup'] || []).length === 0);

  // ② 竖拖（往上 100px）⇒ 用卡，松手结算
  const before = UI.deckRow.scrollLeft;
  UI.startDeckDrag(down(), 0);
  fire('pointermove', { clientX: 200, clientY: 600 });
  check('[G2] 上拖 → 生成拖拽幽灵（UI.drag 有 kind）', !!(UI.drag && UI.drag.kind === 'clean'),
    JSON.stringify(UI.drag && UI.drag.kind));
  check('[G2] 上拖 → 牌库不滚动', UI.deckRow.scrollLeft === before);
  fire('pointerup', { clientX: 200, clientY: 600 });
  check('[G2] 上拖松手 → 结算一次（settled=' + settled + '）', settled === 1);
  check('[G2] 结算后 UI.drag 已清空', UI.drag === null);

  // ③ 纯点击（没动够）⇒ 既不滚也不结算
  UI.startDeckDrag(down(), 0);
  fire('pointermove', { clientX: 201, clientY: 701 });
  fire('pointerup', { clientX: 201, clientY: 701 });
  check('[G3] 纯点击（位移 <10px）→ 不滚、不结算（卡留在牌库）',
    settled === 1 && UI.deckRow.scrollLeft === before, 'settled=' + settled);

  // ④ pointercancel（浏览器接管手势）⇒ 清理，不结算
  UI.startDeckDrag(down(), 0);
  fire('pointermove', { clientX: 200, clientY: 600 });
  fire('pointercancel', { clientX: 200, clientY: 600 });
  check('[G4] pointercancel → 清理拖拽态且不结算',
    UI.drag === null && settled === 1 && (docListeners['pointermove'] || []).length === 0,
    'settled=' + settled + ' mv=' + (docListeners['pointermove'] || []).length);

  // ⑤ 牌库**不**溢出时，横滑不该抢走"用卡"（老手感不变）
  UI.deckRow = { scrollWidth: 200, clientWidth: 366, scrollLeft: 0 };
  UI.startDeckDrag(down(), 0);
  fire('pointermove', { clientX: 150, clientY: 700 });     // 横滑 50px
  check('[G5] 牌库未溢出 → 横滑仍视为用卡（UI.drag 已生成）', !!(UI.drag && UI.drag.kind === 'clean'));
  fire('pointerup', { clientX: 150, clientY: 700 });
  check('[G5] 未溢出时横滑松手 → 正常结算', settled === 2);
}

// ============================================================================
// [P1~P3] 词条弹层暂停（v1.6.37 大王令"抽词条的时候游戏需要暂停"）
// ============================================================================
{
  UI.setStatus = () => {};
  // showOffer 的桩：overlay 只需 classList；offerCards 承接卡 DOM
  UI.offerCards = mkEl('div');
  UI.offerOverlay = { classList: { add() {}, remove() {} } };
  GS.deck = [];

  // [P1] 词条弹层弹出 → **暂停**
  GS.paused = false;
  UI.showOffer([{ kind: 'affix', id: 90, aid: 'a1' }]);
  check('[P1] 词条弹层弹出 → 游戏暂停（GS.paused = true）', GS.paused === true);
  check('[P1] 弹层渲染了 1 张词条卡（.oc）',
    UI.offerCards.children.length === 1 && UI.offerCards.children[0].className === 'oc');

  // [P2] 选卡 → 恢复运行 + 全局生效 + **不进牌库**
  UI.offerCards.children[0].listeners.click[0]({});
  check('[P2] 选完词条 → 恢复运行（GS.paused = false）', GS.paused === false);
  check('[P2] 词条已全局生效（hasAffix）且**不进牌库**',
    GS.hasAffix('a1') && !GS.deck.some(c => c.kind === 'affix'));

  // [P3] 普通抽卡弹层 → **不暂停**（白天本就停车），选卡进牌库
  GS.paused = false;
  GS.deck = [];
  UI.deckRow = { scrollWidth: 0, clientWidth: 366, scrollLeft: 0,
                 innerHTML: '', appendChild() {} };     // renderDeck 桩
  UI.showOffer([{ kind: 'hero', id: 91, elem: 'arrow' }]);
  check('[P3] 普通抽卡弹层 → 不暂停', GS.paused === false);
  UI.offerCards.children[0].listeners.click[0]({});
  check('[P3] 选普通卡 → 关层照常恢复、卡进牌库',
    GS.paused === false && GS.deck.length === 1 && GS.deck[0].kind === 'hero');
}

// [EX] 导出校验行（v1.6.66）：check 行紧随 rail 行，rail=步数、head/tail=首尾格
//   病灶动机：rail 行最长单行，手动复制曾漏尾一个 token（2026-10-15 排查）。
{
  sandbox.FOES = { wave: 0 };                       // exportMap 引用 FOES.wave，桩之
  GS.railPath = [{ c: 1, r: 1 }, { c: 0, r: 1 }, { c: 0, r: 2 }, { c: 1, r: 2 }];
  const lines = UI.exportMap().split('\n');
  const iR = lines.findIndex(l => l.startsWith('rail('));
  check('[EX] check 行存在、紧随 rail 行且首尾格正确',
    iR >= 0 && lines[iR + 1] === 'check: rail=4 head=1,1 tail=1,2', lines[iR + 1]);
  GS.railPath = [];
  check('[EX] 空环不产 check 行（rail=0 行仍在）',
    UI.exportMap().split('\n').every(l => !l.startsWith('check:')));
  GS.railPath = [];
}

// [IM] 地图导入 round-trip（v1.6.67 大王令）：导出 → 导入 → 再导出逐行全等（除时间戳）；
//   丢尾格 / 非地图数据 / 非法环 拒收且盘面原地不动
{
  sandbox.FOES = sandbox.FOES || { wave: 0 };       // [EX] 已桩过；防序兜底
  GS.newGame();
  const txt1 = UI.exportMap().split('\n');
  check('[IM] 正常导出导入成功（返回 null）', GS.importMap(txt1.join('\n')) === null);
  const txt2 = UI.exportMap().split('\n');
  let same = txt1.length === txt2.length;
  for (let li = 1; same && li < txt1.length; li++) if (txt1[li] !== txt2[li]) same = false;
  check('[IM] 导出→导入→导出 逐行全等（除时间戳行）', same);
  const broken = txt1.join('\n').replace(/^rail\((\d+)\): (.*)$/m, (mm, n, seq) =>
    'rail(' + n + '): ' + seq.split(' ').slice(0, -1).join(' '));
  const e1 = GS.importMap(broken);
  check('[IM] 丢尾格导出被拒收（提示不完整）', typeof e1 === 'string' && e1.indexOf('不完整') >= 0, e1);
  check('[IM] 非地图数据被拒收', typeof GS.importMap('hello') === 'string');
  // check 校验路径：数量对但首格被换 → check 行首格不符（数量错会先被"不完整"拦住，
  //   踩不到 check 校验，故这里只动首格坐标）
  const e2 = GS.importMap(txt1.join('\n').replace(/^(rail\(\d+\): )\d+,\d+/m, '$19,9'));
  check('[IM] check 首尾格不符被拒收', typeof e2 === 'string' && e2.indexOf('不符') >= 0, e2);
  GS.newGame();                                     // 恢复干净盘面
}

// ============================================================================
// [C6] 场上建筑自由拖动（v1.8u 十四令 §14.85）：移动 / 交换 / 下场变卡 / 非法弹回
//   —— 大王令"建筑不再能合成升级"，位置调整替代升级：拖空地=移动、拖建筑=交换、
//   拖出画布=变回卡牌（进牌库尾部，可逆）；金币/塔/镇中心全弹回。
// ============================================================================
{
  sandbox.FOES = sandbox.FOES || { wave: 0 };
  UI.setStatus = () => {};
  UI.renderDeck = () => {};
  GS.debugNoDeadline = true;
  GS.newGame();
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
    GS.grid[r][c].gold = false; GS.grid[r][c].heart = false;   // 清资源格凑干净可行区
  }
  GS.goldTiles = []; GS.heartTiles = [];
  // 开局自带 12 格初始环（内区真空地只剩 2 格）—— 清几块废墟凑拖动用例的场地
  let made = 0;
  for (let r = 0; r < CFG.MAP_ROWS && made < 6; r++)
    for (let c = 0; c < CFG.MAP_COLS && made < 6; c++) {
      if (GS.grid[r][c].t === 'blank' || GS.grid[r][c].b || GS.onRail(c, r)) continue;
      GS.grid[r][c].t = 'blank'; made++;
    }
  const free = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) free.push({ c, r });
  const A = free[0], B = free[1], C = free[2];

  // ① 移动：mint 建在 A，拖到空地 B → 双格引用对调、坐标更新（加成查询式自动跟随）
  ENG.placeBuilding(A.c, A.r, 'mint');
  const mint = GS.grid[A.r][A.c].b;
  UI.settleBuildingMove({ building: mint }, B);
  check('[C6] 移动：松手空地 → 坐标/双格引用同步',
    GS.grid[A.r][A.c].b === null && GS.grid[B.r][B.c].b === mint &&
    mint.c === B.c && mint.r === B.r);

  // ② 交换：gas 建在 C，mint(B) 拖到 gas(C) → 两格引用互换、坐标互换
  ENG.placeBuilding(C.c, C.r, 'gas');
  const gas = GS.grid[C.r][C.c].b;
  UI.settleBuildingMove({ building: mint }, C);
  check('[C6] 交换：拖到另一建筑上 → 引用/坐标互换（不是合成升级）',
    GS.grid[B.r][B.c].b === gas && GS.grid[C.r][C.c].b === mint &&
    gas.c === B.c && gas.r === B.r && mint.c === C.c && mint.r === C.r);

  // ③ 下场：mint 拖出画布（cell=null）→ buildings 减一、deck 尾多一张同型建筑卡
  const nB = GS.buildings.length, nD = GS.deck.length;
  UI.settleBuildingMove({ building: mint }, null);
  check('[C6] 下场：拖出画布 → 变回建筑卡进牌库尾部（可再拖回）',
    GS.buildings.length === nB - 1 && GS.deck.length === nD + 1 &&
    GS.deck[nD].kind === 'building' && GS.deck[nD].bkey === 'mint' &&
    GS.grid[C.r][C.c].b === null);

  // ④ 弹回/交换两路：金币格（b=null 但非 isFreeSpot）弹回；塔格 = 建筑 ⇄ 塔交换
  //   （v1.8u 十七令 §14.88 放开：塔纳入交换，双向）
  const atk2 = free[3];
  ENG.placeBuilding(atk2.c, atk2.r, 'atk');
  const atkB = GS.grid[atk2.r][atk2.c].b;
  const goldCell = free[5];                       // 造在空闲格（B 已被 ② 的 gas 占着）
  GS.goldTiles.push({ c: goldCell.c, r: goldCell.r }); GS.grid[goldCell.r][goldCell.c].gold = true;
  UI.settleBuildingMove({ building: atkB }, goldCell);
  check('[C6] 弹回：金币格不是空地（b=null 也不行）',
    atkB.c === atk2.c && atkB.r === atk2.r && GS.grid[atk2.r][atk2.c].b === atkB);
  TOWERS.placeAt(free[4].c, free[4].r, 'arrow', 1);
  const tw0 = GS.grid[free[4].r][free[4].c].b;
  UI.settleBuildingMove({ building: atkB }, free[4]);
  check('[C6] 建筑 ⇄ 塔交换（十七令放开）：引用/坐标互换',
    GS.grid[atk2.r][atk2.c].b === tw0 && GS.grid[free[4].r][free[4].c].b === atkB &&
    tw0.c === atk2.c && tw0.r === atk2.r && atkB.c === free[4].c && atkB.r === free[4].r);
  UI.settleBuildingMove({ building: atkB }, { c: GS.core.c, r: GS.core.r });
  check('[C6] 弹回：镇中心不能换位',
    atkB.c === free[4].c && atkB.r === free[4].r &&
    GS.grid[GS.core.r][GS.core.c].b === GS.core);
  // ⑤ 原位松手 = 无事
  UI.settleBuildingMove({ building: atkB }, { c: free[4].c, r: free[4].r });
  check('[C6] 原位松手 = 无事', GS.grid[free[4].r][free[4].c].b === atkB);
}

// ============================================================================
// [C7] 场上塔自由拖动（v1.8u 十七令 §14.88）：移动 / 交换 / 合成保留 / 弹回 / 不可下场
//   —— 大王拍板「移动+交换」：拖空地=移动、拖建筑/异类塔=交换、同名同星=合成（保留）；
//   星级长在塔上 ⇒ 拖出画布**不下场**（弹回），与建筑拖动的唯一差异点。
// ============================================================================
{
  GS.newGame();
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++) {
    GS.grid[r][c].gold = false; GS.grid[r][c].heart = false;
  }
  GS.goldTiles = []; GS.heartTiles = [];
  let made7 = 0;
  for (let r = 0; r < CFG.MAP_ROWS && made7 < 6; r++)
    for (let c = 0; c < CFG.MAP_COLS && made7 < 6; c++) {
      if (GS.grid[r][c].t === 'blank' || GS.grid[r][c].b || GS.onRail(c, r)) continue;
      GS.grid[r][c].t = 'blank'; made7++;
    }
  const f7 = [];
  for (let r = 0; r < CFG.MAP_ROWS; r++) for (let c = 0; c < CFG.MAP_COLS; c++)
    if (GS.isFreeSpot(c, r)) f7.push({ c, r });
  const P = f7[0], Q = f7[1], R7 = f7[2];

  // ① 移动：塔建在 P，拖到空地 Q → 双格引用同步、塔对象 c/r 更新、仍在编组
  const t1 = TOWERS.placeAt(P.c, P.r, 'magic', 1);
  UI.settleTowerMove({ tower: t1 }, Q);
  check('[C7] 移动：松手空地 → 坐标/双格引用同步（仍在 GS.towers）',
    GS.grid[P.r][P.c].b === null && GS.grid[Q.r][Q.c].b === t1 &&
    t1.c === Q.c && t1.r === Q.r && GS.towers.indexOf(t1) >= 0);

  // ② 交换（异类塔）：arrow 塔建在 R7，magic(Q) 拖到 arrow(R7) → 互换不合并
  const t2 = TOWERS.placeAt(R7.c, R7.r, 'arrow', 1);
  UI.settleTowerMove({ tower: t1 }, R7);
  check('[C7] 交换：异类塔上松手 → 引用/坐标互换（不吞塔）',
    GS.grid[Q.r][Q.c].b === t2 && GS.grid[R7.r][R7.c].b === t1 &&
    t2.c === Q.c && t2.r === Q.r && t1.c === R7.c && t1.r === R7.r &&
    GS.towers.length === 2);

  // ③ 合成保留：magic 1 星建在 P（R7 的 magic 拖过去）→ star=2、源塔离场
  const t3 = TOWERS.placeAt(P.c, P.r, 'magic', 1);
  UI.settleTowerMove({ tower: t1 }, P);
  check('[C7] 合成保留：同名同星 → 星级+1、源塔离场',
    GS.grid[P.r][P.c].b === t3 && t3.star === 2 &&
    GS.towers.indexOf(t1) < 0 && GS.towers.length === 2);

  // ④ 同名异星 = 交换不吞：magic 1 星建在 R7，拖到 P 的 magic 2 星上 → 互换
  const t4 = TOWERS.placeAt(R7.c, R7.r, 'magic', 1);
  UI.settleTowerMove({ tower: t4 }, P);
  check('[C7] 同名异星不合成 → 交换（星级不吞不并）',
    GS.grid[R7.r][R7.c].b === t3 && GS.grid[P.r][P.c].b === t4 &&
    t3.star === 2 && t4.star === 1 && GS.towers.length === 3);

  // ⑤ 不可下场：拖出画布（cell=null）→ 弹回，塔数/格引用原样
  UI.settleTowerMove({ tower: t4 }, null);
  check('[C7] 不可下场：拖出画布弹回（星级资产不动）',
    GS.towers.length === 3 && GS.grid[P.r][P.c].b === t4 && t4.c === P.c);

  // ⑥ 弹回：金币格（b=null 但非 isFreeSpot）
  const g7 = f7[5];
  GS.goldTiles.push({ c: g7.c, r: g7.r }); GS.grid[g7.r][g7.c].gold = true;
  UI.settleTowerMove({ tower: t4 }, g7);
  check('[C7] 弹回：金币格不是空地', t4.c === P.c && t4.r === P.r &&
    GS.grid[P.r][P.c].b === t4);

  // ⑦ core 不能换位
  UI.settleTowerMove({ tower: t4 }, { c: GS.core.c, r: GS.core.r });
  check('[C7] 弹回：镇中心不能换位',
    t4.c === P.c && GS.grid[GS.core.r][GS.core.c].b === GS.core);

  // ⑧ 原位松手 = 无事
  UI.settleTowerMove({ tower: t4 }, { c: P.c, r: P.r });
  check('[C7] 原位松手 = 无事', GS.grid[P.r][P.c].b === t4);

  // ⑨ 建筑 ⇄ 塔交换（另一方向）：gas 放到空格，塔 t2(Q) 拖到 gas 上 → 互换
  const S7 = f7[3];
  ENG.placeBuilding(S7.c, S7.r, 'gas');
  const gas7 = GS.grid[S7.r][S7.c].b;
  UI.settleTowerMove({ tower: t2 }, S7);
  check('[C7] 建筑 ⇄ 塔交换：塔拖到建筑上 → 互换',
    GS.grid[Q.r][Q.c].b === gas7 && GS.grid[S7.r][S7.c].b === t2 &&
    gas7.c === Q.c && gas7.r === Q.r && t2.c === S7.c && t2.r === S7.r);
}

console.log('\n' + '='.repeat(64));
console.log('卡面/牌库：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
if (fail) { console.log(failures.join('\n')); process.exit(1); }
