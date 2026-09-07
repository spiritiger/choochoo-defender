// ============================================================
//  建筑 / 单位数值 —— 修改这里调整各建筑效果与价格
// ============================================================

export interface BuildingSpec {
  id: string
  name: string
  cost: number
  description: string
  // 生产建筑专用
  resourcePerCycle?: number // 每周期产出资源数
  cycleInterval?: number // 产出周期(秒)
  // 加工建筑专用
  inputPerCycle?: number
  outputPerCycle?: number
  // 作战建筑专用
  damage?: number
  fireRange?: number
  fireCooldown?: number
  // 列车增强专用
  trainSpeedBonus?: number
  trainDamageBonus?: number
  trainFireRateBonus?: number
  trainSteamBonus?: number
}

/** 四类建筑，MVP 各 1 种 */
export const BUILDINGS: BuildingSpec[] = [
  {
    id: 'mine',
    name: '采矿机',
    cost: 30,
    description: '每 5 秒产出 1 单位基础资源',
    resourcePerCycle: 1,
    cycleInterval: 5,
  },
  {
    id: 'furnace',
    name: '冶炼炉',
    cost: 50,
    description: '每 6 秒将 1 资源加工为 1 成品',
    inputPerCycle: 1,
    outputPerCycle: 1,
  },
  {
    id: 'turret',
    name: '蒸汽炮台',
    cost: 40,
    description: '自动攻击射程内的怪物',
    damage: 12,
    fireRange: 120,
    fireCooldown: 1.2,
  },
  {
    id: 'booster',
    name: '蒸汽核心',
    cost: 60,
    description: '提升列车火力 +25% 与能量恢复',
    trainDamageBonus: 0.25,
    trainFireRateBonus: 0.15,
    trainSteamBonus: 15,
  },
]

/** 怪物数值 */
export interface MonsterSpec {
  id: string
  name: string
  maxHp: number
  speed: number
  damage: number // 对建筑/镇中心单次碰撞伤害
  reward: number // 击杀金币奖励
}

export const MONSTERS: MonsterSpec[] = [
  { id: 'grunt', name: '步兵', maxHp: 30, speed: 35, damage: 8, reward: 10 },
  { id: 'runner', name: '突击兵', maxHp: 18, speed: 60, damage: 5, reward: 8 },
  { id: 'tank', name: '重甲兵', maxHp: 80, speed: 22, damage: 18, reward: 25 },
]