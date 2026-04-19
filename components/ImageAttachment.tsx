'use client'
import { useRef } from 'react'

export interface AttachedImage {
  dataUrl: string      // for preview (may be non-image dataUrl)
  base64: string       // raw base64 for upload
  mediaType: string    // image/png, application/pdf, etc
  name: string
  size?: number
}

interface Props {
  image: AttachedImage | null
  onAttach: (img: AttachedImage) => void
  onRemove: () => void
}

function fileToAttached(file: File): Promise<AttachedImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const [meta, base64] = dataUrl.split(',')
      const mediaType = meta.replace('data:', '').replace(';base64', '') || file.type || 'application/octet-stream'
      resolve({ dataUrl, base64, mediaType, name: file.name, size: file.size })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function useImagePaste(onAttach: (img: AttachedImage) => void) {
  return async function handlePaste(e: React.ClipboardEvent) {
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const att = await fileToAttached(file)
        onAttach(att)
        return
      }
    }
  }
}

function fileIcon(mediaType: string, name: string): string {
  if (mediaType.startsWith('image/')) return '🖼'
  if (mediaType.includes('pdf')) return '📄'
  if (mediaType.startsWith('video/')) return '🎬'
  if (mediaType.startsWith('audio/')) return '🎵'
  if (/\.(zip|tar|gz|7z|rar)$/i.test(name)) return '🗜'
  if (/\.(md|txt|log|csv|json|yaml|yml|xml|html|js|ts|tsx|py|go|rs|sh|sql)$/i.test(name)) return '📝'
  return '📎'
}

function formatSize(bytes?: number): string {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function ImageAttachment({ image, onAttach, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const att = await fileToAttached(file)
    onAttach(att)
    e.target.value = ''
  }

  const isImage = image ? image.mediaType.startsWith('image/') : false

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input
        ref={fileRef}
        type="file"
        onChange={handleFile}
        style={{ display: 'none' }}
        aria-hidden
      />

      {!image && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="glass-btn"
          style={{ padding: '8px 11px', fontSize: 16, minHeight: 44, flexShrink: 0 }}
          title="Attach file (any type, or paste from clipboard)"
          aria-label="Attach file"
        >
          📎
        </button>
      )}

      {image && isImage && (
        <div style={{ position: 'relative', flexShrink: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.dataUrl}
            alt="Attached"
            style={{
              width: 44, height: 44,
              objectFit: 'cover',
              borderRadius: 8,
              border: '1px solid var(--glass-border)',
              display: 'block',
            }}
          />
          <button
            type="button"
            onClick={onRemove}
            style={{
              position: 'absolute', top: -6, right: -6,
              width: 18, height: 18,
              borderRadius: '50%',
              background: 'var(--red)',
              color: '#fff',
              border: 'none',
              fontSize: 10,
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              lineHeight: 1,
            }}
            aria-label="Remove image"
          >✕</button>
        </div>
      )}

      {image && !isImage && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          background: 'var(--glass-bg)',
          border: '1px solid var(--glass-border)',
          borderRadius: 8,
          padding: '6px 8px',
          fontSize: 12,
          maxWidth: 240,
        }}>
          <span style={{ fontSize: 16, flexShrink: 0 }}>{fileIcon(image.mediaType, image.name)}</span>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'var(--text2)', flex: 1, minWidth: 0,
          }} title={image.name}>{image.name}</span>
          {image.size && (
            <span style={{ color: 'var(--text3)', fontSize: 10, flexShrink: 0 }}>
              {formatSize(image.size)}
            </span>
          )}
          <button
            type="button"
            onClick={onRemove}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text3)', fontSize: 14, padding: 2,
              lineHeight: 1, flexShrink: 0,
            }}
            aria-label="Remove file"
          >✕</button>
        </div>
      )}
    </div>
  )
}
