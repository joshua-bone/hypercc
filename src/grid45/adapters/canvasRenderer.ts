import { geodesicPolyline } from '../../hyper/geodesic'
import { toCameraView } from '../domain/camera'
import type { Grid45Tileset } from './spriteAtlas'
import type { GameState, MazeCell } from '../domain/model'

type ScreenPoint = {
  x: number
  y: number
}

type ProjectedOutline = ScreenPoint[][]
type ProjectedShape = {
  outline: ProjectedOutline
  corners: ScreenPoint[]
}

function projectCellShape(
  cell: MazeCell,
  playerCenter: MazeCell['center'],
  cameraAngle: number,
  centerX: number,
  centerY: number,
  radius: number,
): ProjectedShape {
  const corners = cell.vertices.map((point) => {
    const viewPoint = toCameraView(point, playerCenter, cameraAngle)
    return {
      x: centerX + viewPoint.x * radius,
      y: centerY - viewPoint.y * radius,
    }
  })

  const outline = cell.vertices.map((a, side) => {
    const b = cell.vertices[(side + 1) % cell.vertices.length]
    const polyline = geodesicPolyline(a, b, 8)
    return polyline.map((point, index) => {
      if (index === 0) return corners[side]
      if (index === polyline.length - 1) return corners[(side + 1) % corners.length]

      const viewPoint = toCameraView(point, playerCenter, cameraAngle)
      return {
        x: centerX + viewPoint.x * radius,
        y: centerY - viewPoint.y * radius,
      }
    })
  })

  return { outline, corners }
}

function traceProjectedPath(ctx: CanvasRenderingContext2D, outline: ProjectedOutline): void {
  let started = false

  for (const segment of outline) {
    for (let i = 0; i < segment.length; i++) {
      const point = segment[i]
      if (!started) {
        ctx.moveTo(point.x, point.y)
        started = true
      } else if (i > 0) {
        ctx.lineTo(point.x, point.y)
      }
    }
  }

  ctx.closePath()
}

function outlineBounds(outline: ProjectedOutline): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const segment of outline) {
    for (const point of segment) {
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }
  }

  return { minX, minY, maxX, maxY }
}

function traceCellPath(ctx: CanvasRenderingContext2D, outline: ProjectedOutline): void {
  traceProjectedPath(ctx, outline)
}

function fillCell(
  ctx: CanvasRenderingContext2D,
  outline: ProjectedOutline,
  fillStyle: string,
): void {
  ctx.beginPath()
  traceCellPath(ctx, outline)
  ctx.fillStyle = fillStyle
  ctx.fill()
}

function baseFillForCell(kind: MazeCell['kind']): string {
  return kind === 'floor' ? '#bebebe' : '#9c9c9c'
}

function featureFillForCell(
  cell: MazeCell,
  state: Pick<GameState, 'remainingChipCellIds' | 'socketCleared'>,
): string | null {
  if (cell.feature === 'chip' && state.remainingChipCellIds.has(cell.id)) return '#e0c15b'
  if (cell.feature === 'socket') return state.socketCleared ? null : '#5ea0c6'
  if (cell.feature === 'exit') return '#6cb774'
  return null
}

function featureSpriteForCell(
  cell: MazeCell,
  state: Pick<GameState, 'remainingChipCellIds' | 'socketCleared'>,
  tileset: Grid45Tileset,
): CanvasImageSource | null {
  if (cell.feature === 'chip') {
    return state.remainingChipCellIds.has(cell.id) ? tileset.features.chip : null
  }
  if (cell.feature === 'socket') return state.socketCleared ? null : tileset.features.socket
  if (cell.feature === 'exit') return tileset.features.exit
  return null
}

