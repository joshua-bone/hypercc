export type Vec2 = { x: number; y: number }

export function vec(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x
}

export function lenSq(v: Vec2): number {
  return v.x * v.x + v.y * v.y
}

export function len(v: Vec2): number {
  return Math.sqrt(lenSq(v))
}

export function norm(v: Vec2): Vec2 {
  const l = len(v)
  if (l === 0) return { x: 0, y: 0 }
  return { x: v.x / l, y: v.y / l }
}

export function perp(v: Vec2): Vec2 {
  return { x: -v.y, y: v.x }
}

export function approxEq(a: Vec2, b: Vec2, eps = 1e-6): boolean {
  return Math.abs(a.x - b.x) <= eps && Math.abs(a.y - b.y) <= eps
}

