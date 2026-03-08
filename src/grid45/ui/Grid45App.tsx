import { useEffect, useRef, useState } from 'react'
import { createGrid45Session, type Grid45Session } from '../application/createGrid45Session'
import { renderGrid45Scene, resizeCanvasToDisplaySize } from '../adapters/canvasRenderer'
import { createIntervalClock } from '../adapters/intervalClock'
import { attachKeyboardIntent } from '../adapters/keyboardIntent'
import { loadGrid45Tileset, type Grid45Tileset } from '../adapters/spriteAtlas'
import { keyColors, type GameState, type KeyColor } from '../domain/model'
import { defaultAntCount, defaultPinkBallCount, defaultWorldSize, worldSizes, type WorldSize } from '../domain/world'

const MIN_ANT_COUNT = 0
const MAX_ANT_COUNT = 128

const keyLabels: Record<KeyColor, string> = {
  blue: 'B',
  red: 'R',
  green: 'G',
  yellow: 'Y',
}

const keyColorsHex: Record<KeyColor, string> = {
  blue: '#6cb7ff',
  red: '#ff7878',
  green: '#75d98f',
  yellow: '#f2d466',
}

const worldSizeLabels: Record<WorldSize, string> = {
  tiny: 'Tiny',
  small: 'Small',
  medium: 'Medium',
  large: 'Large',
  huge: 'Huge',
}

function nextSeed(): number {
  return (Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)
}

function createSession(): Grid45Session {
  return createGrid45Session({
    clock: createIntervalClock(10),
    seedPort: {
      nextSeed,
    },
    initialWorldSize: defaultWorldSize,
    initialAntCount: defaultAntCount,
    initialPinkBallCount: defaultPinkBallCount,
  })
}

function describeOutcome(snapshot: GameState): string {
  if (snapshot.levelComplete) return 'You Win!'
  if (snapshot.playerDead) return 'You Died!'
  if (snapshot.lastOutcome === 'completed') return 'You Win!'
  if (snapshot.lastOutcome === 'dead') return 'You Died!'
  if (snapshot.lastOutcome === 'locked') return 'cooldown tick'
  if (snapshot.lastOutcome === 'moved') return `moved ${snapshot.lastIntent}`
  if (snapshot.lastOutcome === 'blocked') return `blocked ${snapshot.lastIntent}`
  return 'standing by'
}

function formatKeyInventory(snapshot: GameState): string {
  return keyColors.map((color) => `${keyLabels[color]} ${snapshot.keyInventory[color]}`).join('  ')
}

function describeGate(edge: GameState['world']['areaDag']['edges'][number]): string {
  if (edge.gate === 'socket') return 'socket'
  return edge.color ?? 'door'
}

