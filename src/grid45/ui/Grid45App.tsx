import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createGrid45Session, type Grid45Session } from '../application/createGrid45Session'
import { renderGrid45Scene, resizeCanvasToDisplaySize, pickGrid45CellAtPoint, type Grid45RenderOptions } from '../adapters/canvasRenderer'
import { createIntervalClock } from '../adapters/intervalClock'
import { attachKeyboardIntent } from '../adapters/keyboardIntent'
import { loadGrid45Tileset, type Grid45Tileset } from '../adapters/spriteAtlas'
import { resolveCameraRelativeExits } from '../domain/directions'
import { createInitialGameState } from '../domain/engine'
import { keyColors, type Direction, type GameState, type KeyColor, type MazeWorld, type MoveIntent } from '../domain/model'
import { defaultAntCount, defaultPinkBallCount, defaultTeethCount, defaultWorldSize, worldSizes, type WorldSize } from '../domain/world'
import { cloneMazeWorld, downloadWorldJson, paintEditorWorld, rotateDirection, type EditorPaintTool } from './editorHelpers'

const MIN_MONSTER_COUNT = 0
const MAX_MONSTER_COUNT = 128

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

const editorPalette: Array<{ tool: EditorPaintTool; label: string }> = [
  { tool: 'floor', label: 'Floor' },
  { tool: 'wall', label: 'Wall' },
  { tool: 'start', label: 'Start' },
  { tool: 'chip', label: 'Chip' },
  { tool: 'socket', label: 'Socket' },
  { tool: 'exit', label: 'Exit' },
  { tool: 'key-blue', label: 'Blue Key' },
  { tool: 'key-red', label: 'Red Key' },
  { tool: 'key-green', label: 'Green Key' },
  { tool: 'key-yellow', label: 'Yellow Key' },
  { tool: 'door-blue', label: 'Blue Door' },
  { tool: 'door-red', label: 'Red Door' },
  { tool: 'door-green', label: 'Green Door' },
  { tool: 'door-yellow', label: 'Yellow Door' },
  { tool: 'ant', label: 'Ant' },
  { tool: 'pink-ball', label: 'Pink Ball' },
  { tool: 'teeth', label: 'Teeth' },
  { tool: 'none', label: 'Clear Feature' },
]

function isMobTool(tool: EditorPaintTool): tool is 'ant' | 'pink-ball' | 'teeth' {
  return tool === 'ant' || tool === 'pink-ball' || tool === 'teeth'
}

function normalizeAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle))
}

function nextSeed(): number {
  return (Date.now() >>> 0) ^ ((Math.random() * 0xffffffff) >>> 0)
}

function parseSeedInput(seedInput: string): number | undefined {
  const trimmed = seedInput.trim()
  if (trimmed.length === 0) return undefined

  const parsed = Number(trimmed)
  if (!Number.isFinite(parsed)) return undefined

  return Math.floor(parsed) >>> 0
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
    initialTeethCount: defaultTeethCount,
  })
}

