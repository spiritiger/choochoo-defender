// ============================================================
//  游戏主引擎：持有状态、推进昼夜、调度各系统
//  （纯 TS，不依赖渲染；渲染层只读 state）
// ============================================================
import { FIELD, GRID, RULE, ECONOMY, TRAIN_BASE, CENTER, TRACK } from '../config/game'
import { BUILDINGS, MONSTERS } from '../config/units'
import type {
  GameState,
  BuildingKind,
  Monster,
  Projectile,
  Train,
} from './types'
import type { BuildingSpec, MonsterSpec } from '../config/units'

let uid = 0
const nextId = () => `id_${++uid}`

/** 网格原点（左上角），使网格居中 */
function gridOrigin(): { x: number; y: number } {
  const gridW = (GRID.cols - 1) * GRID.pitch + GRID.cellSize
  const gridH = (GRID.rows - 1) * GRID.pitch + GRID.cellSize
  return {
    x: (FIELD.width - gridW) / 2,
    y: (FIELD.height - gridH) / 2,
  }
}

/** 定位一个网格格心的像素坐标 */
export function cellCenter(index: number): { x: number; y: number } {
  const col = index % GRID.cols
  const row = Math.floor(index / GRID.cols)
  const o = gridOrigin()
  return {
    x: o.x + col * GRID.pitch + GRID.cellSize / 2,
    y: o.y + row * GRID.pitch + GRID.cellSize / 2,
  }
}

export { gridOrigin }

const CENTER_X = FIELD.width / 2
const CENTER_Y = FIELD.height / 2

function createTrain(): Train {
  return { angle: 0, speedMult: 1, boostTimer: 0, cooldown: 0 }
}

export function createInitialState(): GameState {
  return {
    phase: 'day',
    coins: RULE.initialCoins,
    raw: 0,
    product: 0,
    nightCount: 0,
    nightTimer: 0,
    spawnTimer: 0,
    centerHp: CENTER.maxHp,
    buildings: [],
    monsters: [],
    projectiles: [],
    train: createTrain(),
    steam: TRAIN_BASE.steamMax,
    gameOver: false,
    victory: false,
    placing: null,
    toast: null,
    kills: 0,
  }
}

export class GameEngine {
  state: GameState

  constructor() {
    this.state = createInitialState()
  }

  // ---------- 输入操作 ----------

  /** 选择/取消一个建筑进行摆放 */
  selectToPlace(kind: BuildingKind) {
    if (this.state.gameOver) return
    this.state.placing = this.state.placing === kind ? null : kind
  }

  /** 在第 index 格摆放当前选中的建筑 */
  place(index: number) {
    const s = this.state
    const kind = s.placing
    if (!kind || s.gameOver) return
    const spec = BUILDINGS.find((b) => b.id === kind)!
    if (s.coins < spec.cost) {
      this.toast('金币不足')
      return
    }
    const { x, y } = cellCenter(index)
    // 检查该格是否已有建筑
    const occupied = s.buildings.some(
      (b) => Math.abs(b.gridX - x) < 1 && Math.abs(b.gridY - y) < 1,
    )
    if (occupied) {
      this.toast('该位置已有建筑')
      return
    }
    s.coins -= spec.cost
    s.buildings.push({
      id: nextId(),
      kind,
      gridX: x,
      gridY: y,
      hp: 1, // 建筑仅作为瞄准目标
      cooldown: 0,
      rawStock: 0,
      prodStock: 0,
    })
  }

  /** 手动进入夜晚（白天阶段触发） */
  startNight() {
    const s = this.state
    if (s.phase !== 'day' || s.gameOver) return
    s.phase = 'night'
    s.nightTimer = RULE.nightDuration
    s.spawnTimer = 0
  }

  /** 蒸汽加速（有能量时） */
  boost() {
    const s = this.state
    if (s.phase !== 'night' || s.gameOver) return
    if (s.steam < TRAIN_BASE.steamCost) {
      this.toast('蒸汽能量不足')
      return
    }
    s.steam -= TRAIN_BASE.steamCost
    s.train.boostTimer = TRAIN_BASE.boostDuration
    s.train.speedMult = TRAIN_BASE.boostMultiplier
  }

  /** 卖基础资源（低价） */
  sellRaw() {
    const s = this.state
    if (s.raw <= 0) {
      this.toast('没有基础资源')
      return
    }
    s.coins += s.raw * ECONOMY.rawSellPrice
    s.raw = 0
  }

  /** 卖成品（高价） */
  sellProduct() {
    const s = this.state
    if (s.product <= 0) {
      this.toast('没有成品可卖')
      return
    }
    s.coins += s.product * ECONOMY.productSellPrice
    s.product = 0
  }

