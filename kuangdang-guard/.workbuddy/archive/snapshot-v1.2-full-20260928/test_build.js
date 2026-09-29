// ============================================================
// 打包健康检查：验证「单文件打包能力」与「后续频繁修改」互不干扰。
//
// 用法：node test_build.js
//
// 为什么需要它：
//   build_single.js 靠正则去 index.html 里找 <link>/<script src> 并内联。
//   只要正则太严，某种写法变体（属性顺序颠倒、多余空格、自闭合）就会被漏掉，
//   而漏掉的表现是"打包照常成功、但产出文件缺了一段代码"—— 极难发现。
//   本脚本就是给这个风险装个报警器。
//
// 检查内容：
//   ① 基线：原始 index.html 可完整内联、无残留外链
//   ② 新增 JS 文件 → 自动内联，无需改打包脚本
//   ③ 删除 JS 文件 → 不残留引用
//   ④ 调整加载顺序 → 内联顺序严格跟随 index.html（顺序敏感型代码安全）
//   ⑤ 新增第二个 CSS → 两个都内联
//   ⑥ 标签写法变体（属性顺序颠倒/多余空格/自闭合）→ 仍能识别
//   ⑥b 带 defer/async → 应拒绝内联（时序语义不同）
//   ⑦ 单文件版内联的 JS == 源码各文件原样拼接（零改写、零压缩）
//
// 全部在内存里做，不触碰真实项目文件。
// ============================================================
var fs = require('fs');
var path = require('path');
var ROOT = __dirname;

var log = [], fails = 0;
function L(s) { log.push(s); }
function check(name, cond, detail) {
  L((cond ? 'PASS' : 'FAIL') + '  ' + name + (cond ? '' : '   → ' + (detail || '')));
  if (!cond) fails++;
}

// ---------- 直接调用打包脚本用的那份内联逻辑（原来这里抄了一份副本，已抽到 build_core.js）----------
var core = require('./build_core.js');
function inline(html, readFile) {
  return core.inlineAssets(html, readFile).html;
}
var realRead = function (rel) { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); };
var original = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var EOL = original.indexOf('\r\n') >= 0 ? '\r\n' : '\n';   // index.html 用 CRLF，替换时必须兼容

function leftovers(html) {
  return html.match(/(?:src|href)="(?!#|https?:|data:|javascript:|mailto:)[^"]*"/g);
}

L('================ 基线 ================');
var base = inline(original, realRead);
check('① 原始 index.html 可完整内联且无残留外链', leftovers(base) === null, String(leftovers(base)));
check('   9 个 JS 全部内联', (base.match(/<script>\n\/\* ===== /g) || []).length === 9);
check('   1 个 CSS 已内联', base.indexOf('<style>') >= 0 && base.indexOf('rel="stylesheet"') < 0);

L('');
L('================ 模拟后续改代码 ================');

// ② 新增一个 JS 文件（最常见的改动）
var added = original.replace('</body>', '<script src="js/combat.js"></script>' + EOL + '</body>');
var r2 = inline(added, function (rel) {
  return rel === 'js/combat.js' ? 'window.COMBAT = { hello: 1 };' : realRead(rel);
});
check('② 新增 js/combat.js → 自动内联，无需改打包脚本',
  leftovers(r2) === null && r2.indexOf('window.COMBAT = { hello: 1 };') >= 0 &&
  r2.indexOf('js/combat.js') >= 0, String(leftovers(r2)));

// ③ 删除一个 JS（比如把 transport 合进 state）
var removed = original.replace('<script src="js/transport.js"></script>' + EOL, '');
var r3 = inline(removed, realRead);
check('③ 删掉一个 JS → 不会残留引用',
  leftovers(r3) === null && r3.indexOf('js/transport.js') < 0,
  'leftovers=' + leftovers(r3) + ' idx=' + r3.indexOf('js/transport.js'));

// ④ 调整加载顺序（新文件插在最前面）
var reordered = original.replace('<script src="js/config/map.js"></script>',
  '<script src="js/aaa-first.js"></script>' + EOL + '<script src="js/config/map.js"></script>');
var r4 = inline(reordered, function (rel) {
  return rel === 'js/aaa-first.js' ? 'window.AAA = 1;' : realRead(rel);
});
var idxAAA = r4.indexOf('window.AAA = 1;');
var idxCFG = r4.indexOf('/* ===== js/config/map.js ===== */');
check('④ 调整顺序 → 内联顺序严格跟随 index.html（顺序敏感型代码安全）',
  idxAAA >= 0 && idxCFG >= 0 && idxAAA < idxCFG, 'AAA@' + idxAAA + ' CFG@' + idxCFG);

// ⑤ 新增第二个 CSS
var twoCss = original.replace('<link rel="stylesheet" href="css/style.css">',
  '<link rel="stylesheet" href="css/style.css">' + EOL + '<link rel="stylesheet" href="css/theme.css">');
var r5 = inline(twoCss, function (rel) {
  return rel === 'css/theme.css' ? ':root { --tone: 1; }' : realRead(rel);
});
check('⑤ 新增第二个 CSS → 两个都内联，顺序保留',
  leftovers(r5) === null && r5.indexOf('--tone') >= 0 &&
  (r5.match(/<style>/g) || []).length === 2, String(leftovers(r5)));

// ⑥ 标签写法变体：属性顺序颠倒 / 多余空格 / 自闭合 link
var variant = original
  .replace('<link rel="stylesheet" href="css/style.css">', '<link  href="css/style.css"  rel="stylesheet" />')
  .replace('<script src="js/main.js"></script>', '<script   src="js/main.js"  ></script>');
var r6 = inline(variant, realRead);
check('⑥ 属性顺序颠倒/多余空格/自闭合 → 仍能识别（正则已放宽）',
  leftovers(r6) === null, String(leftovers(r6)));

// ⑥b 带 defer 的脚本应被跳过（而不是静默内联改变时序）
var deferH = original.replace('<script src="js/main.js"></script>',
  '<script defer src="js/main.js"></script>');
check('⑥b 带 defer 的脚本 → 不内联（时序语义不同，由脚本报错提示）',
  inline(deferH, realRead).indexOf('<script defer') >= 0, '仍被内联了');

L('');
L('================ 关键：源码版与单文件版的一致性 ================');
// 单文件版内联进去的 JS，应逐字节等于源码各文件原样拼接
var list = [];
(original.match(/<script\s+src="([^"]+)"\s*><\/script>/g) || []).forEach(function (t) {
  var m = t.match(/src="([^"]+)"/);
  if (m) list.push(m[1]);
});
var srcJs = list.map(realRead).join('\n');
var inlinedJsOnly = (base.match(/<script>[\s\S]*?<\/script>/g) || [])
  .map(function (s) { return s.replace(/^<script>\n|\n<\/script>$/g, ''); })
  .map(function (s) { return s.replace(/^\/\* ===== [^*]+ ===== \*\/\n/, ''); })
  .join('\n');
check('⑦ 单文件版内联的 JS == 源码各文件原样拼接（零改写、零压缩）',
  inlinedJsOnly === srcJs,
  'inline=' + inlinedJsOnly.length + 'B vs src=' + srcJs.length + 'B');

L('');
L('================ 结论 ================');
L(fails === 0 ? '全部通过：打包与频繁修改互不干扰' : fails + ' 项失败');
L('');
L('说明：本脚本只检查"打包链路"的健康度。');
L('      游戏逻辑本身的正确性由 test_rail.js / test_rules.js 负责。');

console.log(log.join('\n'));
process.exit(fails ? 1 : 0);
