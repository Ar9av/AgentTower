import { NextRequest, NextResponse } from 'next/server'
import { requireAuth } from '@/lib/auth'
import { loadDailyBriefConfig } from '@/lib/daily-brief'

// POST /api/daily-brief/trigger — manually fire a morning brief
// This just tells the agent on St3ve to run via a webhook call.
// If no agentTowerUrl is configured for outbound, returns instructions.
export async function POST(req: NextRequest) {
  const authErr = await requireAuth(req)
  if (authErr) return authErr

  const cfg = loadDailyBriefConfig()

  if (!cfg.enabled) {
    return NextResponse.json({ ok: false, message: 'Daily brief is disabled. Enable it in settings first.' })
  }

  if (cfg.projects.filter(p => p.enabled).length === 0) {
    return NextResponse.json({ ok: false, message: 'No enabled projects configured.' })
  }

  // The trigger is handled by the agent on St3ve. We can't push to it directly,
  // but we can return a curl command for the user to run on St3ve.
  const curlCmd = `curl -X POST http://localhost:3001/trigger \\
  -H "Authorization: Bearer ${cfg.apiKey}" \\
  -H "Content-Type: application/json"

# Or on St3ve:
# node ~/agenttower/scripts/daily-brief/morning-brief.mjs`

  return NextResponse.json({
    ok: true,
    message: 'To trigger manually on St3ve, run the command below or use the cron job.',
    command: curlCmd,
  })
}
