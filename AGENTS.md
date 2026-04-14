# AGENTS.md — Automated setup guide for AI agents

This file is written for AI agents (Claude, Cursor, Copilot, etc.) that need to install and start AgentTower on a user's machine with minimal back-and-forth.

---

## What you need from the user

Before running any commands, ask the user:

> "What password would you like to use to log in to AgentTower?"

Store their answer as `<PASSWORD>`. That's the only thing you need from them. Everything else is automatic.

---

## Setup script (run in order, stop on any error)

```bash
# 1. Clone the repo
git clone https://github.com/Ar9av/agenttower
cd agenttower

# 2. Write the env file with the user's chosen password
#    Replace <PASSWORD> with what the user told you
cat > .env.local << EOF
AUTH_PASSWORD=<PASSWORD>
CLAUDE_DIR=~/.claude
SESSION_TTL_DAYS=7
ACTIVE_THRESHOLD_SECS=300
EOF

# 3. Install dependencies
npm install

# 4. Start the dev server in background
npm run dev &

# 5. Wait for ready signal (server starts in ~300ms but give it a moment)
sleep 5

# 6. Open in browser
open http://localhost:3000        # macOS
# xdg-open http://localhost:3000  # Linux
# start http://localhost:3000     # Windows Git Bash
```

After step 6, tell the user:

> "AgentTower is running at http://localhost:3000 — sign in with the password you gave me."

---

## Platform detection

```bash
OS=$(uname -s)
if [ "$OS" = "Darwin" ]; then
  OPEN_CMD="open"
elif [ "$OS" = "Linux" ]; then
  OPEN_CMD="xdg-open"
else
  OPEN_CMD="start"
fi
```

---

## Prerequisites check

Run these before the setup script. Tell the user what to install if anything is missing.

```bash
# Node.js 18+
node --version || echo "MISSING: Install Node.js from https://nodejs.org"

# npm 9+
npm --version || echo "MISSING: npm not found"

# Claude Code (optional — but needed for session data to appear)
claude --version || echo "NOTE: Claude Code not found. Sessions will be empty until installed."

# ~/.claude/projects/ should exist (Claude must have been run at least once)
ls ~/.claude/projects/ 2>/dev/null || echo "NOTE: No Claude sessions found. Run Claude Code first."
```

---

## Production mode (persistent, survives terminal close)

For a server or remote machine, build and run in the background:

```bash
npm run build
nohup npm start > agenttower.log 2>&1 &
echo "PID: $!"
echo "Logs: tail -f agenttower.log"
```

---

## Stopping the server

```bash
pkill -f "next dev"    # development
pkill -f "next start"  # production
```

---

## Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `AUTH_PASSWORD` | **Yes** | — | The password the user chose |
| `CLAUDE_DIR` | No | `~/.claude` | Only change if Claude config is in a non-default location |
| `SESSION_TTL_DAYS` | No | `7` | Cookie lifetime in days |
| `ACTIVE_THRESHOLD_SECS` | No | `300` | Recency window for "active" sessions |

---

## Verifying the server is healthy

```bash
# Should return 307 (redirect to /login)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/

# Should return 401 (auth required — proves API is live)
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/projects
```

---

## Common errors and fixes

| Error | Fix |
|---|---|
| `Error: AUTH_PASSWORD is not set` | `.env.local` is missing — re-run step 2 |
| `EADDRINUSE :::3000` | Run `pkill -f "next"` then retry, or use `npm run dev -- --port 8484` |
| `npm: command not found` | Install Node.js from https://nodejs.org |
| Page loads but shows no projects | Claude Code has never been run, or `CLAUDE_DIR` points to wrong location |
| Can't log in | Check `.env.local` — no extra spaces, quotes, or newlines around the password value |

---

## Full one-liner (macOS/Linux)

Replace `MYPASSWORD` with the user's chosen password:

```bash
git clone https://github.com/Ar9av/agenttower && cd agenttower && printf "AUTH_PASSWORD=MYPASSWORD\n" > .env.local && npm install && npm run dev &
sleep 5 && open http://localhost:3000
```
