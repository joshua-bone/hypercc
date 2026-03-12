import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type DragEvent as ReactDragEvent, type MutableRefObject, type PointerEvent as ReactPointerEvent } from 'react'
import { createGrid45Session, type Grid45Session } from '../application/createGrid45Session'
import { renderGrid45Scene, resizeCanvasToDisplaySize, pickGrid45CellAtPoint, type Grid45DiskFrame, type Grid45RenderOptions } from '../adapters/canvasRenderer'
import { createIntervalClock } from '../adapters/intervalClock'
import { attachKeyboardIntent, isInteractiveKeyboardTarget } from '../adapters/keyboardIntent'
import { loadGrid45Tileset, type Grid45Tileset } from '../adapters/spriteAtlas'
import { moveCameraInView, orbitCameraAroundCenter } from '../domain/camera'
import { directionFromKey } from '../domain/directions'
import { createInitialGameState } from '../domain/engine'
import { loadMazeWorldFromJson } from '../domain/levelCodec'
import { keyColors, type Direction, type GameState, type KeyColor, type MazeCell, type MazeWorld, type MoveIntent } from '../domain/model'
import { createGrid45World, defaultAntCount, defaultPinkBallCount, defaultTankCount, defaultTeethCount, defaultWorldSize, worldSizes, type WorldSize } from '../domain/world'
import {
  canBucketFillEditorTool,
  canPaintEditorBoundaryCell,
  clearEditorWorld,
  collectEditorBoundaryCellIds,
  collectEditorGrowCellIds,
  countEditorMapCells,
  createBlankFloorEditorWorld,
  cloneMazeWorld,
  downloadLevelJson,
  growEditorWorld,
  nearestCellIdToPoint,
  normalizeEditorWorld,
  paintEditorBucketFill,
  paintEditorRegion,
  paintEditorWorld,
  previewEditorBucketFill,
  previewEditorRegionPaint,
  rotateDirection,
  shrinkEditorWorld,
  type EditorPaintTool,
  type EditorRegionPaintMode,
} from './editorHelpers'
import { createGrid45SceneLayout, EMPTY_SCENE_LAYOUT, measureCircularHintLayout, measureElementRect, sceneLayoutEquals, type Grid45SceneLayout } from './sceneLayout'
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
const RENDER_INTERPOLATION_STEPS = 4

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
  { tool: 'popup-wall', label: 'Pop-up Wall' },
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
  { tool: 'hint', label: 'Hint' },
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
  { tool: 'none', label: 'Remove Cell' },
]
const editorToolLabelByTool = Object.fromEntries(editorPalette.map((item) => [item.tool, item.label])) as Record<EditorPaintTool, string>

type EditorHistoryEntry = {
  world: MazeWorld
  selectedCellId: number
  cameraCenter: Vec2
  cameraAngle: number
}

type MiddleDragState = {
  pointerId: number
  buttonMask: number
  lastX: number
  lastY: number
  moved: boolean
  startX: number
  startY: number
  allowCenterOnRelease: boolean
}

type PaintDragState = {
  pointerId: number
  paintButton: 'left' | 'right'
  lastCellId: number | null
}

type EditorIoStatus = {
  tone: 'info' | 'error'
  text: string
}

