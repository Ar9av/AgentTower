# AgentTower — Telegram Bot

Control your Claude Code sessions from Telegram. Start tasks, stream responses, inject messages, kill/pause/resume — all via chat.

## Setup

### 1. Create a bot

Message [@BotFather](https://t.me/BotFather) on Telegram:

```
/newbot
```

Copy the `BOT_TOKEN` it gives you.

### 2. Get your chat ID

Message [@userinfobot](https://t.me/userinfobot) — it replies with your numeric chat ID.

### 3. Configure

```bash
cp telegram/.env.example telegram/.env
# Edit telegram/.env — set BOT_TOKEN and ALLOWED_CHAT_ID
```

### 4. Run

```bash
# From the agenttower project root:
npx ts-node telegram/bot.ts
```

Or with environment variables inline:

```bash
BOT_TOKEN=xxx ALLOWED_CHAT_ID=yyy npx ts-node telegram/bot.ts
```

## Commands

| Command | Description |
|---|---|
| `/start`, `/help` | Show help |
| `/sessions` | List recent sessions with inline buttons (Kill/Pause/Resume/Watch/Logs/Diff) |
| `/status` | Show running Claude processes with controls |
| `/task <prompt>` | Start a new session with `--dangerously-skip-permissions` |
| `/safetask <prompt>` | Start a session with default permissions (prompts on tool use) |
| `/plan <prompt>` | Start in plan mode (read-only investigation) |
| `/task /abs/path\n<prompt>` | Override project dir for this task |
| `/watch <id>` | Stream output from an existing session |
| `/kill <id>` | SIGTERM a running session |
| `/pause <id>` | SIGSTOP (freeze) |
| `/resume <id>` | SIGCONT (unfreeze) and resume streaming |
| `/logs <id> [n]` | Last n messages from a session (default 5, max 20) |
| `/diff <id>` | `git diff HEAD` in the session's cwd; full patch attached as a file |
| `/cd <path>` | Set your default project dir (persisted per chat) |
| `/pwd` | Show your current default |
| `/whoami` | Show your chat id |

Session IDs can be the first 8 characters of the full UUID.
Every session message has inline buttons — you rarely need to type IDs by hand.

## Sending messages & files

- **Plain text** → injected into the most recently running session (or starts a new one).
- **Reply to a bot message** → same as plain text.
- **Upload a file/photo** → stashed as an attachment; your next text message will be prefixed with a reference to the file path so Claude can `Read` it.
  - Send a caption with the file to use it immediately in one step.
- **Voice message** → transcribed via OpenAI Whisper (if `OPENAI_API_KEY` is set) and injected as a prompt.

## How streaming works

```
You: /task refactor the auth module

Bot: ⏳ Waiting for Claude...
     [edits same message as Claude writes]
Bot: Looking at the current auth code...
     ⚙ `Read` (lib/auth.ts)
     ⚙ `Edit` (lib/auth.ts)
     Done! I've refactored the auth module. Here's what changed...

Bot: ✅ Session complete
     Reply to continue, or /sessions to see all sessions.
```

- Claude's responses are streamed by polling the JSONL file every 1s
- The bot edits a single Telegram message to simulate streaming (≤1 edit/1.5s to respect rate limits)
- Tool calls are shown inline: `⚙ \`ToolName\``
- Errors are shown with `✗`
- Thinking blocks shown as italicised preview

## Security & ops

- `ALLOWED_CHAT_IDS=111,222,333` — comma-separated allowlist. `ALLOWED_CHAT_ID` (singular) still works for backward compatibility.
- Without an allowlist set, the bot accepts anyone who messages it (dev only).
- **Rate limiting:** 20 commands/min per chat, buttons included.
- **Audit log:** every message, button press, and denied request is appended to `~/.claude/agenttower-audit.jsonl`.
- **Notifications:** when a session finishes while you're not watching, the bot pings all allowed chats.
- **Safer mode:** prefer `/safetask` or `/plan` over `/task` for any prompt involving destructive tools — `/task` uses `--dangerously-skip-permissions`.

## Environment variables

| Variable | Purpose |
|---|---|
| `BOT_TOKEN` | Required. From @BotFather. |
| `ALLOWED_CHAT_IDS` | Comma-separated numeric chat IDs. |
| `OPENAI_API_KEY` | Optional. Enables voice message transcription via Whisper. |
| `PROJECTS_DIR` | Default cwd for new sessions (overridden per-user by `/cd`). |
| `CLAUDE_DIR` | Override `~/.claude`. |

State is persisted to `~/.claude/agenttower-bot.json` (user defaults) and `~/.claude/agenttower-audit.jsonl` (audit log).

## Running as a service

**macOS (launchd):**

```bash
cat > ~/Library/LaunchAgents/com.agenttower.telegram.plist << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.agenttower.telegram</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>npx</string>
    <string>ts-node</string>
    <string>/path/to/agenttower/telegram/bot.ts</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>BOT_TOKEN</key><string>YOUR_TOKEN</string>
    <key>ALLOWED_CHAT_ID</key><string>YOUR_CHAT_ID</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
launchctl load ~/Library/LaunchAgents/com.agenttower.telegram.plist
```

**Linux (systemd):**

```ini
# ~/.config/systemd/user/agenttower-telegram.service
[Unit]
Description=AgentTower Telegram Bot

[Service]
ExecStart=npx ts-node /path/to/agenttower/telegram/bot.ts
EnvironmentFile=/path/to/agenttower/telegram/.env
Restart=on-failure

[Install]
WantedBy=default.target
```

```bash
systemctl --user enable --now agenttower-telegram
```
