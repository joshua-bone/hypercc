import { cameraAngleForMove } from './camera'
import { resolveCameraRelativeExits } from './directions'
import {
  createEmptyKeyInventory,
  doorColorFromFeature,
  keyColorFromFeature,
  type AntState,
  type Direction,
  type GameState,
  type MazeWorld,
  type MoveIntent,
  type TickOutcome,
} from './model'

const antTurnPriority: Record<Direction, Direction[]> = {
  north: ['west', 'north', 'east', 'south'],
  east: ['north', 'east', 'south', 'west'],
  south: ['east', 'south', 'west', 'north'],
  west: ['south', 'west', 'north', 'east'],
}

type AntTraversalState = Pick<
  GameState,
  'world' | 'remainingChipCellIds' | 'collectedKeyCellIds' | 'openedDoorCellIds' | 'socketCleared'
>

type AntAdvanceResult = {
  ants: AntState[]
  playerDead: boolean
}

export function createInitialGameState(world: MazeWorld): GameState {
  return {
    tick: 0,
    playerCellId: world.startCellId,
    playerFacing: 'north',
    cameraAngle: 0,
    recoveryTicks: 0,
    lastIntent: 'stay',
    lastOutcome: 'resting',
    ants: world.initialAnts.map((ant) => ({ ...ant })),
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

function antCanEnterCell(
  state: AntTraversalState,
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

function advanceAnts(
  state: AntTraversalState,
  ants: AntState[],
  playerCellId: number,
): AntAdvanceResult {
  const nextAnts: AntState[] = []
  const occupiedCellIds = new Set(ants.map((ant) => ant.cellId))

  for (let antIndex = 0; antIndex < ants.length; antIndex += 1) {
    const ant = ants[antIndex]
    occupiedCellIds.delete(ant.cellId)

    if (ant.recoveryTicks > 0) {
      nextAnts.push({
        ...ant,
        recoveryTicks: ant.recoveryTicks - 1,
      })
      occupiedCellIds.add(ant.cellId)
      continue
    }

    const cell = state.world.cells[ant.cellId]
    let moved = false

    for (const direction of antTurnPriority[ant.facing]) {
      const targetId = cell.exits[direction]
      if (targetId === null || !antCanEnterCell(state, targetId, playerCellId, occupiedCellIds)) continue

      const nextAnt = {
        ...ant,
        cellId: targetId,
        facing: direction,
        recoveryTicks: 1,
      }
      nextAnts.push(nextAnt)

      if (targetId === playerCellId) {
        return {
          ants: [...nextAnts, ...ants.slice(antIndex + 1).map((remainingAnt) => ({ ...remainingAnt }))],
          playerDead: true,
        }
      }

      occupiedCellIds.add(targetId)
      moved = true
      break
    }

    if (moved) continue

    nextAnts.push({ ...ant })
    occupiedCellIds.add(ant.cellId)
  }

  return {
    ants: nextAnts,
    playerDead: false,
  }
}

export function advanceGame(state: GameState, intent: MoveIntent): GameState {
  let playerCellId = state.playerCellId
  let playerFacing = state.playerFacing
  let cameraAngle = state.cameraAngle
  let recoveryTicks = state.recoveryTicks
  let lastOutcome: TickOutcome = 'resting'
  let ants = state.ants
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

      const collidedWithAnt = state.ants.some((ant) => ant.cellId === targetId)
      if (collidedWithAnt) {
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
    const antAdvance = advanceAnts(
      {
        world: state.world,
        remainingChipCellIds,
        collectedKeyCellIds,
        openedDoorCellIds,
        socketCleared,
      },
      ants,
      playerCellId,
    )
    ants = antAdvance.ants
    if (antAdvance.playerDead) {
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
    ants,
    remainingChipCellIds,
    collectedKeyCellIds,
    openedDoorCellIds,
    keyInventory,
    socketCleared,
    playerDead,
    levelComplete,
  }
}
