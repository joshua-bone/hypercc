import { hyperbolicDistance } from '../../hyper/poincare'
import { cameraAngleForMove } from './camera'
import { directions, resolveCameraRelativeExits } from './directions'
import {
  createEmptyKeyInventory,
  doorColorFromFeature,
  isPassableCellKind,
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
  'world' | 'remainingChipCellIds' | 'collectedKeyCellIds' | 'openedDoorCellIds' | 'removedBombCellIds' | 'socketCleared' | 'togglePhase'
>

type MonsterAdvanceResult = {
  monsters: MonsterState[]
  playerDead: boolean
  removedBombCellIds: Set<number>
  togglePhase: boolean
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
    playerFacing: 'south',
    cameraAngle: 0,
    recoveryTicks: 0,
    lastIntent: 'stay',
    lastOutcome: 'resting',
    monsters: world.initialMonsters.map((monster) => ({ ...monster })),
    remainingChipCellIds: new Set(world.chipCellIds),
    collectedKeyCellIds: new Set<number>(),
    openedDoorCellIds: new Set<number>(),
    removedBombCellIds: new Set<number>(),
    keyInventory: createEmptyKeyInventory(),
    socketCleared: false,
    togglePhase: false,
    playerDead: false,
    levelComplete: false,
    world,
  }
}

function isBombActive(state: Pick<GameState, 'removedBombCellIds' | 'world'> | Pick<MonsterTraversalState, 'removedBombCellIds' | 'world'>, cellId: number): boolean {
  return state.world.cells[cellId].feature === 'bomb' && !state.removedBombCellIds.has(cellId)
}

function removeBombCell(removedBombCellIds: Set<number>, cellId: number): Set<number> {
  if (removedBombCellIds.has(cellId)) return removedBombCellIds
  const nextRemovedBombCellIds = new Set(removedBombCellIds)
  nextRemovedBombCellIds.add(cellId)
  return nextRemovedBombCellIds
}

function canEnterCell(state: GameState, targetId: number): boolean {
  const cell = state.world.cells[targetId]
  if (!isPassableCellKind(cell.kind, state.togglePhase)) return false
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
  if (!isPassableCellKind(cell.kind, state.togglePhase)) return false

  const doorColor = doorColorFromFeature(cell.feature)
  if (doorColor !== null) return state.openedDoorCellIds.has(targetId)
  if (cell.feature === 'socket') return state.socketCleared
  if (cell.feature === 'chip') return !state.remainingChipCellIds.has(targetId)

  const keyColor = keyColorFromFeature(cell.feature)
  if (keyColor !== null) return state.collectedKeyCellIds.has(targetId)

  return cell.feature === 'none' || cell.feature === 'green-button' || cell.feature === 'tank-button' || isBombActive(state, targetId)
}

function dirtBlockCanEnterCell(
  state: MonsterTraversalState,
  targetId: number,
  occupiedCellIds: Set<number>,
): boolean {
  if (occupiedCellIds.has(targetId)) return false

  const cell = state.world.cells[targetId]
  if (!isPassableCellKind(cell.kind, state.togglePhase)) return false
  if (cell.feature === 'none' || cell.feature === 'green-button' || cell.feature === 'tank-button' || isBombActive(state, targetId)) return true

  const keyColor = keyColorFromFeature(cell.feature)
  if (keyColor === 'blue' || keyColor === 'red') return true

  return false
}

function nextFacingFromMove(world: MazeWorld, previousCellId: number, nextCellId: number, fallback: Direction): Direction {
  const backwardDirection = directions.find((direction) => world.cells[nextCellId].exits[direction] === previousCellId)
  return backwardDirection ? oppositeDirection[backwardDirection] : fallback
}

function reverseDirection(direction: Direction): Direction {
  return oppositeDirection[direction]
}

function reverseTankFacing(monster: MonsterState): MonsterState {
  if (monster.kind !== 'tank') return monster
  return {
    ...monster,
    facing: reverseDirection(monster.facing),
  }
}

