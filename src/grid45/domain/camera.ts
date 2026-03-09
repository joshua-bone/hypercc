import { clampToDisk, mobiusAdd, mobiusNeg } from '../../hyper/poincare'
import type { Vec2 } from '../../hyper/vec2'
import type { Direction } from './model'

// Use left-translation so the player's hyperbolic center maps to the origin
// without introducing the drift caused by right-subtraction in 2D.
export function toPlayerView(point: Vec2, playerCenter: Vec2): Vec2 {
  return mobiusAdd(mobiusNeg(playerCenter), point)
}

export function rotateViewPoint(point: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle)
  const s = Math.sin(angle)
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
  }
}

export function cameraAngleForMove(previousCenter: Vec2, nextCenter: Vec2, moveDirection: Direction): number {
  const backwardVector = toPlayerView(previousCenter, nextCenter)
  const backwardAngle = Math.atan2(backwardVector.y, backwardVector.x)
  const desiredAngle =
    moveDirection === 'north'
      ? -Math.PI / 2
      : moveDirection === 'east'
        ? Math.PI
        : moveDirection === 'south'
          ? Math.PI / 2
          : 0
  return desiredAngle - backwardAngle
}

export function toCameraView(point: Vec2, playerCenter: Vec2, cameraAngle: number): Vec2 {
  return rotateViewPoint(toPlayerView(point, playerCenter), cameraAngle)
}

export function moveCameraInView(cameraCenter: Vec2, cameraAngle: number, viewDelta: Vec2): Vec2 {
  const worldDelta = rotateViewPoint(viewDelta, -cameraAngle)
  return clampToDisk(mobiusAdd(cameraCenter, worldDelta))
}

export function orbitCameraAroundCenter(cameraCenter: Vec2, angleDelta: number): Vec2 {
  return clampToDisk(rotateViewPoint(cameraCenter, angleDelta))
}
