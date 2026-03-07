import { mulberry32 } from '../../hyper/random'
import { generateTiling, type Cell as HyperCell } from '../../hyper/tiling'
import { dot, norm, type Vec2 } from '../../hyper/vec2'
import { directionVectors, directions } from './directions'
import type { CellKind, Direction, DirectionMap, MazeCell, MazeWorld } from './model'

const WORLD_ROTATION = -Math.PI / 4
const DEFAULT_MAX_CELLS = 1600
const DEFAULT_MAX_CENTER_RADIUS = 0.996
const WORLD_GENERATION_ATTEMPTS = 64

type CreateGrid45WorldOptions = {
  seed: number
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

type ObjectiveLayout = {
  chipCellIds: number[]
  socketCellId: number
  exitCellId: number
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

function computeDistances(graph: number[][], startId: number): number[] {
  const distances = new Array(graph.length).fill(-1)
  const queue: number[] = [startId]
  distances[startId] = 0

  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break

    const nextDistance = distances[id] + 1
    for (const neighborId of graph[id]) {
      if (distances[neighborId] !== -1) continue
      distances[neighborId] = nextDistance
      queue.push(neighborId)
    }
  }

  return distances
}

function collectReachable(graph: number[][], startId: number, blockedId: number): Set<number> {
  const reachable = new Set<number>()
  if (startId === blockedId) return reachable

  const queue: number[] = [startId]
  reachable.add(startId)

  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break

    for (const neighborId of graph[id]) {
      if (neighborId === blockedId || reachable.has(neighborId)) continue
      reachable.add(neighborId)
      queue.push(neighborId)
    }
  }

  return reachable
}

function collectDisconnectedComponents(
  graph: number[][],
  candidateIds: Set<number>,
  blockedId: number,
): number[][] {
  const components: number[][] = []
  const unseen = new Set(candidateIds)

  while (unseen.size > 0) {
    const startId = unseen.values().next().value as number
    unseen.delete(startId)

    const component: number[] = []
    const queue: number[] = [startId]
    while (queue.length > 0) {
      const id = queue.shift()
      if (id === undefined) break

      component.push(id)
      for (const neighborId of graph[id]) {
        if (neighborId === blockedId || !unseen.has(neighborId)) continue
        unseen.delete(neighborId)
        queue.push(neighborId)
      }
    }

    components.push(component)
  }

  return components
}

function mixSeed(seed: number, salt: number): number {
  return (seed ^ Math.imul(salt, 0x9e3779b1)) >>> 0
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function pickObjectiveLayout(cells: MazeCell[], startCellId: number, seed: number): ObjectiveLayout | null {
  const floorGraph = buildFloorGraph(cells)
  const floorIds = cells.filter((cell) => cell.kind === 'floor').map((cell) => cell.id)
  const distancesFromStart = computeDistances(floorGraph, startCellId)
  const desiredChipCount = clamp(Math.floor(floorIds.length / 40), 8, 20)

  let bestLayout: (ObjectiveLayout & { score: number }) | null = null

  for (const socketCellId of floorIds) {
    if (socketCellId === startCellId) continue
    if (distancesFromStart[socketCellId] < 3) continue

    const reachable = collectReachable(floorGraph, startCellId, socketCellId)
    if (reachable.size >= floorIds.length - 1) continue

    const disconnectedIds = new Set(
      floorIds.filter((id) => id !== socketCellId && !reachable.has(id)),
    )
    if (disconnectedIds.size === 0) continue

    const accessibleChipCandidates = Array.from(reachable).filter((id) => id !== startCellId)
    if (accessibleChipCandidates.length < desiredChipCount) continue

    const disconnectedComponents = collectDisconnectedComponents(floorGraph, disconnectedIds, socketCellId)

    for (const component of disconnectedComponents) {
      const exitCellId = component.reduce((bestId, id) =>
        distancesFromStart[id] > distancesFromStart[bestId] ? id : bestId,
      component[0])

      if (distancesFromStart[exitCellId] < distancesFromStart[socketCellId] + 2) continue

      const chipCount = clamp(
        desiredChipCount,
        4,
        Math.max(4, accessibleChipCandidates.length - 2),
      )
      const chipRng = mulberry32(mixSeed(seed, socketCellId ^ exitCellId ^ component.length))
      const chipCellIds = accessibleChipCandidates
        .map((id) => ({
          id,
          score: distancesFromStart[id] + chipRng() * 4,
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, chipCount)
        .map((entry) => entry.id)

      const score =
        distancesFromStart[exitCellId] * 12 +
        component.length * 3 +
        distancesFromStart[socketCellId] * 4 +
        chipCellIds.length

      if (!bestLayout || score > bestLayout.score) {
        bestLayout = {
          chipCellIds,
          socketCellId,
          exitCellId,
          score,
        }
      }
    }
  }

  if (!bestLayout) return null

  return {
    chipCellIds: bestLayout.chipCellIds,
    socketCellId: bestLayout.socketCellId,
    exitCellId: bestLayout.exitCellId,
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
  const { seed, maxCells = DEFAULT_MAX_CELLS, maxCenterRadius = DEFAULT_MAX_CENTER_RADIUS } = options
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

  for (let attempt = 0; attempt < WORLD_GENERATION_ATTEMPTS; attempt += 1) {
    const attemptSeed = mixSeed(seed, attempt + 1)
    const kinds = carveFloorKinds(draftCells.length, roomConnections, mixSeed(attemptSeed, 1))
    const cells = draftCells.map((cell) => ({
      ...cell,
      kind: kinds[cell.id],
      feature: 'none' as const,
    }))
    const objectiveLayout = pickObjectiveLayout(cells, startCellId, mixSeed(attemptSeed, 2))
    if (!objectiveLayout) continue
    const chipCellIds = new Set(objectiveLayout.chipCellIds)

    return {
      startCellId,
      chipCellIds: objectiveLayout.chipCellIds,
      socketCellId: objectiveLayout.socketCellId,
      exitCellId: objectiveLayout.exitCellId,
      cells: cells.map((cell) => ({
        ...cell,
        feature:
          cell.id === objectiveLayout.socketCellId
            ? 'socket'
            : cell.id === objectiveLayout.exitCellId
              ? 'exit'
              : chipCellIds.has(cell.id)
                ? 'chip'
                : 'none',
      })),
    }
  }

  throw new Error('Failed to generate a gated hyperbolic level')
}
