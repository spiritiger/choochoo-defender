# 终局预览（§14.63）退役归档 · 2026-10-18

> 本目录保存「终局预览」功能被移除时的**原始源码**，仅供回溯。
> 移除令：大王「把预览关掉，包括工具菜单的功能入口，并且把相关代码归档不再引用」。
> 现行源码已不含以下任何代码；相关测试用例同步退役。

## js/state.js

```
  GS.__fpRail = null;   // v1.7.5：终局预览真链环缓存随新局失效（restart/startLevel 均经 newGame）
```
```
// ---- 终局预览推演（v1.7.3，规格 §14.63；v1.7.7 回归真生成规则）----
//   【一句话】建造期规划尺：推演"清出一片连通全部资源的空白地块后，真求解链会
//   解出什么环"。骨架环只负责圈范围，轨道由真求解链产出（finalPreviewRail）。
//
//   ▍v1.7.7 大王四条铁口径（验收三轮后立）：
//     ① 铁轨沿空白地块外边缘 ② 连通所有资源点 ③ 正确线条（无孤立轨/怪弯）
//     ④ 空白地块包含铁轨（= 现行定义 t==='blank'，铺轨不占 t）。
//   v1.7.6 骨架环直接当轨道画是自造几何：不贴边（单侧膨胀带内缘）、core 小弧
//   怪弯、同射线两资源先内后外必折返（单格往返，五关全有）——全部违背真规则。
//   ⇒ 定稿（A 案"环内全清"）：骨架环降级为**推演范围发生器**——
//     ① 节点 = 镇中心 + 全部资源格，绕 core 极角排序（atan2；同角按距升序）；
//     ② core 替换为两个切点（主轴正交邻）；环路 = 入切点→资源…→出切点；
//     ③ L 形展开（先横后竖）+ core 绕行小弧 —— 产 path（闭合折线，资源必经）；
//     ④ **U = 环围域**（"环内全清、环外仍废墟"）= path 格 ∪ 内部格。
//        内部格 = 外洪水补集：从图边界非 path 格 4 邻 BFS，不可达者即内部
//        （无几何边界情形；同射线折返的针尖段两侧连通外部，不出假内部）。
//        v1.7.6 的单侧膨胀 mark 退役（膨胀正是"轨道不贴边"的元凶）。
//     ⑤ ∂U = U 中至少一个正交邻不在 U（fallback 画线用，语义沿用）。
//   轨道本体 = finalPreviewRail 灌真求解链产物（贴边/真弯道/无孤立轨全由求解器
//   保证）；骨架 path 只喂推演盘与 fallback，其折返病灶不再进观感。
//
//   纯函数零副作用（不碰 GS.grid/railPath/求解缓存，"求解器别动"铁律安全）。
//   返回 {cells, set, u, path}（path = 骨架环格序列，可含重复格；
//   u 含 core 格——BFS 连通/车台上轨语义）。
GS.finalPreviewCells = function () {
  var pts = [{ c: GS.core.c, r: GS.core.r }];
  var gi, hi;
  for (gi = 0; gi < GS.goldTiles.length; gi++) pts.push(GS.goldTiles[gi]);
  for (hi = 0; hi < GS.heartTiles.length; hi++) pts.push(GS.heartTiles[hi]);
  if (pts.length < 2) return { cells: [], set: {}, u: {}, path: [] };
  var CORE_C = pts[0].c, CORE_R = pts[0].r;
  // ① 极角排序（绕 core；同角按距 core **降序**，v1.7.7d）：
  //    同射线两资源（如 (2,6)(0,6)）若内层先访问，外层的出边（去 outCut/下一
  //    资源）必穿回内层区 → 单格往返死角（L4 西北角实锤，uTurn 两侧行全被上游
  //    占死无解）。外层先访问则出边向外顺滑。L4 全环手推零撞。
  var rest = pts.slice(1).map(function (p) {
    return { p: p, ang: Math.atan2(p.r - CORE_R, p.c - CORE_C),
             d: Math.abs(p.c - CORE_C) + Math.abs(p.r - CORE_R) };
  });
  rest.sort(function (a, b) {
    if (Math.abs(a.ang - b.ang) > 1e-9) return a.ang - b.ang;
    return b.d - a.d;
  });
  // ② 切点替代 core（主轴正交邻：|dc|≥|dr| 取东/西邻，否则南/北邻）
  var mainCut = function (t) {
    var dc = t.c - CORE_C, dr = t.r - CORE_R;
    if (Math.abs(dc) >= Math.abs(dr)) return { c: CORE_C + (dc > 0 ? 1 : -1), r: CORE_R };
    return { c: CORE_C, r: CORE_R + (dr > 0 ? 1 : -1) };
  };
  var inCut = mainCut(rest[0].p), outCut = mainCut(rest[rest.length - 1].p);
  var ring = [inCut];
  for (var si = 0; si < rest.length; si++) ring.push(rest[si].p);
  ring.push(outCut);
  // v1.7.7e 未来环点登记：ring 成员（资源 + 切点）迟早要作为端点被访问，
  //   后续 leg 的途经格若踩上**尚未访问**的环点，等环序轮到它时必重踩
  //   （L4 首条 leg 南下踩 (4,3)(4,1)，环序到时竖列往返实锤）→ 途经罚 3。
  var ringSet = {};
  for (si = 0; si < ring.length; si++) ringSet[ring[si].c + ',' + ring[si].r] = true;
  // ③ L 形展开（先横后竖）+ 穿 core 绕外圈短弧
  var u = {}, path = [];
  var DIRS4 = [[0, -1], [1, 0], [0, 1], [-1, 0]];   // N E S W
  var dirIdx = function (dx, dy) {
    for (var i = 0; i < 4; i++) if (DIRS4[i][0] === dx && DIRS4[i][1] === dy) return i;
    return -1;
  };
  // v1.7.7b 绕 core 弧改走 3×3 外圈（8 向顺时针）：4 正交邻**互不相邻**（对角关系），
  //   旧 4 邻弧 E→S 直接跳变 = 断链/首尾距离 2（"莫名弯道"来源之一）
  var OCT = [[0, -1], [1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1]];
  var octIdx = function (dx, dy) {
    for (var i = 0; i < 8; i++) if (OCT[i][0] === dx && OCT[i][1] === dy) return i;
    return -1;
  };
  var mark = function (c, r) {                       // v1.7.7：只记格本身（path 格是围域
    if (!CFG.inBounds(c, r)) return;                 // 边界；内部格由外洪水补齐，见 ④'）
    u[c + ',' + r] = true;
  };
  var lastStep = null;                               // 上一 push 步方向 [dx,dy]（折返检测用）
  var onP = {};                                      // path 已占格（U 形选侧防撞检查）
  var push = function (c, r) {                       // 相邻重复格跳过 + 方向记录 + 占用登记
    var n = path.length;
    if (n && path[n - 1].c === c && path[n - 1].r === r) return;
    if (n) lastStep = [c - path[n - 1].c, r - path[n - 1].r];
    onP[c + ',' + r] = true;
    path.push({ c: c, r: r });
  };
  var cc = 0, rr = 0;
  // v1.7.7b step = 带方向锁的单步推进（axis 'h'/'v'）—— 旧 walk 内部"横向优先"
  //   会覆盖 expandLeg 的段序意图（先竖后横时仍先横 ⇒ 换序判据形同虚设）
  var step = function (b, axis) {
    var dx = 0, dy = 0;
    if (axis === 'h') dx = cc < b.c ? 1 : -1; else dy = rr < b.r ? 1 : -1;
    var tc = cc + dx, tr = rr + dy;
    if (!(tc === CORE_C && tr === CORE_R)) { cc = tc; rr = tr; mark(cc, rr); push(cc, rr); return; }
    var i0 = octIdx(-dx, -dy), i1 = octIdx(dx, dy);  // 进入方位 → 外圈顺时针弧 → 离开方位
    for (var st = 1; st <= 8; st++) {
      var k = (i0 + st) % 8;
      cc = CORE_C + OCT[k][0]; rr = CORE_R + OCT[k][1];
      mark(cc, rr); push(cc, rr);
      if (k === i1) break;
    }
  };
  // ③' v1.7.7 同射线折返修复（大王四条之③"单格往返"病根）：同一条射线上两枚
  //   资源（如 core 正北 (4,3) 与 (4,1)），极角同按距升序 → 先访问内层，但 L 展开
  //   从外侧过来会"路过外层不停"走到内层，下一条 leg 目标恰是外层 → 原路折返，
  //   中间格走两遍（五关全有，L4×3）。几何必然，排序升降序都治不了。
  //   修法 = 该 leg 改 **U 形侧偏**：去程走本列、回程走"远离 core"的邻列，端头
  //   两枚真弯道相连 —— 重复边消失、资源仍必经、形态 = 双列并行轨（合理路网）。
  var uTurn = function (a, b) {                      // a→b 纯轴向共线折返时的 U 形展开
    var horiz = (a.r === b.r);
    var sgn = horiz ? (b.c > a.c ? 1 : -1) : (b.r > a.r ? 1 : -1);
    var sides = horiz ? [[0, -1], [0, 1]] : [[1, 0], [-1, 0]];
    sides.sort(function (s1, s2) {                   // 远离 core 的侧优先（贴外缘语义）
      var d1 = Math.abs(a.c + s1[0] - CORE_C) + Math.abs(a.r + s1[1] - CORE_R);
      var d2 = Math.abs(a.c + s2[0] - CORE_C) + Math.abs(a.r + s2[1] - CORE_R);
      return d2 - d1;
    });
    for (var si = 0; si < 2; si++) {
      var sd = sides[si];
      var ac = a.c + sd[0], ar = a.r + sd[1];
      var bc2 = b.c + sd[0], br2 = b.r + sd[1];
      if (!CFG.inBounds(ac, ar) || !CFG.inBounds(bc2, br2)) continue;
      if ((ac === CORE_C && ar === CORE_R) || (bc2 === CORE_C && br2 === CORE_R)) continue;
      // v1.7.7b 侧偏列全程不得与 path 已占格重叠（撞则换侧）—— 否则 U 形列与
      //   相邻 leg 的路径形成重复边（L4 实测 ×6 的病根）
      var hit = false, sc = ac, sr = ar;
      var uBud = Math.abs(bc2 - ac) + Math.abs(br2 - ar) + 4;  // v1.7.7d 预检预算兜底
      while (uBud-- > 0) {
        if (onP[sc + ',' + sr]) { hit = true; break; }
        if (sc === bc2 && sr === br2) break;
        if (horiz) sc += sgn; else sr += sgn;
        if (sc === CORE_C && sr === CORE_R) { hit = true; break; }   // 途中撞 core 也换侧
      }
      if (uBud <= 0) hit = true;                     // 预算耗尽 = 形态不可达，换侧
      if (hit) continue;
      mark(ac, ar); push(ac, ar);                    // a 已在 path 尾（重复跳过）
      sc = ac; sr = ar;
      while (sc !== bc2 || sr !== br2) {
        if (horiz) sc += sgn; else sr += sgn;
        mark(sc, sr); push(sc, sr);
      }
      mark(b.c, b.r); push(b.c, b.r);
      return true;
    }
    return false;                                    // 两侧都不可用 → 退回原直走（罕见）
  };
  // ③'' v1.7.7b 自适应段序（折返根治判据，双约束 + 竖段外移第三选项）：
  //   L 展开的折返/重复边只有两个来源：
  //     · 出口折返 —— 到达 b 的方向与下一 leg 首步反向（单格往返）；
  //     · 入口重叠 —— 本 leg 首段与前 leg 末段共线反向（同一条边走两遍）。
  //   三候选：① 先横后竖 ② 先竖后横 ③ 先横后竖但竖段外移 1 列（远离 core 一侧，
  //   多出两个端头弯）—— 前两个各坏一头时（同列资源对）用 ③。逐候选查双约束，
  //   取第一个无违例者；全违例 → ①认命（纯轴向外移不可用时由 uTurn 兜底）。
  var segDir = function (p, q) {
    if (p.c === q.c && p.r === q.r) return null;
    // v1.7.7e 主导轴语义：竖向主导 leg（pickPlan 实际先竖展开）必须预测竖向——
    //   旧"列优先"在 dc=1/dr=3 类 leg 上把 fd 预测成横向，出口折返罚分全落空，
    //   角点资源被"向上到达"占位后下条 leg 全候选撞车 → 认命重踩 = 单格往返
    //   （L2 (8,0)↔(8,1)、(0,11)↔(0,12) 实锤）。纯轴向 leg 两种语义同值。
    if (Math.abs(q.c - p.c) >= Math.abs(q.r - p.r)) return [q.c > p.c ? 1 : -1, 0];
    return [0, q.r > p.r ? 1 : -1];
  };
  var go = function (t, axis) {                      // 沿锁定的轴走到 t
    // v1.7.7c 步数预算：detour 弧会横移 cc/rr，极端时序下可越过目标来回横跳，
    //   预算耗尽强制收敛（形态妥协也不挂死）
    var budget = Math.abs(cc - t.c) + Math.abs(rr - t.r) + 12;
    if (axis === 'h') { while (cc !== t.c && budget-- > 0) step(t, 'h'); }
    else { while (rr !== t.r && budget-- > 0) step(t, 'v'); }
  };
  var expandLeg = function (a, b, plan) {
    if (a.c === b.c && a.r === b.r) return;
    cc = a.c; rr = a.r;
    mark(cc, rr); push(cc, rr);                      // a 已在 path 尾（重复跳过）
    // v1.7.7e Z 形台阶：先走到中间行/列，横（竖）移一次，再走到 b
    if (plan.z != null) {
      if (plan.vert) {
        go({ c: a.c, r: plan.z }, 'v');
        go({ c: b.c, r: plan.z }, 'h');
        go(b, 'v');
      } else {
        go({ c: plan.z, r: a.r }, 'h');
        go({ c: plan.z, r: b.r }, 'v');
        go(b, 'h');
      }
      return;
    }
    var sh = plan.shift || 0;
    if (plan.hf) {
      if (!sh) { go({ c: b.c, r: a.r }, 'h'); go(b, 'v'); }
      else {
        go({ c: b.c + sh, r: a.r }, 'h');
        go({ c: b.c + sh, r: b.r }, 'v');
        go(b, 'h');
      }
    } else {
      go({ c: a.c, r: b.r }, 'v');
      go(b, 'h');
    }
  };
  var pickPlan = function (a, b, prevArr, fd) {
    var vA = a.r === b.r ? 0 : (b.r > a.r ? 1 : -1); // 先横后竖的竖段方向
    var hA = a.c === b.c ? 0 : (b.c > a.c ? 1 : -1); // 先竖后横的横段方向
    // v1.7.7c 全候选打分取最小（违例不可避免时选观感损失最小的）：
    //   入口反向重叠 / 出口折返 = 掉头贴片（观感最差，各罚 3）；中途压已占格
    //   = 共线重复边（罚 1/格）；候选沿途越界格 = 罚 4（不可接受）。
    var viaBad = function (cells) {
      for (var vi = 0; vi < cells.length; vi++) {
        var q = cells[vi];
        if ((q.c === a.c && q.r === a.r) || (q.c === b.c && q.r === b.r)) continue;
        if (onP[q.c + ',' + q.r]) return true;
      }
      return false;
    };
    var viaHits = function (cells) {
      var n = 0;
      for (var vi = 0; vi < cells.length; vi++) {
        var q = cells[vi];
        if (!CFG.inBounds(q.c, q.r)) return 99;       // 途经越界 = 一票否决
        if ((q.c === a.c && q.r === a.r) || (q.c === b.c && q.r === b.r)) continue;
        var vk = q.c + ',' + q.r;
        if (onP[vk]) n += 1;
        else if (ringSet[vk]) n += 3;                  // v1.7.7e 未访问环点：踩上必产重复边
      }
      return n;
    };
    var penalty = function (dIn, dOut, cells) {
      var s = viaHits(cells);
      if (prevArr && dIn[0] === -prevArr[0] && dIn[1] === -prevArr[1]) s += 3;
      if (fd && dOut[0] === -fd[0] && dOut[1] === -fd[1]) s += 3;
      return s;
    };
    var spanC = function (c0, c1, r) {               // 横段途经格（不含两端点；零长返空）
      if (c0 === c1) return [];
      var out = [], st = c0 < c1 ? 1 : -1;
      for (var x = c0 + st; x !== c1; x += st) out.push({ c: x, r: r });
      return out;
    };
    var spanR = function (r0, r1, c) {
      if (r0 === r1) return [];
      var out = [], st = r0 < r1 ? 1 : -1;
      for (var y = r0 + st; y !== r1; y += st) out.push({ c: c, r: y });
      return out;
    };
    // v1.7.7e 贴边平局裁决（四条铁口径之①"沿空白地块外边缘"）：penalty 并列时
    //   优先靠地图边缘的走线——边缘距 = min(到四边距离)，经格逐格 0.01 计入。
    //   只作平局裁决，永不翻转撞格(1/格)/折返(3)/越界(99) 罚分。
    var edgeTerm = function (cells) {
      var s = 0;
      for (var vi = 0; vi < cells.length; vi++) {
        var q = cells[vi];
        s += Math.min(q.c, q.r, CFG.MAP_COLS - 1 - q.c, CFG.MAP_ROWS - 1 - q.r);
      }
      return s * 0.01;
    };
    // 候选 ① 先横后竖：首段 = 横向（零长则竖向），到达 = 竖向（零长则横向）
    // v1.7.7d 转折点补查：span 不含端点，但 L 形**转折点**（如先横后竖的
    //   (b.c,a.r)）既非 leg 端点又必被 expandLeg 踩——漏查会让已占转折点
    //   零罚通过 → 重复边（L1 (8,2)↔(8,3) 单格往返实锤）
    var d1in = hA ? [hA, 0] : [0, vA], d1out = vA ? [0, vA] : [hA, 0];
    var via1 = hA ? spanC(a.c, b.c, a.r).concat([{ c: b.c, r: a.r }],
                    spanR(a.r, b.r, b.c)) : spanR(a.r, b.r, a.c);
    // 候选 ② 先竖后横：首段 = 竖向（零长则横向），到达 = 横向（零长则竖向）
    var d2in = vA ? [0, vA] : [hA, 0], d2out = hA ? [hA, 0] : [0, vA];
    var via2 = vA ? spanR(a.r, b.r, a.c).concat([{ c: a.c, r: b.r }],
                    spanC(a.c, b.c, b.r)) : spanC(a.c, b.c, a.r);
    // 候选 ③④ 竖段外移（需横竖两段都非零长）：到达 = 横向 -sh 方向
    var best = { hf: true, shift: 0, arr: d1out, score: penalty(d1in, d1out, via1) + edgeTerm(via1) };
    var s2 = penalty(d2in, d2out, via2) + edgeTerm(via2);
    if (s2 < best.score) best = { hf: false, shift: 0, arr: d2out, score: s2 };
    if (hA && vA) {
      var sides = b.c > CORE_C ? [1, -1] : [-1, 1];  // 远离 core 一侧优先
      for (var sp = 0; sp < 2; sp++) {
        var sh = sides[sp];
        var midC = b.c + sh;
        if (midC < 0 || midC >= CFG.MAP_COLS) continue;   // v1.7.7c 外移列不得出界
        var via3 = spanC(a.c, midC, a.r).concat([{ c: midC, r: a.r }],
                    spanR(a.r, b.r, midC).concat([{ c: midC, r: b.r }],
                    spanC(midC, b.c, b.r)));
        var d3in = [hA, 0], d3out = [-sh, 0];
        var s3 = penalty(d3in, d3out, via3) + edgeTerm(via3);
        if (s3 < best.score) best = { hf: true, shift: sh, arr: d3out, score: s3 };
      }
      // v1.7.7e Z 形台阶候选 ×2 族（L1 左侧 U 型弯 / L4 对角 tie 实锤修复）：
      //   行族 = 中间行 kz 横移一次（贴边直行 + 小幅进出资源）；列族 = 中间列
      //   jz 竖移一次。对角 tie 的 leg（|dr|=|dc|，如 L4 (2,3)→(4,1)）只有列族
      //   能"右进右出"避开 (4,2) 占位连锁 → 两族全开都参评。
      for (var kz = a.r + vA; kz !== b.r; kz += vA) {
        var viaZ = spanR(a.r, kz, a.c).concat([{ c: a.c, r: kz }],
                    spanC(a.c, b.c, kz).concat([{ c: b.c, r: kz }],
                    spanR(kz, b.r, b.c)));
        var dZ = [0, vA];                              // 入口/到达同竖向
        var sZ = penalty(dZ, dZ, viaZ) + edgeTerm(viaZ);
        if (sZ < best.score) best = { z: kz, vert: true, arr: dZ, score: sZ };
      }
      for (var jz = a.c + hA; jz !== b.c; jz += hA) {
        var viaZ2 = spanC(a.c, jz, a.r).concat([{ c: jz, r: a.r }],
                     spanR(a.r, b.r, jz).concat([{ c: jz, r: b.r }],
                     spanC(jz, b.c, b.r)));
        var dZ2 = [hA, 0];                             // 入口/到达同横向
        var sZ2 = penalty(dZ2, dZ2, viaZ2) + edgeTerm(viaZ2);
        if (sZ2 < best.score) best = { z: jz, vert: false, arr: dZ2, score: sZ2 };
      }
    }
    return best;
  };
  var lastArr = null;                                // 前 leg 到达方向（入口约束用）
  for (var ei = 0; ei < ring.length - 1; ei++) {
    var a = ring[ei], b = ring[ei + 1];
    var plan = pickPlan(a, b, lastArr, ring[ei + 2] ? segDir(b, ring[ei + 2]) : null);
    // uTurn 兜底：纯轴向且首步与来路共线反向（候选 ③④ 不可用的死角资源）
    // v1.7.7d 死循环根修：fd2 对对角 leg 也非 null（segDir 返回粗方向），但 uTurn
    //   只支持纯轴向——对角 leg 时预检 while 的终止条件永不成立且无出界检查，
    //   sc 无限递增挂死（L4 实锤，不经过 push 故熔断不响）→ 触发必须限纯轴向。
    var fd2 = segDir(a, b);
    if (fd2 && (a.c === b.c || a.r === b.r) && lastArr &&
        fd2[0] === -lastArr[0] && fd2[1] === -lastArr[1] && uTurn(a, b)) {
      lastArr = segDir(b, a);                        // U 形末段回程方向（近似）
      continue;
    }
    expandLeg(a, b, plan);
    lastArr = plan.arr;
  }
  // ③''' v1.7.7c 主环收尾：inCut===outCut（首尾切点同格）时主环自然闭合到首格，
  //   弹出尾部重复的首格；此后若尾格已与首格相邻则无需闭包弧。
  while (path.length > 4 &&
         path[path.length - 1].c === path[0].c && path[path.length - 1].r === path[0].r) {
    path.pop();
  }
  var tailAdjacent = Math.abs(path[path.length - 1].c - path[0].c) +
                     Math.abs(path[path.length - 1].r - path[0].r) === 1;
  // ④ 闭合弧：出切点 → 入切点沿 3×3 外圈（双向选边：短弧若折返/撞主环已占格 → 长弧）
  var iOut = octIdx(outCut.c - CORE_C, outCut.r - CORE_R);
  var iIn = octIdx(inCut.c - CORE_C, inCut.r - CORE_R);
  if (!tailAdjacent && iOut >= 0 && iIn >= 0) {
    // 进入 inCut 的方向 = 弧最后一步方向；须 ≠ -(主环首 leg 首步)（闭环接缝防折返）
    // v1.7.7d 首步用 path 实测值：segDir(ring[0],ring[1]) 是粗方向（横优先），
    //   而展开是先横后竖——同角降序后首 leg 常反向走横段，预测与实测相反，
    //   会误杀本可通过的长弧（L4 实锤：实测首步向西，粗方向判向东）。
    var fdFirst = path.length > 1
      ? [path[1].c - path[0].c, path[1].r - path[0].r]
      : segDir(ring[0], ring[1]);
    var arcDirs = [1, -1];                           // 顺时针短弧优先
    var arcDone = false;
    for (var ai = 0; ai < arcDirs.length && !arcDone; ai++) {
      var dirSign = arcDirs[ai];
      var arc = [], okArc = true, prevG = outCut;
      for (var st2 = 1; st2 <= 8; st2++) {
        var k2 = ((iOut + dirSign * st2) % 8 + 8) % 8;
        var gc = CORE_C + OCT[k2][0], gr = CORE_R + OCT[k2][1];
        if (gc === inCut.c && gr === inCut.r) {
          // 到达方向检查：inCut - prevG
          var arr = [gc - prevG.c, gr - prevG.r];
          if (fdFirst && arr[0] === -fdFirst[0] && arr[1] === -fdFirst[1]) okArc = false;
          break;
        }
        // v1.7.7c 弧格撞主环已占格 → 换向（主环 leg 途经切点邻格时短弧必重复）
        if (onP[gc + ',' + gr]) { okArc = false; break; }
        arc.push({ c: gc, r: gr });
        prevG = { c: gc, r: gr };
      }
      // v1.7.7d 残弧 bug 修：两个方向失败都不得 push 半截弧——
      //   旧判 `!okArc && ai===0` 会让长弧失败也 push 残弧且 arcDone=true，
      //   认命弧被跳过 → path 尾悬空断链（L4 尾 (5,7)→(4,5) dist=3 实锤）
      if (!okArc) continue;
      for (var ap = 0; ap < arc.length; ap++) { mark(arc[ap].c, arc[ap].r); push(arc[ap].c, arc[ap].r); }
      arcDone = true;
    }
    if (!arcDone) {                                  // 双弧皆违例 → 认命走短弧
      for (var st3 = 1; st3 <= 8; st3++) {
        var k3 = ((iOut + st3) % 8 + 8) % 8;
        var gc3 = CORE_C + OCT[k3][0], gr3 = CORE_R + OCT[k3][1];
        if (gc3 === inCut.c && gr3 === inCut.r) break;
        mark(gc3, gr3); push(gc3, gr3);
      }
    }
  }
  // ④' v1.7.7 U = 环围域（"环内全清"，大王拍板 A 案）= path 格 ∪ 环内部格。
  //   内部格 = 外洪水补集：从图边界非 path 格 4 邻 BFS，图内不可达者即内部。
  //   无几何边界情形；折返已由 U 形侧偏根治，围域是简单闭合曲线的内部。
  //   core 在环内部 → 自然进 u（车台上轨语义沿用）。
  //   ▍为什么轨道 = 骨架环直出、不再灌真链（两轮实测数据在案）：
  //     真求解器目标函数（覆盖→十字→格数）**没有"资源必经"约束**，且求解器铁律
  //     不许动 ⇒ 盘形引导两头堵：实心大盘真环抄直路漏凹处资源（12~14/15 在环），
  //     2 宽瘦带真环只走外列漏内列（7~14/15）。而骨架环本身 = 围域外边缘 + 资源
  //     必经（构造保证）+ 折返修复后无重复边无十字，大王四条形态全满足。
  {
    var onP = {};
    for (var pi = 0; pi < path.length; pi++) onP[path[pi].c + ',' + path[pi].r] = true;
    var ext = {}, fq = [];
    var seedEdge = function (c, r) {
      var k = c + ',' + r;
      if (onP[k] || ext[k]) return;
      ext[k] = true; fq.push([c, r]);
    };
    for (var bc = 0; bc < CFG.MAP_COLS; bc++) {
      seedEdge(bc, 0); seedEdge(bc, CFG.MAP_ROWS - 1);
    }
    for (var br = 0; br < CFG.MAP_ROWS; br++) {
      seedEdge(0, br); seedEdge(CFG.MAP_COLS - 1, br);
    }
    while (fq.length) {
      var cur = fq.pop();
      for (var d4 = 0; d4 < 4; d4++) {
        var nc2 = cur[0] + DIRS4[d4][0], nr2 = cur[1] + DIRS4[d4][1];
        if (!CFG.inBounds(nc2, nr2)) continue;
        // v1.7.7d core 视为洪水障碍：镇中心必须 ∈ U（车台语义）。否则四角+南北
        //   轴类资源分布会摆出"双室夹缝"环，core 行西侧开敞，洪水把 core 判成
        //   外部 → core ∉ U（test_rules [FP] 4 连通 113 vs 112 实锤）
        if (nc2 === CORE_C && nr2 === CORE_R) continue;
        var nk = nc2 + ',' + nr2;
        if (ext[nk] || onP[nk]) continue;
        ext[nk] = true; fq.push([nc2, nr2]);
      }
    }
    for (var fr = 0; fr < CFG.MAP_ROWS; fr++) for (var fc = 0; fc < CFG.MAP_COLS; fc++) {
      if (!ext[fc + ',' + fr]) u[fc + ',' + fr] = true;   // 非 path 且非外部 = 内部
    }
    u[CORE_C + ',' + CORE_R] = true;                      // core 显式兜底 ∈ U
  }
  // ⑤ ∂U：U 中至少一个正交邻不在 U
  var cells = [], set = {};
  for (var k2 in u) {
    var qc = +k2.split(',')[0], qr = +k2.split(',')[1];
    var edge = !CFG.inBounds(qc - 1, qr) || !u[(qc - 1) + ',' + qr] ||
               !CFG.inBounds(qc + 1, qr) || !u[(qc + 1) + ',' + qr] ||
               !CFG.inBounds(qc, qr - 1) || !u[qc + ',' + (qr - 1)] ||
               !CFG.inBounds(qc, qr + 1) || !u[qc + ',' + (qr + 1)];
    if (edge) { cells.push({ c: qc, r: qr }); set[k2] = true; }
  }
  return { cells: cells, set: set, u: u, path: path };
};

// 终局预览·规划环（v1.7.5 立懒缓存+灌真链；v1.7.6 骨架直出；v1.7.7 骨架直出+围域盘）：
//   v1.7.7 两轮灌链实测（数据在案）：真求解器无"资源必经"约束，实心大盘抄直路
//   漏凹处资源、2 宽瘦带只走外列——盘形引导两头堵，且求解器铁律不许加约束。
//   定稿：轨道 = 修好折返的骨架环**直出**（微秒级纯函数），U = 环围域（环内全清）：
//   ① 骨架环 = 围域外边缘（贴边）② 资源必经（极角环路构造保证）③ 折返 U 形
//   侧偏修复后无重复边、无十字、纯直/弯贴片（正确线条）④ 围域含轨道格。
//   懒缓存（newGame 置 GS.__fpRail=null 失效——restart/startLevel 均经 newGame）。
//   返回 { ok, path, u }；ok=false 时渲染层 fallback 邻接双线。
GS.finalPreviewRail = function () {
  if (GS.__fpRail) return GS.__fpRail;
  var pv = GS.finalPreviewCells();
  var p = pv.path || [];
  // v1.7.8 真链通道（大王令"直接用真求解器，bug 单一归因到灰格生成规则"；先行
  //   关卡 1 验收，通过后再放开 2-5 与随机盘）：轨道 = 真求解器在推演盘上的输出。
  //   灰区生成规则（§14.63 尾注 j 组实验结论）：
  //     · 底盘 = A 案实心盘（骨架环围域全清，V0）；
  //     · 每资源补含它的 2×2 全灰块（四象限择优补缺）——资源若只挂 1 个灰邻会被
  //       剪死胡同/削脖子删掉（L1 角资源 (0,0)(8,0) 实锤）；
  //     · 灌验后仍 miss 的资源，贪心开 **2 格宽废墟沟**（方向 4 候选 × 两侧偏移，
  //       试灌取 miss 最少者）：资源 ∈ 外轮廓 B ⇔ 四邻有"连通图边的废墟"，1 宽
  //       凹口在闭合迹下数学不可覆盖（进去必原路出来），2 宽才能"进沟绕资源出来"；
  //       沟保护其他资源的 2×2 块格（自己的块可借道）。
  //     · 全程墙钟预算，超时取当前最优；最终仍 miss/不闭合/有往返 → 回退骨架 Y 案。
  if (GS.levelIdx === 0 && typeof GS.__fpTrueLink === 'function') {
    var tl = GS.__fpTrueLink(pv);
    if (tl) { GS.__fpRail = tl; return GS.__fpRail; }
  }
  GS.__fpRail = { ok: !!(p.length > 3), path: p, u: pv.u };
  return GS.__fpRail;
};

// v1.7.8 真链通道本体：构造灰区 board → 七件套备份 → 灌 grid → recomputeRails
//   → 抓真轨 → 还原 → 冷解复原。失败返回 null（调用方回退骨架）。
//   ⚠️ recomputeRails 是同步全量求解（每次 20~500ms），本函数含试灌循环，
//      只在预览懒缓存 miss 时跑一次，禁入每帧路径。
GS.__fpTrueLink = function (pv) {
  if (!pv.path || pv.path.length <= 3) return null;
  var COLS = CFG.MAP_COLS, ROWS = CFG.MAP_ROWS;
  var K = function (c, r) { return c + ',' + r; };
  var res = GS.goldTiles.concat(GS.heartTiles);
  var cc0 = GS.core.c, rr0 = GS.core.r;

  // —— 灰区底盘 = V0 实心盘（骨架环格 ∪ 环内部格）——
  var board = {};
  var i, k;
  for (i = 0; i < pv.path.length; i++) board[K(pv.path[i].c, pv.path[i].r)] = true;
  for (k in pv.u) if (pv.u[k]) board[k] = true;

  // —— pourCheck：灌 grid → 同步全量求解 → 抓轨 → 还原盘 → 质检 ——
  //   返回 {rail, miss, closed, rev, ms}；不碰车站/列车（还原后冷解复原局内环）。
  var pourCheck = function () {
    var backup = [], r0, c0;
    for (r0 = 0; r0 < ROWS; r0++) for (c0 = 0; c0 < COLS; c0++)
      backup.push(GS.grid[r0][c0].t, GS.grid[r0][c0].b);
    for (k in board) {
      var xy = k.split(',');
      var c = +xy[0], r = +xy[1];
      if (c === cc0 && r === rr0) continue;                 // core 建筑保留
      GS.grid[r][c].t = 'blank';
      if (GS.grid[r][c].b) GS.grid[r][c].b = null;          // 推演盘不压玩家建筑（规划尺语义）
    }
    var t0 = Date.now();
    GS.recomputeRails();
    var ms = Date.now() - t0;
    var rail = [], j;
    for (j = 0; j < (GS.railPath || []).length; j++) rail.push({ c: GS.railPath[j].c, r: GS.railPath[j].r });
    // 还原盘面 + 冷解复原（railPath 置空防"旧环复验"沿用推演轨）
    var bi = 0;
    for (r0 = 0; r0 < ROWS; r0++) for (c0 = 0; c0 < COLS; c0++) {
      GS.grid[r0][c0].t = backup[bi++];
      var b = backup[bi++];
      if (GS.grid[r0][c0].b !== b) GS.grid[r0][c0].b = b;
    }
    GS.railPath = null;
    GS.recomputeRails();
    // 质检：资源全上环 / 闭合 / 零往返
    var onRail = {};
    for (j = 0; j < rail.length; j++) onRail[K(rail[j].c, rail[j].r)] = true;
    var miss = [];
    for (j = 0; j < res.length; j++) if (!onRail[K(res[j].c, res[j].r)]) miss.push(res[j]);
    var closed = rail.length > 3;
    for (j = 0; j < rail.length && closed; j++) {
      var a = rail[j], b2 = rail[(j + 1) % rail.length];
      if (Math.abs(a.c - b2.c) + Math.abs(a.r - b2.r) !== 1) closed = false;
    }
    var de = {};
    for (j = 0; j < rail.length; j++) {
      var a2 = rail[j], b3 = rail[(j + 1) % rail.length];
      de[K(a2.c, a2.r) + '>' + K(b3.c, b3.r)] = (de[K(a2.c, a2.r) + '>' + K(b3.c, b3.r)] || 0) + 1;
    }
    var rev = 0;
    for (k in de) {
      var m = k.match(/^(\d+),(\d+)>(\d+),(\d+)$/);
      if (de[m[3] + ',' + m[4] + '>' + m[1] + ',' + m[2]] && k < (m[3] + ',' + m[4] + '>' + m[1] + ',' + m[2])) rev++;
    }
    // 观感病灶计（v1.7.8b）：灰区里没上轨、却被轨道从相对两侧夹住的格
    //   （轨道发卡弯绕着一条灰/废墟窄条走 = 大王报的"多余的障碍"观感）。
    var dodged = 0;
    for (k in board) {
      var hk = k.split(',');
      var hc = +hk[0], hr = +hk[1];
      if ((hc === cc0 && hr === rr0) || onRail[k]) continue;
      if ((onRail[hc + ',' + (hr - 1)] && onRail[hc + ',' + (hr + 1)]) ||
          (onRail[(hc - 1) + ',' + hr] && onRail[(hc + 1) + ',' + hr])) dodged++;
    }
    return { rail: rail, miss: miss, closed: closed, rev: rev, ms: ms, dodged: dodged };
  };

  // —— 每资源 2×2 块：四象限选缺灰格最少者，补缺格并登记保护 ——
  var cellOwner = {};
  for (i = 0; i < res.length; i++) {
    var q = res[i], best = null;
    for (var sc = -1; sc <= 1; sc += 2) for (var sr = -1; sr <= 1; sr += 2) {
      var cells = [[q.c, q.r], [q.c + sc, q.r], [q.c, q.r + sr], [q.c + sc, q.r + sr]];
      var missing = [], bad = false;
      for (var ci = 0; ci < cells.length; ci++) {
        var c1 = cells[ci][0], r1 = cells[ci][1];
        if (!CFG.inBounds(c1, r1)) { bad = true; break; }
        if (c1 === cc0 && r1 === rr0) { bad = true; break; }
        var other = false;
        for (var ri = 0; ri < res.length; ri++) {
          var w = res[ri];
          if (w.c === c1 && w.r === r1 && !(w.c === q.c && w.r === q.r)) { other = true; break; }
        }
        if (other) { bad = true; break; }
        if (!board[K(c1, r1)]) missing.push(cells[ci]);
      }
      if (!bad && (!best || missing.length < best.missing.length)) best = { cells: cells, missing: missing };
    }
    if (!best) continue;
    for (ci = 0; ci < best.missing.length; ci++) {
      board[K(best.missing[ci][0], best.missing[ci][1])] = true;
      cellOwner[K(best.missing[ci][0], best.missing[ci][1])] = K(q.c, q.r);
    }
  }

  var st = pourCheck();
  var T0 = Date.now(), BUDGET = 2500;                       // 墙钟预算（含所有试灌）
  var trenched = [];
  var lastMissN = st.miss.length + 1;
  for (var round = 0; round < 8 && st.miss.length; round++) {
    if (st.miss.length >= lastMissN) break;                 // 沟开下去 miss 不降 → 停
    lastMissN = st.miss.length;
    var q0 = st.miss[0], qk = K(q0.c, q0.r);
    var dc = q0.c - cc0, dr = q0.r - rr0;
    // 沟候选：远离 core 的两轴方向 × 三种宽度。v1.7.8b：沟的最小职责只是"给资源
    //   一个连通图边的废墟邻居"，1 宽脊线（mode 0）优先参评——2 宽沟会从图边咬掉
    //   一大块（L1 右缘 (8,2)(8,3) 实锤 = 大王报的"多余的障碍"）；2 宽 ± 偏移
    //   （mode 1/2）保留作 fallback。v1.7.8c：评分 (miss, 刻格数, dodged, 步数)——
    //   大王两轮验收同一条美学"刻掉的废墟越少越好"（左上爱心 2 宽沟的半边 (3,0)~(3,2)
    //   可以还灰，实锤 dodged 计分会把 1 宽脊线错压下去），刻格数升到 dodged 之前。
    var bestT = null;
    var dirs = [];
    if (dc !== 0) dirs.push({ horiz: true, s: dc > 0 ? 1 : -1 });
    if (dr !== 0) dirs.push({ horiz: false, s: dr > 0 ? 1 : -1 });
    for (var di = 0; di < dirs.length && Date.now() - T0 < BUDGET; di++) {
      for (var mode = 0; mode < 3; mode++) {
        var ps = mode === 0 ? 0 : (mode === 1 ? -1 : 1);
        var cells = [];
        for (var step = 1; step < 20; step++) {
          var cA = dirs[di].horiz ? q0.c + dirs[di].s * step : q0.c;
          var rA = dirs[di].horiz ? q0.r : q0.r + dirs[di].s * step;
          if (!CFG.inBounds(cA, rA)) break;
          cells.push([cA, rA]);
          if (mode > 0) {
            var cB = dirs[di].horiz ? cA : q0.c + ps;
            var rB = dirs[di].horiz ? q0.r + ps : rA;
            if (CFG.inBounds(cB, rB)) cells.push([cB, rB]);
          }
          if (cA === 0 || cA === COLS - 1 || rA === 0 || rA === ROWS - 1) break;
        }
        if (!cells.length) continue;
        var bad2 = false;
        for (ci = 0; ci < cells.length; ci++) {
          var kk = K(cells[ci][0], cells[ci][1]);
          if ((cells[ci][0] === cc0 && cells[ci][1] === rr0) ||
              res.some(function (x) { return x.c === cells[ci][0] && x.r === cells[ci][1]; }) ||
              (cellOwner[kk] && cellOwner[kk] !== qk)) { bad2 = true; break; }
        }
        if (bad2) continue;
        for (ci = 0; ci < cells.length; ci++) delete board[K(cells[ci][0], cells[ci][1])];
        var t = pourCheck();
        for (ci = 0; ci < cells.length; ci++) board[K(cells[ci][0], cells[ci][1])] = true;
        if (!bestT ||
            t.miss.length < bestT.st.miss.length ||
            (t.miss.length === bestT.st.miss.length && cells.length < bestT.cells.length) ||
            (t.miss.length === bestT.st.miss.length && cells.length === bestT.cells.length &&
             t.dodged < bestT.st.dodged) ||
            (t.miss.length === bestT.st.miss.length && cells.length === bestT.cells.length &&
             t.dodged === bestT.st.dodged && t.rail.length < bestT.st.rail.length)) {
          bestT = { cells: cells, st: t };
        }
      }
    }
    if (!bestT) break;
    for (ci = 0; ci < bestT.cells.length; ci++) delete board[K(bestT.cells[ci][0], bestT.cells[ci][1])];
    trenched.push(qk);
    st = bestT.st;
  }

  if (!st.closed || st.miss.length || st.rev) return null;  // 不达标 → 回退骨架 Y 案
  // u = board ∪ core（渲染灰区语义：u 含 core 格）
  var u = {};
  for (k in board) u[k] = true;
  u[K(cc0, rr0)] = true;
  return { ok: true, path: st.rail, u: u, trenched: trenched };
};


```

