import { mulberry32 } from '../../hyper/random'
import { generateTiling, type Cell as HyperCell } from '../../hyper/tiling'
import { dot, norm, type Vec2 } from '../../hyper/vec2'
import { directionVectors, directions } from './directions'
import {
  featureForDoor,
  featureForKey,
  createEmptyKeyInventory,
  type AreaDag,
  type AreaDagEdge,
  type AreaDagNode,
  type CellFeature,
  type CellKind,
  type Direction,
  type DirectionMap,
  type KeyColor,
  type MazeCell,
  type MazeWorld,
} from './model'

const WORLD_ROTATION = -Math.PI / 4
const WORLD_GENERATION_ATTEMPTS = 192
const MIN_AREA_COUNT = 6
const PATH_LAYOUT_ATTEMPTS = 10
const LEAF_CANDIDATE_LIMIT = 16
const DEFAULT_WORLD_SIZE: WorldSize = 'medium'
const DOOR_COLOR_SEQUENCE: KeyColor[] = ['blue', 'green', 'red', 'yellow']

export const worldSizes = ['tiny', 'small', 'medium', 'large', 'huge'] as const
export type WorldSize = (typeof worldSizes)[number]

type WorldSizeConfig = {
  maxCells: number
  maxCenterRadius: number
  targetAreaCount: number
  minAreaWeight: number
}

const worldSizeConfigs: Record<WorldSize, WorldSizeConfig> = {
  tiny: {
    maxCells: 760,
    maxCenterRadius: 0.994,
    targetAreaCount: 6,
    minAreaWeight: 3,
  },
  small: {
    maxCells: 880,
    maxCenterRadius: 0.994,
    targetAreaCount: 7,
    minAreaWeight: 4,
  },
  medium: {
    maxCells: 1600,
    maxCenterRadius: 0.996,
    targetAreaCount: 7,
    minAreaWeight: 4,
  },
  large: {
    maxCells: 1900,
    maxCenterRadius: 0.997,
    targetAreaCount: 8,
    minAreaWeight: 5,
  },
  huge: {
    maxCells: 2500,
    maxCenterRadius: 0.998,
    targetAreaCount: 9,
    minAreaWeight: 5,
  },
}

export const defaultWorldSize = DEFAULT_WORLD_SIZE

type CreateGrid45WorldOptions = {
  seed: number
  size?: WorldSize
  maxCells?: number
  maxCenterRadius?: number
}

type RoomConnection = {
  connectorId: number
  targetRoomId: number
}

type SideSignal = {
  side: number
  outward: Vec2
}

type RootedFloorTree = {
  graph: number[][]
  parent: number[]
  children: number[][]
  depth: number[]
  floorIds: number[]
}

type AreaPlan = {
  id: number
  parentAreaId: number | null
  depth: number
  entryCellId: number
  cellIds: number[]
  childAreaIds: number[]
}

type AreaEdgePlan = {
  fromAreaId: number
  toAreaId: number
  gateCellId: number
  gateCellIds: number[]
  gate: 'door' | 'socket'
  color: KeyColor | null
}

type ProgressionLayout = {
  chipCellIds: number[]
  socketCellId: number
  exitCellId: number
  areaDag: AreaDag
  cellFeatures: CellFeature[]
}

type ProgressionAttempt = {
  layout: ProgressionLayout | null
  reason: string
}

function rotatePoint(point: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
  }
}

function midpoint(a: Vec2, b: Vec2): Vec2 {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  }
}

function toUnitVector(a: Vec2, b: Vec2): Vec2 {
  return norm({
    x: b.x - a.x,
    y: b.y - a.y,
  })
}

