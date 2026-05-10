'use client'
import { ReactNode, CSSProperties } from 'react'
import type { SceneSpec } from './types'
import { useTileset } from './Tileset'
import { TileLayer } from './TileLayer'

/**
 * Renders a scene's tile layers. Children are rendered ABOVE all tile layers,
 * use this slot for entities (agents, lift, particles) positioned absolutely
 * in tile-coords via the helpers below.
 *
 * The scene's own size is `width * tilePx` × `height * tilePx`. The wrapper
 * is `position: relative` so children using `position: absolute` resolve to
 * scene-local coordinates.
 */
export function Scene({ spec, children, style }: {
  spec: SceneSpec
  children?: ReactNode
  style?: CSSProperties
}) {
  const tilesetSrc = useTileset(spec.tileset)
  return (
    <div style={{
      position: 'relative',
      width: spec.width * spec.tilePx,
      height: spec.height * spec.tilePx,
      background: spec.bg,
      ...style,
    }}>
      {spec.layers.map(layer => (
        <TileLayer
          key={layer.name}
          layer={layer}
          tilesetSrc={tilesetSrc}
          tileset={spec.tileset}
          tilePx={spec.tilePx}
          sceneWidth={spec.width}
          sceneHeight={spec.height}
        />
      ))}
      {children}
    </div>
  )
}

/**
 * Style helper: pin an element at tile coordinates inside a Scene.
 * `anchor='bottom-center'` → element's bottom-middle sits at the tile point
 * (useful for character sprites whose feet should land on a row).
 */
export function tilePos(
  x: number, y: number, tilePx: number,
  anchor: 'center' | 'bottom-center' | 'top-left' = 'center'
): CSSProperties {
  const left = x * tilePx
  const top = y * tilePx
  if (anchor === 'top-left') return { position: 'absolute', left, top }
  const transform = anchor === 'bottom-center' ? 'translate(-50%, -100%)' : 'translate(-50%, -50%)'
  return { position: 'absolute', left, top, transform }
}
