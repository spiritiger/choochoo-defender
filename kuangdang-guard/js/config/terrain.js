// 环境地块（纯装饰，不参与战斗），仅可放在外部环境/铁轨外圈
window.TERRAIN = {
  types: [
    { id: 'tree', name: '树木' },
    { id: 'hill', name: '丘陵' }
  ],
  zones: [CFG.ZONE.ENV, CFG.ZONE.OUTER]
};
TERRAIN.canPlace = function (zone) {
  return TERRAIN.zones.indexOf(zone) >= 0;
};