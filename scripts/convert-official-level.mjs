import fs from 'node:fs/promises'
import path from 'node:path'

const directions = ['north', 'east', 'south', 'west']

function toTitleCase(value) {
  return value
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(' ')
}

function deriveTitle(filePath) {
  return toTitleCase(path.basename(filePath, path.extname(filePath))) || 'Untitled Level'
}

function stringifyOfficialLevel(level) {
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

function convertLegacyWorldToOfficialLevel(world, filePath) {
  const authoredCells = world.cells.filter((cell) => cell.kind !== 'void')
  if (authoredCells.length === 0) {
    throw new Error('Cannot convert an empty world.')
  }

  const authoredIdByCellId = new Map(authoredCells.map((cell, index) => [cell.id, index]))
  const monsterByCellId = new Map((world.initialMonsters ?? []).map((monster) => [monster.cellId, monster]))
  const startCellId = authoredIdByCellId.get(world.startCellId) ?? 0

  const cells = authoredCells.map((cell) => {
    const overlay = {}
    if (cell.kind !== 'floor') overlay.terrain = cell.kind
    if (cell.feature !== 'none') overlay.feature = cell.feature

    const monster = monsterByCellId.get(cell.id)
    if (monster) overlay.mob = [monster.kind, monster.facing]

    const cellData = directions.map((direction) => {
      const neighborId = cell.exits[direction]
      return neighborId !== null && authoredIdByCellId.has(neighborId) ? authoredIdByCellId.get(neighborId) : null
    })

    if (Object.keys(overlay).length > 0) cellData.push(overlay)
    return cellData
  })

  return {
    format: 'hypercc-level',
    formatVersion: 2,
    title: typeof world.title === 'string' && world.title.trim().length > 0 ? world.title : deriveTitle(filePath),
    author: typeof world.author === 'string' ? world.author : '',
    hint: typeof world.hint === 'string' && world.hint.length > 0 ? world.hint : undefined,
    seed: typeof world.seed === 'number' ? world.seed >>> 0 : undefined,
    startCellId,
    cells,
  }
}

async function main() {
  const inputPath = process.argv[2]
  const outputPath = process.argv[3] ?? inputPath

  if (!inputPath) {
    throw new Error('Usage: node scripts/convert-official-level.mjs <input.json> [output.json]')
  }

  const raw = await fs.readFile(inputPath, 'utf8')
  const parsed = JSON.parse(raw)

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
    throw new Error('Input does not look like a level JSON file.')
  }

  const officialLevel =
    parsed.format === 'hypercc-level' && parsed.formatVersion === 2
      ? parsed
      : convertLegacyWorldToOfficialLevel(parsed, inputPath)

  await fs.writeFile(outputPath, stringifyOfficialLevel(officialLevel))
  console.log(`Wrote ${outputPath}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
