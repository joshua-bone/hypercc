import { computeGeodesic, reflectPoint } from '../../hyper/geodesic'
import { approxEq, dot, norm, type Vec2 } from '../../hyper/vec2'
import { directionVectors, directions } from './directions'
import type { Direction, DirectionMap, MazeCell } from './model'

const GRID45_WORLD_ROTATION = -Math.PI / 4

type CellGeometry = Pick<MazeCell, 'center' | 'vertices'>

function signedArea(vertices: Vec2[]): number {
  let area = 0
  for (let index = 0; index < vertices.length; index += 1) {
    const nextIndex = (index + 1) % vertices.length
    area += vertices[index].x * vertices[nextIndex].y - vertices[nextIndex].x * vertices[index].y
  }
  return area / 2
}

function canonicalizePolygon(vertices: Vec2[]): Vec2[] {
  const vertexCount = vertices.length
  if (vertexCount === 0) return vertices

  let nextVertices = vertices.slice()
  if (signedArea(nextVertices) < 0) nextVertices.reverse()

  let startIndex = 0
  for (let index = 1; index < vertexCount; index += 1) {
    const candidate = nextVertices[index]
    const current = nextVertices[startIndex]
    if (candidate.x > current.x + 1e-12 || (Math.abs(candidate.x - current.x) <= 1e-12 && candidate.y > current.y)) {
      startIndex = index
    }
  }

  if (startIndex !== 0) {
    nextVertices = nextVertices.slice(startIndex).concat(nextVertices.slice(0, startIndex))
  }

  return nextVertices
}

function polygonCenter(vertices: Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const vertex of vertices) {
    x += vertex.x
    y += vertex.y
  }

  const divisor = vertices.length || 1
  return {
    x: x / divisor,
    y: y / divisor,
  }
}

function euclideanVertexRadiusForTiling(p: number, q: number): number {
  const angleA = Math.PI / p
  const angleB = Math.PI / q
  const coshRadius = 1 / (Math.tan(angleA) * Math.tan(angleB))
  return Math.tanh(Math.acosh(coshRadius) / 2)
}

function regularPolygonVertices(p: number, q: number): Vec2[] {
  const radius = euclideanVertexRadiusForTiling(p, q)
  const vertices: Vec2[] = []
  for (let index = 0; index < p; index += 1) {
    const angle = (2 * Math.PI * index) / p + GRID45_WORLD_ROTATION
    vertices.push({
      x: radius * Math.cos(angle),
      y: radius * Math.sin(angle),
    })
  }
  return canonicalizePolygon(vertices)
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

function findSharedSideIndex(vertices: Vec2[], a: Vec2, b: Vec2, epsilon = 1e-5): number | null {
  for (let index = 0; index < vertices.length; index += 1) {
    const start = vertices[index]
    const end = vertices[(index + 1) % vertices.length]
    if ((approxEq(start, a, epsilon) && approxEq(end, b, epsilon)) || (approxEq(start, b, epsilon) && approxEq(end, a, epsilon))) {
      return index
    }
  }

  return null
}

export function assignGrid45DirectionSides(vertices: Vec2[], center: Vec2): DirectionMap<number> {
  const sideSignals = vertices.map((vertex, side) => {
    const nextVertex = vertices[(side + 1) % vertices.length]
    return {
      side,
      outward: toUnitVector(center, midpoint(vertex, nextVertex)),
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

export function createGrid45RootGeometry(): CellGeometry {
  const vertices = regularPolygonVertices(4, 5)
  return {
    center: polygonCenter(vertices),
    vertices,
  }
}

export function reflectGrid45CellGeometry(cell: CellGeometry, direction: Direction): CellGeometry {
  const directionSides = assignGrid45DirectionSides(cell.vertices, cell.center)
  const side = directionSides[direction]
  const start = cell.vertices[side]
  const end = cell.vertices[(side + 1) % cell.vertices.length]
  const geodesic = computeGeodesic(start, end)
  const reflectedVertices = canonicalizePolygon(cell.vertices.map((vertex) => reflectPoint(vertex, geodesic)))
  return {
    center: polygonCenter(reflectedVertices),
    vertices: reflectedVertices,
  }
}

export function grid45CellGeometryKey(center: Vec2): string {
  const quantize = 1e6
  return `${Math.round(center.x * quantize)},${Math.round(center.y * quantize)}`
}

export function directionTowardNeighbor(cell: CellGeometry, neighbor: CellGeometry): Direction | null {
  const directionSides = assignGrid45DirectionSides(cell.vertices, cell.center)

  for (const direction of directions) {
    const side = directionSides[direction]
    const start = cell.vertices[side]
    const end = cell.vertices[(side + 1) % cell.vertices.length]
    if (findSharedSideIndex(neighbor.vertices, start, end) !== null) return direction
  }

  return null
}