## js/renderer.js

```
  // 终局预览（v1.7.3，规格 §14.63 大王令"链接所有金币爱心的最大地图"）：
  //   建造期的规划尺 —— 资源连通清空区的外轮廓，虚线格 = "清到底会变轨道"。
  //   开关 UI.finalPreview（工具菜单 toggle）；只在白天画（夜晚战斗期无规划意义）。
  REND.finalPreview(ctx, L);
```
```
// 终局预览（v1.7.3，规格 §14.63 大王令"链接所有金币、爱心的最大地图"）：
//   建造期的规划尺 —— 把当前局全部资源格连回镇中心（MST 走廊 + 块状膨胀），
//   GS.finalPreviewCells 每帧直算（微秒级纯函数，零副作用），
//   UI.finalPreview 开关 + 白天才画。
//   ▍v1.7.5 改真链环（大王验收"①连通资源 ②铁轨呈环"；∂U 云状轮廓不呈环，
//     v1.7.4 邻接双线随之降级 fallback）：轨道 = GS.finalPreviewRail() 解出的
//     **真欧拉环**，用真轨道贴片 REND.railTiles 画透明版（globalAlpha 0.42）——
//     直线/弯道弧/十字/T 岔全真，"清到底轨道长这样"所见即所得；
//     U 走廊区保留极淡填充（"清到底会清出来的地"）。解不出环 → fallback 邻接双线。
REND.finalPreview = function (ctx, L) {
  if (!(typeof UI !== 'undefined' && UI.finalPreview)) return;
  if (typeof CLOCK !== 'undefined' && !CLOCK.isDay()) return;
  if (typeof GS.finalPreviewCells !== 'function') return;
  var pv = GS.finalPreviewCells();
  var k, kk;
  // ① 灰区：极淡填充（清理目标区域，区别于轨道线的"强语义"）
  //   v1.7.8：真链通道的灰区 = 推演 board（含 2×2 资源块 − 废墟沟），≠ 骨架 pv.u
  //   —— rail.u 优先，骨架 fallback 才用 pv.u。
  var rail0 = (typeof GS.finalPreviewRail === 'function') ? GS.finalPreviewRail() : null;
  var uSrc = (rail0 && rail0.u) ? rail0.u : pv.u;
  ctx.fillStyle = 'rgba(140,160,190,0.06)';
  for (k in uSrc) {
    kk = k.split(',');
    ctx.fillRect(L.x + (+kk[0]) * L.cell, L.y + (+kk[1]) * L.cell, L.cell, L.cell);
  }
  // ② 轨道：真链环（透明真贴片）优先，解不出环 fallback 邻接双线
  var rail = rail0;
  if (rail && rail.ok && rail.path.length) {
    ctx.globalAlpha = 0.42;                          // 大王拍板：带透明度的轨道
    REND.railTiles(ctx, L, rail.path);
    ctx.globalAlpha = 1;
  } else {
    // fallback（v1.7.4）：每对相邻 ∂U 格各画半段双线（格心 → 共享边中点），
    // 相邻格两半段在共享边中点无缝拼接，拐角在格心直角相接；真轨几何同款。
    var s = L.cell, d = s * 0.12;
    var DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    ctx.strokeStyle = 'rgba(195,201,214,0.42)';      // railLine(#c3c9d6) × alpha 0.42
    ctx.lineWidth = Math.max(1.6, s * 0.075);
    ctx.lineCap = 'butt';
    ctx.beginPath();
    for (k in pv.set) {
      kk = k.split(',');
      var c = +kk[0], r = +kk[1];
      var cx = L.x + (c + 0.5) * L.cell, cy = L.y + (r + 0.5) * L.cell;
      for (var di = 0; di < 4; di++) {
        if (!pv.set[(c + DIRS[di][0]) + ',' + (r + DIRS[di][1])]) continue;   // 邻格不在 ∂U
        var mx = L.x + (c + 0.5 + DIRS[di][0] * 0.5) * L.cell;                // 共享边中点
        var my = L.y + (r + 0.5 + DIRS[di][1] * 0.5) * L.cell;
        var nx = DIRS[di][1], ny = -DIRS[di][0];                              // 法向（行进方向转 90°）
        ctx.moveTo(cx + nx * d, cy + ny * d); ctx.lineTo(mx + nx * d, my + ny * d);
        ctx.moveTo(cx - nx * d, cy - ny * d); ctx.lineTo(mx - nx * d, my - ny * d);
      }
    }
    ctx.stroke();
  }
};
```

