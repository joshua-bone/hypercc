import { mulberry32 } from '../../hyper/random'
import { generateTiling, type Cell as HyperCell } from '../../hyper/tiling'
import { dot, norm, type Vec2 } from '../../hyper/vec2'
import { directionVectors, directions } from './directions'
import {
  createEmptyKeyInventory,
  featureForDoor,
  featureForKey,
  type AreaDag,
  type AreaDagEdge,
  type AreaDagNode,
  type CellFeature,
  type CellKind,
  type DirectionMap,
  type KeyColor,
  type MazeCell,
  type MazeWorld,
} from './model'

const WORLD_ROTATION = -Math.PI / 4
const WORLD_GENERATION_ATTEMPTS = 120
const GATE_CANDIDATE_LIMIT = 20
const FRONTIER_SAMPLE_COUNT = 6
const DEFAULT_WORLD_SIZE: WorldSize = 'medium'
const KEY_COLORS: KeyColor[] = ['blue', 'red', 'yellow', 'green']

export const worldSizes = ['tiny', 'small', 'medium', 'large', 'huge'] as const
export type WorldSize = (typeof worldSizes)[number]

type WorldSizeConfig = {
  maxCells: number
  maxCenterRadius: number
  roomCount: number
  minRoomSize: number
  targetRoomSize: number
}

const worldSizeConfigs: Record<WorldSize, WorldSizeConfig> = {
  tiny: {
    maxCells: 760,
    maxCenterRadius: 0.994,
    roomCount: 5,
    minRoomSize: 5,
    targetRoomSize: 8,
  },
  small: {
    maxCells: 980,
    maxCenterRadius: 0.995,
    roomCount: 6,
    minRoomSize: 6,
    targetRoomSize: 9,
  },
  medium: {
    maxCells: 1700,
    maxCenterRadius: 0.996,
    roomCount: 8,
    minRoomSize: 7,
    targetRoomSize: 10,
  },
  large: {
    maxCells: 2300,
    maxCenterRadius: 0.997,
    roomCount: 10,
    minRoomSize: 8,
    targetRoomSize: 11,
  },
  huge: {
    maxCells: 3000,
    maxCenterRadius: 0.998,
    roomCount: 12,
    minRoomSize: 9,
    targetRoomSize: 12,
  },
}

export const defaultWorldSize = DEFAULT_WORLD_SIZE

type CreateGrid45WorldOptions = {
  seed: number
  size?: WorldSize
  maxCells?: number
  maxCenterRadius?: number
}

