import { hyperbolicDistance } from '../../hyper/poincare'
import type { Vec2 } from '../../hyper/vec2'
import { directionTowardNeighbor, grid45CellGeometryKey, reflectGrid45CellGeometry } from '../domain/cellGeometry'
import { mazeWorldToOfficialLevel, stringifyOfficialLevel } from '../domain/levelCodec'
import { currentCellKind, isPassableCellKind, type AreaDag, type CellFeature, type CellKind, type Direction, type MazeCell, type MazeWorld, type MonsterKind } from '../domain/model'
import { directions } from '../domain/directions'

type PaintableCellKind = Exclude<CellKind, 'void'>

export type EditorPaintTool = PaintableCellKind | 'start' | CellFeature | MonsterKind
export type EditorRegionPaintMode = 'expand' | 'overwrite'
export type EditorRegionPaintTarget = {
  cell: MazeCell
  geometryKey: string
  distance: number
  existsInWorld: boolean
  isMapInWorld: boolean
}
export type EditorRegionPaintPreview = {
  anchorCellId: number
  targets: EditorRegionPaintTarget[]
  newCellCount: number
  changedCellCount: number
}
export type EditorBucketFillPreview = {
  anchorCellId: number
  targetCellIds: number[]
  changedCellCount: number
}

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

function isMapCell(cell: Pick<MazeCell, 'kind'>): boolean {
  return cell.kind !== 'void'
}

function firstMapCellId(world: MazeWorld): number {
  return world.cells.find((cell) => isMapCell(cell))?.id ?? 0
}

function firstFloorCellId(world: MazeWorld): number {
  return world.cells.find((cell) => {
    if (!isMapCell(cell)) return false
    const kind = currentCellKind(cell.kind, false)
    return kind === 'floor' || kind === 'toggle-floor' || kind === 'dirt' || kind === 'gravel'
  })?.id ?? 0
}

function hasMonsterAtCell(world: MazeWorld, cellId: number): boolean {
  return world.initialMonsters.some((monster) => monster.cellId === cellId)
}

function isBucketFillTool(tool: EditorPaintTool): tool is PaintableCellKind {
  return (
    tool === 'floor' ||
    tool === 'wall' ||
    tool === 'toggle-floor' ||
    tool === 'toggle-wall' ||
    tool === 'water' ||
    tool === 'fire' ||
    tool === 'dirt' ||
    tool === 'gravel'
  )
}

export function cloneMazeWorld(world: MazeWorld): MazeWorld {
  return structuredClone(world)
}

export function rotateDirection(direction: Direction, delta: -1 | 1): Direction {
  const directions: Direction[] = ['north', 'east', 'south', 'west']
  const currentIndex = directions.indexOf(direction)
  return directions[(currentIndex + delta + directions.length) % directions.length]
}

function hasAdjacentMapCell(world: MazeWorld, cellId: number): boolean {
  const cell = world.cells[cellId]
  return directions.some((direction) => {
    const neighborId = cell.exits[direction]
    return neighborId !== null && isMapCell(world.cells[neighborId])
  })
}

function ensureEditorShell(
  world: MazeWorld,
  sourceCellIds: Iterable<number>,
  depth: number,
): { cellIdByGeometryKey: Map<string, number>; visitedCellIds: Set<number> } {
  const cellIdByGeometryKey = new Map<string, number>(world.cells.map((cell) => [grid45CellGeometryKey(cell.center), cell.id]))
  let frontier = Array.from(new Set(Array.from(sourceCellIds).filter((cellId) => !!world.cells[cellId])))
  const visitedCellIds = new Set<number>(frontier)

  for (let step = 0; step < depth; step += 1) {
    const nextFrontier: number[] = []

    for (const cellId of frontier) {
      const cell = world.cells[cellId]
      if (!cell) continue

      for (const direction of directions) {
        let neighborId = cell.exits[direction]

        if (neighborId === null || !world.cells[neighborId]) {
          const geometry = reflectGrid45CellGeometry(cell, direction)
          const geometryKey = grid45CellGeometryKey(geometry.center)
          const existingNeighborId = cellIdByGeometryKey.get(geometryKey)

          if (existingNeighborId === undefined) {
            neighborId = world.cells.length
            world.cells.push({
              id: neighborId,
              kind: 'void',
              feature: 'none',
              center: geometry.center,
              vertices: geometry.vertices,
              exits: {
                north: null,
                east: null,
                south: null,
                west: null,
              },
            })
            cellIdByGeometryKey.set(geometryKey, neighborId)
          } else {
            neighborId = existingNeighborId
          }

          cell.exits[direction] = neighborId
        }

        if (neighborId === null) continue
        const neighbor = world.cells[neighborId]
        const backDirection = directionTowardNeighbor(neighbor, cell)
        if (backDirection !== null && neighbor.exits[backDirection] === null) {
          neighbor.exits[backDirection] = cellId
        }

        if (!visitedCellIds.has(neighborId)) {
          visitedCellIds.add(neighborId)
          nextFrontier.push(neighborId)
        }
      }
    }

    frontier = nextFrontier
  }

  return { cellIdByGeometryKey, visitedCellIds }
}