## js/ui.js

```
  // v1.7.3 终局预览（§14.63）：常开 toggle —— 开关在工具弹层、虚线画在真地图上；
  //   关菜单不复位（与两步确认的 _modePendingReset 不同族），再点按钮才收。
  UI.finalPreview = false;
  UI.btnFinalPreview = document.getElementById('btnFinalPreview');
  if (UI.btnFinalPreview) UI.btnFinalPreview.addEventListener('click', function () {
    UI.finalPreview = !UI.finalPreview;
    UI.btnFinalPreview.textContent = '终局预览：' + (UI.finalPreview ? '开' : '关');
  });
```

## index.html

```
        <!-- v1.7.3 终局预览（§14.63）：建造期在真地图上叠"资源连通清空区"外轮廓虚线，
             标出哪些空地清到底会变轨道 —— 开关在工具弹层、效果在画布（v1.6.67 铁律） -->
        <div class="menuRow">
          <button id="btnFinalPreview" class="btn" title="在地图上画出连通全部资源后的铁轨外轮廓（虚线格 = 清到底会变轨道）">终局预览：关</button>
        </div>
```

## test_rules.js

```
// ============================================================================
// v1.7.3 终局预览推演（规格 §14.63 大王令"链接所有金币、爱心的最大地图"）
//   口径：镇中心 + 全部资源格 → MST 走廊 → 块状膨胀 → 外轮廓 ∂U。
//   验：①资源全被 U 覆盖（推演目标达成）②U 4 连通 ③∂U ⊆ U ④对齐真链
//   （推演 U 灌进 grid → recomputeRails → 环 ⊆ U），备份/还原法不污染后续断言。
// ============================================================================
{
  // 规则套件不载 levels.js（分层最小集）—— 手工摆固定资源（四角 + 上下中轴），
  //  曼哈顿远距、确定性；grid 标记同步（finalPreviewCells 只读两张列表）
  GS.newGame();
  GS.goldTiles = [{ c: 0, r: 0 }, { c: 8, r: 0 }, { c: 0, r: 12 }, { c: 8, r: 12 }];
  GS.heartTiles = [{ c: 4, r: 0 }, { c: 4, r: 12 }];
  for (const p of GS.goldTiles) GS.grid[p.r][p.c].gold = true;
  for (const p of GS.heartTiles) GS.grid[p.r][p.c].heart = true;
  const pv = GS.finalPreviewCells();
  check('[FP] ∂U 非空且 ⊆ U', pv.cells.length > 0 &&
    pv.cells.every(p => pv.u[p.c + ',' + p.r]), 'cells=' + pv.cells.length);
  const res = [...GS.goldTiles, ...GS.heartTiles];
  check('[FP] U 覆盖全部资源格（10 金 + 5 爱全在清空区）',
    res.every(p => pv.u[p.c + ',' + p.r]),
    'miss=' + res.filter(p => !pv.u[p.c + ',' + p.r]).length);
  // U 4 连通（从镇中心 BFS，全 u 可达）
  {
    const seen = new Set([GS.core.c + ',' + GS.core.r]);
    const q = [[GS.core.c, GS.core.r]];
    while (q.length) {
      const [c, r] = q.pop();
      for (const [dc, dr] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const k = (c + dc) + ',' + (r + dr);
        if (pv.u[k] && !seen.has(k)) { seen.add(k); q.push([c + dc, r + dr]); }
      }
    }
    check('[FP] U 4 连通（走廊从镇中心可达每一格）',
      seen.size === Object.keys(pv.u).length, seen.size + ' vs ' + Object.keys(pv.u).length);
  }
  // v1.7.5 真链环：finalPreviewRail 内部完成"灌 U → 真求解链 → 还原"，
  //   验：ok / 环 ⊆ U / 缓存同引用 / 局内铁轨未被预览计算污染
  {
    const railLenBefore = GS.railPath.length;
    const rail = GS.finalPreviewRail();
    check('[FP] 真链环：ok 且环 ⊆ U（步数 ' + rail.path.length + '）',
      rail.ok && rail.path.every(p => pv.u[p.c + ',' + p.r]),
      'rail=' + rail.path.length);
    // v1.7.6 大王口径直译：连通资源 = 环逐格经过全部资源格（列车跑在轨上才采得到）
    {
      const onRail = {};
      for (const p of rail.path) onRail[p.c + ',' + p.r] = true;
      const miss = res.filter(p => !onRail[p.c + ',' + p.r]);
      check('[FP] 环经过全部资源格（连通资源）', miss.length === 0,
        'miss=' + miss.length);
    }
    check('[FP] 真链环：缓存命中（二次调用同引用）', GS.finalPreviewRail() === rail);
    check('[FP] 局内铁轨未被预览计算污染',
      GS.railPath.length === railLenBefore && railLenBefore > 0,
      'before=' + railLenBefore + ' after=' + GS.railPath.length);
  }
  // 五关区分度断言在 test_levels.js（levels 域，[FP-LV]）
  GS.newGame();
}
```

