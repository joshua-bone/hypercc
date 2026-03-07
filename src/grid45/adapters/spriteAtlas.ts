import type { CellFeature, CellKind, Direction } from '../domain/model'

const TILE_SIZE = 32
const DEFAULT_TILESET_URL = '/artwork/tilesets/default.bmp'

type TileLocation = {
  col: number
  row: number
}

export type Grid45Tileset = {
  tileSize: number
  tiles: Record<CellKind, HTMLCanvasElement>
  features: Record<Exclude<CellFeature, 'none'>, HTMLCanvasElement>
  playerSprites: Record<Direction, HTMLCanvasElement>
}

const playerTileRows: Record<Direction, number> = {
  north: 13,
  west: 14,
  south: 15,
  east: 16,
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`))
    image.src = src
  })
}

function drawTile(image: CanvasImageSource, location: TileLocation): HTMLCanvasElement {
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const sx = (location.col - 1) * TILE_SIZE
  const sy = (location.row - 1) * TILE_SIZE
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(image, sx, sy, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE)
  return canvas
}

function applyMask(spriteTile: HTMLCanvasElement, maskTile: HTMLCanvasElement): HTMLCanvasElement {
  const canvas = createCanvas(TILE_SIZE, TILE_SIZE)
  const ctx = canvas.getContext('2d')
  if (!ctx) return canvas

  const spriteCtx = spriteTile.getContext('2d')
  const maskCtx = maskTile.getContext('2d')
  if (!spriteCtx || !maskCtx) return canvas

  const spriteData = spriteCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)
  const maskData = maskCtx.getImageData(0, 0, TILE_SIZE, TILE_SIZE)

  for (let i = 0; i < spriteData.data.length; i += 4) {
    const maskLuma = maskData.data[i] + maskData.data[i + 1] + maskData.data[i + 2]
    spriteData.data[i + 3] = maskLuma === 0 ? 0 : 255
  }

  ctx.putImageData(spriteData, 0, 0)
  return canvas
}

export async function loadGrid45Tileset(src = DEFAULT_TILESET_URL): Promise<Grid45Tileset> {
  const image = await loadImage(src)

  return {
    tileSize: TILE_SIZE,
    tiles: {
      floor: drawTile(image, { col: 1, row: 1 }),
      wall: drawTile(image, { col: 1, row: 2 }),
    },
    features: {
      chip: drawTile(image, { col: 1, row: 3 }),
      socket: drawTile(image, { col: 3, row: 3 }),
      exit: drawTile(image, { col: 2, row: 6 }),
    },
    playerSprites: {
      north: applyMask(drawTile(image, { col: 10, row: playerTileRows.north }), drawTile(image, { col: 13, row: playerTileRows.north })),
      east: applyMask(drawTile(image, { col: 10, row: playerTileRows.east }), drawTile(image, { col: 13, row: playerTileRows.east })),
      south: applyMask(drawTile(image, { col: 10, row: playerTileRows.south }), drawTile(image, { col: 13, row: playerTileRows.south })),
      west: applyMask(drawTile(image, { col: 10, row: playerTileRows.west }), drawTile(image, { col: 13, row: playerTileRows.west })),
    },
  }
}