function createPlaytestSession(world: MazeWorld): Grid45Session {
  return createGrid45Session({
    clock: createIntervalClock(10),
    seedPort: {
      nextSeed,
    },
    initialWorld: cloneMazeWorld(world),
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
  const playAgainButtonRef = useRef<HTMLButtonElement | null>(null)
  const [playSession] = useState(createSession)
  const [playSnapshot, setPlaySnapshot] = useState<GameState>(() => playSession.getSnapshot())
  const [playtestSession, setPlaytestSession] = useState<Grid45Session | null>(null)
  const [playtestSnapshot, setPlaytestSnapshot] = useState<GameState | null>(null)
  const [tileset, setTileset] = useState<Grid45Tileset | null>(null)
  const [activeTab, setActiveTab] = useState<'play' | 'editor'>('play')
  const [showDagValidator, setShowDagValidator] = useState(false)
  const [worldSize, setWorldSize] = useState<WorldSize>(defaultWorldSize)
  const [antCount, setAntCount] = useState<number>(defaultAntCount)
  const [pinkBallCount, setPinkBallCount] = useState<number>(defaultPinkBallCount)
  const [teethCount, setTeethCount] = useState<number>(defaultTeethCount)
  const [seedInput, setSeedInput] = useState('')
  const [editorWorld, setEditorWorld] = useState<MazeWorld>(() => cloneMazeWorld(playSession.getSnapshot().world))
  const [editorCameraCellId, setEditorCameraCellId] = useState<number>(() => playSession.getSnapshot().world.startCellId)
  const [editorCameraAngle, setEditorCameraAngle] = useState(0)
  const [editorSelectedCellId, setEditorSelectedCellId] = useState<number>(() => playSession.getSnapshot().world.startCellId)
  const [editorTool, setEditorTool] = useState<EditorPaintTool>('floor')
  const [editorMobFacing, setEditorMobFacing] = useState<Direction>('north')
  const [editorIntent, setEditorIntent] = useState<MoveIntent>('stay')
  const [editorRotateIntent, setEditorRotateIntent] = useState<-1 | 0 | 1>(0)
  const showDevToggle = import.meta.env.DEV
  const showPlayEndOverlay = activeTab === 'play' && (playSnapshot.levelComplete || playSnapshot.playerDead)
  const endTitle = playSnapshot.levelComplete ? 'You Win!' : 'You Died!'
  const editorPreviewState = createInitialGameState(editorWorld)
  const currentSceneState = activeTab === 'play' ? playSnapshot : playtestSnapshot ?? editorPreviewState
  const currentRenderOptions: Grid45RenderOptions | undefined =
    activeTab === 'editor' && playtestSnapshot === null
      ? {
          cameraCellId: editorCameraCellId,
          cameraAngle: editorCameraAngle,
          highlightCellId: editorSelectedCellId,
        }
      : undefined
  const totalChips = playSnapshot.world.chipCellIds.length
  const chipsRemaining = playSnapshot.remainingChipCellIds.size
  const chipsCollected = totalChips - chipsRemaining
  const antTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'ant').length
  const pinkBallTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'pink-ball').length
  const teethTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'teeth').length
  const editorMonsterTotal = editorWorld.initialMonsters.length

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
    const unsubscribe = playSession.subscribe(setPlaySnapshot)
    return () => {
      unsubscribe()
      playSession.stop()
    }
  }, [playSession])

  useEffect(() => {
    if (!playtestSession) return

    setPlaytestSnapshot(playtestSession.getSnapshot())
    const unsubscribe = playtestSession.subscribe(setPlaytestSnapshot)
    return () => {
      unsubscribe()
      playtestSession.stop()
    }
  }, [playtestSession])

  useEffect(() => {
    if (activeTab !== 'play') playSession.stop()
  }, [activeTab, playSession])

  useEffect(() => {
    if (activeTab === 'editor' || !playtestSession) return
    playtestSession.stop()
    setPlaytestSession(null)
    setPlaytestSnapshot(null)
  }, [activeTab, playtestSession])

  useEffect(() => {
    if (!playtestSession || !playtestSnapshot) return
    if (!playtestSnapshot.levelComplete && !playtestSnapshot.playerDead) return

    playtestSession.stop()
    setPlaytestSession(null)
    setPlaytestSnapshot(null)
  }, [playtestSession, playtestSnapshot])

  useEffect(() => {
    if (activeTab === 'play') {
      return attachKeyboardIntent(window, playSession.setIntent)
    }

    if (playtestSession) {
      const detachKeyboard = attachKeyboardIntent(window, playtestSession.setIntent)
      const onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return
        event.preventDefault()
        playtestSession.stop()
        setPlaytestSession(null)
        setPlaytestSnapshot(null)
      }

      window.addEventListener('keydown', onKeyDown, { passive: false })
      return () => {
        detachKeyboard()
        window.removeEventListener('keydown', onKeyDown)
      }
    }

    const detachKeyboard = attachKeyboardIntent(window, setEditorIntent)
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault()
        setEditorRotateIntent(-1)
      } else if (event.key === 'e' || event.key === 'E') {
        event.preventDefault()
        setEditorRotateIntent(1)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'q' || event.key === 'Q') {
        setEditorRotateIntent((value) => (value === -1 ? 0 : value))
      } else if (event.key === 'e' || event.key === 'E') {
        setEditorRotateIntent((value) => (value === 1 ? 0 : value))
      }
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    window.addEventListener('keyup', onKeyUp, { passive: false })
    return () => {
      detachKeyboard()
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeTab, playSession, playtestSession])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const render = () => {
      const { width, height } = resizeCanvasToDisplaySize(canvas, ctx)
      renderGrid45Scene(ctx, currentSceneState, width, height, tileset, currentRenderOptions)
    }

    drawRef.current = render
    render()

    window.addEventListener('resize', render)
    return () => {
      drawRef.current = null
      window.removeEventListener('resize', render)
    }
  }, [currentRenderOptions, currentSceneState, tileset])

  useEffect(() => {
    drawRef.current?.()
  }, [currentSceneState, currentRenderOptions, tileset])

  useEffect(() => {
    if (!showPlayEndOverlay) return

    playAgainButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
      const isEnter = event.code === 'Enter' || event.key === 'Enter'
      if (!isSpace && !isEnter) return
      event.preventDefault()
      playSession.restart()
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [showPlayEndOverlay, playSession])

  useEffect(() => {
    if (activeTab !== 'editor' || playtestSession) return
    if (editorIntent === 'stay' && editorRotateIntent === 0) return

    const intervalId = window.setInterval(() => {
      if (editorIntent !== 'stay') {
        const nextCellId = resolveCameraRelativeExits({
          cameraAngle: editorCameraAngle,
          playerCellId: editorCameraCellId,
          world: editorWorld,
        })[editorIntent]
        if (nextCellId !== null) {
          setEditorCameraCellId(nextCellId)
          setEditorSelectedCellId(nextCellId)
        }
      }

      if (editorRotateIntent !== 0) {
        setEditorCameraAngle((angle) => normalizeAngle(angle + editorRotateIntent * 0.085))
      }
    }, 48)

    return () => {
      window.clearInterval(intervalId)
    }
  }, [activeTab, playtestSession, editorIntent, editorRotateIntent, editorCameraAngle, editorCameraCellId, editorWorld])

  const generateNewMap = () => {
    playSession.reset(worldSize, antCount, pinkBallCount, teethCount, parseSeedInput(seedInput))
    setSeedInput('')
  }

  const startEditorPlaytest = () => {
    if (playtestSession) return
    const normalizedWorld = cloneMazeWorld(editorWorld)
    setEditorWorld(normalizedWorld)
    setPlaytestSession(createPlaytestSession(normalizedWorld))
    setPlaytestSnapshot(null)
  }

  const paintSelectedCell = (cellId: number) => {
    setEditorSelectedCellId(cellId)
    setEditorWorld((world) => paintEditorWorld(world, cellId, editorTool, editorMobFacing))
    if (editorTool === 'start') setEditorCameraCellId(cellId)
  }

  const handleEditorPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeTab !== 'editor' || playtestSession) return
    if (event.type === 'pointermove' && event.buttons !== 1) return

    const canvas = canvasRef.current
    if (!canvas) return

    const rect = canvas.getBoundingClientRect()
    const cellId = pickGrid45CellAtPoint(
      editorPreviewState,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
      {
        cameraCellId: editorCameraCellId,
        cameraAngle: editorCameraAngle,
      },
    )

    if (cellId === null) return
    paintSelectedCell(cellId)
  }

  return (
    <div className="grid45App">
      <div className="grid45Nav">
        <div className="grid45NavBrand">Hyperbolic CC</div>
        <div className="grid45NavTabs">
          <button
            className={`grid45NavTab${activeTab === 'play' ? ' grid45NavTabActive' : ''}`}
            type="button"
            onClick={() => setActiveTab('play')}
          >
            Play
          </button>
          <button
            className={`grid45NavTab${activeTab === 'editor' ? ' grid45NavTabActive' : ''}`}
            type="button"
            onClick={() => setActiveTab('editor')}
          >
            Editor
          </button>
        </div>
      </div>

      <canvas
        ref={canvasRef}
        className="grid45Canvas"
        onPointerDown={handleEditorPointer}
        onPointerMove={handleEditorPointer}
      />
      {showPlayEndOverlay ? (
        <div className={`grid45EndOverlay${playSnapshot.playerDead ? ' grid45EndOverlayLose' : ''}`}>
          <div className="grid45EndTitle">{endTitle}</div>
          <div className="grid45EndCopy">Press Space or Enter to play again on this same map.</div>
          <div className="grid45EndActions">
            <button ref={playAgainButtonRef} className="grid45Button grid45ButtonPrimary" type="button" onClick={() => playSession.restart()}>
              Play Again
            </button>
            <button
              className="grid45Button"
              type="button"
              onClick={generateNewMap}
            >
              Play Another
            </button>
          </div>
        </div>
      ) : null}
      {activeTab === 'play' && showDevToggle && showDagValidator ? <DagValidatorPanel snapshot={playSnapshot} /> : null}

      {activeTab === 'play' ? (
        <div className="grid45Hud">
          <div className="grid45Eyebrow">Hyperbolic CC</div>
          <div className="grid45Line">Collect every chip, pass through the socket, then reach the exit.</div>
          <div className="grid45Line">Monsters are placed randomly and may render maps unsolveable.</div>
          <div className="grid45Line">Arrow keys or WASD move. Restart replays this maze; Generate builds a new one.</div>
          <div className="grid45Metrics">Tick {playSnapshot.tick}</div>
          <div className="grid45Metrics">State: {describeOutcome(playSnapshot)}</div>
          <div className="grid45Metrics">Chips: {chipsCollected} / {totalChips}</div>
          <div className="grid45Metrics">Keys: {formatKeyInventory(playSnapshot)}</div>
          <div className="grid45Metrics">Ants: {antTotal}</div>
          <div className="grid45Metrics">Pink Balls: {pinkBallTotal}</div>
          <div className="grid45Metrics">Teeth: {teethTotal}</div>
          <div className="grid45Metrics">Seed: {playSnapshot.world.seed}</div>
          <div className="grid45Metrics">Exit: {playSnapshot.levelComplete ? 'reached' : 'active'}</div>
          <div className="grid45Metrics">Move lock: {playSnapshot.recoveryTicks > 0 ? 'armed for next tick' : 'ready'}</div>
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
            <button className="grid45Button" onClick={() => playSession.restart()}>
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
            <label className="grid45SelectLabel">
              <span>Seed</span>
              <input
                className="grid45SeedInput"
                type="text"
                inputMode="numeric"
                placeholder="Random"
                value={seedInput}
                onChange={(event) => setSeedInput(event.target.value)}
              />
            </label>
            <label className="grid45SelectLabel grid45AntControl">
              <span>Ants</span>
              <div className="grid45AntRow">
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setAntCount((count) => Math.max(MIN_MONSTER_COUNT, count - 1))}>
                  -
                </button>
                <input
                  className="grid45Slider"
                  type="range"
                  min={MIN_MONSTER_COUNT}
                  max={MAX_MONSTER_COUNT}
                  step={1}
                  value={antCount}
                  onChange={(event) => setAntCount(Number(event.target.value))}
                />
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setAntCount((count) => Math.min(MAX_MONSTER_COUNT, count + 1))}>
                  +
                </button>
              </div>
              <span className="grid45AntValue">{antCount}</span>
            </label>
            <label className="grid45SelectLabel grid45AntControl">
              <span>Pink Balls</span>
              <div className="grid45AntRow">
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setPinkBallCount((count) => Math.max(MIN_MONSTER_COUNT, count - 1))}>
                  -
                </button>
                <input
                  className="grid45Slider"
                  type="range"
                  min={MIN_MONSTER_COUNT}
                  max={MAX_MONSTER_COUNT}
                  step={1}
                  value={pinkBallCount}
                  onChange={(event) => setPinkBallCount(Number(event.target.value))}
                />
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setPinkBallCount((count) => Math.min(MAX_MONSTER_COUNT, count + 1))}>
                  +
                </button>
              </div>
              <span className="grid45AntValue">{pinkBallCount}</span>
            </label>
            <label className="grid45SelectLabel grid45AntControl">
              <span>Teeth</span>
              <div className="grid45AntRow">
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setTeethCount((count) => Math.max(MIN_MONSTER_COUNT, count - 1))}>
                  -
                </button>
                <input
                  className="grid45Slider"
                  type="range"
                  min={MIN_MONSTER_COUNT}
                  max={MAX_MONSTER_COUNT}
                  step={1}
                  value={teethCount}
                  onChange={(event) => setTeethCount(Number(event.target.value))}
                />
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setTeethCount((count) => Math.min(MAX_MONSTER_COUNT, count + 1))}>
                  +
                </button>
              </div>
              <span className="grid45AntValue">{teethCount}</span>
            </label>
            <button className="grid45Button" onClick={generateNewMap}>
              Generate Maze
            </button>
          </div>
        </div>
      ) : (
        <div className="grid45EditorPanel">
          <div className="grid45Eyebrow">Editor</div>
          {playtestSnapshot ? (
            <>
              <div className="grid45Line">Playtest running. Win, lose, or press ESC to return to the editor.</div>
              <div className="grid45Metrics">Tick: {playtestSnapshot.tick}</div>
              <div className="grid45Metrics">State: {describeOutcome(playtestSnapshot)}</div>
              <div className="grid45Metrics">Chips: {playtestSnapshot.world.chipCellIds.length - playtestSnapshot.remainingChipCellIds.size} / {playtestSnapshot.world.chipCellIds.length}</div>
              <div className="grid45Metrics">Keys: {formatKeyInventory(playtestSnapshot)}</div>
              <div className="grid45Controls">
                <button
                  className="grid45Button"
                  type="button"
                  onClick={() => {
                    if (!playtestSession) return
                    playtestSession.stop()
                    setPlaytestSession(null)
                    setPlaytestSnapshot(null)
                  }}
                >
                  Return to Editor
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="grid45Line">
                Click or drag to paint. Arrow keys move the editor camera. Q / E rotate the world. ESC exits playtest.
              </div>
              <div className="grid45Metrics">Seed: {editorWorld.seed}</div>
              <div className="grid45Metrics">Start Cell: {editorWorld.startCellId}</div>
              <div className="grid45Metrics">Selected Cell: {editorSelectedCellId}</div>
              <div className="grid45Metrics">Monsters: {editorMonsterTotal}</div>
              <div className="grid45Metrics">Mode: Edit</div>
              <div className="grid45Controls">
                <button className="grid45Button grid45ButtonPrimary" type="button" onClick={startEditorPlaytest}>
                  Playtest
                </button>
                <button className="grid45Button" type="button" onClick={() => downloadWorldJson(editorWorld)}>
                  Download JSON
                </button>
                <button
                  className="grid45Button"
                  type="button"
                  onClick={() => {
                    const nextWorld = cloneMazeWorld(playSnapshot.world)
                    setEditorWorld(nextWorld)
                    setEditorCameraCellId(nextWorld.startCellId)
                    setEditorSelectedCellId(nextWorld.startCellId)
                    setEditorCameraAngle(0)
                  }}
                >
                  Use Current Play Map
                </button>
              </div>
              <div className="grid45Palette">
                {editorPalette.map((item) => (
                  <button
                    key={item.tool}
                    className={`grid45PaletteButton${editorTool === item.tool ? ' grid45PaletteButtonActive' : ''}`}
                    type="button"
                    onClick={() => setEditorTool(item.tool)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {!playtestSnapshot && isMobTool(editorTool) ? (
            <div className="grid45Controls">
              <div className="grid45Metrics">Mob Facing: {editorMobFacing}</div>
              <button className="grid45Button grid45StepButton" type="button" onClick={() => setEditorMobFacing((direction) => rotateDirection(direction, -1))}>
                ↺
              </button>
              <button className="grid45Button grid45StepButton" type="button" onClick={() => setEditorMobFacing((direction) => rotateDirection(direction, 1))}>
                ↻
              </button>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}
