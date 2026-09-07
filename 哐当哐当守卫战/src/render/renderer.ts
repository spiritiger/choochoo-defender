// ============================================================
//  渲染层：把 GameState 画到 canvas（纯函数，无副作用保存）
//  扁平卡通占位美术：建筑/怪物用圆角几何 + 简单绘制，改起来快
// ============================================================
import { FIELD, GRID, TRACK, CENTER as CENTER_CFG } from '../config/game'
import { MONSTERS } from '../config/units'
import type { GameState, Phase, BuildingKind } from '../game/types'
import { gridOrigin } from '../game/engine'

const COLORS: Record<BuildingKind, { main: string; dark: string; label: string }> = {
  mine: { main: '#8d9a5a', dark: '#6b7842', label: '矿' },
  furnace: { main: '#e0834f', dark: '#b9622f', label: '冶' },
  turret: { main: '#5b7db1', dark: '#3f5c8a', label: '炮' },
  booster: { main: '#7b5ca6', dark: '#5a3f86', label: '核' },
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function render(ctx: CanvasRenderingContext2D, state: GameState) {
  const W = FIELD.width
  const H = FIELD.height
  ctx.clearRect(0, 0, W, H)

  drawBackground(ctx, state.phase)
  drawTrack(ctx)
  drawGrid(ctx, state)
  drawCenter(ctx, state)
  drawBuildings(ctx, state)
  drawMonsters(ctx, state)
  drawProjectiles(ctx, state)
  drawTrain(ctx, state)
}

function drawBackground(ctx: CanvasRenderingContext2D, phase: Phase) {
  ctx.fillStyle = phase === 'night' ? '#1c2333' : '#ddeee0'
  ctx.fillRect(0, 0, FIELD.width, FIELD.height)
}

function drawTrack(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = 'rgba(120,110,90,0.6)'
  ctx.lineWidth = 6
  ctx.beginPath()
  ctx.ellipse(FIELD.width / 2, FIELD.height / 2, TRACK.rx, TRACK.ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  // 轨道点缀
  ctx.strokeStyle = 'rgba(255,255,255,0.4)'
  ctx.lineWidth = 2
  ctx.setLineDash([8, 12])
  ctx.beginPath()
  ctx.ellipse(FIELD.width / 2, FIELD.height / 2, TRACK.rx, TRACK.ry, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.setLineDash([])
}

function drawGrid(ctx: CanvasRenderingContext2D, state: GameState) {
  const o = gridOrigin()
  ctx.strokeStyle = 'rgba(120,150,120,0.25)'
  ctx.lineWidth = 1
  for (let c = 0; c < GRID.cols; c++) {
    for (let r = 0; r < GRID.rows; r++) {
      const x = o.x + c * GRID.pitch
      const y = o.y + r * GRID.pitch
      // 高亮待摆放格
      if (state.placing) {
        ctx.fillStyle = 'rgba(120,200,255,0.12)'
        ctx.fillRect(x, y, GRID.cellSize, GRID.cellSize)
      }
      ctx.strokeRect(x, y, GRID.cellSize, GRID.cellSize)
    }
  }
}

function drawCenter(ctx: CanvasRenderingContext2D, state: GameState) {
  ctx.save()
  ctx.translate(FIELD.width / 2, FIELD.height / 2)
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.15)'
  ctx.beginPath()
  ctx.arc(0, 3, 30, 0, Math.PI * 2)
  ctx.fill()
  // 底座
  ctx.fillStyle = '#8a6b3d'
  roundRect(ctx, -30, -22, 60, 48, 8)
  ctx.fill()
  // 主塔
  ctx.fillStyle = '#6a4f2f'
  roundRect(ctx, -16, -34, 32, 22, 4)
  ctx.fill()
  // 旗
  ctx.fillStyle = '#d8443c'
  ctx.beginPath()
  ctx.moveTo(0, -34)
  ctx.lineTo(14, -29)
  ctx.lineTo(0, -24)
  ctx.closePath()
  ctx.fill()
  // 血条
  const ratio = state.centerHp / CENTER_CFG.maxHp
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  roundRect(ctx, -28, 22, 56, 7, 3)
  ctx.fill()
  ctx.fillStyle = ratio > 0.5 ? '#63c74d' : ratio > 0.25 ? '#e8b53a' : '#e0553f'
  roundRect(ctx, -28, 22, 56 * ratio, 7, 3)
  ctx.fill()
  ctx.restore()
}

function drawBuildings(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const b of state.buildings) {
    const c = COLORS[b.kind]
    ctx.save()
    ctx.translate(b.gridX, b.gridY)
    ctx.fillStyle = 'rgba(0,0,0,0.12)'
    roundRect(ctx, -28, -20, 56, 14 + 22, 6)
    ctx.fill()
    ctx.fillStyle = c.main
    roundRect(ctx, -26, -16, 52, 36, 8)
    ctx.fill()
    ctx.strokeStyle = c.dark
    ctx.lineWidth = 3
    ctx.stroke()
    // 图标
    ctx.fillStyle = c.dark
    ctx.font = 'bold 16px sans-serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(c.label, 0, 2)
    // 资源库存徽标
    if (b.kind === 'mine' && b.rawStock && b.rawStock > 0) {
      ctx.fillStyle = '#3f6a3a'
      ctx.beginPath()
      ctx.arc(18, -18, 8, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = '#fff'
      ctx.font = 'bold 10px sans-serif'
      ctx.fillText(String(b.rawStock), 18, -17)
    }
    ctx.restore()
  }
}

function drawMonsters(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const m of state.monsters) {
    const spec = MONSTERS.find((s) => s.id === m.kindId)!
    ctx.save()
    ctx.translate(m.x, m.y)
    const color = spec.id === 'runner' ? '#e8c43a' : spec.id === 'tank' ? '#c04b4b' : '#4b8f7a'
    ctx.fillStyle = 'rgba(0,0,0,0.18)'
    ctx.beginPath()
    ctx.arc(0, 2, 13, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(0, 0, 12, 0, Math.PI * 2)
    ctx.fill()
    // 眼睛
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(4, -4, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#222'
    ctx.beginPath()
    ctx.arc(5, -4, 2, 0, Math.PI * 2)
    ctx.fill()
    // 血条
    ctx.fillStyle = 'rgba(0,0,0,0.35)'
    ctx.fillRect(-13, -20, 26, 4)
    ctx.fillStyle = '#e0553f'
    ctx.fillRect(-13, -20, 26 * (m.hp / m.maxHp), 4)
    // 瞄准建筑提示点
    if (m.targetId) {
      ctx.fillStyle = 'rgba(255,120,80,0.9)'
      ctx.beginPath()
      ctx.arc(0, 18, 2.5, 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.restore()
  }
}

function drawProjectiles(ctx: CanvasRenderingContext2D, state: GameState) {
  for (const p of state.projectiles) {
    ctx.save()
    ctx.fillStyle = '#f7d24a'
    ctx.beginPath()
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(247,210,74,0.5)'
    ctx.beginPath()
    ctx.arc(p.x - p.vx * 0.02, p.y - p.vy * 0.02, 7, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
}

function drawTrain(ctx: CanvasRenderingContext2D, state: GameState) {
  const t = state.train
  const pos = {
    x: FIELD.width / 2 + TRACK.rx * Math.cos(t.angle),
    y: FIELD.height / 2 + TRACK.ry * Math.sin(t.angle),
  }
  ctx.save()
  ctx.translate(pos.x, pos.y)
  const boosting = t.boostTimer > 0
  // 车头方向（沿轨道切线）
  ctx.rotate(t.angle + Math.PI / 2)
  ctx.fillStyle = 'rgba(0,0,0,0.2)'
  roundRect(ctx, -16, -10, 32, 46, 8)
  ctx.fill()
  ctx.fillStyle = '#5a7fa8'
  roundRect(ctx, -14, -14, 28, 34, 8)
  ctx.fill()
  ctx.strokeStyle = '#3f5c8a'
  ctx.lineWidth = 2
  ctx.stroke()
  // 烟囱
  ctx.fillStyle = '#3f5c8a'
  ctx.fillRect(-6, -24, 12, 12)
  // 烟/蒸汽
  if (boosting) {
    ctx.fillStyle = 'rgba(255,255,255,0.7)'
    ctx.beginPath()
    ctx.arc(0, -32, 8, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.restore()
}