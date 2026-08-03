import fs from 'fs'
import os from 'os'
import path from 'path'

const CONFIG_PATH = path.join(os.homedir(), '.claude', 'agenttower-settings.json')

export interface AppSettings {
  projectIgnoreRules: string[]
  terminalEnabled: boolean
}

const DEFAULT_SETTINGS: AppSettings = {
  projectIgnoreRules: [],
  terminalEnabled: false,
}

const DEFAULT_PROJECT_IGNORE_REGEXES = [
  '^/tmp(?:/.*)?$',
  '^/private/tmp(?:/.*)?$',
]

export function loadSettings(): AppSettings {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppSettings>
    return {
      projectIgnoreRules: Array.isArray(parsed.projectIgnoreRules)
        ? parsed.projectIgnoreRules.filter((v): v is string => typeof v === 'string')
        : [],
      terminalEnabled: typeof parsed.terminalEnabled === 'boolean' ? parsed.terminalEnabled : false,
    }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(cfg: AppSettings): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 })
}

export function getSettingsPath(): string {
  return CONFIG_PATH
}

export function globToRegexSource(glob: string): string {
  let out = '^'
  for (const ch of glob) {
    if (ch === '*') out += '.*'
    else if (ch === '?') out += '.'
    else if ('\\^$+?.()|{}[]'.includes(ch)) out += `\\${ch}`
    else out += ch
  }
  return `${out}$`
}

export function compileProjectIgnoreRule(rule: string): { source: string; regex: RegExp } {
  const trimmed = rule.trim()
  if (!trimmed) throw new Error('Rule is empty')

  if (trimmed.startsWith('regex:')) {
    const source = trimmed.slice('regex:'.length).trim()
    if (!source) throw new Error('Regex rule is empty')
    return { source, regex: new RegExp(source) }
  }

  const source = trimmed.includes('*') || trimmed.includes('?')
    ? globToRegexSource(trimmed)
    : `^${trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`

  return { source, regex: new RegExp(source) }
}

export function getDefaultProjectIgnoreRegexes(): string[] {
  return [...DEFAULT_PROJECT_IGNORE_REGEXES]
}

export function getCompiledProjectIgnoreRegexes(settings = loadSettings()): string[] {
  const compiled = [...DEFAULT_PROJECT_IGNORE_REGEXES]
  for (const rule of settings.projectIgnoreRules) {
    const trimmed = rule.trim()
    if (!trimmed) continue
    compiled.push(compileProjectIgnoreRule(trimmed).source)
  }
  return compiled
}

export function shouldHideProjectPath(projectPath: string): boolean {
  const resolved = path.resolve(projectPath)
  const regexes = getCompiledProjectIgnoreRegexes().map(source => new RegExp(source))
  return regexes.some(regex => regex.test(resolved))
}
