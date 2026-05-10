/**
 * world-engine — a tiny tile-based scene framework.
 *
 * A world is a stack of tile layers (z-ordered) plus a set of entities
 * positioned in tile coordinates. Layers are 2D arrays of tile indices
 * referring to a Tileset (a sprite atlas of identically-sized tiles).
 * Tile index `-1` (or any negative) means empty cell.
 *
 * Coordinate system:
 *   • Origin is top-left of the scene.
 *   • Tile coordinate (x, y) maps to pixel (x * tilePx, y * tilePx).
 *   • Both layers and entities use tile coords; entities can be fractional
 *     for sub-tile positioning and smooth movement.
 */

export interface TilesetSpec {
  /** Image URL — magenta background pixels are stripped to alpha=0 by useProcessedTileset. */
  src: string
  /** Number of tile columns in the source sheet. */
  cols: number
  /** Number of tile rows in the source sheet. */
  rows: number
  /** Whether the source has a magenta background that should be stripped. */
  stripMagenta?: boolean
}

export interface TileLayer {
  name: string
  /** 2D array of tile indices. Outer = rows (y), inner = cols (x). -1 = empty. */
  tiles: number[][]
  /** Higher z-index renders on top. Default = layer order. */
  zIndex?: number
  /** Optional opacity multiplier for the entire layer. */
  opacity?: number
}

export interface SceneSpec {
  /** Width of the scene in tiles. */
  width: number
  /** Height of the scene in tiles. */
  height: number
  /** Display size (px) of each tile when rendered. */
  tilePx: number
  /** The tileset this scene draws from. */
  tileset: TilesetSpec
  /** Layers, painted bottom-up in array order (or by zIndex). */
  layers: TileLayer[]
  /** Optional CSS background colour for cells with no tile. */
  bg?: string
}

/**
 * A "slot" is a named anchor point inside a scene — used to place dynamic
 * entities (agents, props) at known positions in tile coords. Slots are not
 * rendered themselves; they're metadata.
 */
export interface SceneSlot {
  id: string                 // e.g. 'office_1.desk_3'
  group: string              // e.g. 'office_1'
  x: number                  // tile coords (can be fractional)
  y: number
  facing?: 'left' | 'right'  // optional visual direction
}

/**
 * Result of parsing an ASCII template — tile data plus any slot anchors
 * extracted from special characters.
 */
export interface ParsedTemplate {
  tiles: number[][]
  slots: SceneSlot[]
}