type EditorMenuId = 'level' | 'file' | 'map'
type EditorPaintMode = 'brush' | 'bucket'
type EditorHoverPreviewState = {
  previewCellIds: number[]
  previewCells: MazeCell[]
  cursorX: number
  cursorY: number
  badgeParts: string[]
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

type SceneRenderTransition = {
  fromState: GameState
  progress: number
  frame: number
  frameId: number | null
}

function sceneHasMotion(fromState: GameState, toState: GameState): boolean {
  if (fromState.playerCellId !== toState.playerCellId) return true
  if (fromState.cameraAngle !== toState.cameraAngle) return true
  if (fromState.monsters.length !== toState.monsters.length) return true

  const previousMonsterById = new Map(fromState.monsters.map((monster) => [monster.id, monster]))
  return toState.monsters.some((monster) => {
    const previousMonster = previousMonsterById.get(monster.id)
    return !previousMonster || previousMonster.cellId !== monster.cellId || previousMonster.facing !== monster.facing
  })
}

function shouldAnimateSceneTransition(fromState: GameState, toState: GameState): boolean {
  return fromState.world === toState.world && toState.tick === fromState.tick + 1 && sceneHasMotion(fromState, toState)
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
    'popup-wall': makePaletteIcon(tileset.tiles['popup-wall']),
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
    hint: makePaletteIcon(tileset.features.hint),
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

function isEditorModifierPan(event: ReactPointerEvent<HTMLCanvasElement>): boolean {
  return event.button === 0 && !event.shiftKey && (event.metaKey || event.ctrlKey)
}

function editorRegionPaintModeFromPointer(event: ReactPointerEvent<HTMLCanvasElement>): EditorRegionPaintMode | null {
  if (!event.shiftKey) return null
  return event.metaKey || event.ctrlKey ? 'overwrite' : 'expand'
}

function editorPreviewBadgePosition(rect: { width: number; height: number }, clientX: number, clientY: number): { x: number; y: number } {
  return {
    x: Math.max(12, Math.min(rect.width - 132, clientX + 16)),
    y: Math.max(18, Math.min(rect.height - 18, clientY - 18)),
  }
}

function createEditorHoverPreviewState(
  rect: { width: number; height: number },
  clientX: number,
  clientY: number,
  previewCellIds: number[],
  previewCells: MazeCell[],
  badgeParts: string[],
): EditorHoverPreviewState {
  const cursor = editorPreviewBadgePosition(rect, clientX, clientY)
  return {
    previewCellIds,
    previewCells,
    cursorX: cursor.x,
    cursorY: cursor.y,
    badgeParts,
  }
}

function bucketFillBadgeParts(
  leftChangedCellCount: number | null,
  rightChangedCellCount: number | null,
): string[] {
  if (leftChangedCellCount !== null && rightChangedCellCount !== null) {
    if (leftChangedCellCount === rightChangedCellCount) return [`\u0394${leftChangedCellCount}`]
    return [`L \u0394${leftChangedCellCount}`, `R \u0394${rightChangedCellCount}`]
  }
  if (leftChangedCellCount !== null) return [`L \u0394${leftChangedCellCount}`]
  if (rightChangedCellCount !== null) return [`R \u0394${rightChangedCellCount}`]
  return []
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

function HelpModal({
  title,
  sections,
  onClose,
}: {
  title: string
  sections: Array<{ heading: string; lines: string[] }>
  onClose: () => void
}) {
  return (
    <div className="grid45HelpOverlay" role="dialog" aria-modal="true" aria-labelledby="grid45HelpTitle" onClick={onClose}>
      <div className="grid45HelpModal" onClick={(event) => event.stopPropagation()}>
        <div className="grid45HelpHeader">
          <div id="grid45HelpTitle" className="grid45HelpTitle">{title}</div>
          <button className="grid45Button grid45HelpClose" type="button" onClick={onClose} aria-label="Close help">
            Close
          </button>
        </div>
        <div className="grid45HelpBody">
          {sections.map((section) => (
            <section key={section.heading} className="grid45HelpSection">
              <div className="grid45HelpHeading">{section.heading}</div>
              {section.lines.map((line) => (
                <div key={line} className="grid45Line">{line}</div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}

function HintEditorModal({
  value,
  onChange,
  onClose,
}: {
  value: string
  onChange: (value: string) => void
  onClose: () => void
}) {
  return (
    <div className="grid45HelpOverlay" role="dialog" aria-modal="true" aria-labelledby="grid45HintEditorTitle" onClick={onClose}>
      <div className="grid45HelpModal grid45HintModal" onClick={(event) => event.stopPropagation()}>
        <div className="grid45HelpHeader">
          <div id="grid45HintEditorTitle" className="grid45HelpTitle">Level Hint</div>
          <button className="grid45Button grid45HelpClose" type="button" onClick={onClose} aria-label="Close hint editor">
            Done
          </button>
        </div>
        <label className="grid45FieldLabel grid45FieldLabelTall">
          <span>Hint Text</span>
          <textarea
            className="grid45TextArea"
            value={value}
            placeholder="Shown when the player steps onto a hint tile."
            onChange={(event) => onChange(event.target.value)}
            rows={6}
          />
        </label>
        <div className="grid45EndActions grid45HintEditorActions">
          <button className="grid45Button" type="button" onClick={() => onChange('')}>
            Clear Hint
          </button>
        </div>
      </div>
    </div>
  )
}

function LevelSettingsModal({
  titleValue,
  authorValue,
  seed,
  startCellId,
  hasHint,
  onTitleChange,
  onAuthorChange,
  onEditHint,
  onClose,
}: {
  titleValue: string
  authorValue: string
  seed: number
  startCellId: number
  hasHint: boolean
  onTitleChange: (value: string) => void
  onAuthorChange: (value: string) => void
  onEditHint: () => void
  onClose: () => void
}) {
  return (
    <div className="grid45HelpOverlay" role="dialog" aria-modal="true" aria-labelledby="grid45LevelSettingsTitle" onClick={onClose}>
      <div className="grid45HelpModal grid45HintModal" onClick={(event) => event.stopPropagation()}>
        <div className="grid45HelpHeader">
          <div id="grid45LevelSettingsTitle" className="grid45HelpTitle">Level Settings</div>
          <button className="grid45Button grid45HelpClose" type="button" onClick={onClose} aria-label="Close level settings">
            Done
          </button>
        </div>
        <div className="grid45MetaGrid">
          <label className="grid45FieldLabel">
            <span>Title</span>
            <input
              className="grid45TextInput"
              type="text"
              value={titleValue}
              placeholder="Untitled Level"
              onChange={(event) => onTitleChange(event.target.value)}
            />
          </label>
          <label className="grid45FieldLabel">
            <span>Author</span>
            <input
              className="grid45TextInput"
              type="text"
              value={authorValue}
              placeholder="Author"
              onChange={(event) => onAuthorChange(event.target.value)}
            />
          </label>
        </div>
        <div className="grid45MetaActions">
          <button className="grid45Button grid45ButtonCompact" type="button" onClick={onEditHint}>
            {hasHint ? 'Edit Hint' : 'Add Hint'}
          </button>
          <span className="grid45MetaState">{hasHint ? 'Hint set' : 'No hint'}</span>
        </div>
        <div className="grid45StatList grid45StatListEditor">
          <div className="grid45StatItem">
            <span className="grid45StatLabel">Seed</span>
            <span className="grid45StatValue">{seed}</span>
          </div>
          <div className="grid45StatItem">
            <span className="grid45StatLabel">Start</span>
            <span className="grid45StatValue">{startCellId}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function BlankMapModal({
  size,
  onSizeChange,
  onCreate,
  onClose,
}: {
  size: WorldSize
  onSizeChange: (value: WorldSize) => void
  onCreate: () => void
  onClose: () => void
}) {
  return (
    <div className="grid45HelpOverlay" role="dialog" aria-modal="true" aria-labelledby="grid45BlankMapTitle" onClick={onClose}>
      <div className="grid45HelpModal grid45BlankModal" onClick={(event) => event.stopPropagation()}>
        <div className="grid45HelpHeader">
          <div id="grid45BlankMapTitle" className="grid45HelpTitle">New Blank Map</div>
          <button className="grid45Button grid45HelpClose" type="button" onClick={onClose} aria-label="Close blank map dialog">
            Cancel
          </button>
        </div>
        <label className="grid45FieldLabel grid45FieldLabelTall">
          <span>Size</span>
          <select className="grid45Select" value={size} onChange={(event) => onSizeChange(event.target.value as WorldSize)}>
            {worldSizes.map((worldSize) => (
              <option key={worldSize} value={worldSize}>
                {worldSizeLabels[worldSize]}
              </option>
            ))}
          </select>
        </label>
        <div className="grid45EndActions grid45HintEditorActions">
          <button className="grid45Button grid45ButtonPrimary" type="button" onClick={onCreate}>
            Create Blank
          </button>
        </div>
      </div>
    </div>
  )
}

function bottomArcPath(frame: Grid45DiskFrame, radius: number, startDeg: number, endDeg: number, segments = 48): string {
  const points: string[] = []
  for (let index = 0; index <= segments; index += 1) {
    const t = index / segments
    const angle = ((startDeg + (endDeg - startDeg) * t) * Math.PI) / 180
    const x = frame.centerX + Math.cos(angle) * radius
    const y = frame.centerY + Math.sin(angle) * radius
    points.push(`${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`)
  }
  return points.join(' ')
}

function CircularHintText({
  frame,
  text,
}: {
  frame: Grid45DiskFrame
  text: string
}) {
  const layout = measureCircularHintLayout(frame, text)
  if (!layout) return null
  const { fontSize, lineGap, lines, outerRadius } = layout

  return (
    <svg className="grid45HintArcOverlay" aria-hidden="true">
      <defs>
        {lines.map((_, index) => (
          <path
            key={`hint-arc-${index}`}
            id={`grid45HintArc-${index}`}
            d={bottomArcPath(frame, outerRadius + index * lineGap, 158, 22)}
          />
        ))}
      </defs>
      {lines.map((line, index) => (
        <text key={`hint-line-${index}`} className="grid45HintArcText" style={{ fontSize }}>
          <textPath href={`#grid45HintArc-${index}`} startOffset="50%" textAnchor="middle">
            {line}
          </textPath>
        </text>
      ))}
    </svg>
  )
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
      centerAngleDeg: -48,
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

function isFileDrag(event: ReactDragEvent<HTMLElement>): boolean {
  return Array.from(event.dataTransfer.types).includes('Files')
}

function pointInDisk(frame: Grid45DiskFrame, x: number, y: number): boolean {
  return Math.hypot(x - frame.centerX, y - frame.centerY) <= frame.diskRadius
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
  const editorFileInputRef = useRef<HTMLInputElement | null>(null)
  const navRef = useRef<HTMLDivElement | null>(null)
  const hudRef = useRef<HTMLDivElement | null>(null)
  const editorPanelRef = useRef<HTMLDivElement | null>(null)
  const editorMenuBarRef = useRef<HTMLDivElement | null>(null)
  const dagPanelRef = useRef<HTMLElement | null>(null)
  const paintDragRef = useRef<PaintDragState | null>(null)
  const middleDragRef = useRef<MiddleDragState | null>(null)
  const middleClickRef = useRef<{ time: number; x: number; y: number; cellId: number | null }>({
    time: 0,
    x: 0,
    y: 0,
    cellId: null,
  })
  const playPreviousSnapshotRef = useRef<GameState | null>(null)
  const playRenderTransitionRef = useRef<SceneRenderTransition | null>(null)
  const playtestPreviousSnapshotRef = useRef<GameState | null>(null)
  const playtestRenderTransitionRef = useRef<SceneRenderTransition | null>(null)
  const editorCameraCenterRef = useRef<Vec2 | null>(null)
  const editorCameraAngleRef = useRef(0)
  const editorWorldRef = useRef<MazeWorld | null>(null)
  const editorSelectedCellIdRef = useRef<number | null>(null)
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
  const [sceneLayout, setSceneLayout] = useState<Grid45SceneLayout>(EMPTY_SCENE_LAYOUT)
  const [editorBlankSize, setEditorBlankSize] = useState<WorldSize>(defaultWorldSize)
  const [editorWorld, setEditorWorld] = useState<MazeWorld>(() => normalizeEditorWorld(cloneMazeWorld(playSession.getSnapshot().world)))
  const [editorHistory, setEditorHistory] = useState<EditorHistoryEntry[]>([])
  const [editorCameraCenter, setEditorCameraCenter] = useState<Vec2>(() => playSession.getSnapshot().world.cells[playSession.getSnapshot().world.startCellId].center)
  const [editorCameraAngle, setEditorCameraAngle] = useState(0)
  const [editorSelectedCellId, setEditorSelectedCellId] = useState<number>(() => playSession.getSnapshot().world.startCellId)
  const [editorHoverCellId, setEditorHoverCellId] = useState<number | null>(null)
  const [editorHoverPreview, setEditorHoverPreview] = useState<EditorHoverPreviewState | null>(null)
  const [editorPaintMode, setEditorPaintMode] = useState<EditorPaintMode>('brush')
  const [editorMenuOpen, setEditorMenuOpen] = useState<EditorMenuId | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [editorLeftTool, setEditorLeftTool] = useState<EditorPaintTool>('floor')
  const [editorRightTool, setEditorRightTool] = useState<EditorPaintTool>('wall')
  const [editorLeftMobFacing, setEditorLeftMobFacing] = useState<Direction>('north')
  const [editorRightMobFacing, setEditorRightMobFacing] = useState<Direction>('north')
  const [editorIntent, setEditorIntent] = useState<MoveIntent>('stay')
  const [editorRotateIntent, setEditorRotateIntent] = useState<-1 | 0 | 1>(0)
  const [editorIoStatus, setEditorIoStatus] = useState<EditorIoStatus | null>(null)
  const [editorDropActive, setEditorDropActive] = useState(false)
  const [editorLevelOpen, setEditorLevelOpen] = useState(false)
  const [editorHintOpen, setEditorHintOpen] = useState(false)
  const [editorBlankOpen, setEditorBlankOpen] = useState(false)
  const showDevToggle = import.meta.env.DEV
  const showPlayEndOverlay = activeTab === 'play' && (playSnapshot.levelComplete || playSnapshot.playerDead)
  const showPlaytestEndOverlay = activeTab === 'editor' && !!playtestSnapshot && (playtestSnapshot.levelComplete || playtestSnapshot.playerDead)
  const overlayOpen = helpOpen || editorLevelOpen || editorHintOpen || editorBlankOpen
  const endTitle = playSnapshot.levelComplete ? 'You Win!' : 'You Died!'
  const playtestEndTitle = playtestSnapshot?.levelComplete ? 'You Win!' : 'You Lose!'
  const editorPreviewState = createInitialGameState(editorWorld)
  const currentSceneState = activeTab === 'play' ? playSnapshot : playtestSnapshot ?? editorPreviewState
  const hintSnapshot = activeTab === 'play' ? playSnapshot : playtestSnapshot
  const radialHintText =
    hintSnapshot && hintSnapshot.world.cells[hintSnapshot.playerCellId]?.feature === 'hint'
      ? hintSnapshot.world.hint?.trim() ?? ''
      : ''
  const clearEditorHover = () => {
    setEditorHoverCellId(null)
    setEditorHoverPreview(null)
  }
  const stopSceneTransition = (transitionRef: MutableRefObject<SceneRenderTransition | null>) => {
    const activeTransition = transitionRef.current
    if (activeTransition?.frameId !== null && activeTransition?.frameId !== undefined) {
      window.cancelAnimationFrame(activeTransition.frameId)
    }
    transitionRef.current = null
  }
  const startSceneTransition = (
    transitionRef: MutableRefObject<SceneRenderTransition | null>,
    fromState: GameState,
  ) => {
    stopSceneTransition(transitionRef)

    const transition: SceneRenderTransition = {
      fromState,
      progress: 1 / RENDER_INTERPOLATION_STEPS,
      frame: 1,
      frameId: null,
    }

    const step = () => {
      const activeTransition = transitionRef.current
      if (!activeTransition || activeTransition !== transition) return
      if (activeTransition.frame >= RENDER_INTERPOLATION_STEPS) {
        transitionRef.current = null
        drawRef.current?.()
        return
      }

      activeTransition.frame += 1
      activeTransition.progress = activeTransition.frame / RENDER_INTERPOLATION_STEPS
      drawRef.current?.()

      if (activeTransition.frame >= RENDER_INTERPOLATION_STEPS) {
        transitionRef.current = null
        return
      }

      activeTransition.frameId = window.requestAnimationFrame(step)
    }

    transitionRef.current = transition
    transition.frameId = window.requestAnimationFrame(step)
  }
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
  const editorMapCellCount = countEditorMapCells(editorWorld)
  const editorShrinkDelta = collectEditorBoundaryCellIds(editorWorld).length
  const editorGrowDelta = collectEditorGrowCellIds(editorWorld).length
  const editorStatusMetrics = [
    { label: 'Cells', value: `${editorMapCellCount}/${editorTotalCells}` },
    { label: 'Selected', value: String(editorSelectedCellId) },
    { label: 'Hover', value: editorHoverCellId === null ? '-' : String(editorHoverCellId) },
    { label: 'Monsters', value: String(editorMonsterTotal) },
  ]
  const editorBucketFillEnabled = canBucketFillEditorTool(editorLeftTool) || canBucketFillEditorTool(editorRightTool)
  const editorPlaytestMetrics = playtestSnapshot
    ? [
        { label: 'Tick', value: String(playtestSnapshot.tick) },
        { label: 'State', value: describeOutcome(playtestSnapshot), wide: true },
      ]
    : []
  const editorFacingControls = [
    {
      id: 'left',
      label: 'Left',
      tool: editorLeftTool,
      toolLabel: editorToolLabelByTool[editorLeftTool],
      facing: editorLeftMobFacing,
      icon: iconForPaintTool(editorLeftTool, editorLeftMobFacing, paletteIcons, tileset),
      onRotateLeft: () => rotateEditorBrushFacing('left', -1),
      onRotateRight: () => rotateEditorBrushFacing('left', 1),
    },
    {
      id: 'right',
      label: 'Right',
      tool: editorRightTool,
      toolLabel: editorToolLabelByTool[editorRightTool],
      facing: editorRightMobFacing,
      icon: iconForPaintTool(editorRightTool, editorRightMobFacing, paletteIcons, tileset),
      onRotateLeft: () => rotateEditorBrushFacing('right', -1),
      onRotateRight: () => rotateEditorBrushFacing('right', 1),
    },
  ] as const
  const homeStatusMetrics = [
    { label: 'Tick', value: String(playSnapshot.tick) },
    { label: 'Exit', value: playSnapshot.levelComplete ? 'reached' : 'active' },
    { label: 'Ants', value: String(antTotal) },
    { label: 'Pink Balls', value: String(pinkBallTotal) },
    { label: 'Teeth', value: String(teethTotal) },
    { label: 'Tanks', value: String(tankTotal) },
    { label: 'Move Lock', value: playSnapshot.recoveryTicks > 0 ? 'armed' : 'ready' },
    { label: 'State', value: describeOutcome(playSnapshot) },
    { label: 'Seed', value: String(playSnapshot.world.seed) },
  ]
  const monsterControls = [
    { id: 'ants', label: 'Ants', value: antCount, setValue: setAntCount },
    { id: 'pink-balls', label: 'Pink Balls', value: pinkBallCount, setValue: setPinkBallCount },
    { id: 'teeth', label: 'Teeth', value: teethCount, setValue: setTeethCount },
    { id: 'tanks', label: 'Tanks', value: tankCount, setValue: setTankCount },
  ] as const
  const playInstructionLine = stepModeEnabled
    ? 'Step mode: Arrow keys or WASD advance 2 ticks, Space advances 1 tick, Z undoes. Restart replays this maze; Generate builds a new one.'
    : 'Arrow keys or WASD move. Space starts time. Restart replays this maze; Generate builds a new one.'
  const editorPlaytestInstructionLine = stepModeEnabled
    ? 'Playtest step mode: Arrow keys or WASD advance 2 ticks, Space advances 1 tick, Z undoes. Press ESC to return to the editor.'
    : 'Playtest running. Arrow keys or WASD move, Space starts time. Press ESC to return to the editor.'
  const helpTitle = activeTab === 'play' ? 'Home Help' : playtestSnapshot ? 'Editor Playtest Help' : 'Editor Help'
  const helpSections =
    activeTab === 'play'
      ? [
          {
            heading: 'Objective',
            lines: [
              'Collect every chip, pass through the socket, then reach the exit.',
              'Monsters are placed randomly and may render maps unsolveable.',
            ],
          },
          {
            heading: 'Controls',
            lines: [playInstructionLine],
          },
        ]
      : playtestSnapshot
        ? [
            {
              heading: 'Playtest',
              lines: [
                editorPlaytestInstructionLine,
                'The Step Mode checkbox changes playtest controls only.',
              ],
            },
          ]
        : [
            {
              heading: 'Painting',
              lines: [
                'Left click a palette item to assign the left brush. Right click a palette item to assign the right brush.',
                'Use Brush for direct painting and Bucket Fill for contiguous same-terrain regions.',
                'Left or right drag paints with the assigned brush.',
                'Comma and Period (< and >) rotate the current mob brush facing.',
              ],
            },
            {
              heading: 'Map Editing',
              lines: [
                'Hover an adjacent outside cell to preview it. Painting there creates a new attached cell.',
                'Shift previews the outer border of a same-terrain region. Command-Shift or Control-Shift previews the full border, including existing cells.',
                'Shrink Map removes the current outer ring. Grow Map adds the next outer ring. Both actions can be undone.',
                'Load JSON from the sidebar or drop it onto the game disk.',
                'The Remove Cell brush erases a cell from the active map entirely.',
                'Hint tiles show the level hint text configured in the editor.',
              ],
            },
            {
              heading: 'Camera',
              lines: [
                'Middle drag pans the editor camera.',
                'Command-click drag or Control-click drag also pans the camera.',
                'Double middle click centers the camera on a tile. Q and E orbit the camera.',
              ],
            },
            {
              heading: 'Playtest',
              lines: [
                'Playtest runs the current editor map. Step Mode only affects playtest controls.',
                stepModeEnabled
                  ? 'With Step Mode enabled, Arrow keys or WASD advance 2 ticks, Space advances 1 tick, and Z undoes.'
                  : 'With Step Mode disabled, Arrow keys or WASD move and Space starts time.',
              ],
            },
          ]

  const restoreEditorFrame = (entry: EditorHistoryEntry) => {
    editorCameraCenterRef.current = entry.cameraCenter
    editorCameraAngleRef.current = entry.cameraAngle
    editorWorldRef.current = entry.world
    editorSelectedCellIdRef.current = entry.selectedCellId
    setEditorWorld(entry.world)
    setEditorSelectedCellId(entry.selectedCellId)
    clearEditorHover()
    setEditorCameraCenter(entry.cameraCenter)
    setEditorCameraAngle(entry.cameraAngle)
  }

  const pushEditorUndo = () => {
    const snapshotWorld = cloneMazeWorld(editorWorldRef.current ?? editorWorld)
    const snapshotSelectedCellId = editorSelectedCellIdRef.current ?? editorSelectedCellId
    const snapshotCameraCenter = editorCameraCenterRef.current ?? editorCameraCenter
    const snapshotCameraAngle = editorCameraAngleRef.current
    setEditorHistory((history) => {
      const nextHistory = history.concat({
        world: snapshotWorld,
        selectedCellId: snapshotSelectedCellId,
        cameraCenter: snapshotCameraCenter,
        cameraAngle: snapshotCameraAngle,
      })
      return nextHistory.slice(-EDITOR_UNDO_LIMIT)
    })
  }

  const undoEditor = () => {
    paintDragRef.current = null
    middleDragRef.current = null
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
    clearEditorHover()
    setEditorCameraCenter(center)
  }

  const resolveEditorSelectedCellId = (world: MazeWorld, preferredCellId: number, fallbackPoint: Vec2): number => {
    if (world.cells[preferredCellId]?.kind !== 'void') return preferredCellId
    return nearestCellIdToPoint(world, fallbackPoint)
  }

  function rotateEditorBrushFacing(paintButton: 'left' | 'right', delta: -1 | 1) {
    if (paintButton === 'left') {
      if (!isMobTool(editorLeftTool)) return
      setEditorLeftMobFacing((direction) => rotateDirection(direction, delta))
      return
    }

    if (!isMobTool(editorRightTool)) return
    setEditorRightMobFacing((direction) => rotateDirection(direction, delta))
  }

  function rotateActiveEditorBrushes(delta: -1 | 1) {
    let rotated = false

    if (isMobTool(editorLeftTool)) {
      rotated = true
      setEditorLeftMobFacing((direction) => rotateDirection(direction, delta))
    }

    if (isMobTool(editorRightTool)) {
      rotated = true
      setEditorRightMobFacing((direction) => rotateDirection(direction, delta))
    }

    return rotated
  }

  const assignEditorTool = (paintButton: 'left' | 'right', tool: EditorPaintTool) => {
    if (paintButton === 'left') {
      setEditorLeftTool(tool)
    } else {
      setEditorRightTool(tool)
    }
  }

  const toggleEditorMenu = (menuId: EditorMenuId) => {
    setEditorMenuOpen((openMenu) => (openMenu === menuId ? null : menuId))
  }

  const closeEditorMenu = () => {
    setEditorMenuOpen(null)
  }

  const applyEditorWorld = (nextWorld: MazeWorld) => {
    const nextCenter = nextWorld.cells[nextWorld.startCellId].center
    playtestSession?.stop()
    setPlaytestSession(null)
    setPlaytestSnapshot(null)
    setEditorHistory([])
    setEditorMenuOpen(null)
    setEditorLevelOpen(false)
    setEditorHintOpen(false)
    setEditorBlankOpen(false)
    editorCameraCenterRef.current = nextCenter
    editorCameraAngleRef.current = 0
    setEditorWorld(nextWorld)
    setEditorSelectedCellId(nextWorld.startCellId)
    clearEditorHover()
    setEditorCameraCenter(nextCenter)
    setEditorCameraAngle(0)
  }

  const importEditorFile = async (file: File) => {
    try {
      const loadedWorld = loadMazeWorldFromJson(await file.text(), {
        fallbackSeed: nextSeed(),
        fileName: file.name,
      })
      applyEditorWorld(normalizeEditorWorld(loadedWorld))
      setEditorIoStatus({
        tone: 'info',
        text: `Loaded ${file.name}`,
      })
    } catch (error) {
      setEditorIoStatus({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Failed to load level file.',
      })
    } finally {
      setEditorDropActive(false)
      if (editorFileInputRef.current) editorFileInputRef.current.value = ''
    }
  }

  const updateEditorMetadata = (field: 'title' | 'author' | 'hint', value: string) => {
    setEditorWorld((world) => ({
      ...world,
      [field]: value,
    }))
  }

  const readSceneLayout = (): Grid45SceneLayout =>
    createGrid45SceneLayout(
      {
        appRect: measureElementRect(appRef.current),
        canvasRect: measureElementRect(canvasRef.current),
        navRect: measureElementRect(navRef.current),
        sideRect: measureElementRect(activeTab === 'play' ? hudRef.current : editorPanelRef.current),
        dagRect: activeTab === 'play' && showDevToggle && showDagValidator ? measureElementRect(dagPanelRef.current) : null,
      },
      {
        hintText: radialHintText,
        safeMargin: RENDER_SAFE_MARGIN,
      },
    )

  const buildRenderOptions = (): Grid45RenderOptions => {
    const options: Grid45RenderOptions = {
      viewportInset: sceneLayout.viewportInset,
    }

    if (activeTab === 'play') {
      if (playRenderTransitionRef.current) {
        options.transition = {
          fromState: playRenderTransitionRef.current.fromState,
          progress: playRenderTransitionRef.current.progress,
        }
      }
      return options
    }

    if (playtestSnapshot !== null && playtestRenderTransitionRef.current) {
      options.transition = {
        fromState: playtestRenderTransitionRef.current.fromState,
        progress: playtestRenderTransitionRef.current.progress,
      }
    }

    if (playtestSnapshot === null) {
      options.cameraCenter = editorCameraCenter
      options.cameraAngle = editorCameraAngle
      options.highlightCellId = editorSelectedCellId
      if (editorHoverPreview) {
        options.previewCellIds = editorHoverPreview.previewCellIds
        options.previewCells = editorHoverPreview.previewCells
      } else if (editorHoverCellId !== null && editorWorld.cells[editorHoverCellId]?.kind === 'void') {
        options.previewCellId = editorHoverCellId
      }
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
  const orbitFrame = orbitSnapshot ? sceneLayout.frame : null

  useEffect(() => {
    editorWorldRef.current = editorWorld
    editorSelectedCellIdRef.current = editorSelectedCellId
  }, [editorWorld, editorSelectedCellId])

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
    const previousSnapshot = playPreviousSnapshotRef.current
    if (previousSnapshot && shouldAnimateSceneTransition(previousSnapshot, playSnapshot)) {
      startSceneTransition(playRenderTransitionRef, previousSnapshot)
    } else {
      stopSceneTransition(playRenderTransitionRef)
    }
    playPreviousSnapshotRef.current = playSnapshot
  }, [playSnapshot])

  useEffect(() => {
    const currentSnapshot = playtestSnapshot
    const previousSnapshot = playtestPreviousSnapshotRef.current
    if (currentSnapshot && previousSnapshot && shouldAnimateSceneTransition(previousSnapshot, currentSnapshot)) {
      startSceneTransition(playtestRenderTransitionRef, previousSnapshot)
    } else {
      stopSceneTransition(playtestRenderTransitionRef)
    }
    playtestPreviousSnapshotRef.current = currentSnapshot
  }, [playtestSnapshot])

  useEffect(() => {
    return () => {
      stopSceneTransition(playRenderTransitionRef)
      stopSceneTransition(playtestRenderTransitionRef)
    }
  }, [])

  useEffect(() => {
    setEditorHoverPreview(null)
  }, [editorPaintMode])

  useEffect(() => {
    if (editorPaintMode === 'bucket' && !editorBucketFillEnabled) {
      setEditorPaintMode('brush')
      setEditorHoverPreview(null)
    }
  }, [editorBucketFillEnabled, editorPaintMode])

  useLayoutEffect(() => {
    const measureLayout = () => {
      setSceneLayout((current) => {
        const next = readSceneLayout()
        return sceneLayoutEquals(current, next) ? current : next
      })
    }

    measureLayout()

    const observer = new ResizeObserver(() => {
      measureLayout()
    })
    const observedElements = [
      appRef.current,
      canvasRef.current,
      navRef.current,
      activeTab === 'play' ? hudRef.current : editorPanelRef.current,
      activeTab === 'play' && showDevToggle && showDagValidator ? dagPanelRef.current : null,
    ]

    observedElements.forEach((element) => {
      if (element) observer.observe(element)
    })
    window.addEventListener('resize', measureLayout)

    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measureLayout)
    }
  }, [activeTab, radialHintText, showDagValidator, showDevToggle])

  useEffect(() => {
    if (!overlayOpen) return

    setEditorIntent('stay')
    setEditorRotateIntent(0)
    playSession.setIntent('stay')
    playSession.stop()
    playtestSession?.setIntent('stay')
    playtestSession?.stop()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (editorHintOpen) {
        setEditorHintOpen(false)
      } else if (editorBlankOpen) {
        setEditorBlankOpen(false)
      } else if (editorLevelOpen) {
        setEditorLevelOpen(false)
      } else {
        setHelpOpen(false)
      }
    }

    window.addEventListener('keydown', onKeyDown, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [overlayOpen, editorBlankOpen, editorHintOpen, editorLevelOpen, playSession, playtestSession])

  useEffect(() => {
    if (activeTab !== 'editor' || playtestSnapshot || editorMenuOpen === null) return

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && editorMenuBarRef.current?.contains(target)) return
      setEditorMenuOpen(null)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setEditorMenuOpen(null)
    }

    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [activeTab, editorMenuOpen, playtestSnapshot])

  useEffect(() => {
    if (activeTab !== 'editor' || playtestSnapshot !== null || !overlayOpen) return
    setEditorMenuOpen(null)
  }, [activeTab, overlayOpen, playtestSnapshot])

  useEffect(() => {
    if (activeTab === 'editor' && playtestSnapshot === null) return
    setEditorLevelOpen(false)
    setEditorHintOpen(false)
    setEditorBlankOpen(false)
  }, [activeTab, playtestSnapshot])

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
    if (activeTab !== 'editor' || playtestSession) setEditorDropActive(false)
  }, [activeTab, playtestSession])

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
    if (overlayOpen) return

    if (activeTab === 'play') {
      if (stepModeEnabled) {
        const onKeyDown = (event: KeyboardEvent) => {
          if (isInteractiveKeyboardTarget(event.target)) return
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
        if (isInteractiveKeyboardTarget(event.target)) return
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
          if (isInteractiveKeyboardTarget(event.target)) return
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
        if (isInteractiveKeyboardTarget(event.target)) return
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
      if (isInteractiveKeyboardTarget(event.target)) return
      const rotationDelta = editorRotationDeltaFromKey(event)
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        event.preventDefault()
        undoEditor()
      } else if (rotationDelta === -1) {
        if (!rotateActiveEditorBrushes(-1)) return
        event.preventDefault()
      } else if (rotationDelta === 1) {
        if (!rotateActiveEditorBrushes(1)) return
        event.preventDefault()
      } else if (event.key === 'q' || event.key === 'Q') {
        event.preventDefault()
        setEditorRotateIntent(-1)
      } else if (event.key === 'e' || event.key === 'E') {
        event.preventDefault()
        setEditorRotateIntent(1)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (isInteractiveKeyboardTarget(event.target)) return
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
  }, [activeTab, editorLeftTool, editorRightTool, overlayOpen, playSession, playtestSession, playtestSnapshot, showPlayEndOverlay, stepModeEnabled, undoEditor])

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

    return () => {
      drawRef.current = null
    }
  }, [activeTab, currentSceneState, editorCameraAngle, editorCameraCenter, editorHoverCellId, editorHoverPreview, editorSelectedCellId, playtestSnapshot, sceneLayout, showDagValidator, tileset])

  useEffect(() => {
    drawRef.current?.()
  }, [activeTab, currentSceneState, editorCameraAngle, editorCameraCenter, editorHoverCellId, editorHoverPreview, editorSelectedCellId, playtestSnapshot, sceneLayout, showDagValidator, tileset])

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
      clearEditorHover()
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

  const usePlayMapAsEditorWorld = () => {
    const nextWorld = normalizeEditorWorld(cloneMazeWorld(playSnapshot.world))
    setEditorHistory([])
    editorCameraCenterRef.current = nextWorld.cells[nextWorld.startCellId].center
    editorCameraAngleRef.current = 0
    setEditorWorld(nextWorld)
    setEditorCameraCenter(nextWorld.cells[nextWorld.startCellId].center)
    setEditorSelectedCellId(nextWorld.startCellId)
    clearEditorHover()
    setEditorCameraAngle(0)
  }

  const startEditorPlaytest = () => {
    if (playtestSession) return
    const normalizedWorld = cloneMazeWorld(editorWorld)
    setEditorWorld(normalizedWorld)
    setEditorMenuOpen(null)
    clearEditorHover()
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
    clearEditorHover()
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
    clearEditorHover()
    setEditorCameraCenter(clearedCenter)
    setEditorCameraAngle(0)
  }

  const shrinkCurrentEditorMap = () => {
    if (editorShrinkDelta === 0 || editorShrinkDelta >= editorMapCellCount) return
    pushEditorUndo()
    const nextWorld = shrinkEditorWorld(editorWorld)
    const nextSelectedCellId = resolveEditorSelectedCellId(
      nextWorld,
      editorSelectedCellId,
      editorCameraCenterRef.current ?? editorCameraCenter,
    )
    setEditorWorld(nextWorld)
    setEditorSelectedCellId(nextSelectedCellId)
    clearEditorHover()
  }

  const growCurrentEditorMap = () => {
    if (editorGrowDelta === 0) return
    pushEditorUndo()
    const nextWorld = growEditorWorld(editorWorld)
    const nextSelectedCellId = resolveEditorSelectedCellId(
      nextWorld,
      editorSelectedCellId,
      editorCameraCenterRef.current ?? editorCameraCenter,
    )
    setEditorWorld(nextWorld)
    setEditorSelectedCellId(nextSelectedCellId)
    clearEditorHover()
  }

  const paintSelectedCell = (cellId: number, paintButton: 'left' | 'right', includeUndo = false) => {
    const tool = paintButton === 'left' ? editorLeftTool : editorRightTool
    if (tool === 'none' && editorWorld.cells[cellId]?.kind === 'void') return
    if (includeUndo) pushEditorUndo()
    const facing = paintButton === 'left' ? editorLeftMobFacing : editorRightMobFacing
    setEditorSelectedCellId(cellId)
    clearEditorHover()
    setEditorWorld((world) => paintEditorWorld(world, cellId, tool, facing))
    if (tool === 'start') {
      const center = editorWorld.cells[cellId]?.center
      if (center) {
        editorCameraCenterRef.current = center
        setEditorCameraCenter(center)
      }
    }
  }

  const paintSelectedRegion = (cellId: number, paintButton: 'left' | 'right', mode: EditorRegionPaintMode) => {
    const preview = previewEditorRegionPaint(editorWorld, cellId, mode)
    if (!preview || preview.targets.length === 0) return

    const tool = paintButton === 'left' ? editorLeftTool : editorRightTool
    if (tool === 'none' && preview.changedCellCount === 0) return
    pushEditorUndo()
    const facing = paintButton === 'left' ? editorLeftMobFacing : editorRightMobFacing
    setEditorSelectedCellId(cellId)
    clearEditorHover()
    setEditorWorld((world) => paintEditorRegion(world, cellId, mode, tool, facing))
  }

  const paintSelectedBucketFill = (cellId: number, paintButton: 'left' | 'right') => {
    const tool = paintButton === 'left' ? editorLeftTool : editorRightTool
    if (!canBucketFillEditorTool(tool)) return

    const preview = previewEditorBucketFill(editorWorld, cellId, tool)
    if (!preview || preview.targetCellIds.length === 0 || preview.changedCellCount === 0) return

    pushEditorUndo()
    setEditorSelectedCellId(cellId)
    clearEditorHover()
    setEditorWorld((world) => paintEditorBucketFill(world, cellId, tool))
  }

  const updateEditorCameraFromDrag = (deltaX: number, deltaY: number, rect: { width: number; height: number }) => {
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
    clearEditorHover()
    setEditorSelectedCellId(nearestCellIdToPoint(editorWorld, nextCenter))
  }

  const handleEditorFileDragOver = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (activeTab !== 'editor' || playtestSession || !isFileDrag(event)) return

    const frame = sceneLayout.frame
    const rect = sceneLayout.canvasRect
    if (!frame || !rect) return

    const insideDisk = pointInDisk(frame, event.clientX - rect.left, event.clientY - rect.top)
    if (!insideDisk) {
      setEditorDropActive(false)
      return
    }

    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setEditorDropActive(true)
  }

  const handleEditorFileDragLeave = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setEditorDropActive(false)
    }
  }

  const handleEditorFileDrop = (event: ReactDragEvent<HTMLCanvasElement>) => {
    if (activeTab !== 'editor' || playtestSession || !isFileDrag(event)) return

    const frame = sceneLayout.frame
    const rect = sceneLayout.canvasRect
    const file = event.dataTransfer.files[0]
    if (!frame || !rect || !file) {
      setEditorDropActive(false)
      return
    }

    const insideDisk = pointInDisk(frame, event.clientX - rect.left, event.clientY - rect.top)
    setEditorDropActive(false)
    if (!insideDisk) return

    event.preventDefault()
    void importEditorFile(file)
  }

  const handleEditorPointer = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (activeTab !== 'editor' || playtestSession) return

    const canvas = canvasRef.current
    const rect = sceneLayout.canvasRect
    if (!canvas || !rect) return

    const cameraCenter = editorCameraCenterRef.current ?? editorCameraCenter
    const viewportInset = sceneLayout.viewportInset
    const activeCellId = pickGrid45CellAtPoint(
      editorPreviewState,
      rect.width,
      rect.height,
      event.clientX - rect.left,
      event.clientY - rect.top,
      {
        cameraCenter,
        cameraAngle: editorCameraAngle,
        viewportInset,
      },
    )
    const boundaryCellId =
      activeCellId === null
        ? pickGrid45CellAtPoint(
            editorPreviewState,
            rect.width,
            rect.height,
            event.clientX - rect.left,
            event.clientY - rect.top,
            {
              cameraCenter,
              cameraAngle: editorCameraAngle,
              viewportInset,
              includeBoundaryVoid: true,
            },
          )
        : null
    const paintCellId =
      activeCellId ??
      (boundaryCellId !== null && canPaintEditorBoundaryCell(editorWorld, boundaryCellId) ? boundaryCellId : null)
    const regionPaintMode = editorPaintMode === 'brush' ? editorRegionPaintModeFromPointer(event) : null
    const regionPaintPreview =
      regionPaintMode !== null && activeCellId !== null
        ? previewEditorRegionPaint(editorWorld, activeCellId, regionPaintMode)
        : null
    const leftBucketFillPreview =
      editorPaintMode === 'bucket' && activeCellId !== null && canBucketFillEditorTool(editorLeftTool)
        ? previewEditorBucketFill(editorWorld, activeCellId, editorLeftTool)
        : null
    const rightBucketFillPreview =
      editorPaintMode === 'bucket' && activeCellId !== null && canBucketFillEditorTool(editorRightTool)
        ? previewEditorBucketFill(editorWorld, activeCellId, editorRightTool)
        : null
    const bucketFillPreview = leftBucketFillPreview ?? rightBucketFillPreview
    const hoverCellId = editorPaintMode === 'bucket' ? activeCellId : paintCellId
    const hoverPreview =
      regionPaintPreview && regionPaintPreview.targets.length > 0
        ? createEditorHoverPreviewState(
            rect,
            event.clientX - rect.left,
            event.clientY - rect.top,
            regionPaintPreview.targets.map((target) => target.cell.id),
            regionPaintPreview.targets.filter((target) => !target.existsInWorld).map((target) => target.cell),
            [`+${regionPaintPreview.newCellCount}`, `\u0394${regionPaintPreview.changedCellCount}`],
          )
        : bucketFillPreview && bucketFillPreview.targetCellIds.length > 0
          ? createEditorHoverPreviewState(
              rect,
              event.clientX - rect.left,
              event.clientY - rect.top,
              bucketFillPreview.targetCellIds,
              [],
              bucketFillBadgeParts(leftBucketFillPreview?.changedCellCount ?? null, rightBucketFillPreview?.changedCellCount ?? null),
            )
          : null

    if (event.type === 'pointerdown') {
      if (event.button === 1 || isEditorModifierPan(event)) {
        event.preventDefault()
        canvas.setPointerCapture(event.pointerId)
        middleDragRef.current = {
          pointerId: event.pointerId,
          buttonMask: event.button === 1 ? 4 : 1,
          lastX: event.clientX,
          lastY: event.clientY,
          moved: false,
          startX: event.clientX,
          startY: event.clientY,
          allowCenterOnRelease: event.button === 1,
        }
        return
      }

      if (event.button === 0 || event.button === 2) {
        event.preventDefault()
        const paintButton = event.button === 0 ? 'left' : 'right'
        if (editorPaintMode === 'bucket') {
          if (activeCellId !== null) paintSelectedBucketFill(activeCellId, paintButton)
          return
        }
        if (regionPaintMode !== null && activeCellId !== null) {
          paintSelectedRegion(activeCellId, paintButton, regionPaintMode)
          return
        }
        canvas.setPointerCapture(event.pointerId)
        paintDragRef.current = {
          pointerId: event.pointerId,
          paintButton,
          lastCellId: paintCellId,
        }
        if (paintCellId !== null) paintSelectedCell(paintCellId, paintButton, true)
        return
      }

      return
    }

    if (event.type === 'pointermove') {
      setEditorHoverCellId(hoverCellId)
      setEditorHoverPreview(hoverPreview)
      const paintDrag = paintDragRef.current
      const isLeftPainting = paintDrag?.paintButton === 'left' && (event.buttons & 1) === 1
      const isRightPainting = paintDrag?.paintButton === 'right' && (event.buttons & 2) === 2
      if (editorPaintMode === 'brush' && paintDrag && paintDrag.pointerId === event.pointerId && (isLeftPainting || isRightPainting)) {
        if (paintCellId !== null && paintCellId !== paintDrag.lastCellId) {
          paintDrag.lastCellId = paintCellId
          paintSelectedCell(paintCellId, paintDrag.paintButton)
        }
      }

      const middleDrag = middleDragRef.current
      if (middleDrag && middleDrag.pointerId === event.pointerId && (event.buttons & middleDrag.buttonMask) === middleDrag.buttonMask) {
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
        if (!middleDrag.moved && middleDrag.allowCenterOnRelease && activeCellId !== null) {
          const now = performance.now()
          const previous = middleClickRef.current
          if (
            previous.cellId === activeCellId &&
            now - previous.time <= DOUBLE_MIDDLE_CLICK_MS &&
            Math.hypot(previous.x - event.clientX, previous.y - event.clientY) <= DOUBLE_MIDDLE_CLICK_DISTANCE
          ) {
            centerEditorOnCell(activeCellId)
            middleClickRef.current = { time: 0, x: 0, y: 0, cellId: null }
          } else {
            middleClickRef.current = {
              time: now,
              x: event.clientX,
              y: event.clientY,
              cellId: activeCellId,
            }
          }
        }
        middleDragRef.current = null
      }

      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId)
      }
      if (event.type === 'pointercancel') clearEditorHover()
    }
  }

  return (
    <div ref={appRef} className="grid45App">
      <div ref={navRef} className="grid45Nav">
        <div className="grid45NavBrand">Hyperbolic CC</div>
        <div className="grid45NavActions">
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
          <button className="grid45NavHelpButton" type="button" onClick={() => setHelpOpen(true)} aria-label="Open help">
            ?
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
        onDragOver={handleEditorFileDragOver}
        onDragLeave={handleEditorFileDragLeave}
        onDrop={handleEditorFileDrop}
        onPointerLeave={() => {
          if (activeTab === 'editor') clearEditorHover()
        }}
        onAuxClick={(event) => {
          if (activeTab === 'editor') event.preventDefault()
        }}
        onContextMenu={(event) => {
          if (activeTab === 'editor') event.preventDefault()
        }}
      />
      {activeTab === 'editor' && playtestSnapshot === null && editorHoverPreview ? (
        <div
          className="grid45EditorPreviewBadge"
          aria-hidden="true"
          style={{
            left: editorHoverPreview.cursorX,
            top: editorHoverPreview.cursorY,
          }}
        >
          {editorHoverPreview.badgeParts.map((part) => (
            <span key={part} className="grid45EditorPreviewBadgeCount">{part}</span>
          ))}
        </div>
      ) : null}
      {editorDropActive && sceneLayout.frame && activeTab === 'editor' && playtestSnapshot === null ? (
        <div
          className="grid45DropHint"
          aria-hidden="true"
          style={{
            left: sceneLayout.frame.centerX - sceneLayout.frame.diskRadius,
            top: sceneLayout.frame.centerY - sceneLayout.frame.diskRadius,
            width: sceneLayout.frame.diskRadius * 2,
            height: sceneLayout.frame.diskRadius * 2,
          }}
        >
          <div className="grid45DropHintInner">Drop level JSON</div>
        </div>
      ) : null}
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
      {helpOpen ? <HelpModal title={helpTitle} sections={helpSections} onClose={() => setHelpOpen(false)} /> : null}
      {editorLevelOpen ? (
        <LevelSettingsModal
          titleValue={editorWorld.title ?? ''}
          authorValue={editorWorld.author ?? ''}
          seed={editorWorld.seed}
          startCellId={editorWorld.startCellId}
          hasHint={Boolean(editorWorld.hint?.trim())}
          onTitleChange={(value) => updateEditorMetadata('title', value)}
          onAuthorChange={(value) => updateEditorMetadata('author', value)}
          onEditHint={() => {
            setEditorLevelOpen(false)
            setEditorHintOpen(true)
          }}
          onClose={() => setEditorLevelOpen(false)}
        />
      ) : null}
      {editorHintOpen ? <HintEditorModal value={editorWorld.hint ?? ''} onChange={(value) => updateEditorMetadata('hint', value)} onClose={() => setEditorHintOpen(false)} /> : null}
      {editorBlankOpen ? (
        <BlankMapModal
          size={editorBlankSize}
          onSizeChange={setEditorBlankSize}
          onCreate={() => {
            setEditorBlankOpen(false)
            createNewBlankEditorMap()
          }}
          onClose={() => setEditorBlankOpen(false)}
        />
      ) : null}
      {activeTab === 'play' && showDevToggle && showDagValidator ? <DagValidatorPanel ref={dagPanelRef} snapshot={playSnapshot} /> : null}
      {orbitFrame && orbitGroups.length > 0 ? <CircularInventoryRing frame={orbitFrame} groups={orbitGroups} /> : null}
      {orbitFrame && radialHintText.length > 0 ? <CircularHintText frame={orbitFrame} text={radialHintText} /> : null}

      {activeTab === 'play' ? (
        <div ref={hudRef} className="grid45Hud">
          <div className="grid45Eyebrow">Hyperbolic CC</div>
          <div className="grid45StatList">
            {homeStatusMetrics.map((metric) => (
              <div key={metric.label} className="grid45StatItem">
                <span className="grid45StatLabel">{metric.label}</span>
                <span className="grid45StatValue">{metric.value}</span>
              </div>
            ))}
          </div>
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
            <div className="grid45MonsterCompactGrid">
              {monsterControls.map((control) => (
                <div key={control.id} className="grid45MonsterCompactItem">
                  <div className="grid45MonsterCompactHeader">
                    <span className="grid45MonsterName">{control.label}</span>
                    <span className="grid45MonsterCount">{control.value}</span>
                  </div>
                  <div className="grid45MonsterCompactControls">
                    <button
                      className="grid45Button grid45StepButton"
                      type="button"
                      onClick={() => control.setValue((count) => Math.max(MIN_MONSTER_COUNT, count - 1))}
                    >
                      -
                    </button>
                    <input
                      className="grid45Slider"
                      type="range"
                      min={MIN_MONSTER_COUNT}
                      max={MAX_MONSTER_COUNT}
                      step={1}
                      value={control.value}
                      onChange={(event) => control.setValue(Number(event.target.value))}
                    />
                    <button
                      className="grid45Button grid45StepButton"
                      type="button"
                      onClick={() => control.setValue((count) => Math.min(MAX_MONSTER_COUNT, count + 1))}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
              <div className="grid45StatList grid45StatListEditor">
                {editorPlaytestMetrics.map((metric) => (
                  <div key={metric.label} className={`grid45StatItem${metric.wide ? ' grid45StatItemWide' : ''}`}>
                    <span className="grid45StatLabel">{metric.label}</span>
                    <span className="grid45StatValue">{metric.value}</span>
                  </div>
                ))}
              </div>
              <label className="grid45Toggle grid45ToggleCompact">
                <input
                  type="checkbox"
                  checked={stepModeEnabled}
                  onChange={(event) => setStepModeEnabled(event.target.checked)}
                />
                <span>Step Mode</span>
              </label>
              <div className="grid45EditorActionGrid">
                <button
                  className="grid45Button grid45ButtonCompact grid45ButtonPrimary"
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
              <input
                ref={editorFileInputRef}
                className="grid45HiddenInput"
                type="file"
                accept=".json,application/json"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  void importEditorFile(file)
                }}
              />
              <div ref={editorMenuBarRef} className="grid45EditorMenuBar" role="menubar" aria-label="Editor menus">
                <div className="grid45EditorMenu">
                  <button
                    className={`grid45EditorMenuTrigger${editorMenuOpen === 'level' ? ' grid45EditorMenuTriggerOpen' : ''}`}
                    type="button"
                    role="menuitem"
                    aria-haspopup="true"
                    aria-expanded={editorMenuOpen === 'level'}
                    onClick={() => toggleEditorMenu('level')}
                  >
                    Level
                  </button>
                  {editorMenuOpen === 'level' ? (
                    <div className="grid45EditorMenuDropdown" role="menu">
                      <div className="grid45EditorMenuList">
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            setEditorLevelOpen(true)
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">Level Settings...</span>
                        </button>
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            setEditorHintOpen(true)
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">{editorWorld.hint?.trim() ? 'Edit Hint...' : 'Add Hint...'}</span>
                          <span className="grid45EditorMenuItemMeta">{editorWorld.hint?.trim() ? 'Set' : 'Empty'}</span>
                        </button>
                        <div className="grid45EditorMenuSeparator" />
                        <div className="grid45EditorMenuInfoRow">
                          <span className="grid45EditorMenuSectionLabel">Seed</span>
                          <span className="grid45EditorMenuItemMeta">{editorWorld.seed}</span>
                        </div>
                        <div className="grid45EditorMenuInfoRow">
                          <span className="grid45EditorMenuSectionLabel">Start</span>
                          <span className="grid45EditorMenuItemMeta">{editorWorld.startCellId}</span>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="grid45EditorMenu">
                  <button
                    className={`grid45EditorMenuTrigger${editorMenuOpen === 'file' ? ' grid45EditorMenuTriggerOpen' : ''}`}
                    type="button"
                    role="menuitem"
                    aria-haspopup="true"
                    aria-expanded={editorMenuOpen === 'file'}
                    onClick={() => toggleEditorMenu('file')}
                  >
                    File
                  </button>
                  {editorMenuOpen === 'file' ? (
                    <div className="grid45EditorMenuDropdown" role="menu">
                      <div className="grid45EditorMenuList">
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            editorFileInputRef.current?.click()
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">Load JSON...</span>
                        </button>
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            downloadLevelJson(editorWorld)
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">Save JSON</span>
                        </button>
                        <div className="grid45EditorMenuSeparator" />
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            usePlayMapAsEditorWorld()
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">Use Play Map</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div className="grid45EditorMenu">
                  <button
                    className={`grid45EditorMenuTrigger${editorMenuOpen === 'map' ? ' grid45EditorMenuTriggerOpen' : ''}`}
                    type="button"
                    role="menuitem"
                    aria-haspopup="true"
                    aria-expanded={editorMenuOpen === 'map'}
                    onClick={() => toggleEditorMenu('map')}
                  >
                    Map
                  </button>
                  {editorMenuOpen === 'map' ? (
                    <div className="grid45EditorMenuDropdown" role="menu">
                      <div className="grid45EditorMenuList">
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            clearCurrentEditorMap()
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">Clear Map</span>
                        </button>
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            shrinkCurrentEditorMap()
                          }}
                          disabled={editorShrinkDelta === 0 || editorShrinkDelta >= editorMapCellCount}
                        >
                          <span className="grid45EditorMenuItemLabel">Shrink Map</span>
                          <span className="grid45EditorMenuItemMeta">{`-${editorShrinkDelta}`}</span>
                        </button>
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            growCurrentEditorMap()
                          }}
                          disabled={editorGrowDelta === 0}
                        >
                          <span className="grid45EditorMenuItemLabel">Grow Map</span>
                          <span className="grid45EditorMenuItemMeta">{`+${editorGrowDelta}`}</span>
                        </button>
                        <div className="grid45EditorMenuSeparator" />
                        <button
                          className="grid45EditorMenuItem"
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            closeEditorMenu()
                            setEditorBlankOpen(true)
                          }}
                        >
                          <span className="grid45EditorMenuItemLabel">New Blank...</span>
                          <span className="grid45EditorMenuItemMeta">{worldSizeLabels[editorBlankSize]}</span>
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="grid45EditorToolbar">
                <div className="grid45SegmentedControl" role="group" aria-label="Paint mode">
                  <button
                    className={`grid45SegmentedButton${editorPaintMode === 'brush' ? ' grid45SegmentedButtonActive' : ''}`}
                    type="button"
                    onClick={() => setEditorPaintMode('brush')}
                  >
                    Brush
                  </button>
                  <button
                    className={`grid45SegmentedButton${editorPaintMode === 'bucket' ? ' grid45SegmentedButtonActive' : ''}`}
                    type="button"
                    onClick={() => setEditorPaintMode('bucket')}
                    disabled={!editorBucketFillEnabled}
                    title={editorBucketFillEnabled ? 'Fill contiguous terrain regions.' : 'Bucket fill needs a terrain brush on the left or right button.'}
                  >
                    Bucket Fill
                  </button>
                </div>
                <label className="grid45Toggle grid45ToggleCompact grid45TogglePill">
                  <input
                    type="checkbox"
                    checked={stepModeEnabled}
                    onChange={(event) => setStepModeEnabled(event.target.checked)}
                  />
                  <span>Step</span>
                </label>
                <button className="grid45Button grid45ButtonCompact grid45ButtonPrimary" type="button" onClick={startEditorPlaytest}>
                  Playtest
                </button>
                <button className="grid45Button grid45ButtonCompact" type="button" onClick={undoEditor} disabled={editorHistory.length === 0}>
                  Undo
                </button>
              </div>
              <div className="grid45StatList grid45StatListEditor">
                {editorStatusMetrics.map((metric) => (
                  <div key={metric.label} className="grid45StatItem">
                    <span className="grid45StatLabel">{metric.label}</span>
                    <span className="grid45StatValue">{metric.value}</span>
                  </div>
                ))}
              </div>
              {editorIoStatus ? <div className={`grid45IoNote grid45IoNote${editorIoStatus.tone === 'error' ? 'Error' : 'Info'}`}>{editorIoStatus.text}</div> : null}
              <div className="grid45BrushGrid">
                {editorFacingControls.map((control) => (
                  <div key={control.id} className="grid45BrushStrip">
                    <div className="grid45BrushSummary">
                      {control.icon ? <img className="grid45BrushPreview" src={control.icon} alt="" /> : null}
                      <div className="grid45BrushText">
                        <span className="grid45BrushLabel">{control.label}</span>
                        <span className="grid45BrushValue">{control.toolLabel}</span>
                        {isMobTool(control.tool) ? <span className="grid45BrushFacing">{control.facing}</span> : null}
                      </div>
                    </div>
                    <div className="grid45BrushButtons">
                      <button
                        className="grid45Button grid45ButtonCompact grid45StepButton"
                        type="button"
                        onClick={control.onRotateLeft}
                        disabled={!isMobTool(control.tool)}
                      >
                        ↺
                      </button>
                      <button
                        className="grid45Button grid45ButtonCompact grid45StepButton"
                        type="button"
                        onClick={control.onRotateRight}
                        disabled={!isMobTool(control.tool)}
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid45Palette grid45PaletteCompact">
                {editorPalette.map((item) => (
                  <button
                    key={item.tool}
                    className={`grid45PaletteButton${editorLeftTool === item.tool ? ' grid45PaletteButtonLeft' : ''}${editorRightTool === item.tool ? ' grid45PaletteButtonRight' : ''}`}
                    type="button"
                    title={item.label}
                    aria-label={item.label}
                    onClick={() => assignEditorTool('left', item.tool)}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      assignEditorTool('right', item.tool)
                    }}
                  >
                    {paletteIcons[item.tool] ? <img className="grid45PaletteIcon" src={paletteIcons[item.tool]} alt="" /> : null}
                    <span className="grid45PaletteAssignments">
                      {editorLeftTool === item.tool ? <span className="grid45PaletteBadge">L</span> : null}
                      {editorRightTool === item.tool ? <span className="grid45PaletteBadge grid45PaletteBadgeAlt">R</span> : null}
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
