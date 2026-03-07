import { dot, lenSq, norm } from '../../hyper/vec2'
import { toCameraView } from './camera'
import type { Vec2 } from '../../hyper/vec2'
import type { Direction, DirectionMap, GameState, MazeWorld, MoveIntent } from './model'

export const directions: Direction[] = ['north', 'east', 'south', 'west']

export const directionVectors: DirectionMap<Vec2> = {
  north: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  south: { x: 0, y: -1 },
  west: { x: -1, y: 0 },
}

export function directionFromKey(key: string): MoveIntent | null {
  if (key === 'ArrowUp' || key === 'w' || key === 'W') return 'north'
  if (key === 'ArrowRight' || key === 'd' || key === 'D') return 'east'
  if (key === 'ArrowDown' || key === 's' || key === 'S') return 'south'
  if (key === 'ArrowLeft' || key === 'a' || key === 'A') return 'west'
  return null
}

type ExitCandidate = {
  direction: Direction
  targetId: number
  viewVector: Vec2
}

export function resolveCameraRelativeExits(state: Pick<GameState, 'cameraAngle' | 'playerCellId' | 'world'>): DirectionMap<number | null> {
  const cell = state.world.cells[state.playerCellId]
  const candidates: ExitCandidate[] = directions.flatMap((direction) => {
    const targetId = cell.exits[direction]
    if (targetId === null) return []

    const viewVector = toCameraView(state.world.cells[targetId].center, cell.center, state.cameraAngle)
    if (lenSq(viewVector) < 1e-12) return []

    return [
      {
        direction,
        targetId,
        viewVector: norm(viewVector),
      },
    ]
  })

  let bestScore = -Infinity
  let bestMapping: DirectionMap<number | null> = {
    north: null,
    east: null,
    south: null,
    west: null,
  }

  const currentMapping: DirectionMap<number | null> = {
    north: null,
    east: null,
    south: null,
    west: null,
  }
  const usedDirections = new Set<Direction>()

  const visit = (screenIndex: number, score: number) => {
    if (screenIndex === directions.length) {
      if (score > bestScore) {
        bestScore = score
        bestMapping = { ...currentMapping }
      }
      return
    }

    const screenDirection = directions[screenIndex]
    currentMapping[screenDirection] = null
    visit(screenIndex + 1, score)

    for (const candidate of candidates) {
      if (usedDirections.has(candidate.direction)) continue

      const alignment = dot(candidate.viewVector, directionVectors[screenDirection])
      if (alignment <= 0) continue

      usedDirections.add(candidate.direction)
      currentMapping[screenDirection] = candidate.targetId
      visit(screenIndex + 1, score + alignment)
      usedDirections.delete(candidate.direction)
      currentMapping[screenDirection] = null
    }
  }

  visit(0, 0)
  return bestMapping
}
