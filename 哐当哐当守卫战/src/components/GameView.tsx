// ============================================================
//  主游戏组件：Canvas 渲染 + HUD 控件 + 输入处理
// ============================================================
import { useRef, useEffect, useCallback, useState } from 'react'
import { GameEngine, createInitialState, gridOrigin } from '../game/engine'
import { render } from '../render/renderer'
import { BUILDINGS } from '../config/units'
import { FIELD, GRID } from '../config/game'
import type { GameState, BuildingKind } from '../game/types'
import './GameView.css'

interface GameViewProps {
  engineRef: React.MutableRefObject<GameEngine | null>
}

export default function GameView({ engineRef }: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rafRef = useRef<number>(0)
  const lastTimeRef = useRef<number>(0)
  const [state, setState] = useState<GameState>(createInitialState())

  // 启动游戏循环
  useEffect(() => {
    const engine = new GameEngine()
    engineRef.current = engine
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')!

    // 定期同步 HUD 状态（约 5 次/秒），避免高频重渲染
    const syncHud = () => setState({ ...engine.state })
    const syncTimer = window.setInterval(syncHud, 200)

    const loop = (time: number) => {
      const dt = lastTimeRef.current ? Math.min((time - lastTimeRef.current) / 1000, 0.05) : 0.016
      lastTimeRef.current = time
      engine.update(dt)
      render(ctx, engine.state)
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(rafRef.current)
      window.clearInterval(syncTimer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 窗口点击事件——强制刷新 React 状态（用于 HUD 更新）
  const sync = useCallback(() => {
    const e = engineRef.current
    if (e) setState({ ...e.state })
  }, [engineRef])

  const handleSelect = useCallback(
    (kind: BuildingKind) => {
      engineRef.current?.selectToPlace(kind)
      sync()
    },
    [engineRef, sync],
  )

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const engine = engineRef.current
      if (!engine) return
      const rect = canvas.getBoundingClientRect()
      const scaleX = FIELD.width / rect.width
      const scaleY = FIELD.height / rect.height
      const mx = (e.clientX - rect.left) * scaleX
      const my = (e.clientY - rect.top) * scaleY
      // 映射到网格索引
      const o = gridOrigin()
      const col = Math.round((mx - o.x - GRID.cellSize / 2) / GRID.pitch)
      const row = Math.round((my - o.y - GRID.cellSize / 2) / GRID.pitch)
      if (col >= 0 && col < GRID.cols && row >= 0 && row < GRID.rows) {
        engine.place(row * GRID.cols + col)
      }
      sync()
    },
    [engineRef, sync],
  )

  const handleStartNight = useCallback(() => {
    engineRef.current?.startNight()
    sync()
  }, [engineRef, sync])

  const handleBoost = useCallback(() => {
    engineRef.current?.boost()
    sync()
  }, [engineRef, sync])

  const handleSellRaw = useCallback(() => {
    engineRef.current?.sellRaw()
    sync()
  }, [engineRef, sync])

  const handleSellProduct = useCallback(() => {
    engineRef.current?.sellProduct()
    sync()
  }, [engineRef, sync])

  const handleRestart = useCallback(() => {
    engineRef.current?.restart()
    sync()
  }, [engineRef, sync])

  // 从引擎获取最新状态
  const engineState = engineRef.current?.state ?? state
  const s = engineState

  return (
    <div className="game-view">
      {/* 顶部资源栏 */}
      <div className="hud-top">
        <div className="hud-resource">
          <span className="icon coin">💰</span>
          <span className="val">{s.coins}</span>
        </div>
        <div className="hud-resource">
          <span className="icon raw">⛏️</span>
          <span className="val">{s.raw}</span>
          <button className="sell-btn" onClick={handleSellRaw} title="低价出售基础资源">
            卖
          </button>
        </div>
        <div className="hud-resource">
          <span className="icon prod">⚙️</span>
          <span className="val">{s.product}</span>
          <button className="sell-btn" onClick={handleSellProduct} title="高价出售成品">
            卖
          </button>
        </div>
        <div className="hud-resource">
          <span className="icon steam">💨</span>
          <span className="val">{Math.floor(s.steam)}</span>
        </div>
        <div className="hud-night">
          🌙 {s.nightCount}/{10}
        </div>
      </div>

      {/* 游戏画布 */}
      <canvas
        ref={canvasRef}
        width={FIELD.width}
        height={FIELD.height}
        onClick={handleCanvasClick}
        className="game-canvas"
      />

      {/* 底部建筑面板 */}
      <div className="hud-bottom">
        {BUILDINGS.map((b) => (
          <button
            key={b.id}
            className={`build-btn ${s.placing === b.id ? 'active' : ''}`}
            onClick={() => handleSelect(b.id as BuildingKind)}
            title={b.description}
          >
            <span className="build-name">{b.name}</span>
            <span className="build-cost">💰{b.cost}</span>
          </button>
        ))}
        <button
          className="action-btn night-btn"
          onClick={handleStartNight}
          disabled={s.phase === 'night' || s.gameOver}
        >
          进入夜晚
        </button>
        <button
          className="action-btn boost-btn"
          onClick={handleBoost}
          disabled={s.phase !== 'night' || s.gameOver}
        >
          💨加速
        </button>
      </div>

      {/* 提示 Toast */}
      {s.toast && <div className="toast">{s.toast}</div>}

      {/* 游戏结束弹窗 */}
      {s.gameOver && (
        <div className="game-over-overlay">
          <div className="game-over-box">
            <h2>{s.victory ? '🎉 胜利！' : '💀 失败'}</h2>
            <p>
              守住了 {s.nightCount} / 10 个夜晚
            </p>
            <p>击杀数：{s.kills}</p>
            <button className="restart-btn" onClick={handleRestart}>
              重新开始
            </button>
          </div>
        </div>
      )}
    </div>
  )
}