function ensureEditorBoundaryShell(world: MazeWorld): void {
  const mapCellIds = world.cells.filter((cell) => isMapCell(cell)).map((cell) => cell.id)
  ensureEditorShell(world, mapCellIds, 1)
}

function vertexGeometryKey(point: Vec2): string {
  const quantize = 1e6
  return `${Math.round(point.x * quantize)},${Math.round(point.y * quantize)}`
}

function collectTerrainRegionCellIds(world: MazeWorld, anchorCellId: number): number[] {
  const anchorCell = world.cells[anchorCellId]
  if (!anchorCell || !isMapCell(anchorCell)) return []

  const regionKind = anchorCell.kind
  const regionCellIds: number[] = []
  const visited = new Set<number>([anchorCellId])
  const queue = [anchorCellId]

  while (queue.length > 0) {
    const cellId = queue.shift()
    if (cellId === undefined) break

    const cell = world.cells[cellId]
    if (!cell || !isMapCell(cell) || cell.kind !== regionKind) continue
    regionCellIds.push(cellId)

    for (const direction of directions) {
      const neighborId = cell.exits[direction]
      if (neighborId === null || visited.has(neighborId)) continue
      visited.add(neighborId)
      queue.push(neighborId)
    }
  }

  return regionCellIds
}

function collectLocalDistances(world: MazeWorld, seedCellIds: Iterable<number>, limitCellIds: Set<number>): Map<number, number> {
  const distanceByCellId = new Map<number, number>()
  const queue: number[] = []

  for (const cellId of seedCellIds) {
    if (!world.cells[cellId] || !limitCellIds.has(cellId)) continue
    distanceByCellId.set(cellId, 0)
    queue.push(cellId)
  }

  while (queue.length > 0) {
    const cellId = queue.shift()
    if (cellId === undefined) break
    const distance = distanceByCellId.get(cellId) ?? 0
    const cell = world.cells[cellId]

    for (const direction of directions) {
      const neighborId = cell.exits[direction]
      if (neighborId === null || !limitCellIds.has(neighborId) || distanceByCellId.has(neighborId)) continue
      distanceByCellId.set(neighborId, distance + 1)
      queue.push(neighborId)
    }
  }

  return distanceByCellId
}