function DagValidatorPanel({ snapshot }: { snapshot: GameState }) {
  const { nodes, edges, validation } = snapshot.world.areaDag
  const maxDepth = nodes.reduce((best, node) => Math.max(best, node.depth), 0)
  const columns = Array.from({ length: maxDepth + 1 }, () => [] as typeof nodes)

  for (const node of nodes) columns[node.depth].push(node)
  for (const column of columns) column.sort((a, b) => a.id - b.id)

  const maxRows = columns.reduce((best, column) => Math.max(best, column.length), 1)
  const horizontalGap = 152
  const verticalGap = 98
  const marginX = 76
  const marginY = 50
  const width = Math.max(360, marginX * 2 + maxDepth * horizontalGap + 100)
  const height = Math.max(180, marginY * 2 + (maxRows - 1) * verticalGap)
  const positions = new Map<number, { x: number; y: number }>()

  columns.forEach((column, depth) => {
    const startY = marginY + ((maxRows - column.length) * verticalGap) / 2
    column.forEach((node, index) => {
      positions.set(node.id, {
        x: marginX + depth * horizontalGap,
        y: startY + index * verticalGap,
      })
    })
  })

  return (
    <aside className="grid45DagPanel">
      <div className="grid45DagHeader">
        <div className="grid45DagTitle">DAG Validator</div>
        <div className={`grid45DagBadge${validation.passed ? ' grid45DagBadgePass' : ' grid45DagBadgeFail'}`}>
          {validation.passed ? 'Solvable' : 'Invalid'}
        </div>
      </div>
      <div className="grid45DagSummary">{validation.summary}</div>
      <div className="grid45DagCanvasWrap">
        <svg className="grid45DagCanvas" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Area progression graph">
          <defs>
            <marker id="grid45DagArrow" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
              <path d="M0,0 L8,4 L0,8 z" fill="#8ea2b8" />
            </marker>
          </defs>
          {edges.map((edge) => {
            const from = positions.get(edge.fromAreaId)
            const to = positions.get(edge.toAreaId)
            if (!from || !to) return null

            const stroke = edge.gate === 'socket' ? '#5ea0c6' : keyColorsHex[edge.color ?? 'yellow']
            const labelX = (from.x + to.x) / 2
            const labelY = (from.y + to.y) / 2 - 8

            return (
              <g key={`${edge.fromAreaId}-${edge.toAreaId}`}>
                <line
                  x1={from.x + 48}
                  y1={from.y}
                  x2={to.x - 48}
                  y2={to.y}
                  stroke={stroke}
                  strokeWidth="3"
                  markerEnd="url(#grid45DagArrow)"
                />
                <text x={labelX} y={labelY} textAnchor="middle" className="grid45DagEdgeText">
                  {describeGate(edge)}
                </text>
              </g>
            )
          })}
          {nodes.map((node) => {
            const position = positions.get(node.id)
            if (!position) return null

            const fill =
              node.kind === 'start' ? '#3c3322' :
              node.kind === 'final' ? '#274236' :
              '#1a222b'
            const keySummary = node.keyColors.length > 0 ? node.keyColors.map((color) => keyLabels[color]).join(',') : '-'

            return (
              <g key={node.id} transform={`translate(${position.x}, ${position.y})`}>
                <rect x="-48" y="-32" width="96" height="64" rx="14" fill={fill} stroke="#8ea2b8" strokeWidth="1.5" />
                <text x="0" y="-10" textAnchor="middle" className="grid45DagNodeTitle">{`A${node.id}`}</text>
                <text x="0" y="7" textAnchor="middle" className="grid45DagNodeMeta">{`chips ${node.chipCellIds.length}`}</text>
                <text x="0" y="22" textAnchor="middle" className="grid45DagNodeMeta">{`keys ${keySummary}`}</text>
              </g>
            )
          })}
        </svg>
      </div>
      <div className="grid45DagSteps">
        {validation.steps.map((step, index) => (
          <div key={`${index}-${step}`} className="grid45DagStep">
            {step}
          </div>
        ))}
      </div>
    </aside>
  )
}

