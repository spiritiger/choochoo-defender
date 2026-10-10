// ============================================================================
// 站台模块（v0.9.2）—— 与铁轨**叠加**的停靠地块
//
// 大王 2026-09-26 的 6 条规则里，本模块负责规则 1/2/3：
//   1) 与铁轨地块是叠加关系：站台**不占新格、不改地形**，只是从当前铁轨环上
//      挑一个轨格当站台。GS.grid 的 t / gold / b 全都不动。
//   2) 一定位于地图中轴线的靠下位置：中轴列 = floor(MAP_COLS/2)（本图 9 列 → 4），
//      镇中心行 = floor(MAP_ROWS/2)（本图 13 行 → 6）；候选 = 中轴列上、镇中心**以下**
//      的轨格；取其中 **r 最大**（最靠下）的那个。
//   3) 随铁轨位置变化：state.js 的 recomputeRails 每次重算完都会回调
//      STATION.solve(railPath)，于是铁轨一变、站台自动跟着变。
//      GS.station 里带 index（该格在 railPath 的**首次**下标），列车白天对齐它即可。
//
// 规则 4/5（白天停靠 / 夜晚才走）在 engine.js（trainFlow / parkAtStation / advanceTrain），
// 规则 6（金币堆在车上、到站交付）在 transport.js（load / deliver）。
//
// 本模块只依赖 CFG（坐标口径）与 GS（读写 GS.station），不依赖 engine/transport/renderer，
// 可以独立替换选点策略（改 STATION.pick 一处即可）。
// ============================================================================
window.STATION = {};

// 可调参数集中在这里，方便单独调整站台规则而不碰其它模块
STATION.CFG = {
  // 站台行必须 > 镇中心行 + BELOW_CENTER。0 = 严格在镇中心下方（不含镇中心那一行）。
  BELOW_CENTER: 0
};

STATION.axisCol = function () { return Math.floor(CFG.MAP_COLS / 2); };
STATION.centerRow = function () { return Math.floor(CFG.MAP_ROWS / 2); };

// 环上每格的「首次出现下标」—— 十字格会被走两次，站台取第一次，保证 from 站台出发的
// 那一圈从该下标数起刚好是完整一圈。
STATION.firstIndex = function (railPath) {
  var first = {}, i;
  for (i = 0; i < railPath.length; i++) {
    var k = railPath[i].c + ',' + railPath[i].r;
    if (!(k in first)) first[k] = i;
  }
  return first;
};

// 选点：返回 { c, r, index }；铁轨不成环（<4 步）时返回 null。
//   首选：中轴列 + 镇中心以下，r 最大者。
//   退化（该列一个候选都没有）：离地图底部中点曼哈顿距离最近的轨格 ——
//     保证任何盘面都有站台（否则整条昼夜流程会没有到站判定）。
STATION.pick = function (railPath) {
  if (!railPath || railPath.length < 4) return null;
  var first = STATION.firstIndex(railPath);
  var ax = STATION.axisCol();
  var rowMin = STATION.centerRow() + STATION.CFG.BELOW_CENTER;
  var best = null, k;
  for (k in first) {
    var cc = k.split(','), c = +cc[0], r = +cc[1];
    if (c !== ax || r <= rowMin) continue;
    if (!best || r > best.r) best = { c: c, r: r, index: first[k] };
  }
  if (best) return best;
  // 退化口径：离底部中点（中轴列, 最后一行）最近
  var bx = ax, by = CFG.MAP_ROWS - 1;
  for (k in first) {
    cc = k.split(',');
    c = +cc[0]; r = +cc[1];
    var d = Math.abs(c - bx) + Math.abs(r - by);
    if (!best || d < best.d ||
        (d === best.d && (r > best.r || (r === best.r && c < best.c)))) {
      best = { c: c, r: r, index: first[k], d: d };
    }
  }
  if (best) delete best.d;
  return best;
};

// ★ 唯一入口：recomputeRails 算完铁轨后回调本函数，站台随之刷新。
STATION.solve = function (railPath) {
  GS.station = STATION.pick(railPath || GS.railPath || []);
  return GS.station;
};

// 当前站台 { c, r, index } 或 null
STATION.slot = function () { return GS.station || null; };
// 站台在 railPath 上的下标（列车停靠用）；无站台返回 -1
STATION.index = function () { return GS.station ? GS.station.index : -1; };
// 该格是不是站台
STATION.isAt = function (c, r) {
  var st = GS.station;
  return !!st && st.c === c && st.r === r;
};
// 铁轨环上是否已解出站台（列车可发车的前提）
STATION.ready = function () { return !!GS.station && GS.railPath && GS.railPath.length >= 4; };