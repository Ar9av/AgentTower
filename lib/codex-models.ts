import { execFileSync } from 'child_process'
import { getCodexBin } from '@/lib/spawn-codex'

export interface CodexModelOption {
  value: string
  label: string
  note?: string
}

interface CodexModelCatalogEntry {
  slug?: string
  display_name?: string
  description?: string
  visibility?: string
}

interface CodexModelCatalogResponse {
  models?: CodexModelCatalogEntry[]
}

interface CodexModelCache {
  expiresAt: number
  options: CodexModelOption[]
}

const CACHE_TTL_MS = 5 * 60 * 1000
const globalCacheKey = '__agenttower_codex_model_cache__'

declare global {
  var __agenttower_codex_model_cache__: CodexModelCache | undefined
}

function getCache(): CodexModelCache | undefined {
  return global[globalCacheKey]
}

function setCache(options: CodexModelOption[]) {
  global[globalCacheKey] = {
    options,
    expiresAt: Date.now() + CACHE_TTL_MS,
  }
}

export function getFallbackCodexModelOptions(): CodexModelOption[] {
  return [
    { value: '', label: 'Use Codex default', note: 'from ~/.codex/config.toml or CLI default' },
    { value: '__custom__', label: 'Custom model…', note: 'enter any model string manually' },
  ]
}

export function getCodexModelOptions(): CodexModelOption[] {
  const cached = getCache()
  if (cached && cached.expiresAt > Date.now()) return cached.options

  try {
    const raw = execFileSync(getCodexBin(), ['debug', 'models'], {
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 2 * 1024 * 1024,
    })
    const parsed = JSON.parse(raw) as CodexModelCatalogResponse
    const listedModels = (parsed.models ?? [])
      .filter(model => model.visibility === 'list' && typeof model.slug === 'string' && model.slug.trim())
      .map(model => ({
        value: model.slug!.trim(),
        label: (model.display_name || model.slug || '').trim(),
        note: model.description?.trim() || undefined,
      }))

    const options = [
      { value: '', label: 'Use Codex default', note: 'from ~/.codex/config.toml or CLI default' },
      ...listedModels,
      { value: '__custom__', label: 'Custom model…', note: 'enter any model string manually' },
    ]

    setCache(options)
    return options
  } catch {
    const fallback = getFallbackCodexModelOptions()
    setCache(fallback)
    return fallback
  }
}