function mixSeed(seed: number, salt: number): number {
  return (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0
}

function assignDirectionSides(vertices: Vec2[], center: Vec2): DirectionMap<number> {
  const sideSignals: SideSignal[] = vertices.map((a, side) => {
    const b = vertices[(side + 1) % vertices.length]
    return {
      side,
      outward: toUnitVector(center, midpoint(a, b)),
    }
  })

  let bestScore = -Infinity
  let bestSides = [0, 1, 2, 3]
  const used = new Array(sideSignals.length).fill(false)
  const currentSides = new Array(directions.length).fill(0)

  const visit = (directionIndex: number, score: number) => {
    if (directionIndex === directions.length) {
      if (score > bestScore) {
        bestScore = score
        bestSides = currentSides.slice()
      }
      return
    }

    const direction = directions[directionIndex]
    const directionVector = directionVectors[direction]
    for (const signal of sideSignals) {
      if (used[signal.side]) continue
      used[signal.side] = true
      currentSides[directionIndex] = signal.side
      visit(directionIndex + 1, score + dot(signal.outward, directionVector))
      used[signal.side] = false
    }
  }

  visit(0, 0)

  return {
    north: bestSides[0],
    east: bestSides[1],
    south: bestSides[2],
    west: bestSides[3],
  }
}

function computeParity(cells: MazeCell[]): number[] {
  const parity = new Array(cells.length).fill(-1)
  const queue: number[] = [0]
  parity[0] = 0

  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break

    const currentParity = parity[id]
    const cell = cells[id]
    for (const direction of directions) {
      const nextId = cell.exits[direction]
      if (nextId === null || parity[nextId] !== -1) continue
      parity[nextId] = 1 - currentParity
      queue.push(nextId)
    }
  }

  return parity
}

function pickForwardRoom(
  cells: MazeCell[],
  parity: number[],
  connectorId: number,
  currentRoomId: number,
  direction: Direction,
): number | null {
  const directTarget = cells[connectorId].exits[direction]
  if (directTarget !== null && directTarget !== currentRoomId && parity[directTarget] === 0) return directTarget

  let bestTarget: number | null = null
  let bestScore = -Infinity
  const connector = cells[connectorId]
  const directionVector = directionVectors[direction]

  for (const neighborId of Object.values(connector.exits)) {
    if (neighborId === null || neighborId === currentRoomId || parity[neighborId] !== 0) continue
    const score = dot(toUnitVector(connector.center, cells[neighborId].center), directionVector)
    if (score > bestScore) {
      bestScore = score
      bestTarget = neighborId
    }
  }

  return bestScore > 0 ? bestTarget : null
}

function buildRoomConnections(cells: MazeCell[], parity: number[]): Array<Partial<Record<Direction, RoomConnection>>> {
  return cells.map((cell, roomId) => {
    if (parity[roomId] !== 0) return {}

    const connections: Partial<Record<Direction, RoomConnection>> = {}
    for (const direction of directions) {
      const connectorId = cell.exits[direction]
      if (connectorId === null || parity[connectorId] !== 1) continue

      const targetRoomId = pickForwardRoom(cells, parity, connectorId, roomId, direction)
      if (targetRoomId === null) continue

      connections[direction] = { connectorId, targetRoomId }
    }

    return connections
  })
}

function carveFloorKinds(
  cellCount: number,
  roomConnections: Array<Partial<Record<Direction, RoomConnection>>>,
  seed: number,
): CellKind[] {
  const rng = mulberry32(seed)
  const kinds: CellKind[] = new Array(cellCount).fill('wall')
  const visitedRooms = new Array(cellCount).fill(false)
  const stack: number[] = [0]

  visitedRooms[0] = true
  kinds[0] = 'floor'

  while (stack.length > 0) {
    const roomId = stack[stack.length - 1]
    const choices = directions.filter((direction) => {
      const connection = roomConnections[roomId][direction]
      return connection !== undefined && !visitedRooms[connection.targetRoomId]
    })

    if (choices.length === 0) {
      stack.pop()
      continue
    }

    const direction = choices[Math.floor(rng() * choices.length)]
    const connection = roomConnections[roomId][direction]
    if (!connection) continue

    visitedRooms[connection.targetRoomId] = true
    kinds[connection.connectorId] = 'floor'
    kinds[connection.targetRoomId] = 'floor'
    stack.push(connection.targetRoomId)
  }

  return kinds
}

function buildFloorGraph(cells: MazeCell[]): number[][] {
  const graph = cells.map(() => [] as number[])

  for (const cell of cells) {
    if (cell.kind !== 'floor') continue

    for (const direction of directions) {
      const neighborId = cell.exits[direction]
      if (neighborId === null || cells[neighborId].kind !== 'floor') continue
      graph[cell.id].push(neighborId)
    }
  }

  return graph
}

