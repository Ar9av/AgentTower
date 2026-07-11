'use client'

import { useEffect, useMemo, useState } from 'react'
import type { CodexModelOption } from '@/lib/codex-models'

const CUSTOM_MODEL_VALUE = '__custom__'

const FALLBACK_OPTIONS: CodexModelOption[] = [
  { value: '', label: 'Use Codex default', note: 'from ~/.codex/config.toml or CLI default' },
  { value: CUSTOM_MODEL_VALUE, label: 'Custom model…', note: 'enter any model string manually' },
]

function isPresetModel(value: string, options: CodexModelOption[]) {
  return options.some(option => option.value === value && option.value !== CUSTOM_MODEL_VALUE)
}

export function useCodexModelSelection() {
  const [options, setOptions] = useState<CodexModelOption[]>(FALLBACK_OPTIONS)
  const [storedModel, setStoredModel] = useState(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem('codex-model') || ''
  })

  useEffect(() => {
    let cancelled = false

    async function loadOptions() {
      try {
        const res = await fetch('/api/codex/models', { cache: 'no-store' })
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled && Array.isArray(data.options) && data.options.length > 0) {
          setOptions(data.options)
        }
      } catch {}
    }

    loadOptions()
    return () => { cancelled = true }
  }, [])

  const codexModelPreset = useMemo(() => {
    if (isPresetModel(storedModel, options)) return storedModel
    if (storedModel) return CUSTOM_MODEL_VALUE
    return ''
  }, [options, storedModel])

  const customCodexModel = useMemo(() => {
    if (isPresetModel(storedModel, options)) return ''
    return storedModel
  }, [options, storedModel])

  const selectedModel = useMemo(
    () => (codexModelPreset === CUSTOM_MODEL_VALUE ? customCodexModel.trim() : codexModelPreset),
    [codexModelPreset, customCodexModel],
  )

  function setCodexModelPreset(value: string) {
    setStoredModel(value === CUSTOM_MODEL_VALUE ? customCodexModel : value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('codex-model', value === CUSTOM_MODEL_VALUE ? customCodexModel : value)
    }
  }

  function setCustomCodexModel(value: string) {
    setStoredModel(value)
    if (typeof window !== 'undefined') {
      localStorage.setItem('codex-model', value)
    }
  }

  return {
    options,
    codexModelPreset,
    customCodexModel,
    selectedModel,
    customModelValue: CUSTOM_MODEL_VALUE,
    setCodexModelPreset,
    setCustomCodexModel,
  }
}
