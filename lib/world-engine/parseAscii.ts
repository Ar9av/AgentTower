import type { ParsedTemplate, SceneSlot } from './types'

/**
 * Parse a multiline ASCII template into a tile grid.
 *
 *   parseAscii(template, charMap, slotMap?, options?)
 *
 * - template: backtick-string where each char represents one tile cell
 * - charMap: { ' ': -1, '|': T.WALL, ... }  — char → tile index
 * - slotMap: optional map of slot characters → slot group name. Slot chars
 *   are NOT placed as tiles (they yield -1 in the tile grid) but produce
 *   a SceneSlot record at that (x, y) position with auto-numbered ids.
 *
 * Each line is one row. Leading/trailing empty lines are trimmed.
 * Lines shorter than the width are padded with empty.
 *
 * Y offset is applied so multiple templates can be stacked into a larger scene.
 */
export function parseAscii(
  template: string,
  charMap: Record<string, number>,
  slotMap: Record<string, string> = {},
  options: { yOffset?: number; xOffset?: number; width?: number } = {}
): ParsedTemplate {
  const yOffset = options.yOffset ?? 0
  const xOffset = options.xOffset ?? 0

  // Strip blank leading/trailing lines (preserve interior)
  const lines = template.split('\n')
  while (lines.length && lines[0].trim() === '') lines.shift()
  while (lines.length && lines[lines.length - 1].trim() === '') lines.pop()

  const width = options.width ?? Math.max(...lines.map(l => l.length))
  const tiles: number[][] = []
  const slots: SceneSlot[] = []
  const slotCounters: Record<string, number> = {}

  for (let y = 0; y < lines.length; y++) {
    const row: number[] = new Array(width).fill(-1)
    const line = lines[y]
    for (let x = 0; x < width; x++) {
      const ch = x < line.length ? line[x] : ' '
      if (ch in slotMap) {
        const group = slotMap[ch]
        const i = slotCounters[group] = (slotCounters[group] ?? 0) + 1
        slots.push({
          id: `${group}.${i - 1}`,
          group,
          x: xOffset + x + 0.5,    // center of cell horizontally
          y: yOffset + y + 1,      // bottom of cell (feet-on-floor)
        })
        // slot chars don't paint a tile
      } else if (ch in charMap) {
        const idx = charMap[ch]
        if (idx >= 0) row[x] = idx
      }
      // unknown chars leave -1 (transparent)
    }
    tiles.push(row)
  }

  return { tiles, slots }
}

/**
 * Stack multiple parsed templates into a single (rows × cols) grid plus a flat
 * slot list. Each template's tiles are pasted at its own y-offset.
 */
export function stackTemplates(
  parts: Array<{ tiles: number[][]; slots: SceneSlot[] }>,
  width: number
): ParsedTemplate {
  const tiles: number[][] = []
  const slots: SceneSlot[] = []
  for (const part of parts) {
    for (const row of part.tiles) {
      const padded = [...row]
      while (padded.length < width) padded.push(-1)
      tiles.push(padded)
    }
    slots.push(...part.slots)
  }
  return { tiles, slots }
}

/** Helper: create an N×M grid filled with -1 (empty). */
export function emptyGrid(width: number, height: number): number[][] {
  const grid: number[][] = []
  for (let y = 0; y < height; y++) {
    grid.push(new Array(width).fill(-1))
  }
  return grid
}

/** Helper: paste tile data from src into dst at (offsetX, offsetY), in-place. */
export function pasteGrid(
  dst: number[][], src: number[][],
  offsetX: number, offsetY: number
): void {
  for (let y = 0; y < src.length; y++) {
    for (let x = 0; x < src[y].length; x++) {
      const v = src[y][x]
      if (v >= 0) {
        const dy = offsetY + y, dx = offsetX + x
        if (dy >= 0 && dy < dst.length && dx >= 0 && dx < dst[dy].length) {
          dst[dy][dx] = v
        }
      }
    }
  }
}
