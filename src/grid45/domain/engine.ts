import { cameraAngleForMove } from './camera'
import { resolveCameraRelativeExits } from './directions'
import type { GameState, MoveIntent, MazeWorld, TickOutcome } from './model'

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
    socketCleared: false,
    levelComplete: false,
    world,
  }
}

function canEnterCell(state: GameState, targetId: number): boolean {
  const cell = state.world.cells[targetId]
  if (cell.kind !== 'floor') return false
  if (targetId === state.world.socketCellId && state.remainingChipCellIds.size > 0) return false
  return true
}

export function advanceGame(state: GameState, intent: MoveIntent): GameState {
  let playerCellId = state.playerCellId
  let playerFacing = state.playerFacing
  let cameraAngle = state.cameraAngle
  let recoveryTicks = state.recoveryTicks
  let lastOutcome: TickOutcome = 'resting'
  let remainingChipCellIds = state.remainingChipCellIds
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
    recoveryTicks -= 1
    lastOutcome = 'locked'
  } else if (intent !== 'stay') {
    const targetId = resolveCameraRelativeExits(state)[intent]
    if (targetId !== null && canEnterCell(state, targetId)) {
      playerFacing = intent
      cameraAngle = cameraAngleForMove(state.world.cells[playerCellId].center, state.world.cells[targetId].center, intent)
      playerCellId = targetId
      if (state.remainingChipCellIds.has(targetId)) {
        remainingChipCellIds = new Set(state.remainingChipCellIds)
        remainingChipCellIds.delete(targetId)
      }
      if (targetId === state.world.socketCellId) {
        socketCleared = true
      }
      levelComplete = targetId === state.world.exitCellId
      recoveryTicks = levelComplete ? 0 : 1
      lastOutcome = levelComplete ? 'completed' : 'moved'
    } else {
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
    socketCleared,
    levelComplete,
  }
}
