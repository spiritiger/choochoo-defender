// ============================================================================
// 生成「轨道对照-新旧算法.html」：四张关键盘面，旧算法(v1) vs 新算法(v2) 并排，
// 用 SVG 把铁轨画成真实的环线（复用游戏求解器实算，非手绘）。
//   node gen_rail_compare.js   →  docs/轨道对照-新旧算法.html
// 用途：大王过目 P2 形状对照（规格 §8.1）。给"人话"看的版本，技术明细在 AB 报告。
// ============================================================================
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = __dirname;
const sandbox = {}; sandbox.window = sandbox; sandbox.console = console;
vm.createContext(sandbox);
for (const f of ['js/config/map.js', 'js/state.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
}
const CFG = sandbox.CFG, GS = sandbox.GS;
GS.debugNoDeadline = true;

const COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS;

function setup(rows) {
  GS.grid = []; GS.goldTiles = [];
  for (let r = 0; r < ROWS; r++) {
    const row = [];
    for (let c = 0; c < COLS; c++) {
      const ch = rows[r][c];
      const isGold = ch === 'G' || ch === 'g';
      row.push({ t: (ch === '#' || ch === 'X' || ch === 'g') ? 'rubble' : 'blank',
                 gold: isGold, harvested: false, flash: 0,
                 b: ch === 'E' ? { type: 'econ', c: c, r: r } : (ch === 'C' ? { type: 'core', c: c, r: r } : null) });
      if (ch === 'C') GS.core = { type: 'core', c: c, r: r };
      if (isGold) GS.goldTiles.push({ c: c, r: r });
    }
    GS.grid.push(row);
  }
  GS.buildings = [GS.core];
  GS.railPath = []; GS.railSet = {}; GS.railRect = null; GS.railGrowHints = [];
  GS.__v2cache = null;
}

const GOLDEN = [
  '#00#0#11#E#', '0#000#11#0#', '0##0#1110#0', '0000#101#00', '00##E1#1###',
  '#0##1101#0#', '###11001#00', '0##11C0110#', '####11111#0', '###0#####00',
  '###00000#0#', '00E0000000#', '#000#00##0#', '##0##0#0#00', '#00#00##E#0'];
const K60 = [
  'g###g####', '######g##', '#g######g', '#########',
  '#g#...#g#', '......###', 'G...C.###', '#...E.#g#',
  '#G....###', '....#...#', 'G...#G..#', '#....###g', '#...G####'];
const PENINSULA = [
  '#########', '#########', '#########', '#########', '#########',
  '###...#..', '###.C....', '###...###',
  '#########', '#########', '#########', '#########', '#########'];
const PEN2 = [
  '#########', '#########', '#########', '#########', '#######..',
  '###......', '###.C..###', '###...###',
  '#########', '#########', '#########', '#########', '#########'];
const CORRIDOR = [
  '#########', '#########', '#########', '#########', '#########',
  '###...##.', '###.C...#', '###...###',
  '#########', '#########', '#########', '#########', '#########'];

const BOARDS = [
  { key: 'golden', rows: GOLDEN,
    title: '① 标准盘（你当初亲手给答案的那张）',
    say: '新旧算法画出的轨道<b>一模一样</b>（都是 26 格环，逐格相同）。老盘面零变化，放心。' },
  { key: 'k60', rows: K60,
    note: { c0: 5, r0: 8, c1: 7, r1: 10, label: '问' },   // 右下支线：双走边(5,8)-(5,9) + 金币小圈
    title: '② 病盘复刻（你指出的 2 列蛇形问题）★已修',
    say: '左边旧算法：左下角走了 <b>(2,8)~(2,11) 四个内格</b>的蛇形绕路（40 步）。' +
         '右边新算法：按你说的改走 <b>3 列直下</b>（★两格），38 步、少占 2 格——' +
         '根因是旧算法的搜索空间看不见"贴着内部废墟墙"的那两格（离外轮廓 3~4 层深），' +
         '只能绕远；新算法把"挨着内部墙的格子"纳入搜索。84 张测试盘验证：' +
         '新算法满覆盖 84/84（旧算法 82/84），无一劣化。' },
  { key: 'pen2', rows: PEN2,
    title: '③ 贴边死角（你报的"空地没轨道"的正确解法长这样）★关键',
    say: '右上那块 2×2 空地，经<b>一条边</b>直接贴在主体上，两端路口都是三口 T 字岔——' +
         '新算法把它收进路线（带 ★ 的格子），<b>全程零往返格</b>，火车开进去绕一圈原路退出、不倒车。' +
         '旧算法在这张盘上也收了（两者 16 步相同）；真正的差异要等你游戏里那张 0912 原盘来验证。' },
  { key: 'peninsula', rows: PENINSULA,
    title: '④ 窄脖子死角（单格脖子）——按你新定的规则，不收',
    say: '这块 2×2 空地只通过<b>一个格子</b>连接主体。数学上，火车进出的两趟必然都压着这个格子的同两个口' +
         '（W 进 E 出去、E 进 W 出回）——就是你指出的"往返格"。所以新旧算法都<b>不铺</b>这里。' +
         '（昨晚旧版曾铺过，今天按你的反馈改掉了。）' },
  { key: 'corridor', rows: CORRIDOR,
    title: '⑤ 走廊盘（一根手指宽的长条）',
    say: '新旧都<b>不去</b>——一格宽的通道，走了必然产生往返格，和 ④ 同理。' }
];

// ---- 解算两张环 ----
function solveBoth(rows) {
  setup(rows);
  GS.railV2 = false;
  GS.recomputeRails();
  const r1 = GS.railPath.map(p => ({ c: p.c, r: p.r }));
  setup(rows);
  GS.railV2 = true;
  GS.recomputeRails();
  GS.railV2 = false;
  const r2 = GS.railPath.map(p => ({ c: p.c, r: p.r }));
  return { r1, r2, grid: GS.grid };
}

// ---- SVG 渲染 ----
const CELL = 36, PAD = 26;
function panelSVG(rows, ring, diffSet, tag, note) {   // note = {c0,r0,c1,r1,label} 圈注区域
  const W = COLS * CELL + PAD + 8, H = ROWS * CELL + PAD + 8;
  let s = '<svg width="' + W + '" height="' + H + '" xmlns="http://www.w3.org/2000/svg">';
  // 地形
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    const ch = rows[r][c];
    const x = PAD + c * CELL, y = PAD + r * CELL;
    let fill = '#e8dcbf';                                   // 空地
    if (ch === '#' || ch === 'X') fill = '#8a6f52';         // 废墟
    if (ch === 'G' || ch === 'g') fill = '#f3d879';         // 金币地
    if (ch === 'C') fill = '#9b7bd4';                       // 镇中心
    if (ch === 'E') fill = '#7fa8d9';                       // 建筑
    s += '<rect x="' + x + '" y="' + y + '" width="' + (CELL - 2) + '" height="' + (CELL - 2) + '" rx="4" fill="' + fill + '" stroke="#6b5b44" stroke-width="1"/>';
    if (ch === 'G' || ch === 'g') s += '<text x="' + (x + CELL / 2 - 1) + '" y="' + (y + CELL / 2 + 5) + '" font-size="13" font-weight="bold" text-anchor="middle" fill="#6b5400">金</text>';
    if (ch === 'C') s += '<text x="' + (x + CELL / 2 - 1) + '" y="' + (y + CELL / 2 + 5) + '" font-size="13" font-weight="bold" text-anchor="middle" fill="#fff">镇</text>';
    if (ch === 'E') s += '<text x="' + (x + CELL / 2 - 1) + '" y="' + (y + CELL / 2 + 5) + '" font-size="12" text-anchor="middle" fill="#fff">塔</text>';
  }
  // 坐标（列号 / 行号，与游戏导出一致）
  for (let c = 0; c < COLS; c++) s += '<text x="' + (PAD + c * CELL + CELL / 2) + '" y="' + (PAD - 8) + '" font-size="11" text-anchor="middle" fill="#888">' + c + '</text>';
  for (let r = 0; r < ROWS; r++) s += '<text x="' + (PAD - 10) + '" y="' + (PAD + r * CELL + CELL / 2 + 4) + '" font-size="11" text-anchor="middle" fill="#888">' + r + '</text>';
  // 铁轨环线：按行车顺序连线（重复经过=交叉/往返，如实画出）
  if (ring.length >= 4) {
    const pts = ring.map(p => (PAD + p.c * CELL + CELL / 2 - 1) + ',' + (PAD + p.r * CELL + CELL / 2 - 1));
    pts.push(pts[0]);
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#3a3f4a" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/>';
    s += '<polyline points="' + pts.join(' ') + '" fill="none" stroke="#dfe3ea" stroke-width="2" stroke-dasharray="6 5" stroke-linejoin="round"/>';
  }
  // 差异格：新算法新铺的轨（v2 有 v1 无）
  for (const k of Object.keys(diffSet)) {
    const [c, r] = k.split(',').map(Number);
    const x = PAD + c * CELL, y = PAD + r * CELL;
    s += '<rect x="' + (x - 2) + '" y="' + (y - 2) + '" width="' + CELL + '" height="' + CELL + '" rx="6" fill="none" stroke="#1faa5a" stroke-width="3"/>';
    s += '<text x="' + (x + CELL - 8) + '" y="' + (y + 13) + '" font-size="13" text-anchor="middle" fill="#1faa5a" font-weight="bold">★</text>';
  }
  // 圈注区域（如：待裁决的往返支线）
  if (note) {
    const x = PAD + note.c0 * CELL - 4, y = PAD + note.r0 * CELL - 4;
    const w = (note.c1 - note.c0 + 1) * CELL + 8, h = (note.r1 - note.r0 + 1) * CELL + 8;
    s += '<rect x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '" rx="10" fill="none" stroke="#e07b1f" stroke-width="3" stroke-dasharray="7 5"/>';
    s += '<text x="' + (x + w / 2) + '" y="' + (y - 6) + '" font-size="12" text-anchor="middle" fill="#e07b1f" font-weight="bold">← 问：这条支线保留吗？</text>';
  }
  s += '<text x="' + (W / 2) + '" y="' + (H - 2) + '" font-size="13" text-anchor="middle" fill="#555" font-weight="bold">' + tag + '</text>';
  s += '</svg>';
  return s;
}

