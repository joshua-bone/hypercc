import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { directions } from '../domain/directions'
import { currentCellKind } from '../domain/model'
import type { Grid45Tileset } from '../adapters/spriteAtlas'

let pickedCellId = 0
let boundingRectSpy: { mockRestore: () => void } | null = null

function createSprite(): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  return canvas
}

function createTileset(): Grid45Tileset {
  return {
    tileSize: 32,
    tiles: {
      floor: createSprite(),
      wall: createSprite(),
      'popup-wall': createSprite(),
      'toggle-floor': createSprite(),
      'toggle-wall': createSprite(),
      water: createSprite(),
      fire: createSprite(),
      dirt: createSprite(),
      gravel: createSprite(),
      void: createSprite(),
    },
    features: {
      bomb: createSprite(),
      chip: createSprite(),
      flippers: createSprite(),
      'fire-boots': createSprite(),
      'green-button': createSprite(),
      hint: createSprite(),
      socket: createSprite(),
      'tank-button': createSprite(),
      exit: createSprite(),
      'key-blue': createSprite(),
      'key-red': createSprite(),
      'key-green': createSprite(),
      'key-yellow': createSprite(),
      'door-blue': createSprite(),
      'door-red': createSprite(),
      'door-green': createSprite(),
      'door-yellow': createSprite(),
    },
    keys: {
      blue: createSprite(),
      red: createSprite(),
      green: createSprite(),
      yellow: createSprite(),
    },
    doors: {
      blue: createSprite(),
      red: createSprite(),
      green: createSprite(),
      yellow: createSprite(),
    },
    playerSprites: {
      north: createSprite(),
      east: createSprite(),
      south: createSprite(),
      west: createSprite(),
    },
    swimmingPlayerSprites: {
      north: createSprite(),
      east: createSprite(),
      south: createSprite(),
      west: createSprite(),
    },
    antSprites: {
      north: createSprite(),
      east: createSprite(),
      south: createSprite(),
      west: createSprite(),
    },
    gliderSprites: {
      north: createSprite(),
      east: createSprite(),
      south: createSprite(),
      west: createSprite(),
    },
    teethSprites: {
      north: createSprite(),
      east: createSprite(),
      south: createSprite(),
      west: createSprite(),
    },
    tankSprites: {
      north: createSprite(),
      east: createSprite(),
      south: createSprite(),
      west: createSprite(),
    },
    dirtBlockSprite: createSprite(),
    fireballSprite: createSprite(),
    pinkBallSprite: createSprite(),
  }
}

vi.mock('../adapters/spriteAtlas', () => ({
  loadGrid45Tileset: vi.fn().mockResolvedValue(createTileset()),
}))

vi.mock('../adapters/canvasRenderer', async () => {
  const actual = await vi.importActual<typeof import('../adapters/canvasRenderer')>('../adapters/canvasRenderer')
  return {
    ...actual,
    renderGrid45Scene: vi.fn(),
    resizeCanvasToDisplaySize: vi.fn(() => ({ width: 960, height: 640 })),
    pickGrid45CellAtPoint: vi.fn((_state, _width, _height, _x, _y, options) => (options?.includeBoundaryVoid ? null : pickedCellId)),
  }
})

import Grid45App from './Grid45App'
import { renderGrid45Scene } from '../adapters/canvasRenderer'

function createRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    width,
    height,
    top,
    right: left + width,
    bottom: top + height,
    left,
    toJSON: () => ({}),
  } as DOMRect
}

function editorStatValue(label: string): string {
  const statLabel = screen.getByText(label)
  const statItem = statLabel.closest('.grid45StatItem')
  const value = statItem?.querySelector('.grid45StatValue')
  if (!value?.textContent) throw new Error(`Missing stat value for ${label}.`)
  return value.textContent
}

function mapCellCount(value: string): number {
  const [count] = value.split('/')
  return Number.parseInt(count, 10)
}

