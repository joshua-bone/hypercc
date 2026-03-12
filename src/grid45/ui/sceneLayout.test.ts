import { describe, expect, it } from 'vitest'

import { createGrid45SceneLayout, measureCircularHintLayout, sceneLayoutEquals, snapshotRect } from './sceneLayout'

function createRect(left: number, top: number, width: number, height: number) {
  return snapshotRect({
    top,
    right: left + width,
    bottom: top + height,
    left,
    width,
    height,
  })
}

describe('sceneLayout', () => {
  it('computes a shared disk frame from the current chrome rects', () => {
    const layout = createGrid45SceneLayout(
      {
        appRect: createRect(0, 0, 1200, 800),
        canvasRect: createRect(0, 0, 1200, 800),
        navRect: createRect(16, 16, 1168, 56),
        sideRect: createRect(16, 92, 320, 280),
        dagRect: null,
      },
      {
        hintText: '',
        safeMargin: 20,
      },
    )

    expect(layout.viewportInset).toEqual({
      top: 92,
      right: 0,
      bottom: 0,
      left: 356,
    })
    expect(layout.frame?.centerX).toBeCloseTo(778, 5)
    expect(layout.frame?.centerY).toBeCloseTo(446, 5)
    expect(layout.frame?.diskRadius).toBeCloseTo(331.84, 5)
  })

  it('expands the bottom inset until the radial hint fits inside the viewport', () => {
    const hintText = 'Collect chips to open the socket, then use the right key on the right door and head for the exit.'
    const layout = createGrid45SceneLayout(
      {
        appRect: createRect(0, 0, 1200, 800),
        canvasRect: createRect(0, 0, 1200, 800),
        navRect: createRect(16, 16, 1168, 56),
        sideRect: createRect(16, 92, 320, 280),
        dagRect: null,
      },
      {
        hintText,
        safeMargin: 20,
      },
    )

    expect(layout.frame).not.toBeNull()
    expect(layout.viewportInset.bottom).toBeGreaterThan(0)

    const hintLayout = measureCircularHintLayout(layout.frame!, hintText)
    expect(hintLayout).not.toBeNull()

    const safeBottom = 800 - 8
    const lastLineRadius = hintLayout!.outerRadius + (hintLayout!.lines.length - 1) * hintLayout!.lineGap
    const textBottom = layout.frame!.centerY + lastLineRadius + hintLayout!.fontSize * 0.95
    expect(textBottom).toBeLessThanOrEqual(safeBottom + 0.5)
  })

  it('treats identical measured layouts as equal', () => {
    const layoutA = createGrid45SceneLayout(
      {
        appRect: createRect(0, 0, 1200, 800),
        canvasRect: createRect(0, 0, 1200, 800),
        navRect: createRect(16, 16, 1168, 56),
        sideRect: createRect(16, 92, 320, 280),
        dagRect: null,
      },
      {
        hintText: '',
        safeMargin: 20,
      },
    )
    const layoutB = createGrid45SceneLayout(
      {
        appRect: createRect(0, 0, 1200, 800),
        canvasRect: createRect(0, 0, 1200, 800),
        navRect: createRect(16, 16, 1168, 56),
        sideRect: createRect(16, 92, 320, 280),
        dagRect: null,
      },
      {
        hintText: '',
        safeMargin: 20,
      },
    )
    const layoutC = createGrid45SceneLayout(
      {
        appRect: createRect(0, 0, 1200, 800),
        canvasRect: createRect(0, 0, 1200, 800),
        navRect: createRect(16, 16, 1168, 56),
        sideRect: createRect(16, 92, 412, 620),
        dagRect: null,
      },
      {
        hintText: '',
        safeMargin: 20,
      },
    )

    expect(sceneLayoutEquals(layoutA, layoutB)).toBe(true)
    expect(sceneLayoutEquals(layoutA, layoutC)).toBe(false)
  })
})
