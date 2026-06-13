import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import os from 'os'

export interface Skill {
  name: string
  description: string
}

function parseSkillMd(content: string): { name?: string; description?: string } {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!fmMatch) return {}
  const fm = fmMatch[1]
  const nameMatch = fm.match(/^name:\s*(.+)$/m)
  // description may be a YAML block scalar ("> ..." multiline) or inline
  const descMatch = fm.match(/^description:\s*[>|]?\s*\n((?:  .+\n?)+)/m)
    ?? fm.match(/^description:\s*(.+)$/m)
  const name = nameMatch?.[1]?.trim()
  let description = ''
  if (descMatch) {
    description = descMatch[1]
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .join(' ')
      .trim()
  }
  return { name, description }
}

export async function GET() {
  const skillsDir = path.join(os.homedir(), '.claude', 'skills')
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true })
    const skills: Skill[] = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const skillMdPath = path.join(skillsDir, entry.name, 'SKILL.md')
      if (!fs.existsSync(skillMdPath)) continue
      const content = fs.readFileSync(skillMdPath, 'utf-8')
      const { name, description } = parseSkillMd(content)
      skills.push({ name: name ?? entry.name, description: description ?? '' })
    }
    skills.sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ skills })
  } catch {
    return NextResponse.json({ skills: [] })
  }
}
