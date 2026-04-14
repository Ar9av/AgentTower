# Setup Guide

Step-by-step instructions to get AgentTower running on your machine from scratch.

---

## Step 1 — Check prerequisites

Open a terminal and run:

```bash
node --version   # needs 18.0.0 or higher
npm --version    # needs 9.0.0 or higher
```

If Node.js is missing, install it from **https://nodejs.org** (choose the LTS version).

---

## Step 2 — Clone the repo

```bash
git clone https://github.com/Ar9av/agenttower
cd agenttower
```

---

## Step 3 — Set your password

Create a `.env.local` file with your chosen login password:

```bash
# Replace "yourpassword" with whatever you want
echo "AUTH_PASSWORD=yourpassword" > .env.local
```

Or copy the example and edit it:

```bash
cp .env.example .env.local
# Then open .env.local in any editor and set AUTH_PASSWORD
```

The only required field is `AUTH_PASSWORD`. Everything else has sensible defaults.

---

## Step 4 — Install dependencies

```bash
npm install
```

This takes 30–60 seconds the first time.

---

## Step 5 — Start the server

```bash
npm run dev
```

You should see:

```
▲ Next.js ready
✓ Ready in ~300ms
```

---

## Step 6 — Open AgentTower

Go to **http://localhost:3000** in your browser.

Sign in with the password you set in Step 3.

You'll land on the Projects page, which shows all your Claude Code sessions.

---

## Optional configuration

Edit `.env.local` to customise behaviour:

```env
AUTH_PASSWORD=yourpassword          # required — your login password
CLAUDE_DIR=~/.claude                # where Claude Code stores its data
SESSION_TTL_DAYS=7                  # how long login sessions last
ACTIVE_THRESHOLD_SECS=300           # sessions active within this many seconds show a live dot
```

---

## Running on a different port

```bash
npm run dev -- --port 8484
# → http://localhost:8484
```

---

## Production build (faster, no hot reload)

```bash
npm run build
npm start
```

Use this on a server or if you want to keep it running long-term.

---

## Keeping it running after closing the terminal

```bash
npm run build
nohup npm start > ~/agenttower.log 2>&1 &
echo "Running as PID $! — logs at ~/agenttower.log"
```

To stop it later:

```bash
pkill -f "next start"
```

---

## Remote access (running on a server)

1. SSH into your server
2. Follow steps 1–5 above
3. In another terminal, set up an SSH tunnel from your laptop:

```bash
ssh -L 3000:localhost:3000 user@your-server
```

4. Open **http://localhost:3000** on your laptop — it's tunnelled to the server.

For a permanent public URL, put AgentTower behind a reverse proxy (Caddy is simplest):

```
# Caddyfile
yourdomain.com {
  reverse_proxy localhost:3000
}
```

---

## Troubleshooting

**"AUTH_PASSWORD is not set"**
→ `.env.local` is missing or the variable name is wrong. Check spelling exactly: `AUTH_PASSWORD`.

**"EADDRINUSE: port 3000 already in use"**
→ Something else is on port 3000. Either stop it, or run `npm run dev -- --port 8484`.

**Projects page is empty**
→ Claude Code hasn't been run yet, or it stores its data in a non-default location. Check that `~/.claude/projects/` exists and contains `.jsonl` files.

**Can't log in even with the right password**
→ Open `.env.local` and make sure the value has no surrounding quotes or extra spaces:
```
AUTH_PASSWORD=mypassword     ✓ correct
AUTH_PASSWORD="mypassword"   ✗ wrong — quotes included in password
AUTH_PASSWORD= mypassword    ✗ wrong — leading space
```

**Live tail not updating**
→ Open browser DevTools → Network tab → look for the `/api/tail` request. If it shows an error, reload the page. SSE reconnects automatically but the page reload forces a fresh connection.
