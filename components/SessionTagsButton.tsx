'use client'
import { useState, useEffect, useRef } from 'react'

interface Props {
  sessionId: string
  initialFavorite?: boolean
  initialTags?: string[]
  compact?: boolean
}

export default function SessionTagsButton({ sessionId, initialFavorite = false, initialTags = [], compact = false }: Props) {
  const [favorite, setFavorite] = useState(initialFavorite)
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagInput, setTagInput] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (showInput) inputRef.current?.focus()
  }, [showInput])

  async function patch(body: Record<string, unknown>) {
    setSaving(true)
    try {
      await fetch('/api/session-tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ...body }),
      })
    } finally {
      setSaving(false)
    }
  }

  async function toggleFavorite() {
    const next = !favorite
    setFavorite(next)
    await patch({ favorite: next, tags })
  }

  async function submitTags(e: React.FormEvent) {
    e.preventDefault()
    const newTags = tagInput
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)
    const merged = Array.from(new Set([...tags, ...newTags]))
    setTags(merged)
    setTagInput('')
    setShowInput(false)
    await patch({ favorite, tags: merged })
  }

  async function removeTag(tag: string) {
    const next = tags.filter(t => t !== tag)
    setTags(next)
    await patch({ favorite, tags: next })
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
      {/* Star button */}
      <button
        onClick={toggleFavorite}
        disabled={saving}
        title={favorite ? 'Remove from favorites' : 'Add to favorites'}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          fontSize: compact ? 14 : 16,
          padding: '2px 4px',
          opacity: saving ? 0.5 : 1,
          color: favorite ? '#f5a623' : 'var(--text3)',
          transition: 'color 0.15s',
          lineHeight: 1,
        }}
      >
        {favorite ? '★' : '☆'}
      </button>

      {/* Existing tags */}
      {tags.map(tag => (
        <span
          key={tag}
          className="chip"
          style={{ fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 3, paddingRight: 4 }}
        >
          {tag}
          <button
            onClick={() => removeTag(tag)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: 10, color: 'var(--text3)', lineHeight: 1 }}
          >
            ×
          </button>
        </span>
      ))}

      {/* Tag input toggle */}
      {showInput ? (
        <form onSubmit={submitTags} style={{ display: 'inline-flex', gap: 4 }}>
          <input
            ref={inputRef}
            value={tagInput}
            onChange={e => setTagInput(e.target.value)}
            placeholder="tag1, tag2…"
            className="glass-input"
            style={{ fontSize: 11, padding: '2px 8px', width: 110, minHeight: 24, borderRadius: 6 }}
            onBlur={() => { if (!tagInput) setShowInput(false) }}
          />
          <button type="submit" className="glass-btn" style={{ fontSize: 11, padding: '2px 8px', minHeight: 24 }}>+</button>
        </form>
      ) : (
        <button
          onClick={() => setShowInput(true)}
          title="Add tag"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 12,
            padding: '2px 4px',
            color: 'var(--text3)',
            lineHeight: 1,
          }}
        >
          #
        </button>
      )}
    </div>
  )
}
