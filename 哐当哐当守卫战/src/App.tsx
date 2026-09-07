import { useRef } from 'react'
import GameView from './components/GameView'
import { GameEngine } from './game/engine'
import './App.css'

function App() {
  const engineRef = useRef<GameEngine | null>(null)

  return (
    <div className="app-shell">
      <header className="app-header">
        <span className="app-title">🚂 哐当哐当守卫战</span>
        <span className="app-sub">昼夜经营 × 列车守城</span>
      </header>
      <GameView engineRef={engineRef} />
      <footer className="app-footer">
        铁轨内是安全区 · 铁轨外是危险区 · 守住 10 个夜晚
      </footer>
    </div>
  )
}

export default App