function buildRootedFloorTree(cells: MazeCell[], startCellId: number): RootedFloorTree | null {
  const graph = buildFloorGraph(cells)
  const floorIds = cells.filter((cell) => cell.kind === 'floor').map((cell) => cell.id)
  const parent = new Array(cells.length).fill(-1)
  const depth = new Array(cells.length).fill(-1)
  const children = cells.map(() => [] as number[])
  const queue: number[] = [startCellId]
  const visitedFloorIds: number[] = []

  parent[startCellId] = -1
  depth[startCellId] = 0

  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break

    visitedFloorIds.push(id)
    for (const neighborId of graph[id]) {
      if (depth[neighborId] !== -1) continue
      parent[neighborId] = id
      depth[neighborId] = depth[id] + 1
      children[id].push(neighborId)
      queue.push(neighborId)
    }
  }

  if (visitedFloorIds.length !== floorIds.length) return null

  return {
    graph,
    parent,
    children,
    depth,
    floorIds,
  }
}

function buildDepthLayers(tree: RootedFloorTree): number[][] {
  const maxDepth = tree.floorIds.reduce((best, cellId) => Math.max(best, tree.depth[cellId]), 0)
  const layers = Array.from({ length: maxDepth + 1 }, () => [] as number[])

  for (const cellId of tree.floorIds) {
    layers[tree.depth[cellId]].push(cellId)
  }

  return layers
}

function segmentLayerWeights(weights: number[], areaCount: number, minAreaWeight: number, seed: number): number[] | null {
  if (weights.length < areaCount) return null

  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight < areaCount * minAreaWeight) return null

  const rng = mulberry32(seed)
  const boundaries = [0]
  let startIndex = 0
  let consumedWeight = 0

  for (let areaIndex = 0; areaIndex < areaCount - 1; areaIndex += 1) {
    const remainingAreas = areaCount - areaIndex
    const remainingLayers = weights.length - startIndex
    if (remainingLayers < remainingAreas) return null

    const remainingWeight = totalWeight - consumedWeight
    const minWeightForRest = (remainingAreas - 1) * minAreaWeight
    const targetWeight = remainingWeight / remainingAreas
    const targetSlack = 1.08 + rng() * 0.42
    const maxTargetWeight = Math.max(minAreaWeight, targetWeight * targetSlack)
    const maxEndExclusive = weights.length - (remainingAreas - 1)

    let endIndex = startIndex
    let segmentWeight = 0

    while (endIndex < maxEndExclusive && segmentWeight < minAreaWeight) {
      segmentWeight += weights[endIndex]
      endIndex += 1
    }

    if (segmentWeight < minAreaWeight) return null

    while (endIndex < maxEndExclusive) {
      const nextWeight = weights[endIndex]
      if (remainingWeight - (segmentWeight + nextWeight) < minWeightForRest) break
      if (segmentWeight >= maxTargetWeight && rng() < 0.72) break

      segmentWeight += nextWeight
      endIndex += 1
    }

    boundaries.push(endIndex)
    startIndex = endIndex
    consumedWeight += segmentWeight
  }

  boundaries.push(weights.length)

  let lastWeight = 0
  for (let index = boundaries[boundaries.length - 2]; index < weights.length; index += 1) {
    lastWeight += weights[index]
  }

  return lastWeight >= minAreaWeight ? boundaries : null
}

