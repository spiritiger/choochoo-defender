// ============================================================
//  核心类型定义
// ============================================================

export type Phase = 'day' | 'night'

export type BuildingKind = 'mine' | 'furnace' | 'turret' | 'booster'

/** 摆放在网格上的建筑实例 */
export interface Building {
  id: string
  kind: BuildingKind
  gridX: number // 逻辑坐标（px）
  gridY: number
  hp: number
  cooldown: number // 生产/开火冷却计时
  rawStock?: number // 生产建筑待运输的资源
  prodStock?: number // 加工建筑库存
}

export interface Monster {
  id: string
  kindId: string
  x: number
  y: number
  hp: number
  maxHp: number
  speed: number
  damage: number
  reward: number
  targetId: string | null // 当前攻击的目标建筑 id；null=冲向镇中心
  attackCooldown: number
}

export interface Projectile {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  damage: number
  targetMonsterId: string | null
}

/** 列车（镇中心上绕圈的炮台） */
export interface Train {
  angle: number
  speedMult: number // 蒸汽加速带来的倍率
  boostTimer: number
  cooldown: number
}

export interface GameState {
  phase: Phase
  coins: number
  raw: number // 基础资源（未运输，钱袋旁显示）
  product: number // 成品（未卖出）
  nightCount: number // 已度过的夜晚数
  nightTimer: number // 本轮夜晚剩余
  spawnTimer: number // 夜晚刷怪计时
  centerHp: number
  buildings: Building[]
  monsters: Monster[]
  projectiles: Projectile[]
  train: Train
  steam: number
  gameOver: boolean
  victory: boolean
  /** 当前待摆放的建筑类型，null 表示未在摆放 */
  placing: BuildingKind | null
  /** 错误提示（用于UI展示，如金币不足） */
  toast: string | null
  /** 最近击杀统计（供HUD） */
  kills: number
}

export interface LevelState extends GameState {
  step: number // 总步进计数，用于 rAF
}