// ============================================================
// 打包核心（纯函数，无副作用、不碰磁盘）。
//
// 为什么单独抽出来：
//   「把 index.html 里的 <link stylesheet> / <script src> 内联成单文件」这段逻辑，
//   原本 build_single.js 和 test_build.js 各抄了一份 —— 测试测的是"副本"，
//   改了打包脚本测试照样绿，报警器形同虚设。
//   抽成这个文件后，两边都 require 它，测试才真的在测打包时用的那段代码。
//
// 用法：
//   var core = require('./build_core.js');
//   var res = core.inlineAssets(html, function (rel) { return fs.readFileSync(...); });
//   res.html      → 内联后的 HTML
//   res.cssCount  → 内联的样式表个数
//   res.jsCount   → 内联的脚本个数
//   res.bytes     → 内联内容总字节数
//   res.inlined   → ['CSS  css/style.css', 'JS   js/state.js', ...]
//   res.deferred  → 遇到带 defer/async 的 <script src> 时，记下它的路径（否则 null）
//                   —— 调用方自行决定怎么处理（打包脚本报错退出 / 测试断言"没被内联"）
//
// 匹配一律「宽松」：属性顺序任意、可有多余空格、link 可自闭合。
//   理由见 build_single.js 头部：写死属性顺序会导致"打包成功但缺内容"，极难发现。
// ============================================================
function inlineAssets(html, readFile) {
  var cssCount = 0, jsCount = 0, totalBytes = 0, inlined = [], deferred = null;

  // 1) 内联 CSS：<link rel="stylesheet" href="...">  →  <style>...</style>
  html = html.replace(/<link\b[^>]*?href="([^"]+)"[^>]*?>/gi, function (m, href) {
    // 只内联样式表（跳过 favicon 等其它 link）
    if (!/rel\s*=\s*["']?stylesheet/i.test(m)) return m;
    var css = readFile(href);
    cssCount++; totalBytes += Buffer.byteLength(css, 'utf8');
    inlined.push('CSS  ' + href);
    return '<style>\n' + css + '\n</style>';
  });

  // 2) 内联 JS：<script src="..."></script>  →  <script>...</script>
  //    必须保持原有先后顺序 —— 这些是经典脚本，靠全局变量互相引用。
  html = html.replace(/<script\b([^>]*?)src="([^"]+)"([^>]*?)><\/script>/gi, function (m, pre, src, post) {
    // 带 defer/async 的脚本有额外时序语义，内联会改变行为 → 不内联，交给调用方处理
    if (/\b(defer|async)\b/i.test(pre + post)) { deferred = src; return m; }
    var js = readFile(src);
    jsCount++; totalBytes += Buffer.byteLength(js, 'utf8');
    inlined.push('JS   ' + src);
    return '<script>\n/* ===== ' + src + ' ===== */\n' + js + '\n</script>';
  });

  return {
    html: html, cssCount: cssCount, jsCount: jsCount,
    bytes: totalBytes, inlined: inlined, deferred: deferred
  };
}

module.exports = { inlineAssets: inlineAssets };
