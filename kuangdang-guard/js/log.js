// ============================================================================
// 行为记录模块（v1.3.5）—— 玩家操作流水，用于后续统计与数值平衡
//
// 大王拍板（2026-09-29）：顶栏新增【导出记录】按钮（导出地图旁），复制本次
//   玩家行为的 JSON 行流水。记录范围（拍板：施工/经济/战斗三类，铁轨重算不记）：
//   · 施工：cleanPay（抽形状付费）/ cleanApply / cleanFail（清理成败与原因）/
//     cleanDiscard（形状作废）/ summon / summonFail / merge / mergeFail
//   · 经济：waveStart（带金币快照）/ waveEnd / deliver（车斗+站台分项、结余）
//   · 战斗：coreHit（镇中心每次受伤后的血量）/ gameOver / newGame（含重开）
//
// 设计口径：
//   · t = 页面加载起的秒数（performance.now 基准，0.1s 精度）——跨局连续递增，
//     靠 newGame 事件切分局；绝对时刻看头部 ISO 时间戳。
//   · 环形上限 LOG.CAP（默认 3000 条，超出丢最旧）——十几局也撑不爆内存。
//   · 各模块调用一律 typeof 守卫（与 CLOCK/STATION 同约定）：test 沙箱不载
//     log.js 时零开销跳过。
//   · 本模块零依赖，index.html 里排在 config 之后即可。
// ============================================================================
window.LOG = {};

LOG.VER = 'v1.3.5';   // 记录器数据格式版本（随规格版本更新；头部 # ver= 行用它）
LOG.CAP = 3000;   // 环形上限：超出丢弃最旧事件
LOG.buf = [];     // 事件缓冲：{t, ev, ...附加字段}
LOG._t0 = (typeof performance !== 'undefined' && performance.now)
  ? performance.now() : Date.now();    // 页面加载基准（脚本执行时近似）
// 会话 ID（页面加载时生成一次，6 位 base36）：多份日志汇总统计时区分数据来源
LOG.sid = (function () {
  var s = '';
  while (s.length < 6) s += Math.random().toString(36).slice(2);
  return s.slice(0, 6);
})();

// 页面相对秒（0.1s 精度）
LOG.now = function () {
  var src = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
  return Math.round((src - LOG._t0) / 100) / 10;
};

// 形状家族归一（v1.3.5 补充，大王拍板）：把「宽×高」按边长排序成规范名，
//   使 2×3 / 3×2（同形状的横竖朝向）归并到同一个家族名 —— 聚合统计不再拆成两行。
//   非「数字×数字」格式的名字原样返回（防御）。
LOG.shapeFam = function (name) {
  var m = /^(\d+)×(\d+)$/.exec(String(name));
  if (!m) return name;
  var a = +m[1], b = +m[2];
  return a <= b ? a + '×' + b : b + '×' + a;
};

// 记一条事件。ev = 事件名；data = 附加字段对象（可省略）。返回该条目。
//   data 里带 shape 的（清理三兄弟）自动补 fam = 家族名 —— 调用点不用各自管。
LOG.add = function (ev, data) {
  var e = { t: LOG.now(), ev: ev };
  if (data) {
    for (var k in data) e[k] = data[k];
    if (data.shape) e.fam = LOG.shapeFam(data.shape);
  }
  LOG.buf.push(e);
  while (LOG.buf.length > LOG.CAP) LOG.buf.shift();   // 环形：丢最旧
  return e;
};

LOG.count = function () { return LOG.buf.length; };

// 导出文本：头部 + 两行汇总 + 每事件一行 JSON（与导出地图同走剪贴板，ui.js 调）。
LOG.exportText = function () {
  var stat = {}, runs = 0, maxWave = 0, goldEarned = 0, i, e;
  for (i = 0; i < LOG.buf.length; i++) {
    e = LOG.buf[i];
    stat[e.ev] = (stat[e.ev] || 0) + 1;
    if (e.ev === 'newGame') runs++;
    if (e.ev === 'waveStart' && e.wave > maxWave) maxWave = e.wave;
    if (e.ev === 'deliver') goldEarned += (e.got || 0);
  }
  var lines = ['KDG-LOG v1 ' + new Date().toISOString()];
  lines.push('# ver=' + LOG.VER + ' sid=' + LOG.sid);
  lines.push('# 事件 ' + LOG.buf.length + ' 条（上限 ' + LOG.CAP + '，超出丢最旧）· 开局 ' + runs + ' 次');
  lines.push('# 统计: waves=' + maxWave +
    ' clean=' + (stat.cleanApply || 0) + '+' + (stat.cleanFail || 0) + 'fail' +
    '+' + (stat.cleanDiscard || 0) + 'discard' +
    ' summon=' + (stat.summon || 0) + '+' + (stat.summonFail || 0) + 'fail' +
    ' merge=' + (stat.merge || 0) + '+' + (stat.mergeFail || 0) + 'fail' +
    ' deliver=' + (stat.deliver || 0) + ' goldEarned=' + goldEarned +
    ' coreHit=' + (stat.coreHit || 0) + ' gameOvers=' + (stat.gameOver || 0));
  for (i = 0; i < LOG.buf.length; i++) lines.push(JSON.stringify(LOG.buf[i]));
  return lines.join('\n');
};
