import { describe, expect, it } from 'vitest'
import { directions } from './directions'
import { advanceGame, createInitialGameState } from './engine'
import { currentCellKind } from './model'
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

  it('lets the player enter a pop-up wall and turns it into a wall beneath them', () => {
    const { world, moveDirection, targetCellId } = createBlankTraversalWorld()
    world.cells[targetCellId].kind = 'popup-wall'

    const nextState = advanceGame(createInitialGameState(world), moveDirection)

    expect(nextState.playerCellId).toBe(targetCellId)
    expect(nextState.lastOutcome).toBe('moved')
    expect(nextState.playerDead).toBe(false)
    expect(nextState.terrainOverrides.get(targetCellId)).toBe('wall')
    expect(currentCellKind(world.cells[targetCellId].kind, nextState.togglePhase, nextState.terrainOverrides.get(targetCellId))).toBe('wall')
  })

  it('prevents monsters from entering a pop-up wall after the player triggers it', () => {
    const { world, moveDirection, targetCellId } = createBlankTraversalWorld()
    world.cells[targetCellId].kind = 'popup-wall'

    const monsterCellId = directions
      .map((direction) => world.cells[targetCellId].exits[direction])
      .find((cellId): cellId is number => cellId !== null && cellId !== world.startCellId && world.cells[cellId].kind !== 'void')

    if (monsterCellId === undefined) throw new Error('Expected an extra neighbor around the pop-up wall cell.')

    world.initialMonsters = [
      {
        id: 0,
        kind: 'teeth',
        cellId: monsterCellId,
        facing: 'north',
        recoveryTicks: 0,
      },
    ]

    const afterEnter = advanceGame(createInitialGameState(world), moveDirection)
    const afterMonsterAdvance = advanceGame(afterEnter, 'stay')

    expect(afterMonsterAdvance.playerCellId).toBe(targetCellId)
    expect(afterMonsterAdvance.playerDead).toBe(false)
    expect(afterMonsterAdvance.terrainOverrides.get(targetCellId)).toBe('wall')
    expect(afterMonsterAdvance.monsters.some((monster) => monster.cellId === targetCellId)).toBe(false)
  })
})
