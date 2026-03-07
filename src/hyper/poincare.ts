import { add, dot, lenSq, scale, sub, type Vec2 } from './vec2'

export function clampToDisk(p: Vec2, maxRadius = 0.999999): Vec2 {
  const r2 = lenSq(p)
  const maxR2 = maxRadius * maxRadius
  if (r2 <= maxR2) return p
  const r = Math.sqrt(r2)
  return scale(p, maxRadius / r)
}

// Möbius addition on the unit Poincaré disk (curvature -1).
export function mobiusAdd(a: Vec2, b: Vec2): Vec2 {
  const a2 = lenSq(a)
  const b2 = lenSq(b)
  const ab2 = 2 * dot(a, b)
  const denom = 1 + ab2 + a2 * b2
  if (denom === 0) return { x: 0, y: 0 }

  const term1 = scale(a, 1 + ab2 + b2)
  const term2 = scale(b, 1 - a2)
  return clampToDisk(scale(add(term1, term2), 1 / denom))
}

export function mobiusNeg(a: Vec2): Vec2 {
  return { x: -a.x, y: -a.y }
}

export function mobiusSub(a: Vec2, b: Vec2): Vec2 {
  return mobiusAdd(a, mobiusNeg(b))
}

export function mobiusTranslate(point: Vec2, by: Vec2): Vec2 {
  return mobiusAdd(by, point)
}

export function toViewSpace(worldPoint: Vec2, playerPos: Vec2): Vec2 {
  return mobiusSub(worldPoint, playerPos)
}

export function hyperbolicDistance(a: Vec2, b: Vec2): number {
  // d(a,b) = arcosh(1 + 2|a-b|^2 / ((1-|a|^2)(1-|b|^2)))
  const diff = sub(a, b)
  const num = 2 * lenSq(diff)
  const denom = (1 - lenSq(a)) * (1 - lenSq(b))
  const x = 1 + num / denom
  return Math.acosh(Math.max(1, x))
}