  toast(msg: string) {
    this.state.toast = msg
    setTimeout(() => {
      if (this.state.toast === msg) this.state.toast = null
    }, 1400)
  }

  // ---------- 系统 ----------

  /** 计算列车强化加成（来自蒸汽核心建筑） */
  private trainBuffs() {
    let dmg = 0
    let rate = 0
    let steamRegen = 0
    for (const b of this.state.buildings) {
      if (b.kind !== 'booster') continue
      const spec = BUILDINGS.find((x) => x.id === 'booster')!
      dmg += spec.trainDamageBonus ?? 0
      rate += spec.trainFireRateBonus ?? 0
      steamRegen += spec.trainSteamBonus ?? 0
    }
    return { dmg, rate, steamRegen }
  }

  /** 列车位置（沿椭圆轨道） */
  trainPos(): { x: number; y: number } {
    const t = this.state.train.angle
    return { x: CENTER_X + TRACK.rx * Math.cos(t), y: CENTER_Y + TRACK.ry * Math.sin(t) }
  }

  update(dt: number) {
    const s = this.state
    if (s.gameOver) return

    this.updatePhase(dt)
    this.updateBuildings(dt)
    this.updateTrain(dt)
    this.updateMonsters(dt)
    this.updateProjectiles(dt)
    this.checkEnd()
  }

  private updatePhase(dt: number) {
    const s = this.state
    if (s.phase === 'night') {
      s.nightTimer -= dt
      s.spawnTimer -= dt
      if (s.spawnTimer <= 0) {
        this.spawnWave()
        s.spawnTimer = RULE.nightSpawnInterval
      }
      if (s.nightTimer <= 0) {
        // 夜晚结束：清场，回到白天
        s.monsters = []
        s.projectiles = []
        s.phase = 'day'
        s.nightCount += 1
        s.train.speedMult = 1
        s.train.boostTimer = 0
      }
    }
  }

  private spawnWave() {
    const s = this.state
    // 随机生成 1~3 只怪
    const n = 1 + Math.floor(Math.random() * 3)
    for (let i = 0; i < n; i++) {
      const spec: MonsterSpec = MONSTERS[Math.floor(Math.random() * MONSTERS.length)]
      // 从轨道外侧随机边界生成
      const edge = Math.floor(Math.random() * 4)
      const margin = 20
      const x =
        edge === 0 ? margin + Math.random() * (FIELD.width - margin * 2)
        : edge === 1 ? FIELD.width - margin
        : edge === 2 ? margin + Math.random() * (FIELD.width - margin * 2)
        : margin
      const y =
        edge === 2 ? margin + Math.random() * (FIELD.height - margin * 2)
        : edge === 3 ? FIELD.height - margin
        : edge === 0 ? margin
        : margin + Math.random() * (FIELD.height - margin * 2)
      s.monsters.push({
        id: nextId(),
        kindId: spec.id,
        x,
        y,
        hp: spec.maxHp,
        maxHp: spec.maxHp,
        speed: spec.speed,
        damage: spec.damage,
        reward: spec.reward,
        targetId: this.pickMonsterTarget(),
        attackCooldown: 0,
      })
    }
  }

  /** 怪物优先攻击最近的建筑，其次冲向镇中心 */
  private pickMonsterTarget(): string | null {
    const s = this.state
    if (s.buildings.length === 0) return null
    // 随机指向一个建筑，避免全挤向同一目标
    return s.buildings[Math.floor(Math.random() * s.buildings.length)].id
  }

  private updateBuildings(dt: number) {
    const s = this.state
    const specs = new Map<string, BuildingSpec>()
    BUILDINGS.forEach((b) => specs.set(b.id, b))

    for (const b of s.buildings) {
      const spec = specs.get(b.kind)!
      b.cooldown -= dt

      // 生产建筑：产出基础资源，交给列车运输（简化：直接进入 raw 库存）
      if (b.kind === 'mine' && spec.resourcePerCycle && spec.cycleInterval) {
        if (b.cooldown <= 0) {
          b.rawStock = (b.rawStock ?? 0) + spec.resourcePerCycle
          b.cooldown = spec.cycleInterval
        }
      }
      // 加工建筑：消耗 raw 生产成品
      if (
        b.kind === 'furnace' &&
        spec.inputPerCycle &&
        spec.outputPerCycle
      ) {
        if (s.raw > 0 || b.rawStock && (b.rawStock ?? 0) > 0) {
          if (b.cooldown <= 0) {
            const input = spec.inputPerCycle
            const consumed = Math.min(input, s.raw)
            s.raw -= consumed
            s.product += consumed
            b.cooldown = 6
          }
        }
      }
      // 作战建筑：自动开火
      if (b.kind === 'turret' && spec.damage && spec.fireRange && spec.fireCooldown) {
        if (b.cooldown <= 0) {
          const target = this.nearestMonster(b.gridX, b.gridY, spec.fireRange)
          if (target) {
            this.fireAt(b.gridX, b.gridY, target, spec.damage)
            b.cooldown = spec.fireCooldown
          }
        }
      }
    }
  }