describe('Grid45App editor', () => {
  beforeEach(() => {
    pickedCellId = 0
    vi.mocked(renderGrid45Scene).mockClear()
    boundingRectSpy?.mockRestore()
    boundingRectSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function mockRect(this: HTMLElement) {
      if (this instanceof HTMLCanvasElement || this.classList.contains('grid45App')) {
        return createRect(0, 0, 1200, 800)
      }
      if (this.classList.contains('grid45Nav')) {
        return createRect(16, 16, 1168, 56)
      }
      if (this.classList.contains('grid45Hud')) {
        return createRect(16, 92, 320, 280)
      }
      if (this.classList.contains('grid45EditorPanel')) {
        return createRect(16, 92, 412, 620)
      }
      return createRect(0, 0, 0, 0)
    })
  })

  afterEach(() => {
    boundingRectSpy?.mockRestore()
    boundingRectSpy = null
  })

  it('keeps typing directed into focused metadata fields', async () => {
    const user = userEvent.setup()
    render(<Grid45App />)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    await user.click(screen.getByRole('menuitem', { name: 'Level' }))
    await user.click(screen.getByRole('menuitem', { name: 'Level Settings...' }))

    const authorInput = screen.getByRole('textbox', { name: 'Author' })
    await user.type(authorInput, 'S')

    expect(authorInput).toHaveValue('S')
  })

  it('shows a delta badge when bucket fill previews a terrain region', async () => {
    render(<Grid45App />)

    fireEvent.click(screen.getByRole('button', { name: 'Editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Wall' }))
    fireEvent.click(screen.getByRole('button', { name: 'Bucket Fill' }))

    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected editor canvas to exist.')

    fireEvent.pointerMove(canvas, {
      buttons: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })

    await waitFor(() => {
      expect(screen.getByText((content) => content.includes('Δ'))).toBeInTheDocument()
    })
  })

  it('passes a render transition when gameplay advances by one move tick', async () => {
    render(<Grid45App />)

    const renderCalls = vi.mocked(renderGrid45Scene).mock.calls
    const initialCall = renderCalls[renderCalls.length - 1]
    if (!initialCall) throw new Error('Expected an initial scene render.')
    const initialState = initialCall[1]
    const moveKeyByDirection = {
      north: 'w',
      east: 'd',
      south: 's',
      west: 'a',
    } as const
    const moveDirection = directions.find((direction) => {
      const neighborId = initialState.world.cells[initialState.playerCellId].exits[direction]
      if (neighborId === null) return false
      const kind = currentCellKind(initialState.world.cells[neighborId].kind, initialState.togglePhase)
      return kind === 'floor' || kind === 'toggle-floor' || kind === 'popup-wall' || kind === 'dirt' || kind === 'gravel'
    })

    if (!moveDirection) throw new Error('Expected a passable neighboring cell from the start position.')

    fireEvent.keyDown(window, {
      key: moveKeyByDirection[moveDirection],
      bubbles: true,
      cancelable: true,
    })

    await waitFor(() => {
      expect(
        vi
          .mocked(renderGrid45Scene)
          .mock.calls.some((call) => call[5]?.transition?.progress === 1 / 4),
      ).toBe(true)
    })
  })

  it('rotates the mob brush facing with > without rotating a placed mob', async () => {
    const user = userEvent.setup()
    render(<Grid45App />)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    await user.click(screen.getByRole('button', { name: 'Glider' }))

    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected editor canvas to exist.')
    const initialMonsterCount = Number.parseInt(editorStatValue('Monsters'), 10)

    fireEvent.pointerDown(canvas, {
      button: 0,
      buttons: 1,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })
    fireEvent.pointerUp(canvas, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })

    await waitFor(() => {
      expect(Number.parseInt(editorStatValue('Monsters'), 10)).toBe(initialMonsterCount + 1)
    })

    const renderCallsBeforeRotate = vi.mocked(renderGrid45Scene).mock.calls
    const stateBeforeRotate = renderCallsBeforeRotate[renderCallsBeforeRotate.length - 1]?.[1]
    const placedMonsterBeforeRotate = stateBeforeRotate?.world.initialMonsters.find((monster) => monster.cellId === 0)
    const placedMonsterFacing = placedMonsterBeforeRotate?.facing
    expect(placedMonsterFacing).toBe('north')

    fireEvent.keyDown(window, {
      key: '>',
      code: 'Period',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    })

    const leftBrushStrip = screen.getByText('Left').closest('.grid45BrushStrip')
    const leftBrushFacing = leftBrushStrip?.querySelector('.grid45BrushFacing')
    await waitFor(() => {
      expect(leftBrushFacing).toHaveTextContent('east')
    })

    const renderCallsAfterRotate = vi.mocked(renderGrid45Scene).mock.calls
    const stateAfterRotate = renderCallsAfterRotate[renderCallsAfterRotate.length - 1]?.[1]
    const placedMonsterAfterRotate = stateAfterRotate?.world.initialMonsters.find((monster) => monster.cellId === 0)
    expect(placedMonsterAfterRotate?.facing).toBe(placedMonsterFacing)
  })

  it('realigns the inventory orbit after switching from editor back to home', async () => {
    const user = userEvent.setup()
    render(<Grid45App />)

    await waitFor(() => {
      expect(document.querySelector('.grid45OrbitSlot')).toBeTruthy()
    })

    const initialSlot = document.querySelector('.grid45OrbitSlot')
    if (!(initialSlot instanceof HTMLElement)) throw new Error('Expected an inventory orbit slot on the home tab.')
    const initialLeft = Number.parseFloat(initialSlot.style.left)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    await user.click(screen.getByRole('button', { name: 'Home' }))

    await waitFor(() => {
      const returnedSlot = document.querySelector('.grid45OrbitSlot')
      expect(returnedSlot).toBeInstanceOf(HTMLElement)
      expect(Number.parseFloat((returnedSlot as HTMLElement).style.left)).toBeCloseTo(initialLeft, 1)
    })
  })

  it('restores a normal paint change when undo is used', async () => {
    const user = userEvent.setup()
    render(<Grid45App />)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    await user.click(screen.getByRole('button', { name: 'Remove Cell' }))

    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected editor canvas to exist.')

    const initialCells = mapCellCount(editorStatValue('Cells'))

    fireEvent.pointerDown(canvas, {
      button: 0,
      buttons: 1,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })
    fireEvent.pointerUp(canvas, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })

    await waitFor(() => {
      expect(mapCellCount(editorStatValue('Cells'))).toBe(initialCells - 1)
    })

    await user.click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(mapCellCount(editorStatValue('Cells'))).toBe(initialCells)
    })
  })

  it('handles Cmd/Ctrl-Z undo even after an editor button keeps focus', async () => {
    const user = userEvent.setup()
    render(<Grid45App />)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    const removeCellButton = screen.getByRole('button', { name: 'Remove Cell' })
    await user.click(removeCellButton)

    const canvas = document.querySelector('canvas')
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected editor canvas to exist.')

    const initialCells = mapCellCount(editorStatValue('Cells'))

    fireEvent.pointerDown(canvas, {
      button: 0,
      buttons: 1,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })
    fireEvent.pointerUp(canvas, {
      button: 0,
      buttons: 0,
      clientX: 120,
      clientY: 120,
      pointerId: 1,
    })

    await waitFor(() => {
      expect(mapCellCount(editorStatValue('Cells'))).toBe(initialCells - 1)
    })

    fireEvent.keyDown(window, {
      key: 'z',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })

    await waitFor(() => {
      expect(mapCellCount(editorStatValue('Cells'))).toBe(initialCells)
    })
  })
})