function drawCellSprite(
  ctx: CanvasRenderingContext2D,
  shape: ProjectedShape,
  sprite: CanvasImageSource,
): void {
  const { outline, corners } = shape
  const { minX, minY, maxX, maxY } = outlineBounds(outline)
  const maxDimension = Math.max(maxX - minX, maxY - minY)
  const subdivisions = Math.max(2, Math.min(4, Math.ceil(maxDimension / 84)))
  const sourceSize = 32
  const sourceInset = 1

  const bilerp = (u: number, v: number): ScreenPoint => {
    const top = {
      x: corners[0].x * (1 - u) + corners[1].x * u,
      y: corners[0].y * (1 - u) + corners[1].y * u,
    }
    const bottom = {
      x: corners[3].x * (1 - u) + corners[2].x * u,
      y: corners[3].y * (1 - u) + corners[2].y * u,
    }

    return {
      x: top.x * (1 - v) + bottom.x * v,
      y: top.y * (1 - v) + bottom.y * v,
    }
  }

  const drawTriangle = (
    s0: ScreenPoint,
    s1: ScreenPoint,
    s2: ScreenPoint,
    d0: ScreenPoint,
    d1: ScreenPoint,
    d2: ScreenPoint,
  ): void => {
    const expandTriangle = (p0: ScreenPoint, p1: ScreenPoint, p2: ScreenPoint, amount: number): [ScreenPoint, ScreenPoint, ScreenPoint] => {
      const center = {
        x: (p0.x + p1.x + p2.x) / 3,
        y: (p0.y + p1.y + p2.y) / 3,
      }

      const expandPoint = (point: ScreenPoint): ScreenPoint => {
        const dx = point.x - center.x
        const dy = point.y - center.y
        const length = Math.hypot(dx, dy) || 1
        return {
          x: point.x + (dx / length) * amount,
          y: point.y + (dy / length) * amount,
        }
      }

      return [expandPoint(p0), expandPoint(p1), expandPoint(p2)]
    }

    const [e0, e1, e2] = expandTriangle(d0, d1, d2, 0.45)
    const denom = s0.x * (s1.y - s2.y) + s1.x * (s2.y - s0.y) + s2.x * (s0.y - s1.y)
    if (Math.abs(denom) < 1e-6) return

    const a = (e0.x * (s1.y - s2.y) + e1.x * (s2.y - s0.y) + e2.x * (s0.y - s1.y)) / denom
    const b = (e0.y * (s1.y - s2.y) + e1.y * (s2.y - s0.y) + e2.y * (s0.y - s1.y)) / denom
    const c = (e0.x * (s2.x - s1.x) + e1.x * (s0.x - s2.x) + e2.x * (s1.x - s0.x)) / denom
    const d = (e0.y * (s2.x - s1.x) + e1.y * (s0.x - s2.x) + e2.y * (s1.x - s0.x)) / denom
    const e =
      (e0.x * (s1.x * s2.y - s2.x * s1.y) +
        e1.x * (s2.x * s0.y - s0.x * s2.y) +
        e2.x * (s0.x * s1.y - s1.x * s0.y)) /
      denom
    const f =
      (e0.y * (s1.x * s2.y - s2.x * s1.y) +
        e1.y * (s2.x * s0.y - s0.x * s2.y) +
        e2.y * (s0.x * s1.y - s1.x * s0.y)) /
      denom

    ctx.save()
    ctx.beginPath()
    ctx.moveTo(e0.x, e0.y)
    ctx.lineTo(e1.x, e1.y)
    ctx.lineTo(e2.x, e2.y)
    ctx.closePath()
    ctx.clip()
    ctx.transform(a, b, c, d, e, f)
    ctx.drawImage(sprite, 0, 0)
    ctx.restore()
  }

  ctx.save()
  ctx.beginPath()
  traceCellPath(ctx, outline)
  ctx.clip()

  ctx.imageSmoothingEnabled = true
  for (let y = 0; y < subdivisions; y++) {
    const v0 = y / subdivisions
    const v1 = (y + 1) / subdivisions
    for (let x = 0; x < subdivisions; x++) {
      const u0 = x / subdivisions
      const u1 = (x + 1) / subdivisions

      const q00 = bilerp(u0, v0)
      const q10 = bilerp(u1, v0)
      const q11 = bilerp(u1, v1)
      const q01 = bilerp(u0, v1)

      const s00 = { x: sourceInset + u0 * (sourceSize - sourceInset * 2), y: sourceInset + v0 * (sourceSize - sourceInset * 2) }
      const s10 = { x: sourceInset + u1 * (sourceSize - sourceInset * 2), y: sourceInset + v0 * (sourceSize - sourceInset * 2) }
      const s11 = { x: sourceInset + u1 * (sourceSize - sourceInset * 2), y: sourceInset + v1 * (sourceSize - sourceInset * 2) }
      const s01 = { x: sourceInset + u0 * (sourceSize - sourceInset * 2), y: sourceInset + v1 * (sourceSize - sourceInset * 2) }

      drawTriangle(s00, s10, s11, q00, q10, q11)
      drawTriangle(s00, s11, s01, q00, q11, q01)
    }
  }
  ctx.restore()
}