function collectEditorRegionPaintTargets(
  world: MazeWorld,
  anchorCellId: number,
  mode: EditorRegionPaintMode,
): EditorRegionPaintPreview | null {
  const anchorCell = world.cells[anchorCellId]
  if (!anchorCell || !isMapCell(anchorCell)) return null

  const previewWorld = cloneMazeWorld(world)
  const regionCellIds = collectTerrainRegionCellIds(previewWorld, anchorCellId)
  if (regionCellIds.length === 0) return null

  const regionCellIdSet = new Set(regionCellIds)
  const { visitedCellIds } = ensureEditorShell(previewWorld, regionCellIds, 2)
  const distanceByCellId = collectLocalDistances(previewWorld, regionCellIds, visitedCellIds)
  const regionVertexKeys = new Set<string>()
  for (const regionCellId of regionCellIds) {
    for (const vertex of previewWorld.cells[regionCellId].vertices) {
      regionVertexKeys.add(vertexGeometryKey(vertex))
    }
  }

  const targets: EditorRegionPaintTarget[] = []
  for (const cellId of visitedCellIds) {
    if (regionCellIdSet.has(cellId)) continue
    const cell = previewWorld.cells[cellId]
    if (!cell) continue

    const edgeAdjacent = directions.some((direction) => {
      const neighborId = cell.exits[direction]
      return neighborId !== null && regionCellIdSet.has(neighborId)
    })
    const vertexAdjacent = cell.vertices.some((vertex) => regionVertexKeys.has(vertexGeometryKey(vertex)))
    if (!edgeAdjacent && !vertexAdjacent) continue
    if (mode === 'expand' && isMapCell(cell)) continue

    const sourceCell = world.cells[cellId]
    const existsInWorld = sourceCell !== undefined
    const isMapInWorld = existsInWorld && isMapCell(sourceCell)
    targets.push({
      cell,
      geometryKey: grid45CellGeometryKey(cell.center),
      distance: distanceByCellId.get(cellId) ?? Number.POSITIVE_INFINITY,
      existsInWorld,
      isMapInWorld,
    })
  }

  targets.sort((left, right) => {
    if (left.distance !== right.distance) return left.distance - right.distance
    return left.geometryKey.localeCompare(right.geometryKey)
  })

  return {
    anchorCellId,
    targets,
    newCellCount: targets.filter((target) => !target.isMapInWorld).length,
    changedCellCount: targets.filter((target) => target.isMapInWorld).length,
  }
}

export function collectEditorBoundaryCellIds(world: MazeWorld): number[] {
  return world.cells
    .filter((cell) => {
      if (!isMapCell(cell)) return false
      return directions.some((direction) => {
        const neighborId = cell.exits[direction]
        return neighborId === null || !isMapCell(world.cells[neighborId])
      })
    })
    .map((cell) => cell.id)
}

export function collectEditorGrowCellIds(world: MazeWorld): number[] {
  return world.cells
    .filter((cell) => !isMapCell(cell) && hasAdjacentMapCell(world, cell.id))
    .map((cell) => cell.id)
}

export function countEditorMapCells(world: MazeWorld): number {
  return world.cells.reduce((count, cell) => count + (isMapCell(cell) ? 1 : 0), 0)
}

export function canPaintEditorBoundaryCell(world: MazeWorld, cellId: number): boolean {
  const cell = world.cells[cellId]
  return !!cell && (!isMapCell(cell) ? hasAdjacentMapCell(world, cellId) : true)
}

export function previewEditorRegionPaint(
  world: MazeWorld,
  anchorCellId: number,
  mode: EditorRegionPaintMode,
): EditorRegionPaintPreview | null {
  return collectEditorRegionPaintTargets(world, anchorCellId, mode)
}

export function canBucketFillEditorTool(tool: EditorPaintTool): boolean {
  return isBucketFillTool(tool)
}

export function previewEditorBucketFill(
  world: MazeWorld,
  anchorCellId: number,
  tool: EditorPaintTool,
): EditorBucketFillPreview | null {
  if (!isBucketFillTool(tool)) return null

  const targetCellIds = collectTerrainRegionCellIds(world, anchorCellId)
  if (targetCellIds.length === 0) return null

  const changedCellCount = targetCellIds.reduce((count, cellId) => {
    const cell = world.cells[cellId]
    const willChange = cell.kind !== tool || cell.feature !== 'none' || hasMonsterAtCell(world, cellId)
    return count + (willChange ? 1 : 0)
  }, 0)

  return {
    anchorCellId,
    targetCellIds,
    changedCellCount,
  }
}

