'use client'
import { useRef } from 'react'

export interface AttachedImage {
  dataUrl: string      // for preview
  base64: string       // raw base64 for upload
  mediaType: string    // image/png etc
  name: string
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
      // dataUrl = "data:image/png;base64,XXXXX"
      const [meta, base64] = dataUrl.split(',')
      const mediaType = meta.replace('data:', '').replace(';base64', '')
      resolve({ dataUrl, base64, mediaType, name: file.name })
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export function useImagePaste(onAttach: (img: AttachedImage) => void) {
  return async function handlePaste(e: React.ClipboardEvent) {
    for (const item of Array.from(e.clipboardData.items)) {
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (!file) continue
        e.preventDefault()
        const img = await fileToAttached(file)
        onAttach(img)
        return
      }
    }
  }
}

export default function ImageAttachment({ image, onAttach, onRemove }: Props) {
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const img = await fileToAttached(file)
    onAttach(img)
    e.target.value = ''
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {/* Hidden file input — accepts images, triggers camera on mobile */}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFile}
        style={{ display: 'none' }}
        aria-hidden
      />

      {/* Attach button */}
      {!image && (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="glass-btn"
          style={{ padding: '8px 11px', fontSize: 16, minHeight: 44, flexShrink: 0 }}
          title="Attach image (or paste from clipboard)"
          aria-label="Attach image"
        >
          📎
        </button>
      )}

      {/* Preview thumbnail */}
      {image && (
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
          >
            ✕
          </button>
        </div>
      )}
    </div>
  )
}
