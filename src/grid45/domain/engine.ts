import { hyperbolicDistance } from '../../hyper/poincare'
import { cameraAngleForMove } from './camera'
import { directions, resolveCameraRelativeExits } from './directions'
import {
  createEmptyKeyInventory,
  doorColorFromFeature,
  keyColorFromFeature,
  type Direction,
  type DirectionMap,
  type GameState,
  type MazeWorld,
  type MonsterState,
  type MoveIntent,
  type TickOutcome,
} from './model'

const antTurnPriority: Record<Direction, Direction[]> = {
  north: ['west', 'north', 'east', 'south'],
  east: ['north', 'east', 'south', 'west'],
  south: ['east', 'south', 'west', 'north'],
  west: ['south', 'west', 'north', 'east'],
}

const oppositeDirection: DirectionMap<Direction> = {
  north: 'south',
  east: 'west',
  south: 'north',
  west: 'east',
}

type MonsterTraversalState = Pick<
  GameState,
  'world' | 'remainingChipCellIds' | 'collectedKeyCellIds' | 'openedDoorCellIds' | 'socketCleared'
>

type MonsterAdvanceResult = {
  monsters: MonsterState[]
  playerDead: boolean
}

type MonsterMovePlan = {
  facing: Direction
  directions: Direction[]
}

const DISTANCE_EPSILON = 1e-6

export function createInitialGameState(world: MazeWorld): GameState {
  return {
    tick: 0,
    playerCellId: world.startCellId,
    playerFacing: 'north',
    cameraAngle: 0,
    recoveryTicks: 0,
    lastIntent: 'stay',
    lastOutcome: 'resting',
    monsters: world.initialMonsters.map((monster) => ({ ...monster })),
    remainingChipCellIds: new Set(world.chipCellIds),
    collectedKeyCellIds: new Set<number>(),
    openedDoorCellIds: new Set<number>(),
    keyInventory: createEmptyKeyInventory(),
    socketCleared: false,
    playerDead: false,
    levelComplete: false,
    world,
  }
}

function canEnterCell(state: GameState, targetId: number): boolean {
  const cell = state.world.cells[targetId]
  if (cell.kind !== 'floor') return false
  const doorColor = doorColorFromFeature(cell.feature)
  if (doorColor !== null && !state.openedDoorCellIds.has(targetId) && state.keyInventory[doorColor] < 1) return false
  if (cell.feature === 'socket' && !state.socketCleared && state.remainingChipCellIds.size > 0) return false
  return true
}

function monsterCanEnterCell(
  state: MonsterTraversalState,
  targetId: number,
  playerCellId: number,
  occupiedCellIds: Set<number>,
): boolean {
  if (targetId === playerCellId) return true
  if (occupiedCellIds.has(targetId)) return false

  const cell = state.world.cells[targetId]
  if (cell.kind !== 'floor') return false

  const doorColor = doorColorFromFeature(cell.feature)
  if (doorColor !== null) return state.openedDoorCellIds.has(targetId)
  if (cell.feature === 'socket') return state.socketCleared
  if (cell.feature === 'chip') return !state.remainingChipCellIds.has(targetId)

  const keyColor = keyColorFromFeature(cell.feature)
  if (keyColor !== null) return state.collectedKeyCellIds.has(targetId)

  return cell.feature === 'none'
}

function nextFacingFromMove(world: MazeWorld, previousCellId: number, nextCellId: number, fallback: Direction): Direction {
  const backwardDirection = directions.find((direction) => world.cells[nextCellId].exits[direction] === previousCellId)
  return backwardDirection ? oppositeDirection[backwardDirection] : fallback
}