let body = '';
for (const b of BOARDS) {
  const { r1, r2 } = solveBoth(b.rows);
  const s1 = {}, s2 = {};
  for (const p of r1) s1[p.c + ',' + p.r] = 1;
  for (const p of r2) s2[p.c + ',' + p.r] = 1;
  const diff = {};
  for (const k of Object.keys(s2)) if (!s1[k]) diff[k] = 1;
  const same = r1.length === r2.length && r1.every((p, i) => p.c === r2[i].c && p.r === r2[i].r);
  body += '<div class="board"><h2>' + b.title + '</h2>';
  body += '<p class="say">' + b.say + (same ? ' <span class="tag-same">两图逐格一致</span>' : '') + '</p>';
  body += '<div class="pair">' + panelSVG(b.rows, r1, {}, '旧算法（' + r1.length + ' 步）', b.note) +
          panelSVG(b.rows, r2, diff, '新算法（' + r2.length + ' 步）', b.note) + '</div></div>';
}

const html = `<!DOCTYPE html>
<html lang="zh"><head><meta charset="utf-8">
<title>轨道对照：旧算法 vs 新算法（rail-v2）</title>
<style>
  body { font-family: "Microsoft YaHei", sans-serif; background:#f4f0e6; margin:0; padding:24px; color:#333; }
  h1 { font-size:22px; } .sub { color:#666; margin:4px 0 18px; }
  .board { background:#fff; border-radius:12px; padding:18px 22px; margin:0 0 22px; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .board h2 { font-size:17px; margin:0 0 6px; }
  .say { font-size:14px; line-height:1.7; margin:0 0 12px; }
  .pair { display:flex; gap:28px; flex-wrap:wrap; }
  .tag-same { background:#e8f5ec; color:#1faa5a; border-radius:6px; padding:1px 8px; font-size:12px; }
  .legend { background:#fff; border-radius:12px; padding:12px 22px; margin-bottom:22px; box-shadow:0 2px 8px rgba(0,0,0,.08); font-size:14px; }
  .chip { display:inline-block; width:15px; height:15px; border-radius:4px; vertical-align:-2px; margin:0 3px 0 12px; border:1px solid #6b5b44; }
  .decision { background:#fff8e0; border:2px solid #e0b94f; border-radius:12px; padding:14px 22px; font-size:14px; line-height:1.8; }
</style></head><body>
<h1>轨道对照：旧算法 vs 新算法（rail-v2）</h1>
<div class="sub">四张关键盘面，左边=现在游戏里的算法，右边=重构后的新算法。绿框★=新算法多铺的轨。生成于 ${new Date().toLocaleString('zh-CN')}</div>
<div class="legend"><b>图例：</b>
  <span class="chip" style="background:#8a6f52"></span>废墟
  <span class="chip" style="background:#e8dcbf"></span>空地
  <span class="chip" style="background:#f3d879"></span>金币地
  <span class="chip" style="background:#9b7bd4"></span>镇中心
  <span class="chip" style="background:#7fa8d9"></span>建筑
  <span class="chip" style="background:#3a3f4a"></span>铁轨（深色环线就是火车走的路）
  <span style="margin-left:12px">★绿框 = 新算法新铺的轨</span>
</div>
${body}
<div class="decision"><b>本轮修复清单（2026-10-11 你的两条反馈）：</b><br>
① <b>往返格已禁</b>：格内掉头、一格两趟来回碾压，全部非法——④⑤ 号盘按新规则不铺；唯一合法双走是 T 字岔穿越（③ 号盘）。<br>
② <b>2 列蛇形已修</b>：贴内部墙的格子纳入搜索（② 号盘 40→38 步）；84 盘测试满覆盖 84/84（旧算法 82/84），零劣化。<br><br>
<b>剩一个小裁决（看 ② 号盘右下角）：</b>轨道伸下去绕金币小圈再<b>沿原路退回</b>的那条支线（旧算法也有，路口都是 T 字、按新规则合法）——保留还是去掉？<br>
· <b>保留</b>（现状）＝能收到这种挂边金币地；<b>去掉</b>＝火车永不回头，但这种金币收不到。回「保留」或「去掉」即可。</div>
</body></html>`;

fs.writeFileSync(path.join(ROOT, 'docs', '轨道对照-新旧算法.html'), html, 'utf8');
console.log('已生成 docs/轨道对照-新旧算法.html（' + BOARDS.length + ' 张盘对照）');
