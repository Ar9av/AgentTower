# AgentTower

A Next.js web UI for monitoring, searching, and controlling Claude Code sessions in real time.

## Features

- **Projects grid** — all your Claude Code projects at a glance, active ones highlighted
- **Session browser** — list sessions per project with message counts, token usage, and process state
- **Live tail** — SSE-based real-time stream; new messages appear within 2s
- **Session reader** — full conversation: user prompts, Claude responses, tool calls, thinking blocks
- **Send input** — inject a new message into any running or finished session
- **Process control** — Kill, Pause (SIGSTOP), Resume (SIGCONT) running Claude processes
- **Global search** — grep across every JSONL session file with highlighted matches
- **Auth** — password login with exponential backoff on failed attempts, HttpOnly cookies

## Quick start

```bash
git clone https://github.com/<you>/agenttower
cd agenttower
npm install
cp .env.example .env.local
# Set AUTH_PASSWORD in .env.local
npm run dev
# Open http://localhost:3000
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `AUTH_PASSWORD` | *(required)* | Login password |
| `CLAUDE_DIR` | `~/.claude` | Claude Code config root |
| `SESSION_TTL_DAYS` | `7` | Cookie lifetime |
| `ACTIVE_THRESHOLD_SECS` | `300` | Session "active" window in seconds |

## Production

```bash
npm run build
AUTH_PASSWORD=strongpassword npm start
```

For remote access, put behind a reverse proxy with TLS (nginx/caddy). Never expose directly to the internet without HTTPS.

## Architecture

```
app/
  api/             Next.js API routes (auth, projects, sessions, SSE tail, process signals)
  login/           Login page
  projects/        Projects grid (server-rendered)
  project/         Session list for a project
  session/         Full session reader with live tail
  search/          Global search
lib/
  auth.ts          Password hashing, session tokens, rate limiting
  claude-fs.ts     JSONL parsing, project/session discovery, search, SSE helpers
  process.ts       Claude process scanning, signaling
  types.ts         TypeScript types
components/
  Nav.tsx          Top navigation bar
  MessageBlock.tsx Renders a single conversation message with tool blocks
  LiveSession.tsx  SSE client + input form + process controls
  ProcessControls.tsx Kill/Pause/Resume buttons with confirmation
```

## Security

- PBKDF2-HMAC-SHA256 password hashing (in-memory, regenerated each restart)
- Exponential backoff on failed logins (2s, 4s, 8s… up to 1h)
- HttpOnly, SameSite=Strict session cookies
- All API endpoints require auth cookie
- Path traversal protection on all file access
- Process signals validate PID ownership before sending
