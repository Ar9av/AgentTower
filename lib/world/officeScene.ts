/**
 * Office tower scene definition — 18 wide × 30 tall, 5 floors × 6 rows each.
 *
 * Each floor is laid out as ASCII; characters map to tile indices via TILE_CHARS,
 * and slot characters (@!#$*) mark agent positions in tile coords. We stack the
 * floors top-down using stackTemplates and produce the full scene.
 *
 * Edit the floor templates here to change the office layout.
 *
 * Floor structure (6 rows tall):
 *   row 0: ceiling — chandelier / picture / empty
 *   rows 1-3: room contents
 *   row 4: floor surface (where agents stand — slot chars go here)
 *   row 5: divider beam
 */

import type { SceneSpec, SceneSlot, TileLayer } from '../world-engine/types'
import { parseAscii, emptyGrid, pasteGrid } from '../world-engine/parseAscii'
import { officeTileset, TILE_CHARS, SLOT_CHARS } from './tiles'

export const SCENE_WIDTH = 18
export const FLOOR_HEIGHT = 6
export const SCENE_HEIGHT = FLOOR_HEIGHT * 5   // 5 floors

// Floor index → y row of its FLOOR SURFACE (where agents stand).
// Floor 0 = penthouse, 4 = lounge. Surface row is the 5th row of each floor (index 4).
export const FLOOR_SURFACE_Y: Record<string, number> = {
  penthouse: 0 * FLOOR_HEIGHT + 4,
  boardroom: 1 * FLOOR_HEIGHT + 4,
  office_2:  2 * FLOOR_HEIGHT + 4,
  office_1:  3 * FLOOR_HEIGHT + 4,
  lounge:    4 * FLOOR_HEIGHT + 4,
}

// X-coord of the lift shaft (centred on its tile column)
export const LIFT_X = 16.5

// ── Floor templates (6 rows × 18 cols each) ─────────────────────────────────
//
// Legend:
//   . or space = empty
//   |          = outer wall
//   _          = floor divider beam
//   W          = window
//   L          = lift shaft
//   d D        = desk left / desk right with monitor
//   c          = office chair
//   b          = bookshelf
//   s S        = couch left / couch right
//   w          = water cooler
//   p          = plant
//   t          = conference table segment
//   h          = boardroom chair
//   E          = executive desk
//   C          = chandelier
//   @          = penthouse SLOT
//   !          = boardroom SLOT
//   #          = office_2 SLOT
//   $          = office_1 SLOT
//   *          = lounge SLOT

// All template rows are exactly SCENE_WIDTH (18) characters.
// Layout per row: '|' (col 0) + 15 interior cols (1-15) + 'L' (col 16, lift shaft) + '|' (col 17).
const PENTHOUSE = `
|.......C.......L|
|.WWWWWWWWWWWWW.L|
|p.............pL|
|.......E.......L|
|.......@.......L|
|_______________L|
`

const BOARDROOM = `
|.......C.......L|
|p.............pL|
|..tttttttttt...L|
|..h.h.h.h.h....L|
|.!.!.!.!.......L|
|_______________L|
`

const OFFICE_2 = `
|.......C.......L|
|p..b.....b....pL|
|D.D.D.D.D.D....L|
|c.c.c.c.c.c....L|
|#.#.#.#.#.#....L|
|_______________L|
`

const OFFICE_1 = `
|.......C.......L|
|p..b.....b....pL|
|D.D.D.D.D.D....L|
|c.c.c.c.c.c....L|
|$.$.$.$.$.$....L|
|_______________L|
`

const LOUNGE = `
|.......C.......L|
|p.............pL|
|.sS....sS....w.L|
|...............L|
|*.*.*.*.*.*.*.*L|
|_______________L|
`

// ── Build the scene ────────────────────────────────────────────────────────

function build() {
  // Each floor returns its tile data + slots; we stack them and assemble layers.
  const parts = [PENTHOUSE, BOARDROOM, OFFICE_2, OFFICE_1, LOUNGE].map((tpl, i) =>
    parseAscii(tpl, TILE_CHARS, SLOT_CHARS, {
      yOffset: i * FLOOR_HEIGHT,
      width: SCENE_WIDTH,
    })
  )

  // Single architectural layer covering walls + furniture (everything is one layer
  // since tiles are designed not to overlap — fewer DOM nodes).
  const tiles = emptyGrid(SCENE_WIDTH, SCENE_HEIGHT)
  parts.forEach((p, i) => pasteGrid(tiles, p.tiles, 0, i * FLOOR_HEIGHT))

  const slots: SceneSlot[] = []
  parts.forEach(p => slots.push(...p.slots))

  return { tiles, slots }
}

const built = build()

export const officeSceneSlots: SceneSlot[] = built.slots

const layers: TileLayer[] = [
  { name: 'world', tiles: built.tiles, zIndex: 1 },
]

export function makeOfficeScene(tilePx: number): SceneSpec {
  return {
    width: SCENE_WIDTH,
    height: SCENE_HEIGHT,
    tilePx,
    tileset: officeTileset,
    layers,
  }
}

// ── Slot helpers — used by TowerView to position agents ────────────────────

/** All slots grouped by floor name (for round-robin assignment). */
export const slotsByGroup: Record<string, SceneSlot[]> = {
  penthouse: [], boardroom: [], office_2: [], office_1: [], lounge: [],
}
for (const s of officeSceneSlots) {
  if (slotsByGroup[s.group]) slotsByGroup[s.group].push(s)
}
// Sort each group left-to-right for predictable assignment
for (const g of Object.keys(slotsByGroup)) {
  slotsByGroup[g].sort((a, b) => a.x - b.x)
}
