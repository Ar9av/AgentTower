import { spawn, execSync, SpawnOptions, ChildProcess } from "child_process"

/**
 * Resolve the absolute path to the `claude` CLI once at module load.
 * Falls back to "claude" so ENOENT error is clear if not installed.
 */
let claudeBin: string | null = null
export function getClaudeBin(): string {
  if (claudeBin) return claudeBin
  const candidates = [
    process.env.CLAUDE_BIN,
    "/usr/bin/claude",
    "/usr/local/bin/claude",
  ].filter(Boolean) as string[]
  for (const c of candidates) {
    try {
      execSync(`test -x ${c}`, { stdio: "ignore" })
      claudeBin = c
      return c
    } catch {}
  }
  try {
    claudeBin = execSync("command -v claude", { encoding: "utf-8" }).trim() || "claude"
  } catch {
    claudeBin = "claude"
  }
  return claudeBin
}

export function spawnClaude(args: string[], options: SpawnOptions = {}): ChildProcess {
  return spawn(getClaudeBin(), args, options)
}
