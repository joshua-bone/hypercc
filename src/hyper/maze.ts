import { geodesicPolyline } from './geodesic'
import { randInt, type Rng } from './random'
import type { Cell } from './tiling'
import type { Vec2 } from './vec2'

export function carveMaze(cells: Cell[], rng: Rng, startCellId = 0): void {
  const visited = new Array(cells.length).fill(false)
  const stack: number[] = [startCellId]
  visited[startCellId] = true

  while (stack.length > 0) {
    const currentId = stack[stack.length - 1]
    const current = cells[currentId]

    const choices: number[] = []
    for (let side = 0; side < current.neighbors.length; side++) {
      const n = current.neighbors[side]
      if (!n) continue
      if (!visited[n.id]) choices.push(side)
    }

    if (choices.length === 0) {
      stack.pop()
      continue
    }

    const side = choices[randInt(rng, 0, choices.length)]
    const next = current.neighbors[side]
    if (!next) continue

    current.walls[side] = false
    cells[next.id].walls[next.side] = false

    visited[next.id] = true
    stack.push(next.id)
  }
}

export function buildWallPolylines(cells: Cell[], segments = 12): Vec2[][] {
  const walls: Vec2[][] = []

  for (const cell of cells) {
    const p = cell.vertices.length
    for (let side = 0; side < p; side++) {
      if (!cell.walls[side]) continue

      const n = cell.neighbors[side]
      if (n && cell.id > n.id) continue

      const a = cell.vertices[side]
      const b = cell.vertices[(side + 1) % p]
      walls.push(geodesicPolyline(a, b, segments))
    }
  }

  return walls
}

