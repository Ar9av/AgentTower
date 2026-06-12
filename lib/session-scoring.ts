import fs from 'fs'
import path from 'path'
import os from 'os'
import type { ParsedMessage } from './types'

export interface SessionScore {
  sessionId: string
  scoredAt: number
  qualityScore: number    // 0–100: did the agent accomplish something?
  efficiencyScore: number // 0–100: output tokens / total tokens
  errorCount: number
  toolCallCount: number
  uniqueToolsUsed: string[]
  completionSignal: boolean  // last message had "done"/"completed" language
  totalInputTokens: number
  totalOutputTokens: number
}

const SCORE_DIR = path.join(os.homedir(), '.claude', 'usage-data', 'session-scores')

const COMPLETION_WORDS = [
  'completed', 'done', 'finished', 'successfully', 'created', 'fixed',
  'implemented', 'resolved', 'deployed', 'shipped', 'working', 'all set',
]

function lastAssistantText(messages: ParsedMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.type !== 'assistant') continue
    for (const b of m.content) {
      if (b.type === 'text' && b.text) return b.text.toLowerCase()
    }
  }
  return ''
}

export function computeSessionScore(sessionId: string, messages: ParsedMessage[]): SessionScore {
  let errorCount = 0
  let toolCallCount = 0
  const toolNames = new Set<string>()
  let totalInput = 0
  let totalOutput = 0

  for (const m of messages) {
    if (m.usage) {
      totalInput += m.usage.input_tokens ?? 0
      totalOutput += m.usage.output_tokens ?? 0
    }
    for (const b of m.content) {
      if (b.type === 'tool_use' && b.tool_name) {
        toolCallCount++
        toolNames.add(b.tool_name)
      }
      if (b.type === 'tool_result' && b.is_error) {
        errorCount++
      }
    }
  }

  const lastText = lastAssistantText(messages)
  const completionSignal = COMPLETION_WORDS.some(w => lastText.includes(w))

  // Quality score (0–100)
  let quality = 40
  if (completionSignal) quality += 20
  if (toolCallCount >= 3) quality += 10
  if (toolCallCount >= 10) quality += 10
  if (toolNames.size >= 3) quality += 10
  quality -= Math.min(40, errorCount * 8)
  quality = Math.max(0, Math.min(100, quality))

  // Efficiency: output / total tokens (agents that produce output are efficient)
  const totalTokens = totalInput + totalOutput
  const efficiencyScore = totalTokens > 0
    ? Math.round((totalOutput / totalTokens) * 100)
    : 0

  return {
    sessionId,
    scoredAt: Date.now(),
    qualityScore: quality,
    efficiencyScore,
    errorCount,
    toolCallCount,
    uniqueToolsUsed: Array.from(toolNames),
    completionSignal,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
  }
}

export function saveSessionScore(score: SessionScore): void {
  fs.mkdirSync(SCORE_DIR, { recursive: true })
  const file = path.join(SCORE_DIR, `${score.sessionId}.json`)
  fs.writeFileSync(file, JSON.stringify(score, null, 2), 'utf-8')
}

export function loadSessionScore(sessionId: string): SessionScore | null {
  try {
    const file = path.join(SCORE_DIR, `${sessionId}.json`)
    return JSON.parse(fs.readFileSync(file, 'utf-8')) as SessionScore
  } catch {
    return null
  }
}

export function loadAllScores(): SessionScore[] {
  const scores: SessionScore[] = []
  try {
    const files = fs.readdirSync(SCORE_DIR).filter(f => f.endsWith('.json'))
    for (const f of files) {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(SCORE_DIR, f), 'utf-8')) as SessionScore
        if (s.sessionId) scores.push(s)
      } catch { /* skip corrupt */ }
    }
  } catch { /* dir doesn't exist yet */ }
  return scores
}
