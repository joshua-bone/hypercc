import { approxEq } from '../../hyper/vec2'
import { createGrid45RootGeometry, directionTowardNeighbor, reflectGrid45CellGeometry } from './cellGeometry'
import { directions } from './directions'
import type { AreaDag, CellFeature, CellKind, Direction, MazeCell, MazeWorld, MonsterKind, MonsterState } from './model'

type OfficialLevelTerrain = Exclude<CellKind, 'void'>
type OfficialLevelFeature = Exclude<CellFeature, 'none'>
type OfficialLevelMob = [kind: MonsterKind, facing: Direction]

type OfficialLevelCellOverlay = {
  terrain?: OfficialLevelTerrain
  feature?: OfficialLevelFeature
  mob?: OfficialLevelMob
}

export type OfficialLevelCellData = [
  north: number | null,
  east: number | null,
  south: number | null,
  west: number | null,
  overlay?: OfficialLevelCellOverlay,
]

export type OfficialLevelFile = {
  format: 'hypercc-level'
  formatVersion: 2
  title: string
  author: string
  hint?: string
  seed?: number
  startCellId: number
  cells: OfficialLevelCellData[]
}

type LegacyMazeWorldData = MazeWorld & {
  title?: string
  author?: string
}

type ParsedOfficialCell = {
  terrain: OfficialLevelTerrain
  feature: CellFeature
  mob: OfficialLevelMob | null
  exits: Record<Direction, number | null>
}

type LoadLevelOptions = {
  fallbackSeed?: number
  fileName?: string
}

const OFFICIAL_LEVEL_FORMAT = 'hypercc-level'
const OFFICIAL_LEVEL_VERSION = 2

