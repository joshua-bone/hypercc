import { useEffect, useRef, useState } from 'react'
import { createGrid45Session, type Grid45Session } from '../application/createGrid45Session'
import { renderGrid45Scene, resizeCanvasToDisplaySize } from '../adapters/canvasRenderer'
import { createIntervalClock } from '../adapters/intervalClock'
import { attachKeyboardIntent } from '../adapters/keyboardIntent'
import { loadGrid45Tileset, type Grid45Tileset } from '../adapters/spriteAtlas'
import type { GameState } from '../domain/model'

function nextSeed(): number {
  return (Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)
}

function createSession(): Grid45Session {
  return createGrid45Session({
    clock: createIntervalClock(10),
    seedPort: {
      nextSeed,
    },
  })
}

function describeOutcome(snapshot: GameState): string {
  if (snapshot.levelComplete) return 'You Win!'
  if (snapshot.lastOutcome === 'completed') return 'You Win!'
  if (snapshot.lastOutcome === 'locked') return 'cooldown tick'
  if (snapshot.lastOutcome === 'moved') return `moved ${snapshot.lastIntent}`
  if (snapshot.lastOutcome === 'blocked') return `blocked ${snapshot.lastIntent}`
  return 'standing by'
}

export default function Grid45App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const [session] = useState(createSession)
  const [snapshot, setSnapshot] = useState<GameState>(() => session.getSnapshot())
  const [tileset, setTileset] = useState<Grid45Tileset | null>(null)
  const totalChips = snapshot.world.chipCellIds.length
  const chipsRemaining = snapshot.remainingChipCellIds.size
  const chipsCollected = totalChips - chipsRemaining

  useEffect(() => {
    let active = true

    loadGrid45Tileset()
      .then((nextTileset) => {
        if (active) setTileset(nextTileset)
      })
      .catch((error) => {
        console.error('Failed to load tileset', error)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    const unsubscribe = session.subscribe(setSnapshot)
    const detachKeyboard = attachKeyboardIntent(window, session.setIntent)
    session.start()

    return () => {
      detachKeyboard()
      unsubscribe()
      session.stop()
    }
  }, [session])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const render = () => {
      const { width, height } = resizeCanvasToDisplaySize(canvas, ctx)
      renderGrid45Scene(ctx, session.getSnapshot(), width, height, tileset)
    }

    drawRef.current = render
    render()

    window.addEventListener('resize', render)
    return () => {
      drawRef.current = null
      window.removeEventListener('resize', render)
    }
  }, [session, tileset])

  useEffect(() => {
    drawRef.current?.()
  }, [snapshot, tileset])

  return (
    <div className="grid45App">
      <canvas ref={canvasRef} className="grid45Canvas" />
      {snapshot.levelComplete ? <div className="grid45Win">You Win!</div> : null}
      <div className="grid45Hud">
        <div className="grid45Eyebrow">Hyperbolic CC</div>
        <div className="grid45Line">Collect every chip, pass through the socket, then reach the exit.</div>
        <div className="grid45Line">Arrow keys or WASD move. Regenerate builds a new maze.</div>
        <div className="grid45Metrics">Tick {snapshot.tick}</div>
        <div className="grid45Metrics">State: {describeOutcome(snapshot)}</div>
        <div className="grid45Metrics">Chips: {chipsCollected} / {totalChips}</div>
        <div className="grid45Metrics">Exit: {snapshot.levelComplete ? 'reached' : 'active'}</div>
        <div className="grid45Metrics">Move lock: {snapshot.recoveryTicks > 0 ? 'armed for next tick' : 'ready'}</div>
        <button className="grid45Button" onClick={() => session.reset()}>
          Regenerate Maze
        </button>
      </div>
    </div>
  )
}