function reverseTankMonsters(monsters: MonsterState[]): MonsterState[] {
  return monsters.map(reverseTankFacing)
}

function findMonsterIndexAtCell(monsters: MonsterState[], cellId: number): number {
  return monsters.findIndex((monster) => monster.cellId === cellId)
}

function pushDirectionFromCell(world: MazeWorld, sourceCellId: number, previousCellId: number): Direction | null {
  const backwardDirection = directions.find((direction) => world.cells[sourceCellId].exits[direction] === previousCellId)
  return backwardDirection ? oppositeDirection[backwardDirection] : null
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

  if (monster.kind === 'tank') {
    return {
      facing: monster.facing,
      directions: [monster.facing],
    }
  }

  if (monster.kind === 'dirt-block') {
    return {
      facing: monster.facing,
      directions: [],
    }
  }

  return {
    facing: monster.facing,
    directions: antTurnPriority[monster.facing],
  }
}

function cooldownTicksForMonster(kind: MonsterState['kind']): number {
  if (kind === 'dirt-block') return 0
  return kind === 'teeth' ? 3 : 1
}

function advanceMonsters(
  state: MonsterTraversalState,
  monsters: MonsterState[],
  playerCellId: number,
): MonsterAdvanceResult {
  const nextMonsters: MonsterState[] = []
  const occupiedCellIds = new Set(monsters.map((monster) => monster.cellId))
  let removedBombCellIds = state.removedBombCellIds
  let togglePhase = state.togglePhase
  let tankDirectionsReversed = false

  for (let monsterIndex = 0; monsterIndex < monsters.length; monsterIndex += 1) {
    const storedMonster = monsters[monsterIndex]
    const monster = tankDirectionsReversed && storedMonster.kind === 'tank' ? reverseTankFacing(storedMonster) : storedMonster
    occupiedCellIds.delete(monster.cellId)

    if (monster.recoveryTicks > 0) {
      nextMonsters.push({
        ...monster,
        recoveryTicks: monster.recoveryTicks - 1,
      })
      occupiedCellIds.add(monster.cellId)
      continue
    }

    const movePlan = movePlanForMonster(
      {
        ...state,
        togglePhase,
      },
      monster,
      playerCellId,
    )
    const activeMonster = movePlan.facing === monster.facing ? monster : { ...monster, facing: movePlan.facing }
    const cell = state.world.cells[activeMonster.cellId]
    let moved = false

    for (const direction of movePlan.directions) {
      const targetId = cell.exits[direction]
      if (
        targetId === null ||
        !monsterCanEnterCell(
          {
            ...state,
            removedBombCellIds,
            togglePhase,
          },
          targetId,
          playerCellId,
          occupiedCellIds,
        )
      ) {
        continue
      }

      const nextMonster = {
        ...activeMonster,
        cellId: targetId,
        facing: nextFacingFromMove(state.world, monster.cellId, targetId, direction),
        recoveryTicks: cooldownTicksForMonster(activeMonster.kind),
      }

      if (targetId === playerCellId) {
        return {
          monsters: [
            ...nextMonsters,
            nextMonster,
            ...monsters.slice(monsterIndex + 1).map((remainingMonster) =>
              tankDirectionsReversed && remainingMonster.kind === 'tank' ? reverseTankFacing(remainingMonster) : { ...remainingMonster },
            ),
          ],
          playerDead: true,
          removedBombCellIds,
          togglePhase,
        }
      }

      const enteredCell = state.world.cells[targetId]
      if (isBombActive({ world: state.world, removedBombCellIds }, targetId)) {
        removedBombCellIds = removeBombCell(removedBombCellIds, targetId)
        moved = true
        break
      }

      nextMonsters.push(nextMonster)
      if (enteredCell.feature === 'green-button') {
        togglePhase = !togglePhase
      }
      if (enteredCell.feature === 'tank-button') {
        tankDirectionsReversed = !tankDirectionsReversed
        for (let index = 0; index < nextMonsters.length; index += 1) {
          nextMonsters[index] = reverseTankFacing(nextMonsters[index])
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
    removedBombCellIds,
    togglePhase,
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
  let removedBombCellIds = state.removedBombCellIds
  let keyInventory = state.keyInventory
  let socketCleared = state.socketCleared
  let togglePhase = state.togglePhase
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
      const blockingMonsterIndex = findMonsterIndexAtCell(monsters, targetId)
      const blockingMonster = blockingMonsterIndex >= 0 ? monsters[blockingMonsterIndex] : null

      if (blockingMonster?.kind === 'dirt-block') {
        const pushDirection = pushDirectionFromCell(state.world, targetId, playerCellId)
        const pushTargetId = pushDirection ? state.world.cells[targetId].exits[pushDirection] : null
        const occupiedByOtherMonsters = new Set(
          monsters.filter((monster, index) => index !== blockingMonsterIndex).map((monster) => monster.cellId),
        )

        if (pushTargetId === null || !dirtBlockCanEnterCell({ ...state, removedBombCellIds, togglePhase }, pushTargetId, occupiedByOtherMonsters)) {
          playerFacing = intent
          lastOutcome = 'blocked'
        } else {
          if (isBombActive({ world: state.world, removedBombCellIds }, pushTargetId)) {
            removedBombCellIds = removeBombCell(removedBombCellIds, pushTargetId)
            monsters = monsters.filter((_, index) => index !== blockingMonsterIndex)
          } else {
            monsters = monsters.map((monster, index) =>
              index === blockingMonsterIndex
                ? {
                    ...monster,
                    cellId: pushTargetId,
                    recoveryTicks: 0,
                  }
                : monster,
            )

            const pushedIntoCell = state.world.cells[pushTargetId]
            if (pushedIntoCell.feature === 'green-button') {
              togglePhase = !togglePhase
            }
            if (pushedIntoCell.feature === 'tank-button') {
              monsters = reverseTankMonsters(monsters)
            }
          }

          playerFacing = intent
          cameraAngle = cameraAngleForMove(state.world.cells[playerCellId].center, targetCell.center, intent)
          playerCellId = targetId

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
          if (targetCell.feature === 'green-button') {
            togglePhase = !togglePhase
          }
          if (targetCell.feature === 'tank-button') {
            monsters = reverseTankMonsters(monsters)
          }
          if (isBombActive({ world: state.world, removedBombCellIds }, targetId)) {
            removedBombCellIds = removeBombCell(removedBombCellIds, targetId)
            playerDead = true
            recoveryTicks = 0
            lastOutcome = 'dead'
          } else {
            levelComplete = targetId === state.world.exitCellId
            recoveryTicks = levelComplete ? 0 : 1
            lastOutcome = levelComplete ? 'completed' : 'moved'
          }
        }
      } else {
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

      const collidedWithMonster = blockingMonster !== null
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
        if (targetCell.feature === 'green-button') {
          togglePhase = !togglePhase
        }
        if (targetCell.feature === 'tank-button') {
          monsters = reverseTankMonsters(monsters)
        }
        if (isBombActive({ world: state.world, removedBombCellIds }, targetId)) {
          removedBombCellIds = removeBombCell(removedBombCellIds, targetId)
          playerDead = true
          recoveryTicks = 0
          lastOutcome = 'dead'
        } else {
          levelComplete = targetId === state.world.exitCellId
          recoveryTicks = levelComplete ? 0 : 1
          lastOutcome = levelComplete ? 'completed' : 'moved'
        }
      }
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
        removedBombCellIds,
        socketCleared,
        togglePhase,
      },
      monsters,
      playerCellId,
    )
    monsters = monsterAdvance.monsters
    removedBombCellIds = monsterAdvance.removedBombCellIds
    togglePhase = monsterAdvance.togglePhase
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
    removedBombCellIds,
    keyInventory,
    socketCleared,
    togglePhase,
    playerDead,
    levelComplete,
  }
}
