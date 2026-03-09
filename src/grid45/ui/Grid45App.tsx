import { forwardRef, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createGrid45Session, type Grid45Session } from '../application/createGrid45Session'
import { computeGrid45DiskFrame, renderGrid45Scene, resizeCanvasToDisplaySize, pickGrid45CellAtPoint, type Grid45DiskFrame, type Grid45RenderOptions } from '../adapters/canvasRenderer'
import { createIntervalClock } from '../adapters/intervalClock'
import { attachKeyboardIntent } from '../adapters/keyboardIntent'
import { loadGrid45Tileset, type Grid45Tileset } from '../adapters/spriteAtlas'
import { moveCameraInView, orbitCameraAroundCenter } from '../domain/camera'
import { directionFromKey } from '../domain/directions'
import { createInitialGameState } from '../domain/engine'
import { keyColors, type Direction, type GameState, type KeyColor, type MazeWorld, type MoveIntent } from '../domain/model'
import { createGrid45World, defaultAntCount, defaultPinkBallCount, defaultTankCount, defaultTeethCount, defaultWorldSize, worldSizes, type WorldSize } from '../domain/world'
import { clearEditorWorld, createBlankFloorEditorWorld, cloneMazeWorld, downloadWorldJson, nearestCellIdToPoint, paintEditorWorld, rotateDirection, rotateEditorMobAtCell, type EditorPaintTool } from './editorHelpers'
import type { Vec2 } from '../../hyper/vec2'

const MIN_MONSTER_COUNT = 0
const MAX_MONSTER_COUNT = 128
const EDITOR_UNDO_LIMIT = 96
const EDITOR_MOVE_SPEED = 0.56
const EDITOR_ORBIT_SPEED = 1.2
const EDITOR_DRAG_PAN_SCALE = 1.08
const DOUBLE_MIDDLE_CLICK_MS = 320
const DOUBLE_MIDDLE_CLICK_DISTANCE = 8
const RENDER_SAFE_MARGIN = 20

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
  { tool: 'water', label: 'Water' },
  { tool: 'fire', label: 'Fire' },
  { tool: 'dirt', label: 'Dirt' },
  { tool: 'gravel', label: 'Gravel' },
  { tool: 'toggle-floor', label: 'Toggle Floor' },
  { tool: 'toggle-wall', label: 'Toggle Wall' },
  { tool: 'start', label: 'Start' },
  { tool: 'bomb', label: 'Bomb' },
  { tool: 'chip', label: 'Chip' },
  { tool: 'flippers', label: 'Flippers' },
  { tool: 'fire-boots', label: 'Fire Boots' },
  { tool: 'green-button', label: 'Green Button' },
  { tool: 'socket', label: 'Socket' },
  { tool: 'tank-button', label: 'Tank Button' },
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
  { tool: 'dirt-block', label: 'Dirt Block' },
  { tool: 'glider', label: 'Glider' },
  { tool: 'fireball', label: 'Fireball' },
  { tool: 'pink-ball', label: 'Pink Ball' },
  { tool: 'teeth', label: 'Teeth' },
  { tool: 'tank', label: 'Tank' },
  { tool: 'none', label: 'Clear Feature' },
]

type EditorHistoryEntry = {
  world: MazeWorld
  selectedCellId: number
  cameraCenter: Vec2
  cameraAngle: number
}

type MiddleDragState = {
  pointerId: number
  lastX: number
  lastY: number
  moved: boolean
  startX: number
  startY: number
}

type PaintDragState = {
  pointerId: number
  paintButton: 'left' | 'right'
  lastCellId: number | null
}

type PaletteIconMap = Partial<Record<EditorPaintTool, string>>
type InventoryItem = {
  id: string
  label: string
  iconSrc?: string
  count?: number
  active?: boolean
}

type InventoryOrbitGroup = {
  id: string
  items: InventoryItem[]
  centerAngleDeg: number
  stepDeg: number
  radiusOffset: number
}

function isMobTool(tool: EditorPaintTool): tool is 'ant' | 'pink-ball' | 'teeth' | 'tank' | 'glider' | 'fireball' {
  return tool === 'ant' || tool === 'pink-ball' || tool === 'teeth' || tool === 'tank' || tool === 'glider' || tool === 'fireball'
}

function makePaletteIcon(sprite?: HTMLCanvasElement | null): string | undefined {
  return sprite?.toDataURL()
}

function createClearIcon(): string {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  ctx.fillStyle = '#10161d'
  ctx.fillRect(0, 0, 32, 32)
  ctx.strokeStyle = '#ff8f8f'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(7, 7)
  ctx.lineTo(25, 25)
  ctx.moveTo(25, 7)
  ctx.lineTo(7, 25)
  ctx.stroke()
  return canvas.toDataURL()
}