## test_levels.js

```
// ---- 5) 终局预览区分度（v1.7.3 §14.63，levels 域）-----------------------------
//   五关资源分布不同 ⇒ 资源连通清空区的规模不同（v1.7.1"区别只在资源分布"延伸）；
//   v1.7.5 真链环：五关都要解出真欧拉环（大王验收口径"铁轨呈环"逐关验）
{
  const sigs = [];
  for (let li = 0; li < LEVELS.length; li++) {
    GS.startLevel(li);
    const pv = GS.finalPreviewCells();
    // 每关 U 都要覆盖本关全部资源（连通目标达成，逐关验）
    const res = [...GS.goldTiles, ...GS.heartTiles];
    check('第' + (li + 1) + '关「' + LEVELS[li].name + '」预览 U 覆盖全部资源',
      res.every(p => pv.u[p.c + ',' + p.r]), 'miss=' + res.filter(p => !pv.u[p.c + ',' + p.r]).length);
    // v1.7.5：真求解链解出的预览环——ok、非空、环 ⊆ U（环长在清空区里）
    const rail = GS.finalPreviewRail();
    check('第' + (li + 1) + '关「' + LEVELS[li].name + '」真链环解出且 ⊆ U（' + rail.path.length + ' 步）',
      rail.ok && rail.path.length > 0 && rail.path.every(p => pv.u[p.c + ',' + p.r]),
      'ok=' + rail.ok + ' rail=' + rail.path.length);
    // v1.7.6 大王口径直译：环逐格经过本关全部资源格（列车采得到）
    {
      const onRail = {};
      for (const p of rail.path) onRail[p.c + ',' + p.r] = true;
      const miss = res.filter(p => !onRail[p.c + ',' + p.r]);
      check('第' + (li + 1) + '关「' + LEVELS[li].name + '」环经过全部资源格',
        miss.length === 0, 'miss=' + miss.length);
    }
    sigs.push(pv.cells.length);
  }
  check('五关 ∂U 规模随资源分布不同（有区分度）',
    new Set(sigs).size >= 4, sigs.join('/'));
  GS.startLevel(0);
}
```

## test_render.js

```
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
```
