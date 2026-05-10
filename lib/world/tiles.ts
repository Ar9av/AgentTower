/**
 * Tile-index constants for the office tileset (public/sprites/tileset.png).
 * Layout: 4 rows × 4 cols, source 256×256 per tile.
 */
import type { TilesetSpec } from '../world-engine/types'

export const officeTileset: TilesetSpec = {
  src: '/sprites/tileset.png',
  cols: 4,
  rows: 4,
  stripMagenta: true,
}

// Index = row * 4 + col
export const T = {
  EMPTY: -1,

  // Row 0 — Architecture
  WALL:        0,   // vertical brick wall edge
  BEAM:        1,   // horizontal floor divider
  WINDOW:      2,   // night window
  LIFT_SHAFT:  3,

  // Row 1 — Office furniture
  DESK_L:      4,   // desk left side
  DESK_R:      5,   // desk right side w/ monitor
  CHAIR:       6,   // office chair
  BOOKSHELF:   7,

  // Row 2 — Lounge
  COUCH_L:     8,
  COUCH_R:     9,
  WATER:      10,   // water cooler
  PLANT:      11,

  // Row 3 — Boardroom & penthouse
  CONF_TABLE: 12,
  BOARD_CHAIR:13,
  EXEC_DESK:  14,
  CHANDELIER: 15,
} as const

/** Char → tile index, used by parseAscii. */
export const TILE_CHARS: Record<string, number> = {
  '.': T.EMPTY,
  ' ': T.EMPTY,
  '|': T.WALL,
  '_': T.BEAM,
  'W': T.WINDOW,
  'L': T.LIFT_SHAFT,
  'd': T.DESK_L,
  'D': T.DESK_R,
  'c': T.CHAIR,
  'b': T.BOOKSHELF,
  's': T.COUCH_L,
  'S': T.COUCH_R,
  'w': T.WATER,
  'p': T.PLANT,
  't': T.CONF_TABLE,
  'h': T.BOARD_CHAIR,
  'E': T.EXEC_DESK,
  'C': T.CHANDELIER,
}

/** Slot chars → group name. These produce slots, not tiles. */
export const SLOT_CHARS: Record<string, string> = {
  '@': 'penthouse',  // commander/exec slot
  '!': 'boardroom',
  '#': 'office_2',   // upper office
  '$': 'office_1',   // lower office
  '*': 'lounge',
}