function buildBandAreas(
  tree: RootedFloorTree,
  startCellId: number,
  targetAreaCount: number,
  minAreaWeight: number,
  seed: number,
): { areas: AreaPlan[]; gateCellIdsByArea: number[][] } | null {
  const depthLayers = buildDepthLayers(tree)
  const layerWeights = depthLayers.map((layer) => layer.length)
  const maxAreaCount = Math.min(targetAreaCount, depthLayers.length)

  for (let areaCount = maxAreaCount; areaCount >= MIN_AREA_COUNT; areaCount -= 1) {
    for (let attempt = 0; attempt < PATH_LAYOUT_ATTEMPTS; attempt += 1) {
      const boundaries = segmentLayerWeights(layerWeights, areaCount, minAreaWeight, mixSeed(seed, areaCount * 41 + attempt + 1))
      if (!boundaries) continue

      const areas: AreaPlan[] = []
      const areaIdByCellId = new Array(tree.graph.length).fill(-1)
      for (let areaId = 0; areaId < boundaries.length - 1; areaId += 1) {
        const startDepth = boundaries[areaId]
        const endDepth = boundaries[areaId + 1]
        const cellIds: number[] = []

        for (let depthIndex = startDepth; depthIndex < endDepth; depthIndex += 1) {
          for (const cellId of depthLayers[depthIndex]) {
            cellIds.push(cellId)
            areaIdByCellId[cellId] = areaId
          }
        }

        areas.push({
          id: areaId,
          parentAreaId: areaId === 0 ? null : areaId - 1,
          depth: areaId,
          entryCellId: areaId === 0 ? startCellId : -1,
          cellIds,
          childAreaIds: areaId + 1 < boundaries.length - 1 ? [areaId + 1] : [],
        })
      }

      if (areas.some((area) => area.cellIds.length === 0)) continue

      const gateCellIdsByArea = areas.map(() => [] as number[])
      let valid = true

      for (let areaId = 1; areaId < areas.length; areaId += 1) {
        const gateCellIds = areas[areaId].cellIds.filter((cellId) =>
          tree.graph[cellId].some((neighborId) => areaIdByCellId[neighborId] === areaId - 1),
        )

        if (gateCellIds.length === 0) {
          valid = false
          break
        }

        const hasContinuation = gateCellIds.some((cellId) =>
          tree.graph[cellId].some((neighborId) => areaIdByCellId[neighborId] === areaId),
        )
        if (!hasContinuation) {
          valid = false
          break
        }

        gateCellIds.sort((a, b) => a - b)
        gateCellIdsByArea[areaId] = gateCellIds
        areas[areaId].entryCellId = gateCellIds[0]
      }

      if (valid) {
        return {
          areas,
          gateCellIdsByArea,
        }
      }
    }
  }

  return null
}

function validateAreaBoundaries(graph: number[][], areas: AreaPlan[], edges: AreaEdgePlan[]): string | null {
  const areaByCellId = new Map<number, number>()
  const gateCellIdsByAreaId = new Map(edges.map((edge) => [edge.toAreaId, new Set(edge.gateCellIds)]))

  for (const area of areas) {
    for (const cellId of area.cellIds) {
      if (areaByCellId.has(cellId)) return 'duplicate-area-cell'
      areaByCellId.set(cellId, area.id)
    }
  }

  for (const area of areas) {
    for (const cellId of area.cellIds) {
      for (const neighborId of graph[cellId]) {
        if (neighborId < cellId) continue

        const fromAreaId = areaByCellId.get(cellId)
        const toAreaId = areaByCellId.get(neighborId)
        if (fromAreaId === undefined || toAreaId === undefined) return 'unassigned-area-cell'
        if (fromAreaId === toAreaId) continue

        const lowAreaId = Math.min(fromAreaId, toAreaId)
        const highAreaId = Math.max(fromAreaId, toAreaId)
        if (highAreaId !== lowAreaId + 1) return 'non-local-area-edge'

        const gateCellIds = gateCellIdsByAreaId.get(highAreaId)
        if (!gateCellIds || (!gateCellIds.has(cellId) && !gateCellIds.has(neighborId))) return 'gate-bypass-edge'
      }
    }
  }

  for (let areaId = 1; areaId < areas.length; areaId += 1) {
    const gateCellIds = gateCellIdsByAreaId.get(areaId)
    if (!gateCellIds || gateCellIds.size === 0) return 'missing-gate-group'

    let touchesParent = false
    let touchesOwnArea = false
    for (const gateCellId of gateCellIds) {
      if (graph[gateCellId].some((neighborId) => areaByCellId.get(neighborId) === areaId - 1)) {
        touchesParent = true
      }
      if (graph[gateCellId].some((neighborId) => areaByCellId.get(neighborId) === areaId)) {
        touchesOwnArea = true
      }
    }

    if (!touchesParent || !touchesOwnArea) return 'broken-gate-bridge'
  }

  return null
}

