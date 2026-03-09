import type { Vec2 } from '../../hyper/vec2'

export type Direction = 'north' | 'east' | 'south' | 'west'
export type MoveIntent = Direction | 'stay'
export type CellKind = 'floor' | 'wall' | 'toggle-floor' | 'toggle-wall'
export const keyColors = ['blue', 'red', 'green', 'yellow'] as const
export type KeyColor = (typeof keyColors)[number]
export type CellFeature =
  | 'none'
  | 'bomb'
  | 'chip'
  | 'green-button'
  | 'socket'
  | 'tank-button'
  | 'exit'
  | 'key-blue'
  | 'key-red'
  | 'key-green'
  | 'key-yellow'
  | 'door-blue'
  | 'door-red'
  | 'door-green'
  | 'door-yellow'
export type TickOutcome = 'moved' | 'blocked' | 'resting' | 'locked' | 'completed' | 'dead'

export type DirectionMap<T> = Record<Direction, T>
export type KeyInventory = Record<KeyColor, number>
export type MonsterKind = 'ant' | 'pink-ball' | 'teeth' | 'tank' | 'dirt-block' | 'glider' | 'fireball'

export type AreaDagNode = {
  id: number
  depth: number
  entryCellId: number
  cellIds: number[]
  chipCellIds: number[]
  keyColors: KeyColor[]
  kind: 'start' | 'normal' | 'final'
}

export type AreaDagEdge = {
  fromAreaId: number
  toAreaId: number
  gateCellId: number
  gateCellIds: number[]
  gate: 'door' | 'socket'
  color: KeyColor | null
}

export type AreaDagValidation = {
  passed: boolean
  summary: string
  steps: string[]
}

export type AreaDag = {
  nodes: AreaDagNode[]
  edges: AreaDagEdge[]
  validation: AreaDagValidation
}

export type MazeCell = {
  id: number
  kind: CellKind
  feature: CellFeature
  center: Vec2
  vertices: Vec2[]
  exits: DirectionMap<number | null>
}

export type MonsterState = {
  id: number
  kind: MonsterKind
  cellId: number
  facing: Direction
  recoveryTicks: number
}

export type MazeWorld = {
  seed: number
  cells: MazeCell[]
  startCellId: number
  chipCellIds: number[]
  socketCellId: number
  exitCellId: number
  areaDag: AreaDag
  initialMonsters: MonsterState[]
}

export type GameState = {
  tick: number
  playerCellId: number
  playerFacing: Direction
  cameraAngle: number
  recoveryTicks: number
  lastIntent: MoveIntent
  lastOutcome: TickOutcome
  monsters: MonsterState[]
  remainingChipCellIds: Set<number>
  collectedKeyCellIds: Set<number>
  openedDoorCellIds: Set<number>
  removedBombCellIds: Set<number>
  keyInventory: KeyInventory
  socketCleared: boolean
  togglePhase: boolean
  playerDead: boolean
  levelComplete: boolean
  world: MazeWorld
}

export function createEmptyKeyInventory(): KeyInventory {
  return {
    blue: 0,
    red: 0,
    green: 0,
    yellow: 0,
  }
}

export function featureForKey(color: KeyColor): CellFeature {
  if (color === 'blue') return 'key-blue'
  if (color === 'red') return 'key-red'
  if (color === 'green') return 'key-green'
  return 'key-yellow'
}

export function featureForDoor(color: KeyColor): CellFeature {
  if (color === 'blue') return 'door-blue'
  if (color === 'red') return 'door-red'
  if (color === 'green') return 'door-green'
  return 'door-yellow'
}

export function keyColorFromFeature(feature: CellFeature): KeyColor | null {
  if (feature === 'key-blue') return 'blue'
  if (feature === 'key-red') return 'red'
  if (feature === 'key-green') return 'green'
  if (feature === 'key-yellow') return 'yellow'
  return null
}

export function doorColorFromFeature(feature: CellFeature): KeyColor | null {
  if (feature === 'door-blue') return 'blue'
  if (feature === 'door-red') return 'red'
  if (feature === 'door-green') return 'green'
  if (feature === 'door-yellow') return 'yellow'
  return null
}

export function currentCellKind(kind: CellKind, togglePhase: boolean): CellKind {
  if (kind === 'toggle-floor') return togglePhase ? 'toggle-wall' : 'toggle-floor'
  if (kind === 'toggle-wall') return togglePhase ? 'toggle-floor' : 'toggle-wall'
  return kind
}

export function isPassableCellKind(kind: CellKind, togglePhase: boolean): boolean {
  const effectiveKind = currentCellKind(kind, togglePhase)
  return effectiveKind === 'floor' || effectiveKind === 'toggle-floor'
}
