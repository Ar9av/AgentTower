import { execSync, spawn } from 'child_process'
import path from 'path'

export interface DaemonStatus {
  running: boolean
  pid: number | null
  uptimeSec: number | null
}

function parseElapsedSeconds(raw: string): number | null {
  const text = raw.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return parseInt(text, 10)

  const daySplit = text.split('-')
  let days = 0
  let timePart = text
  if (daySplit.length === 2) {
    days = parseInt(daySplit[0], 10) || 0
    timePart = daySplit[1]
  }

  const parts = timePart.split(':').map(part => parseInt(part, 10) || 0)
  if (parts.length === 2) {
    const [mm, ss] = parts
    return days * 86400 + mm * 60 + ss
  }
  if (parts.length === 3) {
    const [hh, mm, ss] = parts
    return days * 86400 + hh * 3600 + mm * 60 + ss
  }
  return null
}

export function getDaemonStatus(): DaemonStatus {
  try {
    const commands = process.platform === 'darwin'
      ? ['ps -A -o pid=,etime=,command=']
      : ['ps -A -o pid=,etimes=,command=', 'ps -A -o pid=,etime=,command=']

    for (const command of commands) {
      let out = ''
      try {
        out = execSync(command, { encoding: 'utf-8' })
      } catch {
        continue
      }

      for (const line of out.split('\n')) {
        if (!line.includes('orchestrator-bot')) continue
        if (/grep|orchestrator-control/.test(line)) continue
        const m = line.trim().match(/^(\d+)\s+(\S+)\s+/)
        if (!m) continue
        return {
          running: true,
          pid: parseInt(m[1], 10),
          uptimeSec: parseElapsedSeconds(m[2]),
        }
      }
    }
  } catch {}
  return { running: false, pid: null, uptimeSec: null }
}

export function startDaemon(): { ok: true; pid: number | undefined } | { ok: false; error: string } {
  const status = getDaemonStatus()
  if (status.running) {
    return { ok: true, pid: status.pid ?? undefined }
  }

  const botPath = path.resolve(process.cwd(), 'scripts/orchestrator/orchestrator-bot.ts')
  const tsNodeBin = path.resolve(process.cwd(), 'node_modules', '.bin', process.platform === 'win32' ? 'ts-node.cmd' : 'ts-node')

  try {
    const proc = spawn(
      tsNodeBin,
      ['--transpile-only', '--compiler-options', '{"module":"commonjs","moduleResolution":"node"}', botPath],
      { detached: true, stdio: 'ignore', env: process.env },
    )
    proc.unref()
    return { ok: true, pid: proc.pid }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
