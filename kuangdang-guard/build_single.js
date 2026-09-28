// ============================================================
// 打包工具：把整个游戏内联成单个 HTML 文件，方便发给别人玩。
//
// 用法（在项目根目录执行）：
//   node build_single.js
//
// 产出：哐当哐当守卫战-单文件版.html
//   —— 双击即可直接用浏览器打开，也可作为单个文件发给他人。
//
// 原理：项目是「免构建 + 经典 <script>」，所以内联非常安全 ——
//   只需把 css/style.css 塞进 <style>，把 js/*.js 按原顺序塞进 <script>，
//   不涉及任何模块打包/变量重命名，行为与源码版完全一致。
//
// ⚠️ 打包约定（2026-09-25 大王拍板）：**只在发布时重建**单文件版。
//    平时改源码（index.html + js/ + css/）**不必**重跑本脚本 —— 产物落后于源码
//    是预期状态，不是漏打包；发布前跑一次本脚本即可。详见 docs/设计规格.md §12。
//    任何时候都不要直接编辑产出的单文件版（会被下一次打包覆盖）。
// ============================================================
var fs = require('fs');
var path = require('path');
var core = require('./build_core.js');   // 内联逻辑（与 test_build.js 共用同一份，避免"测试测副本"）

var ROOT = __dirname;
var SRC_HTML = path.join(ROOT, 'index.html');
var OUT_HTML = path.join(ROOT, '哐当哐当守卫战-单文件版.html');

var html = fs.readFileSync(SRC_HTML, 'utf8');

// 1)+2) 内联 CSS / JS：<link rel="stylesheet"> → <style>、<script src> → <script>
//    （顺序必须保持 —— 经典脚本靠全局变量互相引用；宽松匹配理由见 build_core.js）
var res = core.inlineAssets(html, function (rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
});

// 带 defer/async 的脚本有额外时序语义，内联会改变行为 → 明确拒绝，提示手工处理
if (res.deferred) {
  console.error('✗ 无法内联 <script src="' + res.deferred + '">：它带 defer/async，内联会改变加载时序。');
  process.exit(1);
}
html = res.html;
var cssCount = res.cssCount, jsCount = res.jsCount, totalBytes = res.bytes, inlined = res.inlined;

// 3) 在标题后加注释，说明这是自动生成的产物
html = html.replace(/(<title>[^<]*<\/title>)/, '$1\n' +
  '<!-- ============================================================\n' +
  '     单文件版（自动生成，请勿手动编辑）\n' +
  '     样式与脚本已全部内联，双击即可运行，也可作为单个文件发送他人。\n' +
  '     源码结构版：index.html（改代码请改那边，然后重新运行 build_single.js）\n' +
  '     ============================================================ -->');

// 4) 自检（两道）
//    4a. 源 HTML 里每个 <script src> / <link stylesheet> 都必须"有人认领"
//        —— 防止某个标签写法特殊导致正则漏掉、却没被发现
var srcTags = (fs.readFileSync(SRC_HTML, 'utf8').match(/<script\b[^>]*\bsrc=/gi) || []).length;
var srcLinks = 0;
(fs.readFileSync(SRC_HTML, 'utf8').match(/<link\b[^>]*>/gi) || []).forEach(function (t) {
  if (/rel\s*=\s*["']?stylesheet/i.test(t)) srcLinks++;
});
if (srcTags !== jsCount || srcLinks !== cssCount) {
  console.error('✗ 打包失败：清单对不上 —— ' +
    '源码里 <script src> ' + srcTags + ' 个（已内联 ' + jsCount + '）、' +
    '样式表 <link> ' + srcLinks + ' 个（已内联 ' + cssCount + '）。');
  console.error('  多半是某个标签写法特殊导致没被识别，请检查 index.html。');
  process.exit(1);
}

//    4b. 产物里不应残留任何指向本地文件的外链
var leftovers = html.match(/(?:src|href)="(?!#|https?:|data:|javascript:|mailto:)[^"]*"/g);
if (leftovers) {
  console.error('✗ 打包失败：仍有未内联的外部引用 → ' + leftovers.join(', '));
  process.exit(1);
}

fs.writeFileSync(OUT_HTML, html, 'utf8');

console.log('打包完成');
console.log('  内联 CSS : ' + cssCount + ' 个');
console.log('  内联 JS  : ' + jsCount + ' 个');
inlined.forEach(function (s) { console.log('    · ' + s); });
console.log('  源码总量 : ' + totalBytes + ' 字节');
console.log('  产出文件 : ' + OUT_HTML);
console.log('  产出大小 : ' + Buffer.byteLength(html, 'utf8') + ' 字节');
console.log('  自检     : 清单核对 ' + (srcTags + srcLinks) + '/' + (jsCount + cssCount) +
  ' 全部内联，无残留外链 ✓');
