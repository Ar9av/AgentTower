'use client'
import { useState } from 'react'
import { appPath } from '@/lib/base-path'
import { BRAND_MANIFEST, type BrandName } from '@/lib/brands'

export type { BrandName }

/**
 * Brand/tool logos sourced from api.svgl.app and cached into public/brands/
 * by `npm run icons`. Add a slug to scripts/fetch-brand-icons.ts, re-run it,
 * and the generated manifest widens `BrandName` automatically.
 *
 * `mono` logos in the manifest are black-and-white artwork that would vanish
 * against one of the two themes; globals.css inverts those via
 * `.brand-icon-mono`.
 */
export default function BrandIcon({
  name, size = 16, title, style, fallback = null,
}: {
  name: BrandName
  size?: number
  title?: string
  style?: React.CSSProperties
  /** Rendered if the asset is missing — e.g. the icons script hasn't been run. */
  fallback?: React.ReactNode
}) {
  const [broken, setBroken] = useState(false)
  const meta = BRAND_MANIFEST[name]

  if (broken || !meta) return <>{fallback}</>

  return (
    // next/image does not optimize SVGs, and these are tiny local assets —
    // a plain <img> avoids the loader round-trip entirely.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={appPath(`/brands/${name}.svg`)}
      alt={title ?? meta.title}
      title={title ?? meta.title}
      width={size}
      height={size}
      className={meta.mono ? 'brand-icon brand-icon-mono' : 'brand-icon'}
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      onError={() => setBroken(true)}
      draggable={false}
    />
  )
}
