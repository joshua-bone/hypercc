import { cameraAngleForMove } from './camera'
import { resolveCameraRelativeExits } from './directions'
import { createEmptyKeyInventory, doorColorFromFeature, keyColorFromFeature, type GameState, type MoveIntent, type MazeWorld, type TickOutcome } from './model'

export function createInitialGameState(world: MazeWorld): GameState {
  return {
    tick: 0,
    playerCellId: world.startCellId,
    playerFacing: 'north',
    cameraAngle: 0,
    recoveryTicks: 0,
    lastIntent: 'stay',
    lastOutcome: 'resting',
    remainingChipCellIds: new Set(world.chipCellIds),
    collectedKeyCellIds: new Set<number>(),
    openedDoorCellIds: new Set<number>(),
    keyInventory: createEmptyKeyInventory(),
    socketCleared: false,
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

function gateCellIdsForCell(world: MazeWorld, cellId: number): number[] {
  const edgeIndex = world.gateEdgeIndexByCellId[cellId] ?? -1
  if (edgeIndex < 0) return [cellId]
  return world.areaDag.edges[edgeIndex]?.gateCellIds ?? [cellId]
}

export function advanceGame(state: GameState, intent: MoveIntent): GameState {
  let playerCellId = state.playerCellId
  let playerFacing = state.playerFacing
  let cameraAngle = state.cameraAngle
  let recoveryTicks = state.recoveryTicks
  let lastOutcome: TickOutcome = 'resting'
  let remainingChipCellIds = state.remainingChipCellIds
  let collectedKeyCellIds = state.collectedKeyCellIds
  let openedDoorCellIds = state.openedDoorCellIds
  let keyInventory = state.keyInventory
  let socketCleared = state.socketCleared
  let levelComplete = state.levelComplete

  if (levelComplete) {
    return {
      ...state,
      lastIntent: intent,
      lastOutcome: 'completed',
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
        for (const gateCellId of gateCellIdsForCell(state.world, targetId)) {
          openedDoorCellIds.add(gateCellId)
        }
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
    } else {
      playerFacing = intent
      lastOutcome = 'blocked'
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
    remainingChipCellIds,
    collectedKeyCellIds,
    openedDoorCellIds,
    keyInventory,
    socketCleared,
    levelComplete,
  }
}
