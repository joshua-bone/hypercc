import { hyperbolicDistance } from '../../hyper/poincare'
import type { Vec2 } from '../../hyper/vec2'
import type { AreaDag, CellFeature, Direction, MazeWorld, MonsterKind } from '../domain/model'

export type EditorPaintTool = 'floor' | 'wall' | 'start' | CellFeature | MonsterKind

const customAreaDag: AreaDag = {
  nodes: [],
  edges: [],
  validation: {
    passed: true,
    summary: 'Custom editor map; DAG validation unavailable.',
    steps: ['This map was hand-edited.'],
  },
}

function nextMonsterId(world: MazeWorld): number {
  return world.initialMonsters.reduce((best, monster) => Math.max(best, monster.id), -1) + 1
}

function firstFloorCellId(world: MazeWorld): number {
  return world.cells.find((cell) => cell.kind === 'floor')?.id ?? 0
}

function hasMonsterAtCell(world: MazeWorld, cellId: number): boolean {
  return world.initialMonsters.some((monster) => monster.cellId === cellId)
}

export function cloneMazeWorld(world: MazeWorld): MazeWorld {
  return structuredClone(world)
}

export function rotateDirection(direction: Direction, delta: -1 | 1): Direction {
  const directions: Direction[] = ['north', 'east', 'south', 'west']
  const currentIndex = directions.indexOf(direction)
  return directions[(currentIndex + delta + directions.length) % directions.length]
}

export function normalizeEditorWorld(world: MazeWorld): MazeWorld {
  const nextWorld = cloneMazeWorld(world)

  for (const cell of nextWorld.cells) {
    if (cell.kind === 'wall') {
      cell.feature = 'none'
    }
  }

  const socketCellIds = nextWorld.cells.filter((cell) => cell.feature === 'socket').map((cell) => cell.id)
  const exitCellIds = nextWorld.cells.filter((cell) => cell.feature === 'exit').map((cell) => cell.id)

  for (const extraSocketCellId of socketCellIds.slice(1)) {
    nextWorld.cells[extraSocketCellId].feature = 'none'
  }
  for (const extraExitCellId of exitCellIds.slice(1)) {
    nextWorld.cells[extraExitCellId].feature = 'none'
  }

  nextWorld.initialMonsters = nextWorld.initialMonsters
    .filter((monster) => {
      const cell = nextWorld.cells[monster.cellId]
      return cell.kind === 'floor' && cell.feature === 'none'
    })
    .map((monster, index) => ({
      ...monster,
      id: index,
      recoveryTicks: 0,
    }))

  if (nextWorld.cells[nextWorld.startCellId]?.kind !== 'floor' || hasMonsterAtCell(nextWorld, nextWorld.startCellId)) {
    nextWorld.startCellId = firstFloorCellId(nextWorld)
  }

  nextWorld.chipCellIds = nextWorld.cells.filter((cell) => cell.feature === 'chip').map((cell) => cell.id)
  nextWorld.socketCellId = nextWorld.cells.find((cell) => cell.feature === 'socket')?.id ?? nextWorld.startCellId
  nextWorld.exitCellId = nextWorld.cells.find((cell) => cell.feature === 'exit')?.id ?? nextWorld.startCellId
  nextWorld.areaDag = customAreaDag

  return nextWorld
}

export function paintEditorWorld(world: MazeWorld, cellId: number, tool: EditorPaintTool, facing: Direction): MazeWorld {
  const nextWorld = cloneMazeWorld(world)
  const cell = nextWorld.cells[cellId]

  nextWorld.initialMonsters = nextWorld.initialMonsters.filter((monster) => monster.cellId !== cellId)

  if (tool === 'start') {
    cell.kind = 'floor'
    cell.feature = 'none'
    nextWorld.startCellId = cellId
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'wall') {
    cell.kind = 'wall'
    cell.feature = 'none'
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'floor' || tool === 'none') {
    cell.kind = 'floor'
    cell.feature = 'none'
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'ant' || tool === 'pink-ball' || tool === 'teeth') {
    cell.kind = 'floor'
    cell.feature = 'none'
    nextWorld.initialMonsters.push({
      id: nextMonsterId(nextWorld),
      kind: tool,
      cellId,
      facing,
      recoveryTicks: 0,
    })
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'socket' || tool === 'exit') {
    for (const otherCell of nextWorld.cells) {
      if (otherCell.feature === tool) otherCell.feature = 'none'
    }
  }

  cell.kind = 'floor'
  cell.feature = tool
  return normalizeEditorWorld(nextWorld)
}

export function clearEditorWorld(world: MazeWorld, startCellId = world.startCellId): MazeWorld {
  const nextWorld = cloneMazeWorld(world)
  const safeStartCellId = nextWorld.cells[startCellId] ? startCellId : nextWorld.startCellId

  for (const cell of nextWorld.cells) {
    cell.kind = 'wall'
    cell.feature = 'none'
  }

  nextWorld.startCellId = safeStartCellId
  nextWorld.cells[safeStartCellId].kind = 'floor'
  nextWorld.cells[safeStartCellId].feature = 'none'
  nextWorld.initialMonsters = []

  return normalizeEditorWorld(nextWorld)
}

export function downloadWorldJson(world: MazeWorld): void {
  const blob = new Blob([JSON.stringify(world, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `hypercc-${world.seed}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function nearestCellIdToPoint(world: MazeWorld, point: Vec2): number {
  let bestCellId = world.startCellId
  let bestDistance = Number.POSITIVE_INFINITY

  for (const cell of world.cells) {
    const distance = hyperbolicDistance(cell.center, point)
    if (distance < bestDistance) {
      bestDistance = distance
      bestCellId = cell.id
    }
  }

  return bestCellId
}
