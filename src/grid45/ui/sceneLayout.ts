import { computeGrid45DiskFrame, type Grid45DiskFrame, type Grid45RenderOptions } from '../adapters/canvasRenderer'

export type Grid45ViewportInset = NonNullable<Grid45RenderOptions['viewportInset']>

export type Grid45MeasuredRect = {
  top: number
  right: number
  bottom: number
  left: number
  width: number
  height: number
}

export type Grid45SceneLayout = {
  canvasRect: Grid45MeasuredRect | null
  viewportInset: Grid45ViewportInset
  frame: Grid45DiskFrame | null
}

type SceneRectSet = {
  appRect: Grid45MeasuredRect | null
  canvasRect: Grid45MeasuredRect | null
  navRect: Grid45MeasuredRect | null
  sideRect: Grid45MeasuredRect | null
  dagRect: Grid45MeasuredRect | null
}

type SceneLayoutOptions = {
  hintText: string
  safeMargin: number
}

type CircularHintLayout = {
  fontSize: number
  lineGap: number
  lines: string[]
  outerRadius: number
}

const EMPTY_VIEWPORT_INSET: Grid45ViewportInset = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
}

export const EMPTY_SCENE_LAYOUT: Grid45SceneLayout = {
  canvasRect: null,
  viewportInset: EMPTY_VIEWPORT_INSET,
  frame: null,
}

export function snapshotRect(rect: Pick<DOMRectReadOnly, 'top' | 'right' | 'bottom' | 'left' | 'width' | 'height'> | null): Grid45MeasuredRect | null {
  if (!rect) return null
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: rect.width,
    height: rect.height,
  }
}

export function measureElementRect(element: Element | null): Grid45MeasuredRect | null {
  return snapshotRect(element?.getBoundingClientRect() ?? null)
}

function cloneInset(inset: Grid45ViewportInset): Grid45ViewportInset {
  return {
    top: inset.top,
    right: inset.right,
    bottom: inset.bottom,
    left: inset.left,
  }
}

function wrapHintArcLines(text: string, maxCharsPerLine: number, maxLines: number): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) return []

  const words = normalized.split(' ')
  const lines: string[] = []
  let currentLine = ''

  const truncateLine = (line: string): string => {
    if (line.length <= maxCharsPerLine) return line
    return `${line.slice(0, Math.max(1, maxCharsPerLine - 1)).trimEnd()}...`
  }

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    const candidate = currentLine.length === 0 ? word : `${currentLine} ${word}`
    if (candidate.length <= maxCharsPerLine || currentLine.length === 0) {
      currentLine = candidate
      continue
    }

    lines.push(currentLine.trim())
    if (lines.length === maxLines - 1) {
      currentLine = [word, ...words.slice(index + 1)].join(' ')
      break
    }
    currentLine = word
  }

  if (currentLine.trim().length > 0) {
    lines.push(truncateLine(currentLine.trim()))
  }

  return lines.slice(0, maxLines)
}

function maxHintArcChars(frame: Grid45DiskFrame, fontSize: number): number {
  return Math.max(14, Math.floor((frame.diskRadius * 2.45) / (fontSize * 0.56)))
}

export function measureCircularHintLayout(frame: Grid45DiskFrame, text: string): CircularHintLayout | null {
  const fontSize = Math.max(13, Math.min(22, frame.diskRadius * 0.048))
  const lineGap = fontSize * 1.18
  const lines = wrapHintArcLines(text, maxHintArcChars(frame, fontSize), 4)
  if (lines.length === 0) return null

  return {
    fontSize,
    lineGap,
    lines,
    outerRadius: frame.diskRadius + fontSize * 1.65,
  }
}

function computeViewportInsetFromRects(rects: Pick<SceneRectSet, 'appRect' | 'navRect' | 'sideRect' | 'dagRect'>, safeMargin: number): Grid45ViewportInset {
  const { appRect, navRect, sideRect, dagRect } = rects
  if (!appRect) return cloneInset(EMPTY_VIEWPORT_INSET)

  const inset = cloneInset(EMPTY_VIEWPORT_INSET)

  const applyTop = (rect: Grid45MeasuredRect) => {
    inset.top = Math.max(inset.top, rect.bottom - appRect.top + safeMargin)
  }
  const applyLeft = (rect: Grid45MeasuredRect) => {
    inset.left = Math.max(inset.left, rect.right - appRect.left + safeMargin)
  }
  const applyRight = (rect: Grid45MeasuredRect) => {
    inset.right = Math.max(inset.right, appRect.right - rect.left + safeMargin)
  }
  const applyBottom = (rect: Grid45MeasuredRect) => {
    inset.bottom = Math.max(inset.bottom, appRect.bottom - rect.top + safeMargin)
  }

  if (navRect) applyTop(navRect)

  if (sideRect) {
    if (sideRect.width >= appRect.width * 0.45) {
      applyTop(sideRect)
    } else {
      applyLeft(sideRect)
    }
  }

  if (dagRect) {
    if (dagRect.width >= appRect.width * 0.55) {
      applyBottom(dagRect)
    } else {
      applyRight(dagRect)
    }
  }

  return inset
}

function addHintViewportInset(
  canvasRect: Grid45MeasuredRect | null,
  viewportInset: Grid45ViewportInset,
  hintText: string,
  safeMargin: number,
): Grid45ViewportInset {
  if (!canvasRect || hintText.trim().length === 0) return viewportInset
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return viewportInset

  const safeBottom = canvasRect.height - Math.max(8, safeMargin * 0.4)
  let adjustedInset = cloneInset(viewportInset)

  for (let iteration = 0; iteration < 24; iteration += 1) {
    const frame = computeGrid45DiskFrame(canvasRect.width, canvasRect.height, adjustedInset)
    const layout = measureCircularHintLayout(frame, hintText)
    if (!layout) break

    const lastLineRadius = layout.outerRadius + (layout.lines.length - 1) * layout.lineGap
    const textBottom = frame.centerY + lastLineRadius + layout.fontSize * 0.95
    const overflow = textBottom - safeBottom
    if (overflow <= 0.5) break

    adjustedInset = {
      ...adjustedInset,
      bottom: adjustedInset.bottom + Math.ceil(overflow),
    }
  }

  return adjustedInset
}

function rectEquals(a: Grid45MeasuredRect | null, b: Grid45MeasuredRect | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left && a.width === b.width && a.height === b.height
}

function insetEquals(a: Grid45ViewportInset, b: Grid45ViewportInset): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left
}

function frameEquals(a: Grid45DiskFrame | null, b: Grid45DiskFrame | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  return a.centerX === b.centerX && a.centerY === b.centerY && a.diskRadius === b.diskRadius
}

export function sceneLayoutEquals(a: Grid45SceneLayout, b: Grid45SceneLayout): boolean {
  return rectEquals(a.canvasRect, b.canvasRect) && insetEquals(a.viewportInset, b.viewportInset) && frameEquals(a.frame, b.frame)
}

export function createGrid45SceneLayout(rects: SceneRectSet, options: SceneLayoutOptions): Grid45SceneLayout {
  const canvasRect = rects.canvasRect?.width && rects.canvasRect.height ? rects.canvasRect : null
  const chromeInset = computeViewportInsetFromRects(rects, options.safeMargin)
  const viewportInset = addHintViewportInset(canvasRect, chromeInset, options.hintText, options.safeMargin)

  return {
    canvasRect,
    viewportInset,
    frame: canvasRect ? computeGrid45DiskFrame(canvasRect.width, canvasRect.height, viewportInset) : null,
  }
}