function chasePlanForTeeth(
  world: MazeWorld,
  monsterCellId: number,
  playerCellId: number,
  fallback: Direction,
): MonsterMovePlan {
  const playerCenter = world.cells[playerCellId].center
  const rankedDirections = directions
    .flatMap((direction) => {
      const targetId = world.cells[monsterCellId].exits[direction]
      if (targetId === null) return []

      return [
        {
          direction,
          hyperbolicDistance: hyperbolicDistance(world.cells[targetId].center, playerCenter),
        },
      ]
    })
    .sort((a, b) => {
      const distanceDelta = a.hyperbolicDistance - b.hyperbolicDistance
      if (Math.abs(distanceDelta) > DISTANCE_EPSILON) return distanceDelta
      if (a.direction === fallback && b.direction !== fallback) return -1
      if (b.direction === fallback && a.direction !== fallback) return 1
      return 0
    })

  const bestCandidate = rankedDirections[0]
  if (!bestCandidate) {
    return {
      facing: fallback,
      directions: [],
    }
  }

  const minimumDistance = bestCandidate.hyperbolicDistance
  const tiedDirections = rankedDirections
    .filter((candidate) => Math.abs(candidate.hyperbolicDistance - minimumDistance) <= DISTANCE_EPSILON)
    .map((candidate) => candidate.direction)

  return {
    facing: bestCandidate.direction,
    directions: tiedDirections,
  }
}

function movePlanForMonster(
  state: MonsterTraversalState,
  monster: MonsterState,
  playerCellId: number,
): MonsterMovePlan {
  if (monster.kind === 'pink-ball') {
    return {
      facing: monster.facing,
      directions: [monster.facing, oppositeDirection[monster.facing]],
    }
  }

  if (monster.kind === 'teeth') {
    return chasePlanForTeeth(state.world, monster.cellId, playerCellId, monster.facing)
  }

  return {
    facing: monster.facing,
    directions: antTurnPriority[monster.facing],
  }
}

function cooldownTicksForMonster(kind: MonsterState['kind']): number {
  return kind === 'teeth' ? 3 : 1
}

function advanceMonsters(
  state: MonsterTraversalState,
  monsters: MonsterState[],
  playerCellId: number,
): MonsterAdvanceResult {
  const nextMonsters: MonsterState[] = []
  const occupiedCellIds = new Set(monsters.map((monster) => monster.cellId))

  for (let monsterIndex = 0; monsterIndex < monsters.length; monsterIndex += 1) {
    const monster = monsters[monsterIndex]
    occupiedCellIds.delete(monster.cellId)

    if (monster.recoveryTicks > 0) {
      nextMonsters.push({
        ...monster,
        recoveryTicks: monster.recoveryTicks - 1,
      })
      occupiedCellIds.add(monster.cellId)
      continue
    }

    const movePlan = movePlanForMonster(state, monster, playerCellId)
    const activeMonster = movePlan.facing === monster.facing ? monster : { ...monster, facing: movePlan.facing }
    const cell = state.world.cells[activeMonster.cellId]
    let moved = false

    for (const direction of movePlan.directions) {
      const targetId = cell.exits[direction]
      if (targetId === null || !monsterCanEnterCell(state, targetId, playerCellId, occupiedCellIds)) continue

      const nextMonster = {
        ...activeMonster,
        cellId: targetId,
        facing: nextFacingFromMove(state.world, monster.cellId, targetId, direction),
        recoveryTicks: cooldownTicksForMonster(activeMonster.kind),
      }
      nextMonsters.push(nextMonster)

      if (targetId === playerCellId) {
        return {
          monsters: [...nextMonsters, ...monsters.slice(monsterIndex + 1).map((remainingMonster) => ({ ...remainingMonster }))],
          playerDead: true,
        }
      }

      occupiedCellIds.add(targetId)
      moved = true
      break
    }

    if (moved) continue

    nextMonsters.push({ ...activeMonster })
    occupiedCellIds.add(activeMonster.cellId)
  }

  return {
    monsters: nextMonsters,
    playerDead: false,
  }
}

