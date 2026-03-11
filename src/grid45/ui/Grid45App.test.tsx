import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Grid45Tileset } from '../adapters/spriteAtlas'

let pickedCellId = 0

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
    const user = userEvent.setup()
    render(<Grid45App />)

    await user.click(screen.getByRole('button', { name: 'Editor' }))
    await user.click(screen.getByRole('button', { name: 'Wall' }))
    await user.click(screen.getByRole('button', { name: 'Bucket Fill' }))

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
