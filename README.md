# AgentTower

> **For AI agents:** Read [`AGENTS.md`](./AGENTS.md) first — it has a complete automated setup script and exact commands to get this running without human interaction (except asking for a password). For a full step-by-step human walkthrough, see [`SETUP.md`](./SETUP.md).

A Next.js web UI for monitoring, searching, and controlling Claude Code sessions in real time. Reads Claude Code's JSONL session logs from `~/.claude/projects/`, streams them live via SSE, and lets you send input, kill, pause, or resume any running Claude process — all from a browser.

---

## What it does

| Feature | Description |
|---|---|
| **Projects grid** | All Claude Code projects at a glance, active ones highlighted with a pulsing dot |
| **Session browser** | Sessions per project split into Active / History, with message counts and token usage |
| **Live tail** | SSE stream — new messages appear within 2s while Claude is running |
| **Session reader** | Full conversation: user prompts, Claude responses, tool calls, tool results, thinking blocks |
| **Send input** | Inject a new message into any running or finished session |
| **Process control** | Kill (SIGTERM), Pause (SIGSTOP), Resume (SIGCONT) running Claude processes |
| **Global search** | Grep across every JSONL session file; results grouped by session with highlighted matches |
| **Auth** | Password login, PBKDF2 hashing, exponential backoff on failed attempts, HttpOnly cookies |

---

## Prerequisites

- **Node.js 18+** — check with `node --version`
- **npm 9+** — check with `npm --version`
- **Claude Code installed** — sessions must exist at `~/.claude/projects/`
- A terminal and a browser

---

## Quick start (3 commands)

```bash
git clone https://github.com/Ar9av/agenttower && cd agenttower
echo "AUTH_PASSWORD=yourpassword" > .env.local
npm install && npm run dev
```

Open **http://localhost:3000** and sign in with the password you set.

---

## Configuration

All config via environment variables in `.env.local` (never committed — already in `.gitignore`).

| Variable | Required | Default | Description |
|---|---|---|---|
| `AUTH_PASSWORD` | **Yes** | — | Login password. Pick something strong. |
| `CLAUDE_DIR` | No | `~/.claude` | Claude Code config root (where `projects/` lives) |
| `SESSION_TTL_DAYS` | No | `7` | How long login cookies stay valid |
| `ACTIVE_THRESHOLD_SECS` | No | `300` | Sessions modified within this window are shown as "active" |

### Example `.env.local`

```env
AUTH_PASSWORD=my-secure-password
CLAUDE_DIR=/home/yourname/.claude
SESSION_TTL_DAYS=7
ACTIVE_THRESHOLD_SECS=300
```

---

## Running

### Development (hot reload)

```bash
npm run dev
# → http://localhost:3000
```

### Production (optimised build)

```bash
npm run build
npm start
# → http://localhost:3000
```

### Custom port

```bash
npm run dev -- --port 8484
# or
PORT=8484 npm start
```

---

## Project structure

```
agenttower/
├── app/
│   ├── api/
│   │   ├── auth/login/route.ts     POST — validate password, set cookie
│   │   ├── auth/logout/route.ts    POST — clear cookie
│   │   ├── projects/route.ts       GET  — list all projects
│   │   ├── sessions/route.ts       GET  — list sessions for a project
│   │   ├── session/route.ts        GET  — parse a single session JSONL
│   │   ├── tail/route.ts           GET  — SSE live tail stream
│   │   ├── search/route.ts         GET  — grep across all JSONL files
│   │   ├── run/route.ts            POST — spawn a new Claude session
│   │   ├── input/route.ts          POST — send input to a running session
│   │   ├── kill/route.ts           POST — SIGTERM a process
│   │   ├── pause/route.ts          POST — SIGSTOP a process
│   │   └── resume/route.ts         POST — SIGCONT a process
│   ├── login/page.tsx              Login page (glass card, ambient orbs)
│   ├── projects/page.tsx           Projects grid
│   ├── project/page.tsx            Session list for a project
│   ├── session/page.tsx            Full session reader
│   └── search/page.tsx             Global search
├── components/
│   ├── Nav.tsx                     Sticky glass nav bar
│   ├── MessageBlock.tsx            Renders user/assistant/tool/thinking blocks
│   ├── LiveSession.tsx             SSE client, auto-scroll, input form
│   └── ProcessControls.tsx         Kill/Pause/Resume with confirmation
├── lib/
│   ├── auth.ts                     PBKDF2 hashing, session tokens, rate limiting
│   ├── claude-fs.ts                JSONL parser, project discovery, search, SSE helpers
│   ├── process.ts                  Claude process scanning (reads ~/.claude/sessions/<pid>.json)
│   └── types.ts                    TypeScript types for all data shapes
├── .env.example                    Template — copy to .env.local and fill in
├── SETUP.md                        Step-by-step human setup guide
└── AGENTS.md                       Automated setup guide for AI agents
```

---

## How the data works

Claude Code writes session logs to `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. Each line is a JSON object representing one event (user message, assistant response, tool call, etc.).

AgentTower:
1. Walks `~/.claude/projects/` to discover projects and sessions
2. Parses JSONL files into typed `ParsedMessage` objects (cached by `path + mtime`)
3. Reads `~/.claude/sessions/<pid>.json` to find running Claude processes
4. Streams new JSONL lines via SSE by tracking file byte offsets

---

## Security

- Passwords are hashed with **PBKDF2-HMAC-SHA256** (260,000 iterations) + random salt on each server start. The plaintext password never lives past startup.
- **Exponential backoff** on failed logins: 2s → 4s → 8s → … capped at 1 hour per IP.
- **HttpOnly + SameSite=Strict** cookies — not accessible from JS, not sent cross-origin.
- All API routes validate the session cookie before doing anything.
- File paths are validated against `CLAUDE_DIR` before reading (no path traversal).
- Process signals validate that the target PID is owned by the current user and is a `claude` process before sending.

**For production / remote access:**
- Put behind HTTPS (Caddy or nginx + Let's Encrypt)
- Consider Tailscale or Cloudflare Access instead of exposing port 3000 to the internet
- Use a long random `AUTH_PASSWORD` (32+ chars)

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `AUTH_PASSWORD is not set` on startup | Create `.env.local` with `AUTH_PASSWORD=yourpassword` |
| No projects showing | Check that `~/.claude/projects/` exists and has `.jsonl` files |
| Live tail not updating | Check browser console for SSE errors; reload the session page |
| `EADDRINUSE` on port 3000 | Use `npm run dev -- --port 8484` |
| Process controls greyed out | The session's Claude process has already exited |
