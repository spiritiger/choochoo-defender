// ============================================================
//  全局游戏参数 —— 修改这里的数字即可调整整体难度与节奏
//  （field 尺寸、昼夜计时、经济售价、胜负条件等）
// ============================================================

export const FIELD = {
  width: 480, // 游戏区域逻辑宽
  height: 760, // 游戏区域逻辑高
} as const

/** 建筑摆放网格 */
export const GRID = {
  cols: 5,
  rows: 5,
  cellSize: 64, // 单格边长(px)
  pitch: 74, // 格心间距(px)
} as const

/** 列车轨道（椭圆），围绕城镇中心 */
export const TRACK = {
  rx: 205,
  ry: 300,
} as const

/** 城镇中心 */
export const CENTER = {
  maxHp: 200,
}

/** 胜负 / 昼夜节奏 */
export const RULE = {
  targetNights: 10, // 守满多少个黑夜即获胜
  dayDuration: 999, // 白天时长（MVP 手动进入夜晚，理论上不限）
  nightDuration: 28, // 单个夜晚时长(秒)
  nightSpawnInterval: 0.95, // 夜晚每间隔(秒)生成一波怪物
  initialCoins: 60,
  centerDefeat: true, // 镇中心被破即失败
}

/** 经济：售价（单价，金币）与产出数值。低卖资源、高卖成品 */
export const ECONOMY = {
  rawSellPrice: 3, // 每单位基础资源售价
  productSellPrice: 8, // 每单位成品售价
}

/** 列车属性（蒸汽核心建筑可在此基础上加成） */
export const TRAIN_BASE = {
  speedRadPerSec: 0.9, // 绕轨道角速度(弧度/秒)
  boostMultiplier: 1.7, // 蒸汽加速倍数
  boostDuration: 3, // 单次加速时长
  steamMax: 100, // 蒸汽能量上限
  steamCost: 45, // 一次加速消耗能量
  steamRegenPerSec: 8, // 能量自然恢复
  fireRange: 130, // 开火射程
  fireCooldown: 0.9, // 开火间隔(秒)
  damage: 10, // 单发伤害
}