type SideSignal = {
  side: number
  outward: Vec2
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

type GateCandidate = {
  gateCellId: number
  anchorCellId: number
  score: number
}

type PlannedGate = {
  fromAreaId: number
  toAreaId: number
  gate: 'door' | 'socket'
  color: KeyColor | null
}

type RoomGraphPlan = {
  parentAreaIdByRoomId: Array<number | null>
  depthByRoomId: number[]
  childAreaIdsByRoomId: number[][]
  gateByToAreaId: Array<PlannedGate | null>
  keyColorsByArea: KeyColor[][]
}

type RoomLayout = {
  cellKinds: CellKind[]
  areas: AreaPlan[]
  edges: AreaEdgePlan[]
  keyColorsByArea: KeyColor[][]
}

type RoomLayoutAttempt = {
  layout: RoomLayout | null
  reason: string
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

function pointRadiusSq(point: Vec2): number {
  return point.x * point.x + point.y * point.y
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

function buildCellGraph(cells: Pick<MazeCell, 'id' | 'exits'>[]): number[][] {
  return cells.map((cell) => {
    const neighborIds = new Set<number>()
    for (const direction of directions) {
      const neighborId = cell.exits[direction]
      if (neighborId !== null) neighborIds.add(neighborId)
    }
    return [...neighborIds]
  })
}

function buildRoomTargetSizes(config: WorldSizeConfig, seed: number): number[] {
  const rng = mulberry32(seed)

  return Array.from({ length: config.roomCount }, (_, roomId) => {
    const jitter = Math.floor(rng() * 3) - 1
    const bonus = roomId === 0 ? 1 : roomId === config.roomCount - 1 ? 2 : 0
    return Math.max(config.minRoomSize, config.targetRoomSize + jitter + bonus)
  })
}

function pickFrontierIndex(frontierCellIds: number[], cells: Pick<MazeCell, 'center'>[], rng: () => number): number {
  let bestIndex = 0
  let bestScore = -Infinity
  const sampleCount = Math.min(frontierCellIds.length, FRONTIER_SAMPLE_COUNT)

  for (let sample = 0; sample < sampleCount; sample += 1) {
    const index = Math.floor(rng() * frontierCellIds.length)
    const cellId = frontierCellIds[index]
    const score = pointRadiusSq(cells[cellId].center) * 0.2 + rng()
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  return bestIndex
}

function canClaimRoomCell(
  graph: number[][],
  cellId: number,
  roomId: number,
  roomIdByCellId: number[],
  gateCellIds: Set<number>,
  allowedGateCellIds: Set<number>,
): boolean {
  if (roomIdByCellId[cellId] !== -1 || gateCellIds.has(cellId)) return false

  for (const neighborId of graph[cellId]) {
    const neighborRoomId = roomIdByCellId[neighborId]
    if (neighborRoomId !== -1 && neighborRoomId !== roomId) return false
    if (gateCellIds.has(neighborId) && !allowedGateCellIds.has(neighborId)) return false
  }

  return true
}

function growRoomCells(
  graph: number[][],
  cells: Pick<MazeCell, 'center'>[],
  roomIdByCellId: number[],
  gateCellIds: Set<number>,
  roomId: number,
  anchorCellId: number,
  targetSize: number,
  minSize: number,
  entryGateCellId: number | null,
  seed: number,
): number[] | null {
  const rng = mulberry32(seed)
  const allowedGateCellIds = new Set<number>(entryGateCellId === null ? [] : [entryGateCellId])
  const claimedCellIds: number[] = []
  const frontierCellIds = [anchorCellId]
  const frontierSet = new Set<number>([anchorCellId])

  while (frontierCellIds.length > 0 && claimedCellIds.length < targetSize) {
    const frontierIndex = pickFrontierIndex(frontierCellIds, cells, rng)
    const [cellId] = frontierCellIds.splice(frontierIndex, 1)
    frontierSet.delete(cellId)

    if (!canClaimRoomCell(graph, cellId, roomId, roomIdByCellId, gateCellIds, allowedGateCellIds)) continue

    roomIdByCellId[cellId] = roomId
    claimedCellIds.push(cellId)

    const neighborIds = graph[cellId].slice()
    for (let index = neighborIds.length - 1; index > 0; index -= 1) {
      const swapIndex = Math.floor(rng() * (index + 1))
      const temp = neighborIds[index]
      neighborIds[index] = neighborIds[swapIndex]
      neighborIds[swapIndex] = temp
    }

    for (const neighborId of neighborIds) {
      if (roomIdByCellId[neighborId] !== -1 || gateCellIds.has(neighborId) || frontierSet.has(neighborId)) continue
      frontierCellIds.push(neighborId)
      frontierSet.add(neighborId)
    }
  }

  if (claimedCellIds.length < minSize) {
    for (const claimedCellId of claimedCellIds) roomIdByCellId[claimedCellId] = -1
    return null
  }

  return claimedCellIds
}

function collectGateCandidates(
  graph: number[][],
  cells: Pick<MazeCell, 'center'>[],
  parentRoomId: number,
  parentRoomCellIds: number[],
  roomIdByCellId: number[],
  gateCellIds: Set<number>,
  seed: number,
): GateCandidate[] {
  const rng = mulberry32(seed)
  const candidates: GateCandidate[] = []
  const seenPairs = new Set<string>()

  for (const roomCellId of parentRoomCellIds) {
    for (const gateCellId of graph[roomCellId]) {
      if (roomIdByCellId[gateCellId] !== -1 || gateCellIds.has(gateCellId)) continue

      let touchesParent = false
      let invalidGate = false
      for (const neighborId of graph[gateCellId]) {
        if (gateCellIds.has(neighborId)) {
          invalidGate = true
          break
        }

        const neighborRoomId = roomIdByCellId[neighborId]
        if (neighborRoomId === -1) continue
        if (neighborRoomId !== parentRoomId) {
          invalidGate = true
          break
        }
        touchesParent = true
      }

      if (invalidGate || !touchesParent) continue

      for (const anchorCellId of graph[gateCellId]) {
        const pairKey = `${gateCellId}:${anchorCellId}`
        if (seenPairs.has(pairKey)) continue
        seenPairs.add(pairKey)

        if (!canClaimRoomCell(graph, anchorCellId, -2, roomIdByCellId, gateCellIds, new Set([gateCellId]))) continue

        candidates.push({
          gateCellId,
          anchorCellId,
          score: pointRadiusSq(cells[anchorCellId].center) + pointRadiusSq(cells[gateCellId].center) * 0.25 + rng() * 0.1,
        })
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  return candidates.slice(0, GATE_CANDIDATE_LIMIT)
}

function chooseDoorColor(
  roomId: number,
  parentAreaId: number,
  childAreaIdsByRoomId: number[][],
  colorByToAreaId: Array<KeyColor | null>,
  depthByRoomId: number[],
  rng: () => number,
): KeyColor {
  const siblingColors = childAreaIdsByRoomId[parentAreaId]
    .filter((childAreaId) => childAreaId < roomId)
    .map((childAreaId) => colorByToAreaId[childAreaId])
    .filter((color): color is KeyColor => color !== null)

  const baseColors = KEY_COLORS.filter((color) => color !== 'green')
  const preferred = baseColors.filter((color) => !siblingColors.includes(color))
  const pool = preferred.length > 0 ? preferred : baseColors

  if (depthByRoomId[roomId] >= 2 && siblingColors.every((color) => color !== 'green') && rng() < 0.18) {
    return 'green'
  }

  return pool[Math.floor(rng() * pool.length)]
}

function buildExplorationOrder(childAreaIdsByRoomId: number[][], finalAreaId: number, seed: number): number[] {
  const rng = mulberry32(seed)
  const order: number[] = []
  const frontierAreaIds = childAreaIdsByRoomId[0].filter((areaId) => areaId !== finalAreaId)

  while (frontierAreaIds.length > 0) {
    const index = Math.floor(rng() * frontierAreaIds.length)
    const [roomId] = frontierAreaIds.splice(index, 1)
    order.push(roomId)

    const childAreaIds = childAreaIdsByRoomId[roomId]
      .filter((areaId) => areaId !== finalAreaId)
      .sort((a, b) => a - b)
    for (const childAreaId of childAreaIds) frontierAreaIds.push(childAreaId)
  }

  return order
}

function chooseKeySourceArea(
  toAreaId: number,
  parentAreaId: number,
  accessibleAreaIds: number[],
  childAreaIdsByRoomId: number[][],
  keyCountsByArea: number[],
  depthByRoomId: number[],
  rng: () => number,
): number {
  if (parentAreaId === 0) {
    const rootChildIds = childAreaIdsByRoomId[0].filter((areaId) => areaId !== childAreaIdsByRoomId.length - 1)
    if (rootChildIds.indexOf(toAreaId) < Math.min(2, rootChildIds.length)) return 0
  }

  const preferredAreaIds = accessibleAreaIds.filter((areaId) => areaId !== parentAreaId)
  const candidateAreaIds = preferredAreaIds.length > 0 ? preferredAreaIds : accessibleAreaIds

  const rankedAreaIds = candidateAreaIds.slice().sort((a, b) => {
    const keyDelta = keyCountsByArea[a] - keyCountsByArea[b]
    if (keyDelta !== 0) return keyDelta

    const depthDelta = depthByRoomId[b] - depthByRoomId[a]
    if (depthDelta !== 0) return depthDelta

    return a - b
  })

  const window = rankedAreaIds.slice(0, Math.min(3, rankedAreaIds.length))
  return window[Math.floor(rng() * window.length)]
}

function buildRoomGraphPlan(config: WorldSizeConfig, seed: number): RoomGraphPlan {
  const finalAreaId = config.roomCount - 1
  const parentAreaIdByRoomId = new Array<number | null>(config.roomCount).fill(null)
  const depthByRoomId = new Array(config.roomCount).fill(0)
  const childAreaIdsByRoomId = Array.from({ length: config.roomCount }, () => [] as number[])
  const gateByToAreaId = new Array<PlannedGate | null>(config.roomCount).fill(null)
  const keyColorsByArea = Array.from({ length: config.roomCount }, () => [] as KeyColor[])
  const colorByToAreaId = new Array<KeyColor | null>(config.roomCount).fill(null)
  const rng = mulberry32(seed)

  const addChild = (parentAreaId: number, childAreaId: number) => {
    parentAreaIdByRoomId[childAreaId] = parentAreaId
    depthByRoomId[childAreaId] = depthByRoomId[parentAreaId] + 1
    childAreaIdsByRoomId[parentAreaId].push(childAreaId)
  }

  let nextAreaId = 1
  const initialRootChildren = Math.min(finalAreaId, config.roomCount >= 5 ? 2 : 1)
  for (let count = 0; count < initialRootChildren; count += 1) {
    addChild(0, nextAreaId)
    nextAreaId += 1
  }

  while (nextAreaId < finalAreaId) {
    const candidateParentIds = Array.from({ length: nextAreaId }, (_, areaId) => areaId)
      .filter((areaId) => {
        if (areaId === finalAreaId) return false
        const maxChildren = areaId === 0 ? 3 : 2
        return childAreaIdsByRoomId[areaId].length < maxChildren
      })
      .sort((a, b) => {
        const depthDelta = depthByRoomId[a] - depthByRoomId[b]
        if (depthDelta !== 0) return depthDelta
        const childDelta = childAreaIdsByRoomId[a].length - childAreaIdsByRoomId[b].length
        if (childDelta !== 0) return childDelta
        return a - b
      })

    const window = candidateParentIds.slice(0, Math.min(3, candidateParentIds.length))
    const parentAreaId = window[Math.floor(rng() * window.length)]
    addChild(parentAreaId, nextAreaId)
    nextAreaId += 1
  }

  const leafAreaIds = Array.from({ length: finalAreaId }, (_, areaId) => areaId)
    .filter((areaId) => areaId !== 0 && childAreaIdsByRoomId[areaId].length === 0)
    .sort((a, b) => depthByRoomId[b] - depthByRoomId[a] || a - b)
  const finalParentChoices = leafAreaIds.slice(0, Math.min(3, leafAreaIds.length))
  const finalParentAreaId = finalParentChoices[Math.floor(rng() * finalParentChoices.length)]
  addChild(finalParentAreaId, finalAreaId)

  for (let areaId = 1; areaId < finalAreaId; areaId += 1) {
    const parentAreaId = parentAreaIdByRoomId[areaId]
    if (parentAreaId === null) continue

    const color = chooseDoorColor(areaId, parentAreaId, childAreaIdsByRoomId, colorByToAreaId, depthByRoomId, rng)
    colorByToAreaId[areaId] = color
    gateByToAreaId[areaId] = {
      fromAreaId: parentAreaId,
      toAreaId: areaId,
      gate: 'door',
      color,
    }
  }

  gateByToAreaId[finalAreaId] = {
    fromAreaId: finalParentAreaId,
    toAreaId: finalAreaId,
    gate: 'socket',
    color: null,
  }

  const accessibleAreaIds = [0]
  const explorationOrder = buildExplorationOrder(childAreaIdsByRoomId, finalAreaId, mixSeed(seed, 73))
  const keyCountsByArea = new Array(config.roomCount).fill(0)

  for (const areaId of explorationOrder) {
    const parentAreaId = parentAreaIdByRoomId[areaId]
    const plannedGate = gateByToAreaId[areaId]
    if (parentAreaId === null || !plannedGate || plannedGate.color === null) continue

    const sourceAreaId = chooseKeySourceArea(
      areaId,
      parentAreaId,
      accessibleAreaIds,
      childAreaIdsByRoomId,
      keyCountsByArea,
      depthByRoomId,
      rng,
    )
    keyColorsByArea[sourceAreaId].push(plannedGate.color)
    keyCountsByArea[sourceAreaId] += 1
    accessibleAreaIds.push(areaId)
  }

  return {
    parentAreaIdByRoomId,
    depthByRoomId,
    childAreaIdsByRoomId,
    gateByToAreaId,
    keyColorsByArea,
  }
}

function validateRoomLayout(
  graph: number[][],
  cellKinds: CellKind[],
  areas: AreaPlan[],
  edges: AreaEdgePlan[],
): string | null {
  const roomIdByCellId = new Array(graph.length).fill(-1)
  const edgeByGateCellId = new Map(edges.map((edge) => [edge.gateCellId, edge]))

  for (const area of areas) {
    for (const cellId of area.cellIds) {
      if (roomIdByCellId[cellId] !== -1) return 'duplicate-room-cell'
      if (edgeByGateCellId.has(cellId)) return 'gate-inside-room'
      if (cellKinds[cellId] !== 'floor') return 'room-cell-not-floor'
      roomIdByCellId[cellId] = area.id
    }
  }

  for (const area of areas) {
    if (area.cellIds.length === 0) return 'empty-room'

    const roomCellIds = new Set(area.cellIds)
    const queue: number[] = [area.entryCellId]
    const visited = new Set<number>([area.entryCellId])

    while (queue.length > 0) {
      const cellId = queue.shift()
      if (cellId === undefined) break

      for (const neighborId of graph[cellId]) {
        if (!roomCellIds.has(neighborId) || visited.has(neighborId)) continue
        visited.add(neighborId)
        queue.push(neighborId)
      }
    }

    if (visited.size !== area.cellIds.length) return 'disconnected-room'

    for (const cellId of area.cellIds) {
      for (const neighborId of graph[cellId]) {
        if (cellKinds[neighborId] === 'wall') continue

        const neighborRoomId = roomIdByCellId[neighborId]
        if (neighborRoomId === area.id) continue
        if (neighborRoomId !== -1) return 'direct-room-adjacency'

        const gate = edgeByGateCellId.get(neighborId)
        if (!gate || (gate.fromAreaId !== area.id && gate.toAreaId !== area.id)) return 'foreign-gate-touch'
      }
    }
  }

  for (const edge of edges) {
    if (cellKinds[edge.gateCellId] !== 'floor') return 'gate-not-floor'
    if (roomIdByCellId[edge.gateCellId] !== -1) return 'gate-assigned-to-room'

    const touchedRoomIds = new Set<number>()
    for (const neighborId of graph[edge.gateCellId]) {
      if (edgeByGateCellId.has(neighborId)) return 'adjacent-gates'
      if (cellKinds[neighborId] === 'wall') continue

      const neighborRoomId = roomIdByCellId[neighborId]
      if (neighborRoomId === -1) return 'floating-gate'
      touchedRoomIds.add(neighborRoomId)
    }

    if (!touchedRoomIds.has(edge.fromAreaId) || !touchedRoomIds.has(edge.toAreaId) || touchedRoomIds.size !== 2) {
      return 'gate-room-mismatch'
    }
  }

  return null
}

function findExpandableRoomId(
  graph: number[][],
  cellId: number,
  roomIdByCellId: number[],
  edgeByGateCellId: Map<number, AreaEdgePlan>,
): number | null {
  if (roomIdByCellId[cellId] !== -1 || edgeByGateCellId.has(cellId)) return null

  const adjacentRoomIds = new Set<number>()
  for (const neighborId of graph[cellId]) {
    const neighborRoomId = roomIdByCellId[neighborId]
    if (neighborRoomId !== -1) adjacentRoomIds.add(neighborRoomId)
  }

  if (adjacentRoomIds.size !== 1) return null
  const roomId = adjacentRoomIds.values().next().value as number

  for (const neighborId of graph[cellId]) {
    const neighborRoomId = roomIdByCellId[neighborId]
    if (neighborRoomId !== -1 && neighborRoomId !== roomId) return null

    const gate = edgeByGateCellId.get(neighborId)
    if (gate && gate.fromAreaId !== roomId && gate.toAreaId !== roomId) return null
  }

  return roomId
}

function expandRoomsToFillSpace(
  graph: number[][],
  cells: Pick<MazeCell, 'center'>[],
  areas: AreaPlan[],
  edges: AreaEdgePlan[],
  roomIdByCellId: number[],
  seed: number,
): AreaPlan[] {
  const rng = mulberry32(seed)
  const edgeByGateCellId = new Map(edges.map((edge) => [edge.gateCellId, edge]))
  let changed = true

  while (changed) {
    changed = false
    const candidates: Array<{ cellId: number; score: number }> = []

    for (let cellId = 0; cellId < roomIdByCellId.length; cellId += 1) {
      if (findExpandableRoomId(graph, cellId, roomIdByCellId, edgeByGateCellId) === null) continue
      candidates.push({
        cellId,
        score: pointRadiusSq(cells[cellId].center) * 0.35 + rng(),
      })
    }

    candidates.sort((a, b) => b.score - a.score)

    for (const candidate of candidates) {
      const roomId = findExpandableRoomId(graph, candidate.cellId, roomIdByCellId, edgeByGateCellId)
      if (roomId === null) continue
      roomIdByCellId[candidate.cellId] = roomId
      changed = true
    }
  }

  const expandedAreas = areas.map((area) => ({
    ...area,
    cellIds: [] as number[],
  }))

  for (let cellId = 0; cellId < roomIdByCellId.length; cellId += 1) {
    const roomId = roomIdByCellId[cellId]
    if (roomId === -1) continue
    expandedAreas[roomId].cellIds.push(cellId)
  }

  return expandedAreas
}

function buildRoomLayout(
  cells: Pick<MazeCell, 'center'>[],
  graph: number[][],
  startCellId: number,
  config: WorldSizeConfig,
  plan: RoomGraphPlan,
  seed: number,
): RoomLayoutAttempt {
  const roomIdByCellId = new Array(cells.length).fill(-1)
  const gateCellIds = new Set<number>()
  const roomTargetSizes = buildRoomTargetSizes(config, mixSeed(seed, 1))
  const areas = new Array<AreaPlan>(config.roomCount)
  const edges: AreaEdgePlan[] = []

  const startRoomCellIds = growRoomCells(
    graph,
    cells,
    roomIdByCellId,
    gateCellIds,
    0,
    startCellId,
    roomTargetSizes[0],
    config.minRoomSize,
    null,
    mixSeed(seed, 2),
  )
  if (!startRoomCellIds) return { layout: null, reason: 'start-room' }

  areas[0] = {
    id: 0,
    parentAreaId: null,
    depth: 0,
    entryCellId: startCellId,
    cellIds: startRoomCellIds,
    childAreaIds: plan.childAreaIdsByRoomId[0].slice(),
  }

  const placementOrder = Array.from({ length: config.roomCount - 1 }, (_, index) => index + 1)
  const placeRoom = (orderIndex: number): boolean => {
    if (orderIndex >= placementOrder.length) return true

    const roomId = placementOrder[orderIndex]
    const parentAreaId = plan.parentAreaIdByRoomId[roomId]
    const plannedGate = plan.gateByToAreaId[roomId]
    if (parentAreaId === null || !plannedGate) return false

    const parentArea = areas[parentAreaId]
    if (!parentArea) return false

    const gateCandidates = collectGateCandidates(
      graph,
      cells,
      parentAreaId,
      parentArea.cellIds,
      roomIdByCellId,
      gateCellIds,
      mixSeed(seed, roomId * 37 + orderIndex + 1),
    )

    for (let candidateIndex = 0; candidateIndex < gateCandidates.length; candidateIndex += 1) {
      const candidate = gateCandidates[candidateIndex]
      gateCellIds.add(candidate.gateCellId)

      const roomCellIds = growRoomCells(
        graph,
        cells,
        roomIdByCellId,
        gateCellIds,
        roomId,
        candidate.anchorCellId,
        roomTargetSizes[roomId],
        config.minRoomSize,
        candidate.gateCellId,
        mixSeed(seed, roomId * 131 + candidateIndex + 1),
      )

      if (!roomCellIds) {
        gateCellIds.delete(candidate.gateCellId)
        continue
      }

      areas[roomId] = {
        id: roomId,
        parentAreaId,
        depth: plan.depthByRoomId[roomId],
        entryCellId: candidate.anchorCellId,
        cellIds: roomCellIds,
        childAreaIds: plan.childAreaIdsByRoomId[roomId].slice(),
      }
      edges.push({
        fromAreaId: plannedGate.fromAreaId,
        toAreaId: plannedGate.toAreaId,
        gateCellId: candidate.gateCellId,
        gateCellIds: [candidate.gateCellId],
        gate: plannedGate.gate,
        color: plannedGate.color,
      })

      if (placeRoom(orderIndex + 1)) return true

      edges.pop()
      for (const roomCellId of roomCellIds) roomIdByCellId[roomCellId] = -1
      gateCellIds.delete(candidate.gateCellId)
      areas[roomId] = undefined as unknown as AreaPlan
    }

    return false
  }

  if (!placeRoom(0)) return { layout: null, reason: 'room-branching' }

  const placedAreas = expandRoomsToFillSpace(
    graph,
    cells,
    areas.filter((area): area is AreaPlan => area !== undefined),
    edges,
    roomIdByCellId,
    mixSeed(seed, 977),
  )
  const cellKinds: CellKind[] = new Array(cells.length).fill('wall')
  for (const area of placedAreas) {
    for (const cellId of area.cellIds) cellKinds[cellId] = 'floor'
  }
  for (const edge of edges) cellKinds[edge.gateCellId] = 'floor'

  const validationFailure = validateRoomLayout(graph, cellKinds, placedAreas, edges)
  if (validationFailure) return { layout: null, reason: validationFailure }

  return {
    layout: {
      cellKinds,
      areas: placedAreas,
      edges,
      keyColorsByArea: plan.keyColorsByArea.map((keyColors) => keyColors.slice()),
    },
    reason: 'ok',
  }
}

function makeRoomCandidateOrder(
  graph: number[][],
  roomCellIds: number[],
  entryCellId: number,
  cells: Pick<MazeCell, 'center'>[],
  seed: number,
): number[] {
  const roomCellIdSet = new Set(roomCellIds)
  const distanceByCellId = new Array(cells.length).fill(-1)
  const queue: number[] = [entryCellId]
  distanceByCellId[entryCellId] = 0

  while (queue.length > 0) {
    const cellId = queue.shift()
    if (cellId === undefined) break

    for (const neighborId of graph[cellId]) {
      if (!roomCellIdSet.has(neighborId) || distanceByCellId[neighborId] !== -1) continue
      distanceByCellId[neighborId] = distanceByCellId[cellId] + 1
      queue.push(neighborId)
    }
  }

  const rng = mulberry32(seed)
  return roomCellIds
    .filter((cellId) => cellId !== entryCellId)
    .map((cellId) => ({
      cellId,
      score: distanceByCellId[cellId] + pointRadiusSq(cells[cellId].center) * 0.15 + rng() * 0.5,
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
      summary: 'Missing start or final room',
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
        summary: 'Room graph is not acyclic',
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
      steps.push(`Room ${areaId}: collected ${node.chipCellIds.length} chip${node.chipCellIds.length === 1 ? '' : 's'}`)
    }
    for (const color of node.keyColors) {
      inventory[color] += 1
      steps.push(`Room ${areaId}: gained ${color} key`)
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
        steps.push(`Room ${edge.fromAreaId}: opened socket to room ${edge.toAreaId}`)
      } else {
        const color = edge.color
        if (!color || inventory[color] < 1) continue
        if (color !== 'green') inventory[color] -= 1
        steps.push(`Room ${edge.fromAreaId}: opened ${formatGateLabel(edge)} to room ${edge.toAreaId}`)
      }

      collectArea(edge.toAreaId)
      progressed = true
    }
  }

  const passed = accessibleAreaIds.has(finalNode.id)
  return {
    passed,
    summary: passed ? `Validated ${nodes.length} rooms and ${edges.length} gates` : `Failed to reach final room ${finalNode.id}`,
    steps,
  }
}

function buildProgressionFromRoomLayout(
  cells: Pick<MazeCell, 'center'>[],
  graph: number[][],
  roomLayout: RoomLayout,
  seed: number,
): ProgressionAttempt {
  const boundaryFailure = validateRoomLayout(graph, roomLayout.cellKinds, roomLayout.areas, roomLayout.edges)
  if (boundaryFailure) {
    return { layout: null, reason: boundaryFailure }
  }

  const finalAreaId = roomLayout.areas.length - 1
  const cellFeatures: CellFeature[] = new Array(cells.length).fill('none')
  const chipCellIds: number[] = []
  const chipCellIdsByArea = roomLayout.areas.map(() => [] as number[])
  const keyColorsByArea = roomLayout.keyColorsByArea.map((keyColors) => keyColors.slice())

  for (const edge of roomLayout.edges) {
    if (edge.gate === 'door' && edge.color !== null) {
      cellFeatures[edge.gateCellId] = featureForDoor(edge.color)
    }
  }

  const socketCellId = roomLayout.edges.find((edge) => edge.gate === 'socket')?.gateCellId ?? -1
  if (socketCellId < 0) return { layout: null, reason: 'missing-socket' }
  cellFeatures[socketCellId] = 'socket'

  let exitCellId = -1

  for (const area of roomLayout.areas) {
    const candidates = makeRoomCandidateOrder(graph, area.cellIds, area.entryCellId, cells, mixSeed(seed, area.id + 1))

    if (area.id === finalAreaId) {
      const exitCandidate = candidates[0]
      if (exitCandidate === undefined) return { layout: null, reason: 'final-room-too-small' }
      exitCellId = exitCandidate
      cellFeatures[exitCellId] = 'exit'
      continue
    }

    const chipCount = area.childAreaIds.length > 1 ? 2 : 1
    const requiredCells = chipCount + keyColorsByArea[area.id].length
    if (candidates.length < requiredCells) return { layout: null, reason: 'room-capacity' }

    for (let chipIndex = 0; chipIndex < chipCount; chipIndex += 1) {
      const chipCellId = candidates[chipIndex]
      if (chipCellId === undefined) return { layout: null, reason: 'chip-placement' }
      cellFeatures[chipCellId] = 'chip'
      chipCellIds.push(chipCellId)
      chipCellIdsByArea[area.id].push(chipCellId)
    }

    for (let keyIndex = 0; keyIndex < keyColorsByArea[area.id].length; keyIndex += 1) {
      const keyCellId = candidates[chipCount + keyIndex]
      const color = keyColorsByArea[area.id][keyIndex]
      if (keyCellId === undefined || color === undefined) return { layout: null, reason: 'key-placement' }
      cellFeatures[keyCellId] = featureForKey(color)
    }
  }

  if (exitCellId < 0) return { layout: null, reason: 'missing-exit' }

  const areaDagNodes: AreaDagNode[] = roomLayout.areas.map((area) => ({
    id: area.id,
    depth: area.depth,
    entryCellId: area.entryCellId,
    cellIds: area.cellIds,
    chipCellIds: chipCellIdsByArea[area.id],
    keyColors: keyColorsByArea[area.id],
    kind: area.id === 0 ? 'start' : area.id === finalAreaId ? 'final' : 'normal',
  }))

  const areaDagEdges: AreaDagEdge[] = roomLayout.edges.map((edge) => ({
    fromAreaId: edge.fromAreaId,
    toAreaId: edge.toAreaId,
    gateCellId: edge.gateCellId,
    gateCellIds: edge.gateCellIds,
    gate: edge.gate,
    color: edge.color,
  }))

  const dagValidation = validateAreaDag(areaDagNodes, areaDagEdges)
  const validation: AreaDag['validation'] = dagValidation.passed ? {
    passed: true,
    summary: `Validated ${areaDagNodes.length} rooms and ${areaDagEdges.length} gates`,
    steps: ['Layout: rooms are sealed by walls except for single-tile gates', ...dagValidation.steps],
  } : dagValidation
  if (!validation.passed) return { layout: null, reason: 'dag-validation' }

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

  const graph = buildCellGraph(draftCells)
  const startCellId = 0
  const failureCounts = new Map<string, number>()

  for (let attempt = 0; attempt < WORLD_GENERATION_ATTEMPTS; attempt += 1) {
    const attemptSeed = mixSeed(options.seed, attempt + 1)
    const graphPlan = buildRoomGraphPlan(config, mixSeed(attemptSeed, 11))
    const roomLayout = buildRoomLayout(draftCells, graph, startCellId, config, graphPlan, mixSeed(attemptSeed, 23))
    if (!roomLayout.layout) {
      failureCounts.set(roomLayout.reason, (failureCounts.get(roomLayout.reason) ?? 0) + 1)
      continue
    }

    const progression = buildProgressionFromRoomLayout(draftCells, graph, roomLayout.layout, mixSeed(attemptSeed, 401))
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
      cells: draftCells.map((cell) => ({
        ...cell,
        kind: roomLayout.layout?.cellKinds[cell.id] ?? 'wall',
        feature: progression.layout?.cellFeatures[cell.id] ?? 'none',
      })),
    }
  }

  const failureSummary = Array.from(failureCounts.entries())
    .map(([reason, count]) => `${reason}:${count}`)
    .join(', ')
  throw new Error(`Failed to generate a room-based hyperbolic level (${failureSummary})`)
}
