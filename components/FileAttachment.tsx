'use client'
import { useRef } from 'react'

export interface AttachedFile {
  dataUrl?: string        // for image preview only
  base64: string          // raw base64 for upload
  name: string
  size: number
  mediaType: string       // mime type
  isImage: boolean
}

interface Props {
  files: AttachedFile[]
  onAttach: (f: AttachedFile) => void
  onRemove: (idx: number) => void
}

function fileToAttached(file: File): Promise<AttachedFile> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      const [meta, base64] = dataUrl.split(',')
      const mediaType = meta.replace('data:', '').replace(';base64', '') || file.type || 'application/octet-stream'
      const isImage = mediaType.startsWith('image/')
      resolve({
        dataUrl: isImage ? dataUrl : undefined,
        base64,
        name: file.name,
        size: file.size,
        mediaType,
        isImage,
      })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function useFilePaste(onAttach: (f: AttachedFile) => void) {
  return async function handlePaste(e: React.ClipboardEvent) {
    const items = Array.from(e.clipboardData.items)
    for (const item of items) {
      if (item.kind === 'file') {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const attached = await fileToAttached(file)
        onAttach(attached)
        return
      }
    }
  }
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
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

export default function FileAttachment({ files, onAttach, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const list = Array.from(e.target.files ?? [])
    for (const f of list) {
      const attached = await fileToAttached(f)
      onAttach(attached)
    }
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flexWrap: 'wrap' }}>
      <input
        ref={fileRef}
        type="file"
        multiple
        onChange={handleFile}
        style={{ display: 'none' }}
        aria-hidden
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="glass-btn"
        style={{ padding: '8px 11px', fontSize: 16, minHeight: 44, flexShrink: 0 }}
        title="Attach file (or paste with Cmd+V)"
        aria-label="Attach file"
      >
        📎
      </button>

      {files.map((f, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'var(--glass-bg)',
            border: '1px solid var(--glass-border)',
            borderRadius: 8,
            padding: '4px 6px 4px 8px',
            fontSize: 12,
            maxWidth: 200,
          }}
        >
          {f.isImage && f.dataUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={f.dataUrl}
              alt=""
              style={{ width: 24, height: 24, objectFit: 'cover', borderRadius: 4, flexShrink: 0 }}
            />
          ) : (
            <span style={{ fontSize: 14, flexShrink: 0 }}>{fileIcon(f.mediaType, f.name)}</span>
          )}
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'var(--text2)', flex: 1, minWidth: 0,
          }} title={f.name}>
            {f.name}
          </span>
          <span style={{ color: 'var(--text3)', fontSize: 10, flexShrink: 0 }}>
            {formatSize(f.size)}
          </span>
          <button
            type="button"
            onClick={() => onRemove(i)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text3)', fontSize: 12, padding: 2,
              lineHeight: 1, flexShrink: 0,
            }}
            aria-label={`Remove ${f.name}`}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
