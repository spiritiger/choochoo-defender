// 迷你版 3 夜关卡（仅验证经济与强度循环；夜晚击杀暂不给奖励）
window.LEVELS = [
  { name: '第 1 夜', count: 8,  interval: 1.7, hp: 18, dmg: 6,  speed: 2.0 },
  { name: '第 2 夜', count: 14, interval: 1.25, hp: 26, dmg: 8,  speed: 2.25 },
  { name: '第 3 夜', count: 20, interval: 1.0,  hp: 36, dmg: 10, speed: 2.4 }
];

LEVELS.total = LEVELS.length; // 3