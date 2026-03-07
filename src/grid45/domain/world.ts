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
  minAreaCount: number
}

const worldSizeConfigs: Record<WorldSize, WorldSizeConfig> = {
  tiny: {
    maxCells: 760,
    maxCenterRadius: 0.994,
    targetAreaCount: 6,
    minAreaCount: 4,
  },
  small: {
    maxCells: 880,
    maxCenterRadius: 0.994,
    targetAreaCount: 7,
    minAreaCount: 5,
  },
  medium: {
    maxCells: 1600,
    maxCenterRadius: 0.996,
    targetAreaCount: 7,
    minAreaCount: 5,
  },
  large: {
    maxCells: 1900,
    maxCenterRadius: 0.997,
    targetAreaCount: 6,
    minAreaCount: 5,
  },
  huge: {
    maxCells: 2500,
    maxCenterRadius: 0.998,
    targetAreaCount: 4,
    minAreaCount: 4,
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

function buildPathToRoot(parent: number[], targetCellId: number): number[] {
  const pathCellIds: number[] = []
  let currentCellId = targetCellId

  while (currentCellId !== -1) {
    pathCellIds.push(currentCellId)
    currentCellId = parent[currentCellId]
  }

  pathCellIds.reverse()
  return pathCellIds
}

function findArticulationPoints(tree: RootedFloorTree): Set<number> {
  const visited = new Array(tree.graph.length).fill(false)
  const discovery = new Array(tree.graph.length).fill(-1)
  const low = new Array(tree.graph.length).fill(-1)
  const articulationIds = new Set<number>()
  let time = 0

  const visit = (cellId: number, parentCellId: number) => {
    visited[cellId] = true
    discovery[cellId] = time
    low[cellId] = time
    time += 1

    let childCount = 0
    for (const neighborId of tree.graph[cellId]) {
      if (!visited[neighborId]) {
        childCount += 1
        visit(neighborId, cellId)
        low[cellId] = Math.min(low[cellId], low[neighborId])
        if (parentCellId !== -1 && low[neighborId] >= discovery[cellId]) {
          articulationIds.add(cellId)
        }
      } else if (neighborId !== parentCellId) {
        low[cellId] = Math.min(low[cellId], discovery[neighborId])
      }
    }

    if (parentCellId === -1 && childCount > 1) articulationIds.add(cellId)
  }

  for (const floorId of tree.floorIds) {
    if (!visited[floorId]) visit(floorId, -1)
  }

  return articulationIds
}

function buildRoutePlans(tree: RootedFloorTree, articulationIds: Set<number>): Array<{
  targetCellId: number
  pathCellIds: number[]
  candidateGateIds: number[]
}> {
  const leafIds = tree.floorIds.filter((cellId) => tree.children[cellId].length === 0)
  const candidateTargets = (leafIds.length > 0 ? leafIds : tree.floorIds)
    .slice()
    .sort((a, b) => tree.depth[b] - tree.depth[a] || a - b)
    .slice(0, LEAF_CANDIDATE_LIMIT)

  return candidateTargets.map((targetCellId) => {
    const pathCellIds = buildPathToRoot(tree.parent, targetCellId)
    return {
      targetCellId,
      pathCellIds,
      candidateGateIds: pathCellIds.slice(1, -1).filter((cellId) => articulationIds.has(cellId)),
    }
  })
}

function selectGateIds(candidateGateIds: number[], gateCount: number, seed: number): number[] | null {
  if (candidateGateIds.length < gateCount) return null

  const rng = mulberry32(seed)
  const selectedIndexes: number[] = []
  let previousIndex = -1

  for (let slot = 0; slot < gateCount; slot += 1) {
    const remainingSlots = gateCount - slot
    const minIndex = previousIndex + 1
    const maxIndex = candidateGateIds.length - remainingSlots
    const center = (((slot + 1) * (candidateGateIds.length + 1)) / (gateCount + 1)) - 1
    const spread = Math.max(1, Math.ceil(candidateGateIds.length / Math.max(4, gateCount * 2)))
    let low = Math.max(minIndex, Math.floor(center - spread))
    let high = Math.min(maxIndex, Math.ceil(center + spread))

    if (low > high) {
      low = minIndex
      high = maxIndex
    }

    const chosenIndex = low + Math.floor(rng() * (high - low + 1))
    selectedIndexes.push(chosenIndex)
    previousIndex = chosenIndex
  }

  return selectedIndexes.map((index) => candidateGateIds[index])
}

function doorColorForAreaId(areaId: number): KeyColor {
  if (areaId <= 0) return 'blue'
  return DOOR_COLOR_SEQUENCE[Math.min(areaId - 1, DOOR_COLOR_SEQUENCE.length - 1)]
}

function buildAreaPlanFromGateIds(tree: RootedFloorTree, startCellId: number, gateCellIds: number[]): {
  areas: AreaPlan[]
  edges: AreaEdgePlan[]
} {
  const areaCount = gateCellIds.length + 1
  const areaIdByCellId = new Array(tree.graph.length).fill(-1)
  const gateAreaIdByCellId = new Map(gateCellIds.map((gateCellId, index) => [gateCellId, index + 1]))
  const visitStack: Array<{ cellId: number; areaId: number }> = [{ cellId: startCellId, areaId: 0 }]

  while (visitStack.length > 0) {
    const next = visitStack.pop()
    if (!next) break

    const ownAreaId = gateAreaIdByCellId.get(next.cellId) ?? next.areaId
    areaIdByCellId[next.cellId] = ownAreaId
    for (let childIndex = tree.children[next.cellId].length - 1; childIndex >= 0; childIndex -= 1) {
      visitStack.push({
        cellId: tree.children[next.cellId][childIndex],
        areaId: ownAreaId,
      })
    }
  }

  const areas: AreaPlan[] = Array.from({ length: areaCount }, (_, areaId) => ({
    id: areaId,
    parentAreaId: areaId === 0 ? null : areaId - 1,
    depth: areaId,
    entryCellId: areaId === 0 ? startCellId : gateCellIds[areaId - 1],
    cellIds: [],
    childAreaIds: areaId + 1 < areaCount ? [areaId + 1] : [],
  }))

  for (const floorId of tree.floorIds) {
    const areaId = areaIdByCellId[floorId]
    if (areaId >= 0) areas[areaId].cellIds.push(floorId)
  }

  const edges: AreaEdgePlan[] = gateCellIds.map((gateCellId, index) => ({
    fromAreaId: index,
    toAreaId: index + 1,
    gateCellId,
    gateCellIds: [gateCellId],
    gate: index + 1 === areaCount - 1 ? 'socket' : 'door',
    color: index + 1 === areaCount - 1 ? null : doorColorForAreaId(index + 1),
  }))

  return {
    areas,
    edges,
  }
}

function validateSingleGateAreas(graph: number[][], areas: AreaPlan[], edges: AreaEdgePlan[]): string | null {
  const areaIdByCellId = new Array(graph.length).fill(-1)
  const edgeByToAreaId = new Map(edges.map((edge) => [edge.toAreaId, edge]))

  for (const area of areas) {
    for (const cellId of area.cellIds) {
      if (areaIdByCellId[cellId] !== -1) return 'duplicate-area-cell'
      areaIdByCellId[cellId] = area.id
    }
  }

  for (const area of areas) {
    if (area.cellIds.length === 0) return 'empty-area'

    const areaCellIds = new Set(area.cellIds)
    const queue: number[] = [area.entryCellId]
    const visited = new Set<number>([area.entryCellId])

    while (queue.length > 0) {
      const cellId = queue.shift()
      if (cellId === undefined) break

      for (const neighborId of graph[cellId]) {
        if (!areaCellIds.has(neighborId) || visited.has(neighborId)) continue
        visited.add(neighborId)
        queue.push(neighborId)
      }
    }

    if (visited.size !== area.cellIds.length) return 'disconnected-area'
  }

  for (let areaId = 1; areaId < areas.length; areaId += 1) {
    const edge = edgeByToAreaId.get(areaId)
    if (!edge) return 'missing-gate-edge'
    if (areaIdByCellId[edge.gateCellId] !== areaId) return 'gate-not-in-child'

    let touchesParent = false
    let touchesOwnArea = false
    for (const neighborId of graph[edge.gateCellId]) {
      if (areaIdByCellId[neighborId] === areaId - 1) touchesParent = true
      if (areaIdByCellId[neighborId] === areaId) touchesOwnArea = true
    }

    if (!touchesParent || !touchesOwnArea) return 'broken-gate-bridge'
  }

  for (const area of areas) {
    for (const cellId of area.cellIds) {
      for (const neighborId of graph[cellId]) {
        if (neighborId < cellId) continue

        const fromAreaId = areaIdByCellId[cellId]
        const toAreaId = areaIdByCellId[neighborId]
        if (fromAreaId === -1 || toAreaId === -1) return 'unassigned-area-cell'
        if (fromAreaId === toAreaId) continue

        const highAreaId = Math.max(fromAreaId, toAreaId)
        const lowAreaId = Math.min(fromAreaId, toAreaId)
        if (highAreaId !== lowAreaId + 1) return 'non-local-area-edge'

        const gateCellId = edgeByToAreaId.get(highAreaId)?.gateCellId
        if (gateCellId === undefined || (cellId !== gateCellId && neighborId !== gateCellId)) return 'gate-bypass-edge'
      }
    }
  }

  return null
}

function buildChokepointAreas(
  tree: RootedFloorTree,
  startCellId: number,
  targetAreaCount: number,
  minAreaCount: number,
  seed: number,
): { areas: AreaPlan[]; edges: AreaEdgePlan[] } | null {
  const articulationIds = findArticulationPoints(tree)
  const routePlans = buildRoutePlans(tree, articulationIds)

  for (const routePlan of routePlans) {
    const maxAreaCount = Math.min(targetAreaCount, routePlan.candidateGateIds.length + 1)
    for (let areaCount = maxAreaCount; areaCount >= minAreaCount; areaCount -= 1) {
      const gateCount = areaCount - 1

      for (let attempt = 0; attempt < PATH_LAYOUT_ATTEMPTS; attempt += 1) {
        const gateCellIds = selectGateIds(
          routePlan.candidateGateIds,
          gateCount,
          mixSeed(seed, routePlan.targetCellId * 131 + areaCount * 17 + attempt + 1),
        )
        if (!gateCellIds) continue

        const layout = buildAreaPlanFromGateIds(tree, startCellId, gateCellIds)
        if (validateSingleGateAreas(tree.graph, layout.areas, layout.edges) !== null) continue

        return layout
      }
    }
  }

  return null
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
  edges: AreaEdgePlan[],
  seed: number,
): ProgressionAttempt {
  const boundaryFailure = validateSingleGateAreas(tree.graph, areas, edges)
  if (boundaryFailure) {
    return { layout: null, reason: boundaryFailure }
  }

  const finalAreaId = areas.length - 1
  const cellFeatures: CellFeature[] = new Array(cells.length).fill('none')
  const chipCellIds: number[] = []
  const chipCellIdsByArea = areas.map(() => [] as number[])
  const keyColorsByArea = areas.map(() => [] as KeyColor[])
  const plannedKeysByArea = areas.map(() => [] as KeyColor[])
  const reservedCellIdsByArea = areas.map((area) => new Set(area.id === 0 ? [area.entryCellId] : [area.entryCellId]))
  let hasGreenKey = false

  for (const edge of edges) {
    if (edge.gate === 'door' && edge.color !== null) {
      cellFeatures[edge.gateCellId] = featureForDoor(edge.color)
      if (edge.color === 'green') {
        if (hasGreenKey) continue
        hasGreenKey = true
      }
      plannedKeysByArea[edge.fromAreaId].push(edge.color)
    }
  }

  const rng = mulberry32(mixSeed(seed, 37))
  const socketCellId = edges.find((edge) => edge.gate === 'socket')?.gateCellId ?? -1
  if (socketCellId < 0) {
    return { layout: null, reason: 'missing-socket' }
  }
  cellFeatures[socketCellId] = 'socket'
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

  const dagValidation = validateAreaDag(areaDagNodes, areaDagEdges)
  const validation: AreaDag['validation'] = dagValidation.passed ? {
    passed: true,
    summary: `Validated ${areaDagNodes.length} BFS areas and ${areaDagEdges.length} single-cell gates`,
    steps: ['Layout: every area transition is a single gate cell on the live map', ...dagValidation.steps],
  } : dagValidation
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

  const chokepointAreas = buildChokepointAreas(tree, startCellId, config.targetAreaCount, config.minAreaCount, seed)
  if (!chokepointAreas) {
    return { layout: null, reason: 'area-layout' }
  }

  return buildProgressionFromAreas(cells, tree, chokepointAreas.areas, chokepointAreas.edges, mixSeed(seed, 101))
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