function doorColorForAreaId(areaId: number): KeyColor {
  if (areaId <= 0) return 'blue'
  return DOOR_COLOR_SEQUENCE[Math.min(areaId - 1, DOOR_COLOR_SEQUENCE.length - 1)]
}

function buildAreaEdges(areas: AreaPlan[], gateCellIdsByArea: number[][]): AreaEdgePlan[] {
  return areas
    .filter((area) => area.parentAreaId !== null)
    .map((area) => ({
      fromAreaId: area.parentAreaId ?? 0,
      toAreaId: area.id,
      gateCellId: area.entryCellId,
      gateCellIds: gateCellIdsByArea[area.id],
      gate: area.id === areas.length - 1 ? 'socket' : 'door',
      color: area.id === areas.length - 1 ? null : doorColorForAreaId(area.id),
    }))
}

function makeAreaCandidateOrder(area: AreaPlan, depth: number[], rng: () => number): number[] {
  return area.cellIds
    .filter((cellId) => cellId !== area.entryCellId)
    .map((cellId) => ({
      cellId,
      score: depth[cellId] + rng() * 0.5,
    }))
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.cellId)
}

function formatGateLabel(edge: AreaDagEdge): string {
  if (edge.gate === 'socket') return 'socket'
  return `${edge.color} door`
}

