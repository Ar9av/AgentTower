'use client'
import { appPath } from '@/lib/base-path'
import { brandForMcpServer } from '@/lib/brands'
import { useTheme } from '../ThemeProvider'
import BrandIcon from './BrandIcon'

/**
 * A logo for a free-form name — an MCP server, a plugin agent — where we can't
 * know the vendor ahead of time.
 *
 * Names the static catalogue places render straight from public/brands/. The
 * rest go through /api/brand, which looks the name up on svgl once, keeps the
 * result on disk, and serves it from there forever after. So the first time a
 * new agent or MCP server shows up in a session it arrives with a grey MCP
 * mark; from the next render on it wears its own logo.
 */
export default function AutoBrandIcon({
  name, size = 16, title, style,
}: {
  /** Raw identifier, e.g. `plugin_dodopayments_dodo-knowledge`. */
  name: string
  size?: number
  title?: string
  style?: React.CSSProperties
}) {
  const { theme } = useTheme()
  const known = brandForMcpServer(name)

  if (known !== 'mcp') return <BrandIcon name={known} size={size} title={title} style={style} />

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // The theme travels with the request: a black-ink logo has to be inverted
      // server-side, because CSS can't reach inside an <img>.
      src={appPath(`/api/brand?q=${encodeURIComponent(name)}&t=${theme}`)}
      alt={title ?? name}
      title={title ?? name}
      width={size}
      height={size}
      className="brand-icon"
      style={{ width: size, height: size, flexShrink: 0, ...style }}
      draggable={false}
    />
  )
}
