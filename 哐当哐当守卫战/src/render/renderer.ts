// ============================================================
//  渲染层：把 GameState 画到 canvas（纯函数，无副作用保存）
//  扁平卡通占位美术：建筑/怪物用圆角几何 + 简单绘制，改起来快
// ============================================================
import { FIELD, GRID, CENTER as CENTER_CFG } from '../config/game'
import { MONSTERS } from '../config/units'
import type { GameState, Phase, BuildingKind, Building } from '../game/types'
import { gridOrigin, cellCenter, CENTER_INDEX, isRailCell, isSafeCell, adjacentToRail, trainPos } from '../game/engine'

const COLORS: Record<BuildingKind, { main: string; dark: string; label: string }> = {
  mine: { main: '#8d9a5a', dark: '#6b7842', label: '矿' },
  furnace: { main: '#e0834f', dark: '#b9622f', label: '冶' },
  turret: { main: '#5b7db1', dark: '#3f5c8a', label: '炮' },
  booster: { main: '#7b5ca6', dark: '#5a3f86', label: '核' },
  platform: { main: '#b58a53', dark: '#8a6238', label: '站' },
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
  drawZones(ctx)
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

/** 区域底色：铁轨内为安全区（偏绿），铁轨外为危险区（偏红），提示摆位风险 */
function drawZones(ctx: CanvasRenderingContext2D) {
  const o = gridOrigin()
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const index = r * GRID.cols + c
      if (isRailCell(index)) continue
      const x = o.x + c * GRID.pitch
      const y = o.y + r * GRID.pitch
      ctx.fillStyle = isSafeCell(index) ? 'rgba(105,190,130,0.10)' : 'rgba(220,100,80,0.10)'
      ctx.fillRect(x, y, GRID.cellSize, GRID.cellSize)
    }
  }
}

function drawTrack(ctx: CanvasRenderingContext2D) {
  const o = gridOrigin()
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const index = r * GRID.cols + c
      if (!isRailCell(index)) continue
      const x = o.x + c * GRID.pitch
      const y = o.y + r * GRID.pitch
      // 铁轨格底色
      ctx.fillStyle = 'rgba(126,108,74,0.9)'
      ctx.fillRect(x, y, GRID.cellSize, GRID.cellSize)
      // 枕木（虚线内框）
      ctx.strokeStyle = 'rgba(255,255,255,0.35)'
      ctx.lineWidth = 2
      ctx.setLineDash([9, 7])
      ctx.strokeRect(x + 7, y + 7, GRID.cellSize - 14, GRID.cellSize - 14)
      ctx.setLineDash([])
      // 两条钢轨（贯穿整格）
      ctx.strokeStyle = 'rgba(55,46,32,0.95)'
      ctx.lineWidth = 4
      ctx.beginPath()
      ctx.moveTo(x + 12, y + 26)
      ctx.lineTo(x + GRID.cellSize - 12, y + 26)
      ctx.moveTo(x + 12, y + GRID.cellSize - 26)
      ctx.lineTo(x + GRID.cellSize - 12, y + GRID.cellSize - 26)
      ctx.stroke()
    }
  }
}

function drawGrid(ctx: CanvasRenderingContext2D, state: GameState) {
  const o = gridOrigin()
  const placing = state.placing
  for (let r = 0; r < GRID.rows; r++) {
    for (let c = 0; c < GRID.cols; c++) {
      const index = r * GRID.cols + c
      const x = o.x + c * GRID.pitch
      const y = o.y + r * GRID.pitch
      if (placing) {
        let style = 'ok'
        const occupied = state.buildings.some(
          (b) => Math.abs(b.gridX - (x + GRID.cellSize / 2)) < 1 && Math.abs(b.gridY - (y + GRID.cellSize / 2)) < 1,
        )
        if (index === CENTER_INDEX) style = 'blocked'
        else if (isRailCell(index)) style = 'rail'
        else if (occupied) style = 'occupied'
        else if (placing === 'platform' && !adjacentToRail(index)) style = 'invalid'
        switch (style) {
          case 'ok':
            ctx.fillStyle = 'rgba(120,200,120,0.18)'
            break
          case 'invalid':
            ctx.fillStyle = 'rgba(255,80,80,0.16)'
            break
          default:
            ctx.fillStyle = 'rgba(120,130,140,0.10)'
        }
        ctx.fillRect(x, y, GRID.cellSize, GRID.cellSize)
      }
      ctx.strokeStyle = 'rgba(120,150,120,0.25)'
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, GRID.cellSize, GRID.cellSize)
    }
  }
}

function drawCenter(ctx: CanvasRenderingContext2D, state: GameState) {
  const ctr = cellCenter(CENTER_INDEX)
  ctx.save()
  ctx.translate(ctr.x, ctr.y)
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
    if (b.kind === 'platform') {
      drawPlatform(ctx, b)
      continue
    }
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

/** 站台：紧邻铁轨的装卸码头，无生命、不被攻击，仅渲染外观 */
function drawPlatform(ctx: CanvasRenderingContext2D, b: Building) {
  ctx.save()
  ctx.translate(b.gridX, b.gridY)
  // 阴影
  ctx.fillStyle = 'rgba(0,0,0,0.12)'
  roundRect(ctx, -25, -19, 50, 38, 7)
  ctx.fill()
  // 木质站台面
  ctx.fillStyle = '#b58a53'
  roundRect(ctx, -23, -15, 46, 30, 7)
  ctx.fill()
  ctx.strokeStyle = '#8a6238'
  ctx.lineWidth = 3
  ctx.stroke()
  // 站牌旗
  ctx.fillStyle = '#5f7f4f'
  roundRect(ctx, -6, -26, 12, 13, 3)
  ctx.fill()
  ctx.fillStyle = '#8a6238'
  ctx.fillRect(-7, -13, 14, 3)
  // 中央"站"字
  ctx.fillStyle = '#6b4c2c'
  ctx.font = 'bold 15px sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('站', 0, 1)
  ctx.restore()
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
  const pos = trainPos(t.t)
  // 车头朝向 = 铁轨环路切线方向
  const ahead = trainPos((t.t + 0.01) % 1)
  const heading = Math.atan2(ahead.y - pos.y, ahead.x - pos.x)
  ctx.save()
  ctx.translate(pos.x, pos.y)
  const boosting = t.boostTimer > 0
  // 车头方向（沿轨道切线）
  ctx.rotate(heading + Math.PI / 2)
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