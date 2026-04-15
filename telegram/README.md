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
| `/start` | Show help |
| `/sessions` | List recent Claude sessions with status |
| `/status` | Show currently running Claude processes |
| `/task <prompt>` | Start a new Claude session, stream output |
| `/task /path/to/project\n<prompt>` | Start session in a specific project directory |
| `/watch <session-id>` | Stream output from an existing session |
| `/kill <session-id>` | Send SIGTERM to a running session |
| `/pause <session-id>` | Send SIGSTOP (freeze) |
| `/resume <session-id>` | Send SIGCONT (unfreeze) and resume streaming |

Session IDs can be the first 8 characters of the full UUID.

## Sending messages

Any plain text message (not a command) is injected into the most recently active Claude session via `claude --resume`. If no session is running, it starts a new one.

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

## Security

- Set `ALLOWED_CHAT_ID` — the bot rejects all other chat IDs
- Without it, anyone who finds your bot can control your Claude sessions
- For teams: run behind a private Telegram group and validate group chat ID

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
