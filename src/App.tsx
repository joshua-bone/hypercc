import { useEffect, useMemo, useRef, useState } from 'react'
import { geodesicEval } from './hyper/geodesic'
import { carveMaze, buildWallPolylines } from './hyper/maze'
import { mulberry32 } from './hyper/random'
import { mobiusAdd, toViewSpace } from './hyper/poincare'
import { generateTiling, pointInCell, type Cell } from './hyper/tiling'
import { norm, scale, type Vec2 } from './hyper/vec2'

type World = {
  cells: Cell[]
  wallPolylines: Vec2[][]
}

type Keys = {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
}

function makeWorld(seed: number): World {
  const cells = generateTiling({
    p: 7,
    q: 3,
    maxCells: 240,
    maxCenterRadius: 0.97,
  })

  carveMaze(cells, mulberry32(seed))
  const wallPolylines = buildWallPolylines(cells, 14)
  return { cells, wallPolylines }
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })
  const keysRef = useRef<Keys>({ up: false, down: false, left: false, right: false })

  const playerRef = useRef<Vec2>({ x: 0, y: 0 })
  const cellRef = useRef<number>(0)

  const [seed, setSeed] = useState(() => (Date.now() >>> 0) ^ 0x9e3779b9)
  const world = useMemo(() => makeWorld(seed), [seed])

  useEffect(() => {
    playerRef.current = { x: 0, y: 0 }
    cellRef.current = 0
  }, [seed])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') keysRef.current.up = true
      else if (e.key === 'ArrowDown') keysRef.current.down = true
      else if (e.key === 'ArrowLeft') keysRef.current.left = true
      else if (e.key === 'ArrowRight') keysRef.current.right = true
      else if (e.key.toLowerCase() === 'r') setSeed((Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0))
      else return

      e.preventDefault()
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') keysRef.current.up = false
      else if (e.key === 'ArrowDown') keysRef.current.down = false
      else if (e.key === 'ArrowLeft') keysRef.current.left = false
      else if (e.key === 'ArrowRight') keysRef.current.right = false
      else return

      e.preventDefault()
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      sizeRef.current = { w: rect.width, h: rect.height, dpr }
      canvas.width = Math.max(1, Math.round(rect.width * dpr))
      canvas.height = Math.max(1, Math.round(rect.height * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
    }

    resize()
    window.addEventListener('resize', resize)

    let raf = 0
    let lastT = performance.now()

    const stepPlayer = (dt: number) => {
      const keys = keysRef.current
      const dir = {
        x: (keys.right ? 1 : 0) - (keys.left ? 1 : 0),
        y: (keys.up ? 1 : 0) - (keys.down ? 1 : 0),
      }
      if (dir.x === 0 && dir.y === 0) return

      const speed = 0.65
      const delta = scale(norm(dir), speed * dt)

      const currentCellId = cellRef.current
      const current = world.cells[currentCellId]

      const player = playerRef.current
      const candidate = mobiusAdd(player, delta)

      const insideEps = 1e-6
      if (pointInCell(current, candidate, insideEps)) {
        playerRef.current = candidate
        return
      }

      let worstSide = -1
      let worstVal = -insideEps
      for (let i = 0; i < current.edges.length; i++) {
        const e = current.edges[i]
        const v = geodesicEval(e.geodesic, candidate) * e.interiorSign
        if (v < worstVal) {
          worstVal = v
          worstSide = i
        }
      }

      if (worstSide < 0) return

      const blocked = current.walls[worstSide] || !current.neighbors[worstSide]
      if (blocked) return

      const next = current.neighbors[worstSide]
      if (!next) return
      if (!pointInCell(world.cells[next.id], candidate, insideEps)) return
      cellRef.current = next.id
      playerRef.current = candidate
    }

    const draw = () => {
      const { w, h } = sizeRef.current
      const r = Math.max(1, Math.min(w, h) * 0.46)
      const cx = w / 2
      const cy = h / 2

      ctx.fillStyle = '#0b0f14'
      ctx.fillRect(0, 0, w, h)

      // Disk boundary
      ctx.strokeStyle = 'rgba(230, 237, 243, 0.35)'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, 2 * Math.PI)
      ctx.stroke()

      const player = playerRef.current

      // Walls
      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, 2 * Math.PI)
      ctx.clip()

      ctx.strokeStyle = 'rgba(230, 237, 243, 0.9)'
      ctx.lineWidth = 1.5
      for (const poly of world.wallPolylines) {
        if (poly.length === 0) continue
        ctx.beginPath()
        let started = false
        for (const wp of poly) {
          const p = toViewSpace(wp, player)
          const x = cx + p.x * r
          const y = cy - p.y * r
          if (!started) {
            ctx.moveTo(x, y)
            started = true
          } else {
            ctx.lineTo(x, y)
          }
        }
        if (started) ctx.stroke()
      }
      ctx.restore()

      // Player marker at center of view
      ctx.fillStyle = '#ffd166'
      ctx.beginPath()
      ctx.arc(cx, cy, 4, 0, 2 * Math.PI)
      ctx.fill()
    }

    const tick = (t: number) => {
      const dt = Math.min(0.05, (t - lastT) / 1000)
      lastT = t
      stepPlayer(dt)
      draw()
      raf = requestAnimationFrame(tick)
    }

    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [world])

  return (
    <div className="app">
      <canvas ref={canvasRef} className="mazeCanvas" />
      <div className="hud">
        <div className="hudTitle">Hyperbolic Maze</div>
        <div className="hudLine">Arrow keys to move. Press R to regenerate.</div>
        <div className="hudLine">Cells: {world.cells.length}</div>
        <button className="hudButton" onClick={() => setSeed((Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0))}>
          Regenerate
        </button>
      </div>
    </div>
  )
}
