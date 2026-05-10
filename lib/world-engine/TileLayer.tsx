'use client'
import type { TilesetSpec, TileLayer as TileLayerData } from './types'

/**
 * Render a single tile layer. Only non-empty cells produce DOM nodes.
 * Each cell is a positioned div with background-image masked to the right tile.
 */
export function TileLayer({
  layer, tilesetSrc, tileset, tilePx, sceneWidth, sceneHeight,
}: {
  layer: TileLayerData
  tilesetSrc: string | null
  tileset: TilesetSpec
  tilePx: number
  sceneWidth: number
  sceneHeight: number
}) {
  if (!tilesetSrc) return null
  const sheetW = tileset.cols * tilePx
  const sheetH = tileset.rows * tilePx

  const cells: React.ReactNode[] = []
  for (let y = 0; y < layer.tiles.length; y++) {
    const row = layer.tiles[y]
    for (let x = 0; x < row.length; x++) {
      const idx = row[x]
      if (idx < 0) continue
      const col = idx % tileset.cols
      const tileRow = Math.floor(idx / tileset.cols)
      cells.push(
        <div
          key={`${layer.name}-${x}-${y}`}
          style={{
            position: 'absolute',
            left: x * tilePx,
            top: y * tilePx,
            width: tilePx,
            height: tilePx,
            backgroundImage: `url(${tilesetSrc})`,
            backgroundSize: `${sheetW}px ${sheetH}px`,
            backgroundPosition: `${-col * tilePx}px ${-tileRow * tilePx}px`,
            backgroundRepeat: 'no-repeat',
            imageRendering: 'pixelated',
          }}
        />
      )
    }
  }

  return (
    <div style={{
      position: 'absolute', inset: 0,
      width: sceneWidth * tilePx, height: sceneHeight * tilePx,
      opacity: layer.opacity,
      zIndex: layer.zIndex,
      pointerEvents: 'none',
    }}>
      {cells}
    </div>
  )
}