export function normalizeEditorWorld(world: MazeWorld): MazeWorld {
  const nextWorld = cloneMazeWorld(world)
  ensureEditorBoundaryShell(nextWorld)

  for (const cell of nextWorld.cells) {
    if (!isMapCell(cell) || !isPassableCellKind(cell.kind, false)) {
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
      if (!isMapCell(cell)) return false
      const kind = currentCellKind(cell.kind, false)
      const canOccupy =
        kind === 'floor' ||
        kind === 'toggle-floor' ||
        (monster.kind === 'glider' && kind === 'water') ||
        (monster.kind === 'fireball' && kind === 'fire') ||
        (monster.kind === 'dirt-block' && kind === 'gravel')
      return canOccupy && cell.feature === 'none'
    })
    .map((monster, index) => ({
      ...monster,
      id: index,
      recoveryTicks: 0,
    }))

  const startKind = currentCellKind(nextWorld.cells[nextWorld.startCellId]?.kind ?? 'wall', false)
  const startPassable = startKind === 'floor' || startKind === 'toggle-floor' || startKind === 'dirt' || startKind === 'gravel'
  if (!startPassable || hasMonsterAtCell(nextWorld, nextWorld.startCellId)) {
    nextWorld.startCellId = firstFloorCellId(nextWorld)
  }

  const normalizedStartKind = currentCellKind(nextWorld.cells[nextWorld.startCellId]?.kind ?? 'void', false)
  const normalizedStartPassable =
    normalizedStartKind === 'floor' ||
    normalizedStartKind === 'toggle-floor' ||
    normalizedStartKind === 'dirt' ||
    normalizedStartKind === 'gravel'
  if (!isMapCell(nextWorld.cells[nextWorld.startCellId] ?? { kind: 'void' }) || !normalizedStartPassable) {
    const fallbackCellId = firstMapCellId(nextWorld)
    nextWorld.cells[fallbackCellId].kind = 'floor'
    nextWorld.startCellId = fallbackCellId
  }

  nextWorld.chipCellIds = nextWorld.cells.filter((cell) => cell.feature === 'chip').map((cell) => cell.id)
  nextWorld.socketCellId = nextWorld.cells.find((cell) => cell.feature === 'socket')?.id ?? nextWorld.startCellId
  nextWorld.exitCellId = nextWorld.cells.find((cell) => cell.feature === 'exit')?.id ?? nextWorld.startCellId
  nextWorld.areaDag = customAreaDag

  return nextWorld
}

