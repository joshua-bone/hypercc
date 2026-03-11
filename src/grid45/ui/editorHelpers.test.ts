import { describe, expect, it } from 'vitest'
import { directions } from '../domain/directions'
import { createGrid45World } from '../domain/world'
import {
  collectEditorBoundaryCellIds,
  collectEditorGrowCellIds,
  countEditorMapCells,
  createBlankFloorEditorWorld,
  growEditorWorld,
  paintEditorBucketFill,
  paintEditorRegion,
  paintEditorWorld,
  previewEditorBucketFill,
  previewEditorRegionPaint,
  shrinkEditorWorld,
} from './editorHelpers'

function createEditorWorld() {
  const sourceWorld = createGrid45World({
    seed: 1,
    size: 'tiny',
    antCount: 0,
    pinkBallCount: 0,
    teethCount: 0,
    tankCount: 0,
  })
  return createBlankFloorEditorWorld(sourceWorld, sourceWorld.startCellId)
}

function firstMapNeighborId(world: ReturnType<typeof createEditorWorld>, cellId: number): number {
  for (const direction of directions) {
    const neighborId = world.cells[cellId].exits[direction]
    if (neighborId !== null && world.cells[neighborId].kind !== 'void') return neighborId
  }
  throw new Error(`No map neighbor found for cell ${cellId}.`)
}

describe('editorHelpers', () => {
  it('creates adjacent cells and removes them again with the remove-cell brush', () => {
    const world = createEditorWorld()
    const initialMapCells = countEditorMapCells(world)
    const boundaryCellId = collectEditorGrowCellIds(world)[0]

    if (boundaryCellId === undefined) throw new Error('Expected at least one boundary growth cell.')

    expect(world.cells[boundaryCellId].kind).toBe('void')

    const painted = paintEditorWorld(world, boundaryCellId, 'wall', 'north')

    expect(painted.cells[boundaryCellId].kind).toBe('wall')
    expect(countEditorMapCells(painted)).toBe(initialMapCells + 1)

    const removed = paintEditorWorld(painted, boundaryCellId, 'none', 'north')

    expect(removed.cells[boundaryCellId].kind).toBe('void')
    expect(countEditorMapCells(removed)).toBe(initialMapCells)
  })

  it('applies grow and shrink deltas exactly to the map cell count', () => {
    const world = createEditorWorld()
    const initialMapCells = countEditorMapCells(world)
    const growDelta = collectEditorGrowCellIds(world).length

    const grown = growEditorWorld(world)

    expect(countEditorMapCells(grown)).toBe(initialMapCells + growDelta)

    const shrinkDelta = collectEditorBoundaryCellIds(grown).length
    const shrunk = shrinkEditorWorld(grown)

    expect(countEditorMapCells(shrunk)).toBe(countEditorMapCells(grown) - shrinkDelta)
  })

  it('previews and paints region border expansion into only non-map cells', () => {
    let world = createEditorWorld()
    const anchorCellId = collectEditorBoundaryCellIds(world)[0]

    if (anchorCellId === undefined) throw new Error('Expected at least one boundary map cell.')

    const neighborCellId = firstMapNeighborId(world, anchorCellId)

    world = paintEditorWorld(world, anchorCellId, 'wall', 'north')
    world = paintEditorWorld(world, neighborCellId, 'wall', 'north')

    const preview = previewEditorRegionPaint(world, anchorCellId, 'expand')

    expect(preview).not.toBeNull()
    expect(preview?.newCellCount ?? 0).toBeGreaterThan(0)
    expect(preview?.changedCellCount ?? -1).toBe(0)
    expect(preview?.targets.every((target) => !target.isMapInWorld)).toBe(true)

    const expanded = paintEditorRegion(world, anchorCellId, 'expand', 'water', 'north')

    expect(countEditorMapCells(expanded)).toBe(countEditorMapCells(world) + (preview?.newCellCount ?? 0))
  })

  it('previews and paints overwrite borders across existing neighboring cells', () => {
    let world = createEditorWorld()
    const anchorCellId = world.startCellId
    const neighborCellId = firstMapNeighborId(world, anchorCellId)

    world = paintEditorWorld(world, anchorCellId, 'wall', 'north')
    world = paintEditorWorld(world, neighborCellId, 'wall', 'north')

    const preview = previewEditorRegionPaint(world, anchorCellId, 'overwrite')
    const existingTarget = preview?.targets.find((target) => target.isMapInWorld)

    expect(preview).not.toBeNull()
    expect(preview?.changedCellCount ?? 0).toBeGreaterThan(0)
    expect(existingTarget).toBeDefined()

    const overwritten = paintEditorRegion(world, anchorCellId, 'overwrite', 'fire', 'north')

    expect(existingTarget).toBeDefined()
    expect(overwritten.cells[existingTarget!.cell.id].kind).toBe('fire')
    expect(countEditorMapCells(overwritten)).toBe(countEditorMapCells(world) + (preview?.newCellCount ?? 0))
  })

  it('bucket fill previews and repaints a contiguous terrain region', () => {
    let world = createEditorWorld()
    const anchorCellId = world.startCellId
    const neighborCellId = firstMapNeighborId(world, anchorCellId)

    world = paintEditorWorld(world, anchorCellId, 'wall', 'north')
    world = paintEditorWorld(world, neighborCellId, 'wall', 'north')

    const preview = previewEditorBucketFill(world, anchorCellId, 'water')

    expect(preview).not.toBeNull()
    expect(preview?.targetCellIds).toEqual(expect.arrayContaining([anchorCellId, neighborCellId]))
    expect(preview?.changedCellCount ?? 0).toBeGreaterThanOrEqual(2)

    const filled = paintEditorBucketFill(world, anchorCellId, 'water')

    expect(filled.cells[anchorCellId].kind).toBe('water')
    expect(filled.cells[neighborCellId].kind).toBe('water')
  })
})
