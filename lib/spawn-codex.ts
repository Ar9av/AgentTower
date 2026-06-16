import { spawn, execSync, SpawnOptions, ChildProcess } from 'child_process'

let codexBin: string | null = null

export function getCodexBin(): string {
  if (codexBin) return codexBin
  const candidates = [
    process.env.CODEX_BIN,
    '/usr/bin/codex',
    '/usr/local/bin/codex',
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      execSync(`test -x "${candidate}"`, { stdio: 'ignore' })
      codexBin = candidate
      return candidate
    } catch {}
  }

  try {
    codexBin = execSync('command -v codex', { encoding: 'utf-8' }).trim() || 'codex'
  } catch {
    codexBin = 'codex'
  }
  return codexBin
}

export function spawnCodex(args: string[], options: SpawnOptions = {}): ChildProcess {
  return spawn(getCodexBin(), args, options)
}