export function paintEditorWorld(world: MazeWorld, cellId: number, tool: EditorPaintTool, facing: Direction): MazeWorld {
  if (!canPaintEditorBoundaryCell(world, cellId)) return world

  const nextWorld = cloneMazeWorld(world)
  const cell = nextWorld.cells[cellId]

  nextWorld.initialMonsters = nextWorld.initialMonsters.filter((monster) => monster.cellId !== cellId)

  if (tool === 'start') {
    cell.kind = 'floor'
    cell.feature = 'none'
    nextWorld.startCellId = cellId
    return normalizeEditorWorld(nextWorld)
  }

  if (
    tool === 'wall' ||
    tool === 'toggle-wall' ||
    tool === 'water' ||
    tool === 'fire' ||
    tool === 'dirt' ||
    tool === 'gravel'
  ) {
    cell.kind = tool
    cell.feature = 'none'
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'floor' || tool === 'toggle-floor') {
    cell.kind = tool
    cell.feature = 'none'
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'none') {
    if (!isMapCell(cell)) return world
    cell.kind = 'void'
    cell.feature = 'none'
    return normalizeEditorWorld(nextWorld)
  }

  if (tool === 'ant' || tool === 'pink-ball' || tool === 'teeth' || tool === 'tank' || tool === 'dirt-block' || tool === 'glider' || tool === 'fireball') {
    const existingKind = currentCellKind(cell.kind, false)
    const canPreserveKind =
      existingKind === 'floor' ||
      existingKind === 'toggle-floor' ||
      (tool === 'glider' && existingKind === 'water') ||
      (tool === 'fireball' && existingKind === 'fire') ||
      (tool === 'dirt-block' && existingKind === 'gravel')
    cell.kind = canPreserveKind ? cell.kind : 'floor'
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

export function paintEditorRegion(
  world: MazeWorld,
  anchorCellId: number,
  mode: EditorRegionPaintMode,
  tool: EditorPaintTool,
  facing: Direction,
): MazeWorld {
  const preview = collectEditorRegionPaintTargets(world, anchorCellId, mode)
  if (!preview || preview.targets.length === 0) return world

  const workingWorld = cloneMazeWorld(world)
  const regionCellIds = collectTerrainRegionCellIds(workingWorld, anchorCellId)
  if (regionCellIds.length === 0) return world

  const { cellIdByGeometryKey } = ensureEditorShell(workingWorld, regionCellIds, 2)
  let nextWorld = workingWorld

  for (const target of preview.targets) {
    const targetCellId = cellIdByGeometryKey.get(target.geometryKey)
    if (targetCellId === undefined) continue
    nextWorld = paintEditorWorld(nextWorld, targetCellId, tool, facing)
  }

  return nextWorld
}

export function paintEditorBucketFill(
  world: MazeWorld,
  anchorCellId: number,
  tool: EditorPaintTool,
): MazeWorld {
  if (!isBucketFillTool(tool)) return world

  const preview = previewEditorBucketFill(world, anchorCellId, tool)
  if (!preview || preview.changedCellCount === 0) return world

  const nextWorld = cloneMazeWorld(world)
  const targetCellIdSet = new Set(preview.targetCellIds)
  nextWorld.initialMonsters = nextWorld.initialMonsters.filter((monster) => !targetCellIdSet.has(monster.cellId))

  for (const cellId of preview.targetCellIds) {
    const cell = nextWorld.cells[cellId]
    cell.kind = tool
    cell.feature = 'none'
  }

  return normalizeEditorWorld(nextWorld)
}

export function rotateEditorMobAtCell(world: MazeWorld, cellId: number, delta: -1 | 1): MazeWorld {
  const monsterIndex = world.initialMonsters.findIndex((monster) => monster.cellId === cellId)
  if (monsterIndex < 0) return world
  if (world.initialMonsters[monsterIndex].kind === 'dirt-block') return world

  const nextWorld = cloneMazeWorld(world)
  nextWorld.initialMonsters[monsterIndex].facing = rotateDirection(nextWorld.initialMonsters[monsterIndex].facing, delta)
  return normalizeEditorWorld(nextWorld)
}

export function clearEditorWorld(world: MazeWorld, startCellId = world.startCellId): MazeWorld {
  return createBlankFloorEditorWorld(world, startCellId)
}

export function createBlankFloorEditorWorld(world: MazeWorld, startCellId = world.startCellId): MazeWorld {
  const nextWorld = cloneMazeWorld(world)
  const safeStartCellId = nextWorld.cells[startCellId] ? startCellId : nextWorld.startCellId

  for (const cell of nextWorld.cells) {
    if (!isMapCell(cell)) continue
    cell.kind = 'floor'
    cell.feature = 'none'
  }

  nextWorld.startCellId = safeStartCellId
  nextWorld.initialMonsters = []

  return normalizeEditorWorld(nextWorld)
}

function sanitizeLevelFileName(name: string): string {
  const normalized = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized.length > 0 ? normalized : 'untitled-level'
}

export function downloadLevelJson(world: MazeWorld): void {
  const blob = new Blob([stringifyOfficialLevel(mazeWorldToOfficialLevel(world))], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${sanitizeLevelFileName(world.title ?? `hypercc-${world.seed}`)}.json`
  link.click()
  URL.revokeObjectURL(url)
}

export function nearestCellIdToPoint(world: MazeWorld, point: Vec2): number {
  let bestCellId = firstMapCellId(world)
  let bestDistance = Number.POSITIVE_INFINITY

  for (const cell of world.cells) {
    if (!isMapCell(cell)) continue
    const distance = hyperbolicDistance(cell.center, point)
    if (distance < bestDistance) {
      bestDistance = distance
      bestCellId = cell.id
    }
  }

  return bestCellId
}

export function shrinkEditorWorld(world: MazeWorld): MazeWorld {
  const boundaryCellIds = collectEditorBoundaryCellIds(world)
  const mapCellCount = countEditorMapCells(world)
  if (boundaryCellIds.length === 0 || boundaryCellIds.length >= mapCellCount) return world

  const nextWorld = cloneMazeWorld(world)
  for (const cellId of boundaryCellIds) {
    nextWorld.cells[cellId].kind = 'void'
    nextWorld.cells[cellId].feature = 'none'
  }

  return normalizeEditorWorld(nextWorld)
}

export function growEditorWorld(world: MazeWorld): MazeWorld {
  const growCellIds = collectEditorGrowCellIds(world)
  if (growCellIds.length === 0) return world

  const nextWorld = cloneMazeWorld(world)
  for (const cellId of growCellIds) {
    nextWorld.cells[cellId].kind = 'floor'
    nextWorld.cells[cellId].feature = 'none'
  }

  return normalizeEditorWorld(nextWorld)
}
