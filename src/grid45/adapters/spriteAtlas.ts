import type { CellFeature, CellKind, Direction, KeyColor } from '../domain/model'

const TILE_SIZE = 32
const DEFAULT_TILESET_URL = `${import.meta.env.BASE_URL}artwork/tilesets/default.bmp`

type TileLocation = {
  col: number
  row: number
}

export type Grid45Tileset = {
  tileSize: number
  tiles: Record<CellKind, HTMLCanvasElement>
  features: Record<Exclude<CellFeature, 'none'>, HTMLCanvasElement>
  keys: Record<KeyColor, HTMLCanvasElement>
  doors: Record<KeyColor, HTMLCanvasElement>
  playerSprites: Record<Direction, HTMLCanvasElement>
  antSprites: Record<Direction, HTMLCanvasElement>
  teethSprites: Record<Direction, HTMLCanvasElement>
  tankSprites: Record<Direction, HTMLCanvasElement>
  pinkBallSprite: HTMLCanvasElement
}

const playerTileRows: Record<Direction, number> = {
  north: 13,
  west: 14,
  south: 15,
  east: 16,
}

const keyTileRows: Record<KeyColor, number> = {
  blue: 5,
  red: 6,
  green: 7,
  yellow: 8,
}

const doorTileRows: Record<KeyColor, number> = {
  blue: 7,
  red: 8,
  green: 9,
  yellow: 10,
}

const antTileRows: Record<Direction, number> = {
  north: 1,
  east: 2,
  south: 3,
  west: 4,
}

const teethTileRows: Record<Direction, number> = {
  north: 5,
  west: 6,
  south: 7,
  east: 8,
}

const tankTileRows: Record<Direction, number> = {
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
      'toggle-floor': drawTile(image, { col: 3, row: 7 }),
      'toggle-wall': drawTile(image, { col: 3, row: 6 }),
    },
    features: {
      chip: drawTile(image, { col: 1, row: 3 }),
      'green-button': drawTile(image, { col: 3, row: 4 }),
      socket: drawTile(image, { col: 3, row: 3 }),
      'tank-button': drawTile(image, { col: 3, row: 9 }),
      exit: drawTile(image, { col: 2, row: 6 }),
      'key-blue': drawTile(image, { col: 7, row: keyTileRows.blue }),
      'key-red': drawTile(image, { col: 7, row: keyTileRows.red }),
      'key-green': drawTile(image, { col: 7, row: keyTileRows.green }),
      'key-yellow': drawTile(image, { col: 7, row: keyTileRows.yellow }),
      'door-blue': drawTile(image, { col: 2, row: doorTileRows.blue }),
      'door-red': drawTile(image, { col: 2, row: doorTileRows.red }),
      'door-green': drawTile(image, { col: 2, row: doorTileRows.green }),
      'door-yellow': drawTile(image, { col: 2, row: doorTileRows.yellow }),
    },
    keys: {
      blue: drawTile(image, { col: 7, row: keyTileRows.blue }),
      red: drawTile(image, { col: 7, row: keyTileRows.red }),
      green: drawTile(image, { col: 7, row: keyTileRows.green }),
      yellow: drawTile(image, { col: 7, row: keyTileRows.yellow }),
    },
    doors: {
      blue: drawTile(image, { col: 2, row: doorTileRows.blue }),
      red: drawTile(image, { col: 2, row: doorTileRows.red }),
      green: drawTile(image, { col: 2, row: doorTileRows.green }),
      yellow: drawTile(image, { col: 2, row: doorTileRows.yellow }),
    },
    playerSprites: {
      north: applyMask(drawTile(image, { col: 10, row: playerTileRows.north }), drawTile(image, { col: 13, row: playerTileRows.north })),
      east: applyMask(drawTile(image, { col: 10, row: playerTileRows.east }), drawTile(image, { col: 13, row: playerTileRows.east })),
      south: applyMask(drawTile(image, { col: 10, row: playerTileRows.south }), drawTile(image, { col: 13, row: playerTileRows.south })),
      west: applyMask(drawTile(image, { col: 10, row: playerTileRows.west }), drawTile(image, { col: 13, row: playerTileRows.west })),
    },
    antSprites: {
      north: applyMask(drawTile(image, { col: 8, row: antTileRows.north }), drawTile(image, { col: 11, row: antTileRows.north })),
      east: applyMask(drawTile(image, { col: 8, row: antTileRows.west }), drawTile(image, { col: 11, row: antTileRows.west })),
      south: applyMask(drawTile(image, { col: 8, row: antTileRows.south }), drawTile(image, { col: 11, row: antTileRows.south })),
      west: applyMask(drawTile(image, { col: 8, row: antTileRows.east }), drawTile(image, { col: 11, row: antTileRows.east })),
    },
    teethSprites: {
      north: applyMask(drawTile(image, { col: 9, row: teethTileRows.north }), drawTile(image, { col: 12, row: teethTileRows.north })),
      east: applyMask(drawTile(image, { col: 9, row: teethTileRows.east }), drawTile(image, { col: 12, row: teethTileRows.east })),
      south: applyMask(drawTile(image, { col: 9, row: teethTileRows.south }), drawTile(image, { col: 12, row: teethTileRows.south })),
      west: applyMask(drawTile(image, { col: 9, row: teethTileRows.west }), drawTile(image, { col: 12, row: teethTileRows.west })),
    },
    tankSprites: {
      north: drawTile(image, { col: 5, row: tankTileRows.north }),
      east: drawTile(image, { col: 5, row: tankTileRows.east }),
      south: drawTile(image, { col: 5, row: tankTileRows.south }),
      west: drawTile(image, { col: 5, row: tankTileRows.west }),
    },
    pinkBallSprite: applyMask(drawTile(image, { col: 8, row: 9 }), drawTile(image, { col: 11, row: 9 })),
  }
}