function createPaletteIconMap(tileset: Grid45Tileset, mobFacing: Direction): PaletteIconMap {
  return {
    floor: makePaletteIcon(tileset.tiles.floor),
    wall: makePaletteIcon(tileset.tiles.wall),
    water: makePaletteIcon(tileset.tiles.water),
    fire: makePaletteIcon(tileset.tiles.fire),
    dirt: makePaletteIcon(tileset.tiles.dirt),
    gravel: makePaletteIcon(tileset.tiles.gravel),
    'toggle-floor': makePaletteIcon(tileset.tiles['toggle-floor']),
    'toggle-wall': makePaletteIcon(tileset.tiles['toggle-wall']),
    start: makePaletteIcon(tileset.playerSprites.south),
    bomb: makePaletteIcon(tileset.features.bomb),
    chip: makePaletteIcon(tileset.features.chip),
    flippers: makePaletteIcon(tileset.features.flippers),
    'fire-boots': makePaletteIcon(tileset.features['fire-boots']),
    'green-button': makePaletteIcon(tileset.features['green-button']),
    socket: makePaletteIcon(tileset.features.socket),
    'tank-button': makePaletteIcon(tileset.features['tank-button']),
    exit: makePaletteIcon(tileset.features.exit),
    'key-blue': makePaletteIcon(tileset.features['key-blue']),
    'key-red': makePaletteIcon(tileset.features['key-red']),
    'key-green': makePaletteIcon(tileset.features['key-green']),
    'key-yellow': makePaletteIcon(tileset.features['key-yellow']),
    'door-blue': makePaletteIcon(tileset.features['door-blue']),
    'door-red': makePaletteIcon(tileset.features['door-red']),
    'door-green': makePaletteIcon(tileset.features['door-green']),
    'door-yellow': makePaletteIcon(tileset.features['door-yellow']),
    ant: makePaletteIcon(tileset.antSprites[mobFacing]),
    'dirt-block': makePaletteIcon(tileset.dirtBlockSprite),
    glider: makePaletteIcon(tileset.gliderSprites[mobFacing]),
    fireball: makePaletteIcon(tileset.fireballSprite),
    'pink-ball': makePaletteIcon(tileset.pinkBallSprite),
    teeth: makePaletteIcon(tileset.teethSprites[mobFacing]),
    tank: makePaletteIcon(tileset.tankSprites[mobFacing]),
    none: createClearIcon(),
  }
}

function iconForPaintTool(
  tool: EditorPaintTool,
  facing: Direction,
  paletteIcons: PaletteIconMap,
  tileset: Grid45Tileset | null,
): string | undefined {
  if (!tileset) return paletteIcons[tool]
  if (tool === 'ant') return makePaletteIcon(tileset.antSprites[facing])
  if (tool === 'dirt-block') return makePaletteIcon(tileset.dirtBlockSprite)
  if (tool === 'glider') return makePaletteIcon(tileset.gliderSprites[facing])
  if (tool === 'fireball') return makePaletteIcon(tileset.fireballSprite)
  if (tool === 'teeth') return makePaletteIcon(tileset.teethSprites[facing])
  if (tool === 'tank') return makePaletteIcon(tileset.tankSprites[facing])
  if (tool === 'pink-ball') return makePaletteIcon(tileset.pinkBallSprite)
  return paletteIcons[tool]
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
    initialTankCount: defaultTankCount,
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

function isSpaceKey(event: KeyboardEvent): boolean {
  return event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
}

function isUndoKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.metaKey && !event.altKey && (event.key === 'z' || event.key === 'Z')
}