function strokeCell(
  ctx: CanvasRenderingContext2D,
  outline: ProjectedOutline,
): void {
  ctx.beginPath()
  traceCellPath(ctx, outline)
  ctx.stroke()
}

export function resizeCanvasToDisplaySize(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): { width: number; height: number } {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(rect.width * dpr))
  canvas.height = Math.max(1, Math.round(rect.height * dpr))
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  return {
    width: rect.width,
    height: rect.height,
  }
}

export function renderGrid45Scene(
  ctx: CanvasRenderingContext2D,
  state: GameState,
  width: number,
  height: number,
  tileset?: Grid45Tileset | null,
): void {
  const diskRadius = Math.max(1, Math.min(width, height) * 0.45)
  const centerX = width / 2
  const centerY = height / 2
  const playerCell = state.world.cells[state.playerCellId]
  const playerCenter = playerCell.center
  const cameraAngle = state.cameraAngle

  ctx.fillStyle = '#05080c'
  ctx.fillRect(0, 0, width, height)

  const backdrop = ctx.createRadialGradient(centerX, centerY * 0.9, diskRadius * 0.1, centerX, centerY, diskRadius * 1.3)
  backdrop.addColorStop(0, '#18212c')
  backdrop.addColorStop(1, '#05080c')
  ctx.fillStyle = backdrop
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.beginPath()
  ctx.arc(centerX, centerY, diskRadius, 0, 2 * Math.PI)
  ctx.clip()

  ctx.fillStyle = '#0d1319'
  ctx.fillRect(centerX - diskRadius, centerY - diskRadius, diskRadius * 2, diskRadius * 2)

  const projectedCells = state.world.cells.map((cell) => ({
    cell,
    shape: projectCellShape(cell, playerCenter, cameraAngle, centerX, centerY, diskRadius),
  }))

  for (const projected of projectedCells) {
    fillCell(ctx, projected.shape.outline, tileset ? baseFillForCell(projected.cell.kind) : projected.cell.kind === 'floor' ? '#d3d7de' : '#363d46')
    if (tileset) drawCellSprite(ctx, projected.shape, tileset.tiles[projected.cell.kind])
    const featureSprite = tileset ? featureSpriteForCell(projected.cell, state, tileset) : null
    if (featureSprite) drawCellSprite(ctx, projected.shape, featureSprite)
    if (!tileset) {
      const featureFill = featureFillForCell(projected.cell, state)
      if (featureFill) fillCell(ctx, projected.shape.outline, featureFill)
    }
  }

  const playerShape = projectedCells[playerCell.id].shape
  if (!tileset) fillCell(ctx, playerShape.outline, '#ffd166')

  ctx.strokeStyle = tileset ? 'rgba(36, 36, 36, 0.18)' : 'rgba(5, 8, 12, 0.28)'
  ctx.lineWidth = tileset ? 0.8 : 1
  for (const projected of projectedCells) {
    strokeCell(ctx, projected.shape.outline)
  }

  if (tileset) {
    const { minX, minY, maxX, maxY } = outlineBounds(playerShape.outline)
    const spriteSize = Math.max(36, Math.min(96, Math.min(maxX - minX, maxY - minY) * 0.42))
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(tileset.playerSprites[state.playerFacing], centerX - spriteSize / 2, centerY - spriteSize / 2, spriteSize, spriteSize)
  } else {
    ctx.fillStyle = '#2a1d00'
    ctx.beginPath()
    ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI)
    ctx.fill()
  }

  ctx.restore()

  ctx.strokeStyle = 'rgba(211, 215, 222, 0.38)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(centerX, centerY, diskRadius, 0, 2 * Math.PI)
  ctx.stroke()
}