function validateAreaDag(nodes: AreaDagNode[], edges: AreaDagEdge[]): AreaDag['validation'] {
  const rootNode = nodes.find((node) => node.kind === 'start')
  const finalNode = nodes.find((node) => node.kind === 'final')
  if (!rootNode || !finalNode) {
    return {
      passed: false,
      summary: 'Missing start or final area',
      steps: [],
    }
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const orderedEdges = [...edges].sort((a, b) => {
    const aDepth = nodeById.get(a.fromAreaId)?.depth ?? 0
    const bDepth = nodeById.get(b.fromAreaId)?.depth ?? 0
    if (aDepth !== bDepth) return aDepth - bDepth
    return a.toAreaId - b.toAreaId
  })

  for (const edge of orderedEdges) {
    const fromNode = nodeById.get(edge.fromAreaId)
    const toNode = nodeById.get(edge.toAreaId)
    if (!fromNode || !toNode || toNode.depth <= fromNode.depth) {
      return {
        passed: false,
        summary: 'Area graph is not acyclic',
        steps: [],
      }
    }
  }

  const inventory = createEmptyKeyInventory()
  const accessibleAreaIds = new Set<number>()
  const collectedChipAreaIds = new Set<number>()
  const chipAreaIds = new Set(nodes.filter((node) => node.kind !== 'final').map((node) => node.id))
  const steps: string[] = []

  const collectArea = (areaId: number) => {
    if (accessibleAreaIds.has(areaId)) return
    const node = nodeById.get(areaId)
    if (!node) return

    accessibleAreaIds.add(areaId)
    if (node.kind !== 'final') {
      collectedChipAreaIds.add(areaId)
      steps.push(`Area ${areaId}: collected ${node.chipCellIds.length} chip${node.chipCellIds.length === 1 ? '' : 's'}`)
    }
    for (const color of node.keyColors) {
      inventory[color] += 1
      steps.push(`Area ${areaId}: gained ${color} key`)
    }
  }

  collectArea(rootNode.id)

  let progressed = true
  while (progressed) {
    progressed = false

    for (const edge of orderedEdges) {
      if (!accessibleAreaIds.has(edge.fromAreaId) || accessibleAreaIds.has(edge.toAreaId)) continue

      if (edge.gate === 'socket') {
        if (collectedChipAreaIds.size !== chipAreaIds.size) continue
        steps.push(`Area ${edge.fromAreaId}: opened socket to area ${edge.toAreaId}`)
      } else {
        const color = edge.color
        if (!color || inventory[color] < 1) continue
        if (color !== 'green') inventory[color] -= 1
        steps.push(`Area ${edge.fromAreaId}: opened ${formatGateLabel(edge)} to area ${edge.toAreaId}`)
      }

      collectArea(edge.toAreaId)
      progressed = true
    }
  }

  const passed = accessibleAreaIds.has(finalNode.id)
  return {
    passed,
    summary: passed ? `Validated ${nodes.length} areas and ${edges.length} gates` : `Failed to reach final area ${finalNode.id}`,
    steps,
  }
}

function buildProgressionFromAreas(
  cells: MazeCell[],
  tree: RootedFloorTree,
  areas: AreaPlan[],
  gateCellIdsByArea: number[][],
  seed: number,
): ProgressionAttempt {
  const edges = buildAreaEdges(areas, gateCellIdsByArea)
  const boundaryFailure = validateAreaBoundaries(tree.graph, areas, edges)
  if (boundaryFailure) {
    return { layout: null, reason: boundaryFailure }
  }

  const finalAreaId = areas.length - 1
  const cellFeatures: CellFeature[] = new Array(cells.length).fill('none')
  const chipCellIds: number[] = []
  const chipCellIdsByArea = areas.map(() => [] as number[])
  const keyColorsByArea = areas.map(() => [] as KeyColor[])
  const plannedKeysByArea = areas.map(() => [] as KeyColor[])
  const reservedCellIdsByArea = gateCellIdsByArea.map((gateCellIds) => new Set(gateCellIds))
  let hasGreenKey = false

  for (const edge of edges) {
    if (edge.gate === 'door' && edge.color !== null) {
      for (const gateCellId of edge.gateCellIds) {
        cellFeatures[gateCellId] = featureForDoor(edge.color)
      }
      if (edge.color === 'green') {
        if (hasGreenKey) continue
        hasGreenKey = true
      }
      plannedKeysByArea[edge.fromAreaId].push(edge.color)
    }
  }

  const rng = mulberry32(mixSeed(seed, 37))
  const socketCellId = areas[finalAreaId].entryCellId
  for (const gateCellId of gateCellIdsByArea[finalAreaId]) {
    cellFeatures[gateCellId] = 'socket'
  }
  let exitCellId = -1

  for (const area of areas) {
    const candidates = makeAreaCandidateOrder(area, tree.depth, rng).filter(
      (cellId) => !reservedCellIdsByArea[area.id].has(cellId),
    )

    if (area.id === finalAreaId) {
      const exitCandidate = candidates.shift()
      if (exitCandidate === undefined) {
        return { layout: null, reason: 'final-area-too-small' }
      }

      exitCellId = exitCandidate
      cellFeatures[exitCellId] = 'exit'
      continue
    }

    const chipCount = 1
    const requiredCells = chipCount + plannedKeysByArea[area.id].length
    if (candidates.length < requiredCells) {
      return { layout: null, reason: 'area-capacity' }
    }

    for (let chipIndex = 0; chipIndex < chipCount; chipIndex += 1) {
      const chipCellId = candidates.shift()
      if (chipCellId === undefined) return { layout: null, reason: 'chip-placement' }

      cellFeatures[chipCellId] = 'chip'
      chipCellIds.push(chipCellId)
      chipCellIdsByArea[area.id].push(chipCellId)
    }

    for (const color of plannedKeysByArea[area.id]) {
      const keyCellId = candidates.shift()
      if (keyCellId === undefined) return { layout: null, reason: 'key-placement' }

      cellFeatures[keyCellId] = featureForKey(color)
      keyColorsByArea[area.id].push(color)
    }
  }

  if (exitCellId < 0) {
    return { layout: null, reason: 'missing-exit' }
  }

  const areaDagNodes: AreaDagNode[] = areas.map((area) => ({
    id: area.id,
    depth: area.depth,
    entryCellId: area.entryCellId,
    cellIds: area.cellIds,
    chipCellIds: chipCellIdsByArea[area.id],
    keyColors: keyColorsByArea[area.id],
    kind: area.id === 0 ? 'start' : area.id === finalAreaId ? 'final' : 'normal',
  }))

  const areaDagEdges: AreaDagEdge[] = edges.map((edge) => ({
    fromAreaId: edge.fromAreaId,
    toAreaId: edge.toAreaId,
    gateCellId: edge.gateCellId,
    gateCellIds: edge.gateCellIds,
    gate: edge.gate,
    color: edge.color,
  }))

  const validation = validateAreaDag(areaDagNodes, areaDagEdges)
  if (!validation.passed) {
    return { layout: null, reason: 'dag-validation' }
  }

  return {
    reason: 'ok',
    layout: {
      chipCellIds,
      socketCellId,
      exitCellId,
      cellFeatures,
      areaDag: {
        nodes: areaDagNodes,
        edges: areaDagEdges,
        validation,
      },
    },
  }
}

function buildProgressionLayout(
  cells: MazeCell[],
  startCellId: number,
  seed: number,
  config: WorldSizeConfig,
): ProgressionAttempt {
  const tree = buildRootedFloorTree(cells, startCellId)
  if (!tree) {
    return { layout: null, reason: 'invalid-floor-tree' }
  }

  const bandedAreas = buildBandAreas(tree, startCellId, config.targetAreaCount, config.minAreaWeight, seed)
  if (!bandedAreas) {
    return { layout: null, reason: 'area-layout' }
  }

  return buildProgressionFromAreas(cells, tree, bandedAreas.areas, bandedAreas.gateCellIdsByArea, mixSeed(seed, 101))
}

function rotateCell(cell: HyperCell): Pick<MazeCell, 'id' | 'center' | 'vertices'> {
  return {
    id: cell.id,
    center: rotatePoint(cell.anchor, WORLD_ROTATION),
    vertices: cell.vertices.map((vertex) => rotatePoint(vertex, WORLD_ROTATION)),
  }
}

export function createGrid45World(options: CreateGrid45WorldOptions): MazeWorld {
  const size = options.size ?? DEFAULT_WORLD_SIZE
  const config = worldSizeConfigs[size]
  const maxCells = options.maxCells ?? config.maxCells
  const maxCenterRadius = options.maxCenterRadius ?? config.maxCenterRadius
  const hyperCells = generateTiling({
    p: 4,
    q: 5,
    maxCells,
    maxCenterRadius,
  })

  const rotatedCells = hyperCells.map(rotateCell)
  const draftCells: MazeCell[] = hyperCells.map((cell, index) => {
    const rotated = rotatedCells[index]
    const directionSides = assignDirectionSides(rotated.vertices, rotated.center)

    return {
      id: cell.id,
      kind: 'wall',
      feature: 'none',
      center: rotated.center,
      vertices: rotated.vertices,
      exits: {
        north: cell.neighbors[directionSides.north]?.id ?? null,
        east: cell.neighbors[directionSides.east]?.id ?? null,
        south: cell.neighbors[directionSides.south]?.id ?? null,
        west: cell.neighbors[directionSides.west]?.id ?? null,
      },
    }
  })

  const parity = computeParity(draftCells)
  const roomConnections = buildRoomConnections(draftCells, parity)
  const startCellId = 0
  const failureCounts = new Map<string, number>()

  for (let attempt = 0; attempt < WORLD_GENERATION_ATTEMPTS; attempt += 1) {
    const attemptSeed = mixSeed(options.seed, attempt + 1)
    const kinds = carveFloorKinds(draftCells.length, roomConnections, mixSeed(attemptSeed, 1))
    const cells = draftCells.map((cell) => ({
      ...cell,
      kind: kinds[cell.id],
      feature: 'none' as const,
    }))
    const progression = buildProgressionLayout(cells, startCellId, mixSeed(attemptSeed, 2), config)
    if (!progression.layout) {
      failureCounts.set(progression.reason, (failureCounts.get(progression.reason) ?? 0) + 1)
      continue
    }

    return {
      startCellId,
      chipCellIds: progression.layout.chipCellIds,
      socketCellId: progression.layout.socketCellId,
      exitCellId: progression.layout.exitCellId,
      areaDag: progression.layout.areaDag,
      cells: cells.map((cell) => ({
        ...cell,
        feature: progression.layout?.cellFeatures[cell.id] ?? 'none',
      })),
    }
  }

  const failureSummary = Array.from(failureCounts.entries())
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ')
  throw new Error(`Failed to generate a solvable hyperbolic level (${failureSummary})`)
}