export function advanceGame(state: GameState, intent: MoveIntent): GameState {
  let playerCellId = state.playerCellId
  let playerFacing = state.playerFacing
  let cameraAngle = state.cameraAngle
  let recoveryTicks = state.recoveryTicks
  let lastOutcome: TickOutcome = 'resting'
  let monsters = state.monsters
  let remainingChipCellIds = state.remainingChipCellIds
  let collectedKeyCellIds = state.collectedKeyCellIds
  let openedDoorCellIds = state.openedDoorCellIds
  let keyInventory = state.keyInventory
  let socketCleared = state.socketCleared
  let playerDead = state.playerDead
  let levelComplete = state.levelComplete

  if (levelComplete) {
    return {
      ...state,
      lastIntent: intent,
      lastOutcome: 'completed',
    }
  }

  if (playerDead) {
    return {
      ...state,
      lastIntent: intent,
      lastOutcome: 'dead',
    }
  }

  if (recoveryTicks > 0) {
    if (intent !== 'stay') playerFacing = intent
    recoveryTicks -= 1
    lastOutcome = 'locked'
  } else if (intent !== 'stay') {
    const targetId = resolveCameraRelativeExits(state)[intent]
    if (targetId !== null && canEnterCell(state, targetId)) {
      const targetCell = state.world.cells[targetId]
      const doorColor = doorColorFromFeature(targetCell.feature)
      if (doorColor !== null && !state.openedDoorCellIds.has(targetId)) {
        openedDoorCellIds = new Set(state.openedDoorCellIds)
        openedDoorCellIds.add(targetId)
        if (doorColor !== 'green') {
          keyInventory = {
            ...keyInventory,
            [doorColor]: keyInventory[doorColor] - 1,
          }
        }
      }

      playerFacing = intent
      cameraAngle = cameraAngleForMove(state.world.cells[playerCellId].center, targetCell.center, intent)
      playerCellId = targetId

      const collidedWithMonster = state.monsters.some((monster) => monster.cellId === targetId)
      if (collidedWithMonster) {
        playerDead = true
        lastOutcome = 'dead'
        recoveryTicks = 0
      } else {
        if (state.remainingChipCellIds.has(targetId)) {
          remainingChipCellIds = new Set(state.remainingChipCellIds)
          remainingChipCellIds.delete(targetId)
        }
        const keyColor = keyColorFromFeature(targetCell.feature)
        if (keyColor !== null && !state.collectedKeyCellIds.has(targetId)) {
          collectedKeyCellIds = new Set(state.collectedKeyCellIds)
          collectedKeyCellIds.add(targetId)
          keyInventory = {
            ...keyInventory,
            [keyColor]: keyInventory[keyColor] + 1,
          }
        }

        if (targetCell.feature === 'socket') {
          socketCleared = true
        }
        levelComplete = targetId === state.world.exitCellId
        recoveryTicks = levelComplete ? 0 : 1
        lastOutcome = levelComplete ? 'completed' : 'moved'
      }
    } else {
      playerFacing = intent
      lastOutcome = 'blocked'
    }
  }

  if (!playerDead && !levelComplete) {
    const monsterAdvance = advanceMonsters(
      {
        world: state.world,
        remainingChipCellIds,
        collectedKeyCellIds,
        openedDoorCellIds,
        socketCleared,
      },
      monsters,
      playerCellId,
    )
    monsters = monsterAdvance.monsters
    if (monsterAdvance.playerDead) {
      playerDead = true
      recoveryTicks = 0
      lastOutcome = 'dead'
    }
  }

  return {
    ...state,
    tick: state.tick + 1,
    playerCellId,
    playerFacing,
    cameraAngle,
    recoveryTicks,
    lastIntent: intent,
    lastOutcome,
    monsters,
    remainingChipCellIds,
    collectedKeyCellIds,
    openedDoorCellIds,
    keyInventory,
    socketCleared,
    playerDead,
    levelComplete,
  }
}
