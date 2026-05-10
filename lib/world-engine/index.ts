/**
 * world-engine — public API.
 *
 * A minimal tile-based scene framework for 2D pixel-art views built from
 * a tileset (sprite atlas) + tile-coordinate layers + entities.
 *
 * Usage:
 *   import { Scene, useTileset, parseAscii, tilePos } from '@/lib/world-engine'
 *
 *   const TILES = { '|': 0, '_': 1, 'W': 2, ... }
 *   const { tiles, slots } = parseAscii(`
 *     |WWWWW|
 *     |.....|
 *     |_____|
 *   `, TILES, { 'd': 'desks' })
 *
 *   <Scene spec={{ width: 18, height: 30, tilePx: 32, tileset, layers }}>
 *     {agents.map(a => (
 *       <div style={tilePos(slot.x, slot.y, 32, 'bottom-center')}>
 *         <Sprite ... />
 *       </div>
 *     ))}
 *   </Scene>
 */

export type { TilesetSpec, TileLayer, SceneSpec, SceneSlot, ParsedTemplate } from './types'
export { useTileset, Tile } from './Tileset'
export { TileLayer as TileLayerComponent } from './TileLayer'
export { Scene, tilePos } from './Scene'
export { parseAscii, stackTemplates, emptyGrid, pasteGrid } from './parseAscii'