function editorRotationDeltaFromKey(event: KeyboardEvent): -1 | 1 | null {
  if (event.code === 'Comma' || event.key === '<' || event.key === ',') return -1
  if (event.code === 'Period' || event.key === '>' || event.key === '.') return 1
  return null
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

function CircularInventoryRing({ frame, groups }: { frame: Grid45DiskFrame; groups: InventoryOrbitGroup[] }) {
  return (
    <div className="grid45OrbitHud" aria-hidden="true">
      {groups.map((group) => {
        const radius = frame.diskRadius + group.radiusOffset
        const startAngleDeg = group.centerAngleDeg - (group.stepDeg * (group.items.length - 1)) / 2

        return (
          <div key={group.id}>
            {group.items.map((item, index) => {
              const angleDeg = startAngleDeg + group.stepDeg * index
              const angleRad = (angleDeg * Math.PI) / 180
              const left = frame.centerX + Math.sin(angleRad) * radius
              const top = frame.centerY - Math.cos(angleRad) * radius

              return (
                <div
                  key={item.id}
                  className="grid45OrbitSlot"
                  style={{
                    left,
                    top,
                    ['--inventory-rotation' as string]: `${angleDeg}deg`,
                  }}
                >
                  <div
                    className={`grid45InventoryItem${item.active === false ? ' grid45InventoryItemInactive' : ''}`}
                    title={item.label}
                  >
                    {item.iconSrc ? <img className="grid45InventoryIcon" src={item.iconSrc} alt={item.label} /> : <span className="grid45InventoryFallback">{item.label[0]}</span>}
                    {item.count !== undefined ? <span className="grid45InventoryCount">{item.count}</span> : null}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}

function inventoryOrbitGroups(keys: InventoryItem[], boots: InventoryItem[], chips: InventoryItem[]): InventoryOrbitGroup[] {
  return [
    {
      id: 'chips-keys',
      items: [...chips, ...keys],
      centerAngleDeg: -36,
      stepDeg: 10,
      radiusOffset: 66,
    },
    {
      id: 'boots',
      items: boots,
      centerAngleDeg: 36,
      stepDeg: 10,
      radiusOffset: 66,
    },
  ]
}

function orbitFrameForCanvas(
  canvas: HTMLCanvasElement | null,
  viewportInset: Grid45RenderOptions['viewportInset'],
): Grid45DiskFrame | null {
  if (!canvas) return null
  const rect = canvas.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return computeGrid45DiskFrame(rect.width, rect.height, viewportInset)
}

function describeGate(edge: GameState['world']['areaDag']['edges'][number]): string {
  if (edge.gate === 'socket') return 'socket'
  return edge.color ?? 'door'
}

const DagValidatorPanel = forwardRef<HTMLElement, { snapshot: GameState }>(function DagValidatorPanel({ snapshot }, ref) {
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
    <aside ref={ref} className="grid45DagPanel">
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
})

export default function Grid45App() {
  const appRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const drawRef = useRef<(() => void) | null>(null)
  const playAgainButtonRef = useRef<HTMLButtonElement | null>(null)
  const playtestAgainButtonRef = useRef<HTMLButtonElement | null>(null)
  const navRef = useRef<HTMLDivElement | null>(null)
  const hudRef = useRef<HTMLDivElement | null>(null)
  const editorPanelRef = useRef<HTMLDivElement | null>(null)
  const dagPanelRef = useRef<HTMLElement | null>(null)
  const paintDragRef = useRef<PaintDragState | null>(null)
  const middleDragRef = useRef<MiddleDragState | null>(null)
  const middleClickRef = useRef<{ time: number; x: number; y: number; cellId: number | null }>({
    time: 0,
    x: 0,
    y: 0,
    cellId: null,
  })
  const editorCameraCenterRef = useRef<Vec2 | null>(null)
  const editorCameraAngleRef = useRef(0)
  const [playSession] = useState(createSession)
  const [playSnapshot, setPlaySnapshot] = useState<GameState>(() => playSession.getSnapshot())
  const [playtestSession, setPlaytestSession] = useState<Grid45Session | null>(null)
  const [playtestSnapshot, setPlaytestSnapshot] = useState<GameState | null>(null)
  const [tileset, setTileset] = useState<Grid45Tileset | null>(null)
  const [paletteIcons, setPaletteIcons] = useState<PaletteIconMap>({})
  const [activeTab, setActiveTab] = useState<'play' | 'editor'>('play')
  const [showDagValidator, setShowDagValidator] = useState(false)
  const [worldSize, setWorldSize] = useState<WorldSize>(defaultWorldSize)
  const [antCount, setAntCount] = useState<number>(defaultAntCount)
  const [pinkBallCount, setPinkBallCount] = useState<number>(defaultPinkBallCount)
  const [teethCount, setTeethCount] = useState<number>(defaultTeethCount)
  const [tankCount, setTankCount] = useState<number>(defaultTankCount)
  const [stepModeEnabled, setStepModeEnabled] = useState(false)
  const [seedInput, setSeedInput] = useState('')
  const [viewportVersion, setViewportVersion] = useState(0)
  const [editorBlankSize, setEditorBlankSize] = useState<WorldSize>(defaultWorldSize)
  const [editorWorld, setEditorWorld] = useState<MazeWorld>(() => cloneMazeWorld(playSession.getSnapshot().world))
  const [editorHistory, setEditorHistory] = useState<EditorHistoryEntry[]>([])
  const [editorCameraCenter, setEditorCameraCenter] = useState<Vec2>(() => playSession.getSnapshot().world.cells[playSession.getSnapshot().world.startCellId].center)
  const [editorCameraAngle, setEditorCameraAngle] = useState(0)
  const [editorSelectedCellId, setEditorSelectedCellId] = useState<number>(() => playSession.getSnapshot().world.startCellId)
  const [editorLeftTool, setEditorLeftTool] = useState<EditorPaintTool>('floor')
  const [editorRightTool, setEditorRightTool] = useState<EditorPaintTool>('wall')
  const [editorLeftMobFacing, setEditorLeftMobFacing] = useState<Direction>('north')
  const [editorRightMobFacing, setEditorRightMobFacing] = useState<Direction>('north')
  const [editorIntent, setEditorIntent] = useState<MoveIntent>('stay')
  const [editorRotateIntent, setEditorRotateIntent] = useState<-1 | 0 | 1>(0)
  const showDevToggle = import.meta.env.DEV
  const showPlayEndOverlay = activeTab === 'play' && (playSnapshot.levelComplete || playSnapshot.playerDead)
  const showPlaytestEndOverlay = activeTab === 'editor' && !!playtestSnapshot && (playtestSnapshot.levelComplete || playtestSnapshot.playerDead)
  const endTitle = playSnapshot.levelComplete ? 'You Win!' : 'You Died!'
  const playtestEndTitle = playtestSnapshot?.levelComplete ? 'You Win!' : 'You Lose!'
  const editorPreviewState = createInitialGameState(editorWorld)
  const currentSceneState = activeTab === 'play' ? playSnapshot : playtestSnapshot ?? editorPreviewState
  const chipsRemaining = playSnapshot.remainingChipCellIds.size
  const antTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'ant').length
  const pinkBallTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'pink-ball').length
  const teethTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'teeth').length
  const tankTotal = playSnapshot.world.initialMonsters.filter((monster) => monster.kind === 'tank').length
  const editorMonsterTotal = editorWorld.initialMonsters.length
  const playInventoryKeys: InventoryItem[] = keyColors.map((color) => ({
    id: `play-key-${color}`,
    label: `${keyLabels[color]} key`,
    iconSrc: paletteIcons[`key-${color}`],
    count: playSnapshot.keyInventory[color],
    active: playSnapshot.keyInventory[color] > 0,
  }))
  const playInventoryBoots: InventoryItem[] = [
    {
      id: 'play-flippers',
      label: 'Flippers',
      iconSrc: paletteIcons.flippers,
      active: playSnapshot.hasFlippers,
    },
    {
      id: 'play-fire-boots',
      label: 'Fire Boots',
      iconSrc: paletteIcons['fire-boots'],
      active: playSnapshot.hasFireBoots,
    },
  ]
  const playInventoryChips: InventoryItem[] = [
    {
      id: 'play-chip',
      label: 'Chips Remaining',
      iconSrc: paletteIcons.chip,
      count: chipsRemaining,
    },
  ]
  const playtestInventoryKeys: InventoryItem[] =
    playtestSnapshot === null
      ? []
      : keyColors.map((color) => ({
          id: `playtest-key-${color}`,
          label: `${keyLabels[color]} key`,
          iconSrc: paletteIcons[`key-${color}`],
          count: playtestSnapshot.keyInventory[color],
          active: playtestSnapshot.keyInventory[color] > 0,
        }))
  const playtestInventoryBoots: InventoryItem[] =
    playtestSnapshot === null
      ? []
      : [
          {
            id: 'playtest-flippers',
            label: 'Flippers',
            iconSrc: paletteIcons.flippers,
            active: playtestSnapshot.hasFlippers,
          },
          {
            id: 'playtest-fire-boots',
            label: 'Fire Boots',
            iconSrc: paletteIcons['fire-boots'],
            active: playtestSnapshot.hasFireBoots,
          },
        ]
  const playtestInventoryChips: InventoryItem[] =
    playtestSnapshot === null
      ? []
      : [
          {
            id: 'playtest-chip',
            label: 'Chips Remaining',
            iconSrc: paletteIcons.chip,
            count: playtestSnapshot.remainingChipCellIds.size,
          },
        ]
  const editorTotalCells = editorWorld.cells.length
  const playInstructionLine = stepModeEnabled
    ? 'Step mode: Arrow keys or WASD advance 2 ticks, Space advances 1 tick, Z undoes. Restart replays this maze; Generate builds a new one.'
    : 'Arrow keys or WASD move. Space starts time. Restart replays this maze; Generate builds a new one.'
  const editorPlaytestInstructionLine = stepModeEnabled
    ? 'Playtest step mode: Arrow keys or WASD advance 2 ticks, Space advances 1 tick, Z undoes. Press ESC to return to the editor.'
    : 'Playtest running. Arrow keys or WASD move, Space starts time. Press ESC to return to the editor.'

  const restoreEditorFrame = (entry: EditorHistoryEntry) => {
    editorCameraCenterRef.current = entry.cameraCenter
    editorCameraAngleRef.current = entry.cameraAngle
    setEditorWorld(entry.world)
    setEditorSelectedCellId(entry.selectedCellId)
    setEditorCameraCenter(entry.cameraCenter)
    setEditorCameraAngle(entry.cameraAngle)
  }

  const pushEditorUndo = () => {
    setEditorHistory((history) => {
      const nextHistory = history.concat({
        world: cloneMazeWorld(editorWorld),
        selectedCellId: editorSelectedCellId,
        cameraCenter: editorCameraCenter,
        cameraAngle: editorCameraAngle,
      })
      return nextHistory.slice(-EDITOR_UNDO_LIMIT)
    })
  }

  const undoEditor = () => {
    setEditorHistory((history) => {
      const previous = history[history.length - 1]
      if (!previous) return history
      restoreEditorFrame(previous)
      return history.slice(0, -1)
    })
  }

  const centerEditorOnCell = (cellId: number) => {
    const center = editorWorld.cells[cellId]?.center
    if (!center) return
    editorCameraCenterRef.current = center
    setEditorSelectedCellId(cellId)
    setEditorCameraCenter(center)
  }

  const rotateSelectedEditorMob = (delta: -1 | 1) => {
    if (!editorWorld.initialMonsters.some((monster) => monster.cellId === editorSelectedCellId)) return
    pushEditorUndo()
    setEditorWorld((world) => rotateEditorMobAtCell(world, editorSelectedCellId, delta))
  }

  const assignEditorTool = (paintButton: 'left' | 'right', tool: EditorPaintTool) => {
    if (paintButton === 'left') {
      setEditorLeftTool(tool)
    } else {
      setEditorRightTool(tool)
    }
  }

  const measureViewportInset = (): NonNullable<Grid45RenderOptions['viewportInset']> => {
    const appRect = appRef.current?.getBoundingClientRect()
    if (!appRect) {
      return { top: 0, right: 0, bottom: 0, left: 0 }
    }

    const inset = { top: 0, right: 0, bottom: 0, left: 0 }

    const applyTop = (rect: DOMRect) => {
      inset.top = Math.max(inset.top, rect.bottom - appRect.top + RENDER_SAFE_MARGIN)
    }
    const applyLeft = (rect: DOMRect) => {
      inset.left = Math.max(inset.left, rect.right - appRect.left + RENDER_SAFE_MARGIN)
    }
    const applyRight = (rect: DOMRect) => {
      inset.right = Math.max(inset.right, appRect.right - rect.left + RENDER_SAFE_MARGIN)
    }
    const applyBottom = (rect: DOMRect) => {
      inset.bottom = Math.max(inset.bottom, appRect.bottom - rect.top + RENDER_SAFE_MARGIN)
    }

    const navRect = navRef.current?.getBoundingClientRect()
    if (navRect) applyTop(navRect)

    const sideRect = (activeTab === 'play' ? hudRef.current : editorPanelRef.current)?.getBoundingClientRect()
    if (sideRect) {
      if (sideRect.width >= appRect.width * 0.45) {
        applyTop(sideRect)
      } else {
        applyLeft(sideRect)
      }
    }

    const dagRect = activeTab === 'play' && showDevToggle && showDagValidator ? dagPanelRef.current?.getBoundingClientRect() : undefined
    if (dagRect) {
      if (dagRect.width >= appRect.width * 0.55) {
        applyBottom(dagRect)
      } else {
        applyRight(dagRect)
      }
    }

    return inset
  }

  const buildRenderOptions = (): Grid45RenderOptions => {
    const options: Grid45RenderOptions = {
      viewportInset: measureViewportInset(),
    }

    if (activeTab === 'editor' && playtestSnapshot === null) {
      options.cameraCenter = editorCameraCenter
      options.cameraAngle = editorCameraAngle
      options.highlightCellId = editorSelectedCellId
    }

    return options
  }

  const orbitSnapshot = activeTab === 'play' ? playSnapshot : playtestSnapshot
  const orbitGroups =
    activeTab === 'play'
      ? inventoryOrbitGroups(playInventoryKeys, playInventoryBoots, playInventoryChips)
      : playtestSnapshot
        ? inventoryOrbitGroups(playtestInventoryKeys, playtestInventoryBoots, playtestInventoryChips)
        : []
  void viewportVersion
  const orbitFrame = orbitSnapshot ? orbitFrameForCanvas(canvasRef.current, measureViewportInset()) : null

  useEffect(() => {
    let active = true

    loadGrid45Tileset()
      .then((nextTileset) => {
        if (active) {
          setTileset(nextTileset)
          setPaletteIcons(createPaletteIconMap(nextTileset, 'north'))
        }
      })
      .catch((error) => {
        console.error('Failed to load tileset', error)
      })

    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    editorCameraCenterRef.current = editorCameraCenter
  }, [editorCameraCenter])

  useEffect(() => {
    editorCameraAngleRef.current = editorCameraAngle
  }, [editorCameraAngle])

  useEffect(() => {
    const handleResize = () => {
      setViewportVersion((value) => value + 1)
    }

    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!tileset) return
    setPaletteIcons(createPaletteIconMap(tileset, 'north'))
  }, [tileset])

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
    if (!stepModeEnabled) return
    playSession.stop()
    playtestSession?.stop()
  }, [stepModeEnabled, playSession, playtestSession])

  useEffect(() => {
    if (activeTab === 'editor' || !playtestSession) return
    playtestSession.stop()
    setPlaytestSession(null)
    setPlaytestSnapshot(null)
  }, [activeTab, playtestSession])

  useEffect(() => {
    if (activeTab === 'play') {
      if (stepModeEnabled) {
        const onKeyDown = (event: KeyboardEvent) => {
          if (showPlayEndOverlay) return

          const direction = directionFromKey(event.key)
          if (direction && direction !== 'stay') {
            event.preventDefault()
            playSession.step(direction, 2)
            return
          }

          if (isSpaceKey(event)) {
            event.preventDefault()
            playSession.step('stay', 1)
            return
          }

          if (isUndoKey(event)) {
            event.preventDefault()
            playSession.undo()
          }
        }

        window.addEventListener('keydown', onKeyDown, { passive: false })
        return () => {
          window.removeEventListener('keydown', onKeyDown)
        }
      }

      const detachKeyboard = attachKeyboardIntent(window, playSession.setIntent)
      const onKeyDown = (event: KeyboardEvent) => {
        if (!isSpaceKey(event)) return
        event.preventDefault()
        playSession.start()
      }

      window.addEventListener('keydown', onKeyDown, { passive: false })
      return () => {
        detachKeyboard()
        window.removeEventListener('keydown', onKeyDown)
      }
    }

    if (playtestSession) {
      if (stepModeEnabled) {
        const onKeyDown = (event: KeyboardEvent) => {
          if (event.key === 'Escape') {
            event.preventDefault()
            playtestSession.stop()
            setPlaytestSession(null)
            setPlaytestSnapshot(null)
            return
          }

          if (playtestSnapshot?.levelComplete || playtestSnapshot?.playerDead) return

          const direction = directionFromKey(event.key)
          if (direction && direction !== 'stay') {
            event.preventDefault()
            playtestSession.step(direction, 2)
            return
          }

          if (isSpaceKey(event)) {
            event.preventDefault()
            playtestSession.step('stay', 1)
            return
          }

          if (isUndoKey(event)) {
            event.preventDefault()
            playtestSession.undo()
          }
        }

        window.addEventListener('keydown', onKeyDown, { passive: false })
        return () => {
          window.removeEventListener('keydown', onKeyDown)
        }
      }

      const detachKeyboard = attachKeyboardIntent(window, playtestSession.setIntent)
      const onKeyDown = (event: KeyboardEvent) => {
        if (isSpaceKey(event)) {
          event.preventDefault()
          playtestSession.start()
          return
        }
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
      const rotationDelta = editorRotationDeltaFromKey(event)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        undoEditor()
      } else if (rotationDelta === -1) {
        event.preventDefault()
        rotateSelectedEditorMob(-1)
      } else if (rotationDelta === 1) {
        event.preventDefault()
        rotateSelectedEditorMob(1)
      } else if (event.key === 'q' || event.key === 'Q') {
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
  }, [activeTab, playSession, playtestSession, playtestSnapshot, rotateSelectedEditorMob, showPlayEndOverlay, stepModeEnabled, undoEditor])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) return

    const render = () => {
      const { width, height } = resizeCanvasToDisplaySize(canvas, ctx)
      renderGrid45Scene(ctx, currentSceneState, width, height, tileset, buildRenderOptions())
    }

    drawRef.current = render
    render()

    window.addEventListener('resize', render)
    return () => {
      drawRef.current = null
      window.removeEventListener('resize', render)
    }
  }, [activeTab, currentSceneState, editorCameraAngle, editorCameraCenter, editorSelectedCellId, playtestSnapshot, showDagValidator, tileset])

  useEffect(() => {
    drawRef.current?.()
  }, [activeTab, currentSceneState, editorCameraAngle, editorCameraCenter, editorSelectedCellId, playtestSnapshot, showDagValidator, tileset])

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
    if (!showPlaytestEndOverlay || !playtestSession) return

    playtestAgainButtonRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      const isSpace = event.code === 'Space' || event.key === ' ' || event.key === 'Spacebar'
      const isEnter = event.code === 'Enter' || event.key === 'Enter'
      if (!isSpace && !isEnter) return
      event.preventDefault()
      playtestSession.restart()
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [showPlaytestEndOverlay, playtestSession])

  useEffect(() => {
    if (activeTab !== 'editor' || playtestSession) return
    if (editorIntent === 'stay' && editorRotateIntent === 0) return

    let frameId = 0
    let previousTime = performance.now()

    const step = (now: number) => {
      const elapsedSeconds = Math.min(0.05, (now - previousTime) / 1000)
      previousTime = now

      let nextCenter = editorCameraCenterRef.current ?? editorWorld.cells[editorWorld.startCellId].center
      let nextAngle = editorCameraAngleRef.current

      if (editorIntent !== 'stay') {
        const distance = EDITOR_MOVE_SPEED * elapsedSeconds
        if (editorIntent === 'north') {
          nextCenter = moveCameraInView(nextCenter, nextAngle, { x: 0, y: distance })
        } else if (editorIntent === 'east') {
          nextCenter = moveCameraInView(nextCenter, nextAngle, { x: distance, y: 0 })
        } else if (editorIntent === 'south') {
          nextCenter = moveCameraInView(nextCenter, nextAngle, { x: 0, y: -distance })
        } else if (editorIntent === 'west') {
          nextCenter = moveCameraInView(nextCenter, nextAngle, { x: -distance, y: 0 })
        }
      }

      if (editorRotateIntent !== 0) {
        nextCenter = orbitCameraAroundCenter(nextCenter, editorRotateIntent * EDITOR_ORBIT_SPEED * elapsedSeconds)
      }

      editorCameraCenterRef.current = nextCenter
      editorCameraAngleRef.current = nextAngle
      setEditorCameraCenter(nextCenter)
      setEditorCameraAngle(nextAngle)
      setEditorSelectedCellId(nearestCellIdToPoint(editorWorld, nextCenter))
      frameId = window.requestAnimationFrame(step)
    }

    frameId = window.requestAnimationFrame(step)
    return () => {
      window.cancelAnimationFrame(frameId)
    }
  }, [activeTab, playtestSession, editorIntent, editorRotateIntent, editorWorld])

  const generateNewMap = () => {
    playSession.reset(worldSize, antCount, pinkBallCount, teethCount, tankCount, parseSeedInput(seedInput))
    setSeedInput('')
  }

  const startEditorPlaytest = () => {
    if (playtestSession) return
    const normalizedWorld = cloneMazeWorld(editorWorld)
    setEditorWorld(normalizedWorld)
    setPlaytestSession(createPlaytestSession(normalizedWorld))
    setPlaytestSnapshot(null)
  }

  const clearCurrentEditorMap = () => {
    pushEditorUndo()
    const clearedWorld = clearEditorWorld(editorWorld, editorSelectedCellId)
    const clearedCenter = clearedWorld.cells[clearedWorld.startCellId].center
    editorCameraCenterRef.current = clearedCenter
    editorCameraAngleRef.current = 0
    setEditorWorld(clearedWorld)
    setEditorSelectedCellId(clearedWorld.startCellId)
    setEditorCameraCenter(clearedCenter)
    setEditorCameraAngle(0)
  }

  const createNewBlankEditorMap = () => {
    pushEditorUndo()
    const blankSeed = nextSeed()
    const sourceWorld = createGrid45World({
      seed: blankSeed,
      size: editorBlankSize,
      antCount: 0,
      pinkBallCount: 0,
      teethCount: 0,
      tankCount: 0,
    })
    const clearedWorld = createBlankFloorEditorWorld(sourceWorld, sourceWorld.startCellId)
    const clearedCenter = clearedWorld.cells[clearedWorld.startCellId].center
    editorCameraCenterRef.current = clearedCenter
    editorCameraAngleRef.current = 0
    setEditorWorld(clearedWorld)
    setEditorSelectedCellId(clearedWorld.startCellId)
    setEditorCameraCenter(clearedCenter)
    setEditorCameraAngle(0)
  }

  const paintSelectedCell = (cellId: number, paintButton: 'left' | 'right', includeUndo = false) => {
    if (includeUndo) pushEditorUndo()
    const tool = paintButton === 'left' ? editorLeftTool : editorRightTool
    const facing = paintButton === 'left' ? editorLeftMobFacing : editorRightMobFacing
    setEditorSelectedCellId(cellId)
    setEditorWorld((world) => paintEditorWorld(world, cellId, tool, facing))
    if (tool === 'start') {
      const center = editorWorld.cells[cellId]?.center
      if (center) {
        editorCameraCenterRef.current = center
        setEditorCameraCenter(center)
      }
    }
  }

  const updateEditorCameraFromDrag = (deltaX: number, deltaY: number, rect: DOMRect) => {
    const diskRadius = Math.max(1, Math.min(rect.width, rect.height) * 0.45)
    const nextCenter = moveCameraInView(
      editorCameraCenterRef.current ?? editorCameraCenter,
      editorCameraAngleRef.current,
      {
        x: (-deltaX / diskRadius) * EDITOR_DRAG_PAN_SCALE,
        y: (deltaY / diskRadius) * EDITOR_DRAG_PAN_SCALE,
      },
    )

    editorCameraCenterRef.current = nextCenter
    setEditorCameraCenter(nextCenter)
    setEditorSelectedCellId(nearestCellIdToPoint(editorWorld, nextCenter))
  }

  const handleEditorPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeTab !== 'editor' || playtestSession) return

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
        cameraCenter: editorCameraCenterRef.current ?? editorCameraCenter,
        cameraAngle: editorCameraAngle,
        viewportInset: measureViewportInset(),
      },
    )

    if (event.type === 'pointerdown') {
      if (event.button === 0 || event.button === 2) {
        event.preventDefault()
        canvas.setPointerCapture(event.pointerId)
        const paintButton = event.button === 0 ? 'left' : 'right'
        paintDragRef.current = {
          pointerId: event.pointerId,
          paintButton,
          lastCellId: cellId,
        }
        if (cellId !== null) paintSelectedCell(cellId, paintButton, true)
        return
      }

      if (event.button === 1) {
        event.preventDefault()
        canvas.setPointerCapture(event.pointerId)
        middleDragRef.current = {
          pointerId: event.pointerId,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
          startX: event.clientX,
          startY: event.clientY,
        }
      }
      return
    }

    if (event.type === 'pointermove') {
      const paintDrag = paintDragRef.current
      const isLeftPainting = paintDrag?.paintButton === 'left' && (event.buttons & 1) === 1
      const isRightPainting = paintDrag?.paintButton === 'right' && (event.buttons & 2) === 2
      if (paintDrag && paintDrag.pointerId === event.pointerId && (isLeftPainting || isRightPainting)) {
        if (cellId !== null && cellId !== paintDrag.lastCellId) {
          paintDrag.lastCellId = cellId
          paintSelectedCell(cellId, paintDrag.paintButton)
        }
      }

      const middleDrag = middleDragRef.current
      if (middleDrag && middleDrag.pointerId === event.pointerId && (event.buttons & 4) === 4) {
        const dx = event.clientX - middleDrag.lastX
        const dy = event.clientY - middleDrag.lastY
        middleDrag.lastX = event.clientX
        middleDrag.lastY = event.clientY
        if (Math.abs(event.clientX - middleDrag.startX) > 2 || Math.abs(event.clientY - middleDrag.startY) > 2) {
          middleDrag.moved = true
        }
        updateEditorCameraFromDrag(dx, dy, rect)
      }
      return
    }

    if (event.type === 'pointerup' || event.type === 'pointercancel') {
      const paintDrag = paintDragRef.current
      if (paintDrag && paintDrag.pointerId === event.pointerId) {
        paintDragRef.current = null
      }

      const middleDrag = middleDragRef.current
      if (middleDrag && middleDrag.pointerId === event.pointerId) {
        if (!middleDrag.moved && cellId !== null) {
          const now = performance.now()
          const previous = middleClickRef.current
          if (
            previous.cellId === cellId &&
            now - previous.time <= DOUBLE_MIDDLE_CLICK_MS &&
            Math.hypot(previous.x - event.clientX, previous.y - event.clientY) <= DOUBLE_MIDDLE_CLICK_DISTANCE
          ) {
            centerEditorOnCell(cellId)
            middleClickRef.current = { time: 0, x: 0, y: 0, cellId: null }
          } else {
            middleClickRef.current = {
              time: now,
              x: event.clientX,
              y: event.clientY,
              cellId,
            }
          }
        }
        middleDragRef.current = null
      }

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
    }
  }

  return (
    <div ref={appRef} className="grid45App">
      <div ref={navRef} className="grid45Nav">
        <div className="grid45NavBrand">Hyperbolic CC</div>
        <div className="grid45NavTabs">
          <button
            className={`grid45NavTab${activeTab === 'play' ? ' grid45NavTabActive' : ''}`}
            type="button"
            onClick={() => setActiveTab('play')}
          >
            Home
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
        onPointerUp={handleEditorPointer}
        onPointerCancel={handleEditorPointer}
        onAuxClick={(event) => {
          if (activeTab === 'editor') event.preventDefault()
        }}
        onContextMenu={(event) => {
          if (activeTab === 'editor') event.preventDefault()
        }}
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
      {showPlaytestEndOverlay ? (
        <div className={`grid45EndOverlay${playtestSnapshot?.playerDead ? ' grid45EndOverlayLose' : ''}`}>
          <div className="grid45EndTitle">{playtestEndTitle}</div>
          <div className="grid45EndCopy">Press Space or Enter to play again on this same test map.</div>
          <div className="grid45EndActions">
            <button
              ref={playtestAgainButtonRef}
              className="grid45Button grid45ButtonPrimary"
              type="button"
              onClick={() => playtestSession?.restart()}
            >
              Play Again
            </button>
            <button
              className="grid45Button"
              type="button"
              onClick={() => {
                playtestSession?.stop()
                setPlaytestSession(null)
                setPlaytestSnapshot(null)
              }}
            >
              Return to Editor
            </button>
          </div>
        </div>
      ) : null}
      {activeTab === 'play' && showDevToggle && showDagValidator ? <DagValidatorPanel ref={dagPanelRef} snapshot={playSnapshot} /> : null}
      {orbitFrame && orbitGroups.length > 0 ? <CircularInventoryRing frame={orbitFrame} groups={orbitGroups} /> : null}

      {activeTab === 'play' ? (
        <div ref={hudRef} className="grid45Hud">
          <div className="grid45Eyebrow">Hyperbolic CC</div>
          <div className="grid45Line">Collect every chip, pass through the socket, then reach the exit.</div>
          <div className="grid45Line">Monsters are placed randomly and may render maps unsolveable.</div>
          <div className="grid45Line">{playInstructionLine}</div>
          <div className="grid45Metrics">Tick {playSnapshot.tick}</div>
          <div className="grid45Metrics">State: {describeOutcome(playSnapshot)}</div>
          <div className="grid45Metrics">Ants: {antTotal}</div>
          <div className="grid45Metrics">Pink Balls: {pinkBallTotal}</div>
          <div className="grid45Metrics">Teeth: {teethTotal}</div>
          <div className="grid45Metrics">Tanks: {tankTotal}</div>
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
          <label className="grid45Toggle">
            <input
              type="checkbox"
              checked={stepModeEnabled}
              onChange={(event) => setStepModeEnabled(event.target.checked)}
            />
            <span>Step Mode</span>
          </label>
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
            <label className="grid45SelectLabel grid45AntControl">
              <span>Tanks</span>
              <div className="grid45AntRow">
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setTankCount((count) => Math.max(MIN_MONSTER_COUNT, count - 1))}>
                  -
                </button>
                <input
                  className="grid45Slider"
                  type="range"
                  min={MIN_MONSTER_COUNT}
                  max={MAX_MONSTER_COUNT}
                  step={1}
                  value={tankCount}
                  onChange={(event) => setTankCount(Number(event.target.value))}
                />
                <button className="grid45Button grid45StepButton" type="button" onClick={() => setTankCount((count) => Math.min(MAX_MONSTER_COUNT, count + 1))}>
                  +
                </button>
              </div>
              <span className="grid45AntValue">{tankCount}</span>
            </label>
            <button className="grid45Button" onClick={generateNewMap}>
              Generate Maze
            </button>
          </div>
        </div>
      ) : (
        <div ref={editorPanelRef} className="grid45EditorPanel">
          <div className="grid45Eyebrow">Editor</div>
          {playtestSnapshot ? (
            <>
              <div className="grid45Line">{editorPlaytestInstructionLine}</div>
              <div className="grid45Metrics">Tick: {playtestSnapshot.tick}</div>
              <div className="grid45Metrics">State: {describeOutcome(playtestSnapshot)}</div>
              <label className="grid45Toggle">
                <input
                  type="checkbox"
                  checked={stepModeEnabled}
                  onChange={(event) => setStepModeEnabled(event.target.checked)}
                />
                <span>Step Mode</span>
              </label>
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
                Left click palette sets the left brush, right click palette sets the right brush. Left or right drag paints. Middle drag pans. Double middle click centers on a tile.
              </div>
              <label className="grid45Toggle">
                <input
                  type="checkbox"
                  checked={stepModeEnabled}
                  onChange={(event) => setStepModeEnabled(event.target.checked)}
                />
                <span>Step Mode for Playtest</span>
              </label>
              <div className="grid45Metrics">Seed: {editorWorld.seed}</div>
              <div className="grid45Metrics">Total Cells: {editorTotalCells}</div>
              <div className="grid45Metrics">Start Cell: {editorWorld.startCellId}</div>
              <div className="grid45Metrics">Selected Cell: {editorSelectedCellId}</div>
              <div className="grid45Metrics">Monsters: {editorMonsterTotal}</div>
              <div className="grid45Metrics">Undo: {editorHistory.length}</div>
              <div className="grid45Metrics">Left Brush: {editorLeftTool}</div>
              <div className="grid45Metrics">Right Brush: {editorRightTool}</div>
              <div className="grid45Metrics">Mode: Edit</div>
              <div className="grid45Controls">
                <button className="grid45Button grid45ButtonPrimary" type="button" onClick={startEditorPlaytest}>
                  Playtest
                </button>
                <button className="grid45Button" type="button" onClick={undoEditor} disabled={editorHistory.length === 0}>
                  Undo
                </button>
                <button className="grid45Button" type="button" onClick={clearCurrentEditorMap}>
                  Clear Map
                </button>
                <label className="grid45SelectLabel">
                  <span>Blank Size</span>
                  <select
                    className="grid45Select"
                    value={editorBlankSize}
                    onChange={(event) => setEditorBlankSize(event.target.value as WorldSize)}
                  >
                    {worldSizes.map((size) => (
                      <option key={size} value={size}>
                        {worldSizeLabels[size]}
                      </option>
                    ))}
                  </select>
                </label>
                <button className="grid45Button" type="button" onClick={createNewBlankEditorMap}>
                  New Blank Map
                </button>
                <button className="grid45Button" type="button" onClick={() => downloadWorldJson(editorWorld)}>
                  Download JSON
                </button>
                <button
                  className="grid45Button"
                  type="button"
                  onClick={() => {
                    const nextWorld = cloneMazeWorld(playSnapshot.world)
                    setEditorHistory([])
                    editorCameraCenterRef.current = nextWorld.cells[nextWorld.startCellId].center
                    editorCameraAngleRef.current = 0
                    setEditorWorld(nextWorld)
                    setEditorCameraCenter(nextWorld.cells[nextWorld.startCellId].center)
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
                    className={`grid45PaletteButton${editorLeftTool === item.tool ? ' grid45PaletteButtonLeft' : ''}${editorRightTool === item.tool ? ' grid45PaletteButtonRight' : ''}`}
                    type="button"
                    onClick={() => assignEditorTool('left', item.tool)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      assignEditorTool('right', item.tool)
                    }}
                  >
                    {paletteIcons[item.tool] ? <img className="grid45PaletteIcon" src={paletteIcons[item.tool]} alt="" /> : null}
                    <span>{item.label}</span>
                    <span className="grid45PaletteAssignments">
                      {editorLeftTool === item.tool ? <span className="grid45PaletteBadge">L</span> : null}
                      {editorRightTool === item.tool ? <span className="grid45PaletteBadge grid45PaletteBadgeAlt">R</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          {!playtestSnapshot ? (
            <>
              <div className="grid45Controls">
                {iconForPaintTool(editorLeftTool, editorLeftMobFacing, paletteIcons, tileset) ? (
                  <img className="grid45FacingPreview" src={iconForPaintTool(editorLeftTool, editorLeftMobFacing, paletteIcons, tileset)} alt="" />
                ) : null}
                <div className="grid45Metrics">Left Facing: {editorLeftMobFacing}</div>
                <button
                  className="grid45Button grid45StepButton"
                  type="button"
                  onClick={() => setEditorLeftMobFacing((direction) => rotateDirection(direction, -1))}
                  disabled={!isMobTool(editorLeftTool)}
                >
                  ↺
                </button>
                <button
                  className="grid45Button grid45StepButton"
                  type="button"
                  onClick={() => setEditorLeftMobFacing((direction) => rotateDirection(direction, 1))}
                  disabled={!isMobTool(editorLeftTool)}
                >
                  ↻
                </button>
              </div>
              <div className="grid45Controls">
                {iconForPaintTool(editorRightTool, editorRightMobFacing, paletteIcons, tileset) ? (
                  <img className="grid45FacingPreview" src={iconForPaintTool(editorRightTool, editorRightMobFacing, paletteIcons, tileset)} alt="" />
                ) : null}
                <div className="grid45Metrics">Right Facing: {editorRightMobFacing}</div>
                <button
                  className="grid45Button grid45StepButton"
                  type="button"
                  onClick={() => setEditorRightMobFacing((direction) => rotateDirection(direction, -1))}
                  disabled={!isMobTool(editorRightTool)}
                >
                  ↺
                </button>
                <button
                  className="grid45Button grid45StepButton"
                  type="button"
                  onClick={() => setEditorRightMobFacing((direction) => rotateDirection(direction, 1))}
                  disabled={!isMobTool(editorRightTool)}
                >
                  ↻
                </button>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
