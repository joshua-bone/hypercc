import { approxEq, len, lenSq, type Vec2 } from './vec2'
import { computeGeodesic, geodesicEval, reflectPoint, type Geodesic } from './geodesic'

export type Neighbor = { id: number; side: number }

export type EdgeDef = {
  a: Vec2
  b: Vec2
  geodesic: Geodesic
  interiorSign: 1 | -1
}

export type Cell = {
  id: number
  vertices: Vec2[]
  anchor: Vec2
  center: Vec2
  edges: EdgeDef[]
  neighbors: Array<Neighbor | null>
  walls: boolean[]
}

export type GenerateTilingOptions = {
  p: number
  q: number
  maxCells: number
  maxCenterRadius: number
}

function signedArea(vertices: Vec2[]): number {
  let a = 0
  for (let i = 0; i < vertices.length; i++) {
    const j = (i + 1) % vertices.length
    a += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y
  }
  return a / 2
}

function canonicalizePolygon(vertices: Vec2[]): Vec2[] {
  const n = vertices.length
  if (n === 0) return vertices

  let verts = vertices.slice()
  if (signedArea(verts) < 0) verts.reverse()

  let start = 0
  for (let i = 1; i < n; i++) {
    const a = verts[i]
    const b = verts[start]
    if (a.x > b.x + 1e-12 || (Math.abs(a.x - b.x) <= 1e-12 && a.y > b.y)) start = i
  }
  if (start !== 0) verts = verts.slice(start).concat(verts.slice(0, start))
  return verts
}

function polygonCenter(vertices: Vec2[]): Vec2 {
  let x = 0
  let y = 0
  for (const v of vertices) {
    x += v.x
    y += v.y
  }
  const n = vertices.length || 1
  return { x: x / n, y: y / n }
}

function cellKey(center: Vec2): string {
  const q = 1e5
  return `${Math.round(center.x * q)},${Math.round(center.y * q)}`
}

function buildEdges(vertices: Vec2[], center: Vec2): EdgeDef[] {
  const n = vertices.length
  const edges: EdgeDef[] = []
  for (let i = 0; i < n; i++) {
    const a = vertices[i]
    const b = vertices[(i + 1) % n]
    const geodesic = computeGeodesic(a, b)
    const sign = geodesicEval(geodesic, center) >= 0 ? 1 : -1
    edges.push({ a, b, geodesic, interiorSign: sign })
  }
  return edges
}

function findSharedSideIndex(vertices: Vec2[], a: Vec2, b: Vec2, eps = 1e-5): number | null {
  const n = vertices.length
  for (let i = 0; i < n; i++) {
    const v1 = vertices[i]
    const v2 = vertices[(i + 1) % n]
    if ((approxEq(v1, a, eps) && approxEq(v2, b, eps)) || (approxEq(v1, b, eps) && approxEq(v2, a, eps)))
      return i
  }
  return null
}

function euclideanVertexRadiusForTiling(p: number, q: number): number {
  // For {p,q} in curvature -1: cosh(R) = cot(pi/p) * cot(pi/q), with R the hyperbolic circumradius.
  const A = Math.PI / p
  const B = Math.PI / q
  const coshR = 1 / (Math.tan(A) * Math.tan(B))
  const R = Math.acosh(coshR)
  return Math.tanh(R / 2)
}

function regularPolygonVertices(p: number, q: number): Vec2[] {
  const r = euclideanVertexRadiusForTiling(p, q)
  const verts: Vec2[] = []
  for (let i = 0; i < p; i++) {
    const t = (2 * Math.PI * i) / p
    verts.push({ x: r * Math.cos(t), y: r * Math.sin(t) })
  }
  return canonicalizePolygon(verts)
}

function makeCell(id: number, vertices: Vec2[], anchor: Vec2): Cell {
  const center = polygonCenter(vertices)
  const edges = buildEdges(vertices, anchor)
  const p = vertices.length
  return {
    id,
    vertices,
    anchor,
    center,
    edges,
    neighbors: Array(p).fill(null),
    walls: Array(p).fill(true),
  }
}

export function generateTiling(options: GenerateTilingOptions): Cell[] {
  const { p, q, maxCells, maxCenterRadius } = options
  const cells: Cell[] = []
  const keyToId = new Map<string, number>()
  const queue: number[] = []

  const root = makeCell(0, regularPolygonVertices(p, q), { x: 0, y: 0 })
  cells.push(root)
  keyToId.set(cellKey(root.anchor), root.id)
  queue.push(root.id)

  while (queue.length > 0 && cells.length < maxCells) {
    const id = queue.shift()
    if (id === undefined) break
    const cell = cells[id]

    for (let side = 0; side < p; side++) {
      if (cell.neighbors[side]) continue

      const g = cell.edges[side].geodesic
      const reflected = cell.vertices.map((v) => reflectPoint(v, g))
      const reflectedAnchor = reflectPoint(cell.anchor, g)
      const verts = canonicalizePolygon(reflected)
      const center = polygonCenter(verts)

      const centerRadius = len(reflectedAnchor)
      if (centerRadius > maxCenterRadius) {
        cell.neighbors[side] = null
        continue
      }
      if (verts.some((v) => lenSq(v) >= 0.999999)) {
        cell.neighbors[side] = null
        continue
      }

      const key = cellKey(reflectedAnchor)
      const existingId = keyToId.get(key)

      const a = cell.vertices[side]
      const b = cell.vertices[(side + 1) % p]

      if (existingId !== undefined) {
        const neighbor = cells[existingId]
        const neighborSide = findSharedSideIndex(neighbor.vertices, a, b)
        if (neighborSide === null) continue

        cell.neighbors[side] = { id: neighbor.id, side: neighborSide }
        if (!neighbor.neighbors[neighborSide]) neighbor.neighbors[neighborSide] = { id: cell.id, side }
        continue
      }

      if (cells.length >= maxCells) {
        cell.neighbors[side] = null
        continue
      }

      const nextId = cells.length
      const nextCell = makeCell(nextId, verts, reflectedAnchor)
      const nextSide = findSharedSideIndex(nextCell.vertices, a, b)
      if (nextSide === null) continue

      cells.push(nextCell)
      keyToId.set(key, nextId)

      cell.neighbors[side] = { id: nextId, side: nextSide }
      nextCell.neighbors[nextSide] = { id: cell.id, side }

      queue.push(nextId)
    }
  }

  return cells
}

export function pointInCell(cell: Cell, p: Vec2, eps = 1e-7): boolean {
  for (const e of cell.edges) {
    const v = geodesicEval(e.geodesic, p)
    if (v * e.interiorSign < -eps) return false
  }
  return true
}
