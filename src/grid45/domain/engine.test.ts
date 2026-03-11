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

describe('engine', () => {
  it('treats hint tiles like walkable floor for the player', () => {
    const { world, moveDirection, targetCellId } = createHintWorld()

    const nextState = advanceGame(createInitialGameState(world), moveDirection)

    expect(nextState.playerCellId).toBe(targetCellId)
    expect(nextState.lastOutcome).toBe('moved')
    expect(nextState.playerDead).toBe(false)
    expect(nextState.world.cells[targetCellId].feature).toBe('hint')
  })
})
