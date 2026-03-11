import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { directions } from './directions'
import { createGrid45World } from './world'
import { loadMazeWorldFromJson, mazeWorldToOfficialLevel, stringifyOfficialLevel } from './levelCodec'
import { countEditorMapCells, createBlankFloorEditorWorld, paintEditorWorld } from '../ui/editorHelpers'

function createEditorWorld() {
  const sourceWorld = createGrid45World({
    seed: 11,
    size: 'tiny',
    antCount: 0,
    pinkBallCount: 0,
    teethCount: 0,
    tankCount: 0,
  })
  return createBlankFloorEditorWorld(sourceWorld, sourceWorld.startCellId)
}

describe('levelCodec', () => {
  it('loads the authored lesson_1 official level with expected metadata and content', () => {
    const world = loadMazeWorldFromJson(readFileSync('levels/lesson_1.json', 'utf8'), {
      fileName: 'lesson_1.json',
    })

    expect(world.title).toBe('Lesson 1')
    expect(world.author).toBe('')
    expect(world.startCellId).toBe(0)
    expect(world.cells.length).toBe(1253)
    expect(world.cells.filter((cell) => cell.feature === 'chip')).toHaveLength(10)
    expect(world.cells.filter((cell) => cell.feature === 'socket')).toHaveLength(1)
    expect(world.cells.filter((cell) => cell.feature === 'exit')).toHaveLength(1)
    expect(world.cells.every((cell) => cell.vertices.length === 4)).toBe(true)
  })

  it('round-trips title, author, hint, and sparse authored cells through the official format', () => {
    let world = createEditorWorld()
    const hintCellId = directions
      .map((direction) => world.cells[world.startCellId].exits[direction])
      .find((cellId): cellId is number => cellId !== null && world.cells[cellId].kind !== 'void')

    if (hintCellId === undefined) throw new Error('Expected a neighboring map cell to place a hint.')

    world = paintEditorWorld(world, hintCellId, 'hint', 'north')
    world = {
      ...world,
      title: 'Round Trip Level',
      author: 'Test Author',
      hint: 'Stay on the bright path.',
    }

    const officialLevel = mazeWorldToOfficialLevel(world)
    const reloaded = loadMazeWorldFromJson(stringifyOfficialLevel(officialLevel), {
      fileName: 'round_trip_level.json',
    })

    expect(officialLevel.title).toBe('Round Trip Level')
    expect(officialLevel.author).toBe('Test Author')
    expect(officialLevel.hint).toBe('Stay on the bright path.')
    expect(officialLevel.cells).toHaveLength(countEditorMapCells(world))
    expect(reloaded.title).toBe('Round Trip Level')
    expect(reloaded.author).toBe('Test Author')
    expect(reloaded.hint).toBe('Stay on the bright path.')
    expect(reloaded.cells.every((cell) => cell.kind !== 'void')).toBe(true)
    expect(reloaded.cells.some((cell) => cell.feature === 'hint')).toBe(true)
  })
})
