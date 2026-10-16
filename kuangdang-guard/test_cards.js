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
const CFG = sandbox.CFG, GS = sandbox.GS, UI = sandbox.UI, REND = sandbox.REND;
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
  const factory = { kind: 'building', id: 5, bkey: 'factory' };
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
  check('[C3] 英雄卡名字 = 塔型名（v1.6.34 塔型化）', eHero.children[1].textContent === '箭塔',
    eHero.children[1].textContent);
  const eBld = mkEl('div'); UI.fillCardDom(eBld, mint, false);
  check('[C3] 建筑卡顶部 = 方块（.art-sq，建筑的形状语言）',
    eBld.children[0].children[0].className === 'art-sq');

  // 文案：形状卡有"清理 N 格"描述；英雄卡"建造后 +1 车厢"
  check('[C4] 形状卡描述 = 清理 4 格', eShape.children[2].textContent === '清理 4 格',
    eShape.children[2].textContent);
  check('[C4] 英雄卡描述 = 建造后 +1 车厢', eHero.children[2].textContent === '建造后 +1 车厢',
    eHero.children[2].textContent);

  // ⭐ 大王令：建筑卡描述**干掉"（可叠加）"**（叠加规则照旧生效，只是不再写卡面）
  check('[C4] 铸币所描述无"可叠加"（= 全场金币价值 +' + CFG.MINT_BONUS + '）',
    eBld.children[2].textContent === '全场金币价值 +' + CFG.MINT_BONUS &&
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
  const eFac = mkEl('div'); UI.fillCardDom(eFac, factory, false);
  const facCells = eFac.children[0].children;
  const facVisible = facCells.filter(d => d.style.visibility !== 'hidden').length;
  check('[C5] 军工厂卡顶 = 范围图（十字 5 格：四角隐藏）',
    eFac.children[0].className === 'p-range' && facCells.length === 9 && facVisible === 5 &&
    facCells[4].style.background === '#7e57c2', 'visible=' + facVisible);
  check('[C5] 军工厂描述 = 车厢攻击 +20%', eFac.children[2].textContent === '车厢攻击 +20%',
    eFac.children[2].textContent);

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
    UI.cardLabel(hero) === '塔·箭塔' && UI.cardLabel(affix) === '词条·散射箭' &&
    UI.cardLabel(factory) === '建筑·军工厂',
    UI.cardLabel(hero) + '/' + UI.cardLabel(affix) + '/' + UI.cardLabel(factory));
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

console.log('\n' + '='.repeat(64));
console.log('卡面/牌库：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(64));
if (fail) { console.log(failures.join('\n')); process.exit(1); }