export default function Grid45App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const [session] = useState(createSession)
  const [snapshot, setSnapshot] = useState<GameState>(() => session.getSnapshot())
  const [tileset, setTileset] = useState<Grid45Tileset | null>(null)
  const [showDagValidator, setShowDagValidator] = useState(false)
  const [worldSize, setWorldSize] = useState<WorldSize>(defaultWorldSize)
  const [antCount, setAntCount] = useState<number>(defaultAntCount)
  const [pinkBallCount, setPinkBallCount] = useState<number>(defaultPinkBallCount)
  const totalChips = snapshot.world.chipCellIds.length
  const chipsRemaining = snapshot.remainingChipCellIds.size
  const chipsCollected = totalChips - chipsRemaining
  const antTotal = snapshot.world.initialMonsters.filter((monster) => monster.kind === 'ant').length
  const pinkBallTotal = snapshot.world.initialMonsters.filter((monster) => monster.kind === 'pink-ball').length
  const showDevToggle = import.meta.env.DEV

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
      {snapshot.playerDead ? <div className="grid45Lose">You Died!</div> : null}
      {showDevToggle && showDagValidator ? <DagValidatorPanel snapshot={snapshot} /> : null}
      <div className="grid45Hud">
        <div className="grid45Eyebrow">Hyperbolic CC</div>
        <div className="grid45Line">Collect every chip, pass through the socket, then reach the exit.</div>
        <div className="grid45Line">Arrow keys or WASD move. Restart replays this maze; Generate builds a new one.</div>
        <div className="grid45Metrics">Tick {snapshot.tick}</div>
        <div className="grid45Metrics">State: {describeOutcome(snapshot)}</div>
        <div className="grid45Metrics">Chips: {chipsCollected} / {totalChips}</div>
        <div className="grid45Metrics">Keys: {formatKeyInventory(snapshot)}</div>
        <div className="grid45Metrics">Ants: {antTotal}</div>
        <div className="grid45Metrics">Pink Balls: {pinkBallTotal}</div>
        <div className="grid45Metrics">Exit: {snapshot.levelComplete ? 'reached' : 'active'}</div>
        <div className="grid45Metrics">Move lock: {snapshot.recoveryTicks > 0 ? 'armed for next tick' : 'ready'}</div>
        {showDevToggle ? (
          <label className="grid45Toggle">
            <input
              type="checkbox"
              checked={showDagValidator}
              onChange={(event) => setShowDagValidator(event.target.checked)}
            />
            <span>Dev mode</span>
          </label>
        ) : null}
        <div className="grid45Controls">
          <button className="grid45Button" onClick={() => session.restart()}>
            Restart Map
          </button>
          <label className="grid45SelectLabel">
            <span>Size</span>
            <select
              className="grid45Select"
              value={worldSize}
              onChange={(event) => setWorldSize(event.target.value as WorldSize)}
            >
              {worldSizes.map((size) => (
                <option key={size} value={size}>
                  {worldSizeLabels[size]}
                </option>
              ))}
            </select>
          </label>
          <label className="grid45SelectLabel grid45AntControl">
            <span>Ants</span>
            <div className="grid45AntRow">
              <button className="grid45Button grid45StepButton" type="button" onClick={() => setAntCount((count) => Math.max(MIN_ANT_COUNT, count - 1))}>
                -
              </button>
              <input
                className="grid45Slider"
                type="range"
                min={MIN_ANT_COUNT}
                max={MAX_ANT_COUNT}
                step={1}
                value={antCount}
                onChange={(event) => setAntCount(Number(event.target.value))}
              />
              <button className="grid45Button grid45StepButton" type="button" onClick={() => setAntCount((count) => Math.min(MAX_ANT_COUNT, count + 1))}>
                +
              </button>
            </div>
            <span className="grid45AntValue">{antCount}</span>
          </label>
          <label className="grid45SelectLabel grid45AntControl">
            <span>Pink Balls</span>
            <div className="grid45AntRow">
              <button className="grid45Button grid45StepButton" type="button" onClick={() => setPinkBallCount((count) => Math.max(MIN_ANT_COUNT, count - 1))}>
                -
              </button>
              <input
                className="grid45Slider"
                type="range"
                min={MIN_ANT_COUNT}
                max={MAX_ANT_COUNT}
                step={1}
                value={pinkBallCount}
                onChange={(event) => setPinkBallCount(Number(event.target.value))}
              />
              <button className="grid45Button grid45StepButton" type="button" onClick={() => setPinkBallCount((count) => Math.min(MAX_ANT_COUNT, count + 1))}>
                +
              </button>
            </div>
            <span className="grid45AntValue">{pinkBallCount}</span>
          </label>
          <button className="grid45Button" onClick={() => session.reset(worldSize, antCount, pinkBallCount)}>
            Generate Maze
          </button>
        </div>
      </div>
    </div>
  )
}