  private nearestMonster(x: number, y: number, range: number): Monster | null {
    let best: Monster | null = null
    let bestD = Infinity
    for (const m of this.state.monsters) {
      if (m.hp <= 0) continue
      const d = Math.hypot(m.x - x, m.y - y)
      if (d <= range && d < bestD) {
        bestD = d
        best = m
      }
    }
    return best
  }

  private fireAt(x: number, y: number, target: Monster, damage: number) {
    const speed = 220
    const dx = target.x - x
    const dy = target.y - y
    const len = Math.hypot(dx, dy)
    this.state.projectiles.push({
      id: nextId(),
      x,
      y,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      damage,
      targetMonsterId: target.id,
    })
  }

  private updateTrain(dt: number) {
    const s = this.state
    const boost = s.train.boostTimer > 0 ? s.train.speedMult : 1
    s.train.angle += TRAIN_BASE.speedRadPerSec * boost * dt
    if (s.train.boostTimer > 0) s.train.boostTimer -= dt
    // 能量恢复
    const { steamRegen } = this.trainBuffs()
    s.steam = Math.min(TRAIN_BASE.steamMax, s.steam + (TRAIN_BASE.steamRegenPerSec + steamRegen) * dt)

    // 列车开火（夜晚才攻击）
    if (s.phase === 'night') {
      const { dmg, rate } = this.trainBuffs()
      const pos = this.trainPos()
      s.train.cooldown -= dt
      if (s.train.cooldown <= 0) {
        const target = this.nearestMonster(pos.x, pos.y, TRAIN_BASE.fireRange + rate * 30)
        if (target) {
          this.fireAt(pos.x, pos.y, target, TRAIN_BASE.damage * (1 + dmg))
          s.train.cooldown = TRAIN_BASE.fireCooldown / (1 + rate)
        }
      }
    }
  }

  private updateMonsters(dt: number) {
    const s = this.state
    const CENTER = { x: CENTER_X, y: CENTER_Y }

    for (const m of s.monsters) {
      if (m.hp <= 0) continue
      // 目标建筑
      let tx = CENTER.x
      let ty = CENTER.y
      const targetB = s.buildings.find((b) => b.id === m.targetId)
      if (targetB) {
        tx = targetB.gridX
        ty = targetB.gridY
      }
      const dx = tx - m.x
      const dy = ty - m.y
      const dist = Math.hypot(dx, dy)
      if (dist > 6) {
        m.x += (dx / dist) * m.speed * dt
        m.y += (dy / dist) * m.speed * dt
      } else {
        // 到达目标，造成伤害
        m.attackCooldown -= dt
        if (m.attackCooldown <= 0) {
          if (targetB) {
            targetB.hp -= m.damage
          } else {
            s.centerHp -= m.damage
          }
          m.attackCooldown = 0.8
        }
      }
    }

    // 移除死亡的建筑（被摧毁）
    s.buildings = s.buildings.filter((b) => b.hp > 0)
  }

  private updateProjectiles(dt: number) {
    const s = this.state
    const alive: Projectile[] = []

    // 怪物存活集合
    const live = new Map<string, Monster>()
    s.monsters.forEach((m) => {
      if (m.hp > 0) live.set(m.id, m)
    })

    for (const p of s.projectiles) {
      p.x += p.vx * dt
      p.y += p.vy * dt

      // 命中追踪目标
      const t = p.targetMonsterId ? live.get(p.targetMonsterId) : undefined
      let hit = false
      if (t && Math.hypot(t.x - p.x, t.y - p.y) < 14) {
        t.hp -= p.damage
        hit = true
        if (t.hp <= 0) {
          if (live.has(t.id)) {
            s.coins += t.reward
            s.kills += 1
            live.delete(t.id)
          }
        }
      }
      // 出界清除
      if (p.x < -20 || p.x > FIELD.width + 20 || p.y < -20 || p.y > FIELD.height + 20) {
        hit = true
      }
      if (!hit) alive.push(p)
    }
    s.projectiles = alive

    // 移除死亡怪物
    s.monsters = s.monsters.filter((m) => m.hp > 0)
  }

  private checkEnd() {
    const s = this.state
    if (s.centerHp <= 0) {
      s.centerHp = 0
      s.gameOver = true
      s.victory = false
    }
    if (!s.gameOver && s.nightCount >= RULE.targetNights && s.phase === 'day') {
      s.gameOver = true
      s.victory = true
    }
  }

  restart() {
    this.state = createInitialState()
  }
}