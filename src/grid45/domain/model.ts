import type { Vec2 } from '../../hyper/vec2'

export type Direction = 'north' | 'east' | 'south' | 'west'
export type MoveIntent = Direction | 'stay'
export type CellKind = 'floor' | 'wall'
export type CellFeature = 'none' | 'chip' | 'socket' | 'exit'
export type TickOutcome = 'moved' | 'blocked' | 'resting' | 'locked' | 'completed'

export type DirectionMap<T> = Record<Direction, T>

export type MazeCell = {
  id: number
  kind: CellKind
  feature: CellFeature
  center: Vec2
  vertices: Vec2[]
  exits: DirectionMap<number | null>
}

export type MazeWorld = {
  cells: MazeCell[]
  startCellId: number
  chipCellIds: number[]
  socketCellId: number
  exitCellId: number
}

export type GameState = {
  tick: number
  playerCellId: number
  playerFacing: Direction
  cameraAngle: number
  recoveryTicks: number
  lastIntent: MoveIntent
  lastOutcome: TickOutcome
  remainingChipCellIds: Set<number>
  socketCleared: boolean
  levelComplete: boolean
  world: MazeWorld
}
