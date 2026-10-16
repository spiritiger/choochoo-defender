/* ============================================================
 * build.js — 无依赖打包脚本（Node 原生 fs）
 * 用法：node build.js
 * 产物：
 *   默认 node build.js        → DIY塔防-dev.html（开发版）+ src/js/_gamedata.generated.js（数据桥接）
 *   node build.js --release   → 额外产出 DIY塔防.html（分享版：全内联单文件，双击即玩，可直接发送）
 *
 * 工作流：
 *   改 src/js/*.js        → 直接刷新 DIY塔防-dev.html 即可
 *   改 src/data/*.json    → 跑一次 node build.js（刷新开发版数据）
 *   体验满意、要分发时    → node build.js --release，然后发根目录的 DIY塔防.html
 * ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SRC = path.join(ROOT, 'src');

const RELEASE_OUTPUT = path.join(ROOT, 'DIY塔防.html');
const DEV_OUTPUT = path.join(ROOT, 'DIY塔防-dev.html');
const DATA_BRIDGE = path.join(SRC, 'js', '_gamedata.generated.js');
const RELEASE = process.argv.includes('--release'); // 仅在明确要求时构建分享版

function read(file) {
    return fs.readFileSync(path.join(SRC, file), 'utf8');
}

/* ---- 1. 读取模板与样式 ---- */
const template = read('template.html');
const css = read('style.css');

/* ---- 2. 合并 JSON 数据（grid / towers / monsters / affixes） ---- */
const dataFiles = ['grid.json', 'towers.json', 'monsters.json', 'affixes.json'];
const gameData = {};
for (const f of dataFiles) {
    const key = f.replace('.json', '');
    try {
        gameData[key] = JSON.parse(read(path.join('data', f)));
    } catch (err) {
        console.error(`[FAIL] JSON parse error in src/data/${f}: ${err.message}`);
        process.exit(1);
    }
}
const dataScript = `window.__GameData__ = ${JSON.stringify(gameData)};`;

/* ---- 3. 按声明顺序拼接 JS，并逐文件做语法校验 ---- */
const order = JSON.parse(read(path.join('js', 'build-order.json')));
const inlineChunks = [];
const devScriptTags = [];
for (const f of order) {
    const code = read(path.join('js', f));
    try {
        new Function(code); // 仅编译校验语法，不会执行
    } catch (err) {
        console.error(`[FAIL] Syntax error in src/js/${f}: ${err.message}`);
        process.exit(1);
    }
    inlineChunks.push(`<!-- ======== src/js/${f} ======== -->\n<script>\n${code}\n</script>`);
    devScriptTags.push(`<script src="src/js/${f}"></script>`);
}

/* ---- 4. 生成数据桥接文件（开发版引用；分享版直接内联同一段） ---- */
fs.writeFileSync(DATA_BRIDGE, dataScript, 'utf8');

/* ---- 5. 按需产出分享版（仅 --release 时；全内联单文件） ---- */
let releaseHtml = null;
if (RELEASE) releaseHtml = template
    .replace('<!--GAME_STYLE-->', () => `<style>\n${css}\n    </style>`)
    .replace('<!--GAME_DATA-->', () => `<script>\n${dataScript}\n    </script>`)
    .replace('{{INLINE_SCRIPTS}}', () => inlineChunks.join('\n'));

/* ---- 6. 产出开发版（引用散装代码，改 JS 刷新即生效） ---- */
let devHtml = template
    .replace('<title>UnderDark 营地保卫战 (四塔纯净版)</title>', '<title>[DEV] UnderDark 营地保卫战</title>')
    .replace('<!--GAME_STYLE-->', () => `<link rel="stylesheet" href="src/style.css">`)
    .replace('<!--GAME_DATA-->', () => `<script src="src/js/_gamedata.generated.js"></script>`)
    .replace('{{INLINE_SCRIPTS}}', () => devScriptTags.join('\n'));

/* ---- 7. 兜底检查：不允许残留任何未替换的占位符 ---- */
const targets = RELEASE ? [['release', releaseHtml], ['dev', devHtml]] : [['dev', devHtml]];
for (const [name, html] of targets) {
    const leftovers = html.match(/\{\{[A-Z_]+\}\}|<!--GAME_(STYLE|DATA)-->/g);
    if (leftovers) {
        console.error(`[FAIL] Unresolved placeholders in ${name}: ${[...new Set(leftovers)].join(', ')}`);
        process.exit(1);
    }
}

fs.writeFileSync(DEV_OUTPUT, devHtml, 'utf8');
if (RELEASE) fs.writeFileSync(RELEASE_OUTPUT, releaseHtml, 'utf8');

const kb = (f) => (fs.statSync(f).size / 1024).toFixed(1);
console.log(`[OK] DIY塔防-dev.html  ${kb(DEV_OUTPUT)} KB  (开发版, 引用 src/ 散装代码)`);
if (RELEASE) {
    console.log(`[OK] DIY塔防.html      ${kb(RELEASE_OUTPUT)} KB  (分享版, 单文件内联, 可直接分发)`);
} else {
    console.log(`[--] 分享版 DIY塔防.html 未更新（如需同步：node build.js --release）`);
}
console.log(`     ${order.length} modules checked, ${dataFiles.length} data files merged.`);
