import { add, approxEq, cross, dot, lenSq, norm, scale, sub, type Vec2 } from './vec2'

export type Geodesic =
  | { kind: 'line'; u: Vec2 }
  | { kind: 'circle'; center: Vec2; radius: number }

function circumcircle(p1: Vec2, p2: Vec2, p3: Vec2): { center: Vec2; radius: number } | null {
  const x1 = p1.x
  const y1 = p1.y
  const x2 = p2.x
  const y2 = p2.y
  const x3 = p3.x
  const y3 = p3.y

  const d = 2 * (x1 * (y2 - y3) + x2 * (y3 - y1) + x3 * (y1 - y2))
  if (Math.abs(d) < 1e-12) return null

  const x1Sqy1Sq = x1 * x1 + y1 * y1
  const x2Sqy2Sq = x2 * x2 + y2 * y2
  const x3Sqy3Sq = x3 * x3 + y3 * y3

  const ux =
    (x1Sqy1Sq * (y2 - y3) + x2Sqy2Sq * (y3 - y1) + x3Sqy3Sq * (y1 - y2)) / d
  const uy =
    (x1Sqy1Sq * (x3 - x2) + x2Sqy2Sq * (x1 - x3) + x3Sqy3Sq * (x2 - x1)) / d

  const center = { x: ux, y: uy }
  const radius = Math.hypot(center.x - x1, center.y - y1)
  return { center, radius }
}

export function computeGeodesic(a: Vec2, b: Vec2): Geodesic {
  const cr = cross(a, b)
  if (Math.abs(cr) < 1e-10) {
    const u = norm(lenSq(a) > 1e-12 ? a : b)
    return { kind: 'line', u }
  }

  const aInv = scale(a, 1 / lenSq(a))
  const circle = circumcircle(a, b, aInv)
  if (!circle) {
    const u = norm(a)
    return { kind: 'line', u }
  }

  return { kind: 'circle', center: circle.center, radius: circle.radius }
}

export function geodesicEval(g: Geodesic, p: Vec2): number {
  if (g.kind === 'line') return cross(g.u, p)
  const d = sub(p, g.center)
  return lenSq(d) - g.radius * g.radius
}

export function reflectPoint(p: Vec2, g: Geodesic): Vec2 {
  if (g.kind === 'line') {
    const u = g.u
    const proj = scale(u, dot(p, u))
    return sub(scale(proj, 2), p)
  }

  const c = g.center
  const r2 = g.radius * g.radius
  const pc = sub(p, c)
  const denom = lenSq(pc)
  if (denom === 0) return p
  return add(c, scale(pc, r2 / denom))
}

function normalizeAngle(a: number): number {
  let x = a
  const tau = 2 * Math.PI
  while (x <= -Math.PI) x += tau
  while (x > Math.PI) x -= tau
  return x
}

export function geodesicPolyline(a: Vec2, b: Vec2, segments = 12): Vec2[] {
  if (approxEq(a, b)) return [a]

  const g = computeGeodesic(a, b)
  if (g.kind === 'line') {
    const pts: Vec2[] = []
    for (let i = 0; i <= segments; i++) {
      const t = i / segments
      pts.push({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t })
    }
    return pts
  }

  const c = g.center
  const r = g.radius
  const start = Math.atan2(a.y - c.y, a.x - c.x)
  const end = Math.atan2(b.y - c.y, b.x - c.x)
  const delta1 = normalizeAngle(end - start)
  const delta2 = delta1 > 0 ? delta1 - 2 * Math.PI : delta1 + 2 * Math.PI

  const mid1 = start + delta1 / 2
  const midP1 = { x: c.x + r * Math.cos(mid1), y: c.y + r * Math.sin(mid1) }
  const pickDelta = lenSq(midP1) < 1 ? delta1 : delta2

  const pts: Vec2[] = []
  for (let i = 0; i <= segments; i++) {
    const t = i / segments
    const ang = start + pickDelta * t
    pts.push({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) })
  }
  pts[0] = a
  pts[pts.length - 1] = b
  return pts
}