function createCustomAreaDag(summary: string): AreaDag {
  return {
    nodes: [],
    edges: [],
    validation: {
      passed: true,
      summary,
      steps: ['This level was loaded from authored JSON.'],
    },
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toOptionalUint32(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback >>> 0
  return (Math.floor(value) >>> 0)
}

function toTitleCase(value: string): string {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

function deriveLevelTitle(fileName?: string): string {
  if (!fileName) return 'Untitled Level'
  const baseName = fileName.replace(/\.[^.]+$/, '')
  const title = toTitleCase(baseName)
  return title.length > 0 ? title : 'Untitled Level'
}

function parseExitCellId(value: unknown, cellCount: number, messagePrefix: string): number | null {
  if (value === null) return null
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${messagePrefix} must be an integer cell id or null.`)
  }
  if (value < 0 || value >= cellCount) {
    throw new Error(`${messagePrefix} references missing cell ${value}.`)
  }
  return value
}

function parseOfficialCellData(value: unknown, cellCount: number, cellId: number): ParsedOfficialCell {
  if (!Array.isArray(value) || value.length < 4 || value.length > 5) {
    throw new Error(`Cell ${cellId} must be a 4-tuple of exits with an optional overlay object.`)
  }

  const overlay = value[4]
  if (overlay !== undefined && !isRecord(overlay)) {
    throw new Error(`Cell ${cellId} overlay must be an object when present.`)
  }

  let terrain: OfficialLevelTerrain = 'floor'
  const terrainValue = overlay?.terrain
  if (terrainValue !== undefined) {
    if (
      terrainValue !== 'floor' &&
      terrainValue !== 'wall' &&
      terrainValue !== 'toggle-floor' &&
      terrainValue !== 'toggle-wall' &&
      terrainValue !== 'water' &&
      terrainValue !== 'fire' &&
      terrainValue !== 'dirt' &&
      terrainValue !== 'gravel'
    ) {
      throw new Error(`Cell ${cellId} has an invalid terrain value.`)
    }
    terrain = terrainValue
  }

  let feature: CellFeature = 'none'
  const featureValue = overlay?.feature
  if (featureValue !== undefined) {
    if (
      featureValue !== 'bomb' &&
      featureValue !== 'chip' &&
      featureValue !== 'flippers' &&
      featureValue !== 'fire-boots' &&
      featureValue !== 'green-button' &&
      featureValue !== 'hint' &&
      featureValue !== 'socket' &&
      featureValue !== 'tank-button' &&
      featureValue !== 'exit' &&
      featureValue !== 'key-blue' &&
      featureValue !== 'key-red' &&
      featureValue !== 'key-green' &&
      featureValue !== 'key-yellow' &&
      featureValue !== 'door-blue' &&
      featureValue !== 'door-red' &&
      featureValue !== 'door-green' &&
      featureValue !== 'door-yellow'
    ) {
      throw new Error(`Cell ${cellId} has an invalid feature value.`)
    }
    feature = featureValue
  }

  let mob: OfficialLevelMob | null = null
  const mobValue = overlay?.mob
  if (mobValue !== undefined) {
    if (!Array.isArray(mobValue) || mobValue.length !== 2) {
      throw new Error(`Cell ${cellId} mob must be a [kind, facing] tuple.`)
    }
    if (
      mobValue[0] !== 'ant' &&
      mobValue[0] !== 'pink-ball' &&
      mobValue[0] !== 'teeth' &&
      mobValue[0] !== 'tank' &&
      mobValue[0] !== 'dirt-block' &&
      mobValue[0] !== 'glider' &&
      mobValue[0] !== 'fireball'
    ) {
      throw new Error(`Cell ${cellId} has an invalid mob kind.`)
    }
    if (mobValue[1] !== 'north' && mobValue[1] !== 'east' && mobValue[1] !== 'south' && mobValue[1] !== 'west') {
      throw new Error(`Cell ${cellId} has an invalid mob facing.`)
    }
    mob = [mobValue[0], mobValue[1]]
  }

  if (feature !== 'none' && mob !== null) {
    throw new Error(`Cell ${cellId} cannot contain both a feature and a mob.`)
  }

  return {
    terrain,
    feature,
    mob,
    exits: {
      north: parseExitCellId(value[0], cellCount, `Cell ${cellId} north exit`),
      east: parseExitCellId(value[1], cellCount, `Cell ${cellId} east exit`),
      south: parseExitCellId(value[2], cellCount, `Cell ${cellId} south exit`),
      west: parseExitCellId(value[3], cellCount, `Cell ${cellId} west exit`),
    },
  }
}

function buildWorldFromOfficialLevel(level: OfficialLevelFile, options?: LoadLevelOptions): MazeWorld {
  if (!Array.isArray(level.cells) || level.cells.length === 0) {
    throw new Error('Official level must contain at least one cell.')
  }
  if (!Number.isInteger(level.startCellId) || level.startCellId < 0 || level.startCellId >= level.cells.length) {
    throw new Error('Official level startCellId must reference an existing cell.')
  }

  const parsedCells = level.cells.map((cell, cellId) => parseOfficialCellData(cell, level.cells.length, cellId))
  const cells: MazeCell[] = parsedCells.map((cell, cellId) => ({
    id: cellId,
    kind: cell.terrain,
    feature: cell.feature,
    center: { x: 0, y: 0 },
    vertices: [],
    exits: { ...cell.exits },
  }))

  let nextMonsterId = 0
  const monsters: MonsterState[] = parsedCells.flatMap((cell, cellId) => {
    if (cell.mob === null) return []
    return [{
      id: nextMonsterId++,
      kind: cell.mob[0],
      cellId,
      facing: cell.mob[1],
      recoveryTicks: 0,
    }]
  })

  const embeddedCellIds = new Set<number>([level.startCellId])
  const queue = [level.startCellId]
  const rootGeometry = createGrid45RootGeometry()
  cells[level.startCellId].center = rootGeometry.center
  cells[level.startCellId].vertices = rootGeometry.vertices

  while (queue.length > 0) {
    const cellId = queue.shift()
    if (cellId === undefined) break

    const cell = cells[cellId]
    for (const direction of directions) {
      const neighborId = cell.exits[direction]
      if (neighborId === null) continue

      const geometry = reflectGrid45CellGeometry(cell, direction)
      const neighbor = cells[neighborId]
      if (embeddedCellIds.has(neighborId)) {
        if (!approxEq(neighbor.center, geometry.center, 1e-5)) {
          throw new Error(`Official level geometry is inconsistent around cells ${cellId} and ${neighborId}.`)
        }
        continue
      }

      neighbor.center = geometry.center
      neighbor.vertices = geometry.vertices
      embeddedCellIds.add(neighborId)
      queue.push(neighborId)
    }
  }

  if (embeddedCellIds.size !== cells.length) {
    const disconnectedCellIds = cells.filter((cell) => !embeddedCellIds.has(cell.id)).map((cell) => cell.id)
    throw new Error(`Official level contains disconnected cells: ${disconnectedCellIds.join(', ')}`)
  }

  for (const cell of cells) {
    for (const direction of directions) {
      const neighborId = cell.exits[direction]
      if (neighborId === null) continue

      const neighbor = cells[neighborId]
      const backDirection = directionTowardNeighbor(neighbor, cell)
      if (backDirection === null) {
        throw new Error(`Cells ${cell.id} and ${neighborId} do not share a valid edge.`)
      }
      if (neighbor.exits[backDirection] === null) {
        neighbor.exits[backDirection] = cell.id
      } else if (neighbor.exits[backDirection] !== cell.id) {
        throw new Error(`Cells ${cell.id} and ${neighborId} disagree on their shared edge.`)
      }
    }
  }

  const chipCellIds = cells.filter((cell) => cell.feature === 'chip').map((cell) => cell.id)
  const startCellId = level.startCellId

  return {
    seed: toOptionalUint32(level.seed, Date.now()),
    title: level.title.trim().length > 0 ? level.title : deriveLevelTitle(options?.fileName),
    author: level.author,
    hint: typeof level.hint === 'string' ? level.hint : '',
    cells,
    startCellId,
    chipCellIds,
    socketCellId: cells.find((cell) => cell.feature === 'socket')?.id ?? -1,
    exitCellId: cells.find((cell) => cell.feature === 'exit')?.id ?? -1,
    areaDag: createCustomAreaDag('Loaded authored level; DAG validation unavailable.'),
    initialMonsters: monsters,
  }
}

function looksLikeOfficialLevelFile(value: unknown): value is OfficialLevelFile {
  return (
    isRecord(value) &&
    value.format === OFFICIAL_LEVEL_FORMAT &&
    value.formatVersion === OFFICIAL_LEVEL_VERSION &&
    typeof value.title === 'string' &&
    typeof value.author === 'string' &&
    (value.hint === undefined || typeof value.hint === 'string') &&
    typeof value.startCellId === 'number' &&
    Array.isArray(value.cells)
  )
}

function looksLikeLegacyMazeWorld(value: unknown): value is LegacyMazeWorldData {
  return (
    isRecord(value) &&
    Array.isArray(value.cells) &&
    typeof value.startCellId === 'number' &&
    typeof value.seed === 'number'
  )
}

function loadLegacyMazeWorld(value: LegacyMazeWorldData, options?: LoadLevelOptions): MazeWorld {
  const title = typeof value.title === 'string' && value.title.trim().length > 0 ? value.title : deriveLevelTitle(options?.fileName)
  const author = typeof value.author === 'string' ? value.author : ''
  return {
    ...structuredClone(value),
    seed: toOptionalUint32(value.seed, options?.fallbackSeed ?? Date.now()),
    title,
    author,
    hint: typeof value.hint === 'string' ? value.hint : '',
  }
}

export function loadMazeWorldFromJson(text: string, options?: LoadLevelOptions): MazeWorld {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Level file is not valid JSON.')
  }

  if (looksLikeOfficialLevelFile(parsed)) return buildWorldFromOfficialLevel(parsed, options)
  if (looksLikeLegacyMazeWorld(parsed)) return loadLegacyMazeWorld(parsed, options)

  throw new Error('Unsupported level format.')
}

export function mazeWorldToOfficialLevel(world: MazeWorld): OfficialLevelFile {
  const authoredCells = world.cells.filter((cell) => cell.kind !== 'void')
  if (authoredCells.length === 0) {
    throw new Error('Cannot export an empty level.')
  }

  const authoredIdByCellId = new Map<number, number>(authoredCells.map((cell, index) => [cell.id, index]))
  const monsterByCellId = new Map(world.initialMonsters.map((monster) => [monster.cellId, monster]))
  const startCellId = authoredIdByCellId.get(world.startCellId) ?? 0

  const cells: OfficialLevelCellData[] = authoredCells.map((cell) => {
    const overlay: OfficialLevelCellOverlay = {}
    if (cell.kind !== 'floor') overlay.terrain = cell.kind as OfficialLevelTerrain
    if (cell.feature !== 'none') overlay.feature = cell.feature as OfficialLevelFeature

    const monster = monsterByCellId.get(cell.id)
    if (monster) overlay.mob = [monster.kind, monster.facing]

    const cellData: OfficialLevelCellData = [
      cell.exits.north !== null && authoredIdByCellId.has(cell.exits.north) ? authoredIdByCellId.get(cell.exits.north) ?? null : null,
      cell.exits.east !== null && authoredIdByCellId.has(cell.exits.east) ? authoredIdByCellId.get(cell.exits.east) ?? null : null,
      cell.exits.south !== null && authoredIdByCellId.has(cell.exits.south) ? authoredIdByCellId.get(cell.exits.south) ?? null : null,
      cell.exits.west !== null && authoredIdByCellId.has(cell.exits.west) ? authoredIdByCellId.get(cell.exits.west) ?? null : null,
    ]

    if (Object.keys(overlay).length > 0) cellData.push(overlay)
    return cellData
  })

  return {
    format: OFFICIAL_LEVEL_FORMAT,
    formatVersion: OFFICIAL_LEVEL_VERSION,
    title: world.title?.trim().length ? world.title : 'Untitled Level',
    author: world.author ?? '',
    hint: world.hint?.length ? world.hint : undefined,
    seed: world.seed,
    startCellId,
    cells,
  }
}

export function stringifyOfficialLevel(level: OfficialLevelFile): string {
  const lines = [
    '{',
    `  "format": ${JSON.stringify(level.format)},`,
    `  "formatVersion": ${level.formatVersion},`,
    `  "title": ${JSON.stringify(level.title)},`,
    `  "author": ${JSON.stringify(level.author)},`,
  ]

  if (level.hint !== undefined && level.hint.length > 0) {
    lines.push(`  "hint": ${JSON.stringify(level.hint)},`)
  }

  if (level.seed !== undefined) {
    lines.push(`  "seed": ${level.seed >>> 0},`)
  }

  lines.push(`  "startCellId": ${level.startCellId},`)
  lines.push('  "cells": [')
  for (let index = 0; index < level.cells.length; index += 1) {
    const suffix = index === level.cells.length - 1 ? '' : ','
    lines.push(`    ${JSON.stringify(level.cells[index])}${suffix}`)
  }
  lines.push('  ]')
  lines.push('}')
  return lines.join('\n')
}
