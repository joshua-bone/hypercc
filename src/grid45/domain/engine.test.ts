import { describe, expect, it } from 'vitest'
import { directions } from './directions'
import { advanceGame, createInitialGameState } from './engine'
import { createGrid45World } from './world'
import { createBlankFloorEditorWorld } from '../ui/editorHelpers'

function createHintWorld() {
  const sourceWorld = createGrid45World({
    seed: 7,
    size: 'tiny',
    antCount: 0,
    pinkBallCount: 0,
    teethCount: 0,
    tankCount: 0,
  })
  const world = createBlankFloorEditorWorld(sourceWorld, sourceWorld.startCellId)
  const startCellId = world.startCellId
  const moveDirection = directions.find((direction) => {
    const neighborId = world.cells[startCellId].exits[direction]
    return neighborId !== null && world.cells[neighborId].kind !== 'void'
  })

  if (!moveDirection) throw new Error('Expected a neighboring map cell for the start cell.')

  const targetCellId = world.cells[startCellId].exits[moveDirection]
  if (targetCellId === null) throw new Error('Expected a concrete target cell id.')

  world.cells[targetCellId].feature = 'hint'
  world.hint = 'Follow the trail.'

  return {
    world,
    moveDirection,
    targetCellId,
  }
}

function createBlankTraversalWorld() {
  const sourceWorld = createGrid45World({
    seed: 17,
    size: 'tiny',
    antCount: 0,
    pinkBallCount: 0,
    teethCount: 0,
    tankCount: 0,
  })
  const world = createBlankFloorEditorWorld(sourceWorld, sourceWorld.startCellId)
  const startCellId = world.startCellId
  const moveDirection = directions.find((direction) => {
    const neighborId = world.cells[startCellId].exits[direction]
    return neighborId !== null && world.cells[neighborId].kind !== 'void'
  })

  if (!moveDirection) throw new Error('Expected a neighboring map cell for the start cell.')

  const targetCellId = world.cells[startCellId].exits[moveDirection]
  if (targetCellId === null) throw new Error('Expected a concrete target cell id.')

  const returnDirection = directions.find((direction) => world.cells[targetCellId].exits[direction] === startCellId)
  if (!returnDirection) throw new Error('Expected a return direction back to the start cell.')

  return {
    world,
    moveDirection,
    returnDirection,
    targetCellId,
  }
}

describe('engine', () => {
  it('treats hint tiles like walkable floor for the player', () => {
    const { world, moveDirection, targetCellId } = createHintWorld()

    const nextState = advanceGame(createInitialGameState(world), moveDirection)

    expect(nextState.playerCellId).toBe(targetCellId)
    expect(nextState.lastOutcome).toBe('moved')
    expect(nextState.playerDead).toBe(false)
    expect(nextState.world.cells[targetCellId].feature).toBe('hint')
  })

  it('only completes the level when the player steps onto an actual exit tile', () => {
    const { world, moveDirection, targetCellId } = createBlankTraversalWorld()
    world.cells[targetCellId].feature = 'exit'
    world.exitCellId = targetCellId

    const nextState = advanceGame(createInitialGameState(world), moveDirection)

    expect(nextState.playerCellId).toBe(targetCellId)
    expect(nextState.levelComplete).toBe(true)
    expect(nextState.lastOutcome).toBe('completed')
  })

  it('does not complete the level on maps with no exit tile', () => {
    const { world, moveDirection } = createBlankTraversalWorld()

    expect(world.cells.every((cell) => cell.feature !== 'exit')).toBe(true)
    expect(world.exitCellId).toBe(-1)

    const afterFirstMove = advanceGame(createInitialGameState(world), moveDirection)
    const unlockedState = advanceGame(afterFirstMove, 'stay')
    const afterReturn = directions
      .map((direction) => advanceGame(unlockedState, direction))
      .find((candidate) => candidate.playerCellId === world.startCellId)

    expect(afterFirstMove.levelComplete).toBe(false)
    expect(afterReturn).toBeDefined()
    expect(afterReturn?.levelComplete).toBe(false)
    expect(afterReturn?.lastOutcome).toBe('moved')
  })
})
