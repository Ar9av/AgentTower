'use client'
import { useEffect, useState } from 'react'
import type { TilesetSpec } from './types'

/**
 * Loads a tileset PNG, optionally strips magenta (#FF00FF ± tolerance) to alpha=0,
 * and returns a data-URL ready to use as background-image. Cached per-src.
 */
const cache = new Map<string, string>()

export function useTileset(spec: TilesetSpec): string | null {
  const [url, setUrl] = useState<string | null>(() => cache.get(spec.src) ?? null)

  useEffect(() => {
    const cached = cache.get(spec.src)
    if (cached) { setUrl(cached); return }

    if (!spec.stripMagenta) {
      cache.set(spec.src, spec.src)
      setUrl(spec.src)
      return
    }

    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth
      canvas.height = img.naturalHeight
      const ctx = canvas.getContext('2d')!
      ctx.drawImage(img, 0, 0)
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
      const px = data.data
      for (let i = 0; i < px.length; i += 4) {
        if (px[i] > 200 && px[i + 2] > 200 && px[i + 1] < 80) px[i + 3] = 0
      }
      ctx.putImageData(data, 0, 0)
      const dataUrl = canvas.toDataURL('image/png')
      cache.set(spec.src, dataUrl)
      setUrl(dataUrl)
    }
    img.src = spec.src
    return () => { cancelled = true }
  }, [spec.src, spec.stripMagenta])

  return url
}

/**
 * Render a single tile by index. Used for icons / one-offs.
 * Layers should NOT use this — they render via background-position math directly
 * for fewer DOM nodes (see TileLayer below).
 */
export function Tile({ tilesetSrc, tileset, tileIdx, sizePx }: {
  tilesetSrc: string | null
  tileset: TilesetSpec
  tileIdx: number
  sizePx: number
}) {
  if (tileIdx < 0 || !tilesetSrc) return null
  const col = tileIdx % tileset.cols
  const row = Math.floor(tileIdx / tileset.cols)
  const sheetW = tileset.cols * sizePx
  const sheetH = tileset.rows * sizePx
  return (
    <div style={{
      width: sizePx, height: sizePx,
      backgroundImage: `url(${tilesetSrc})`,
      backgroundSize: `${sheetW}px ${sheetH}px`,
      backgroundPosition: `${-col * sizePx}px ${-row * sizePx}px`,
      backgroundRepeat: 'no-repeat',
      imageRendering: 'pixelated',
    }} />
  )
}
