#!/usr/bin/env python3
"""
Claude Code Stop hook — sends a Telegram notification when a session ends.
Registered in ~/.claude/settings.json under hooks.Stop.
Receives session JSON on stdin from Claude Code.
"""
import json, os, sys, urllib.request

# ── Read session info from Claude Code ────────────────────────────────────────
try:
    session = json.load(sys.stdin)
except Exception:
    session = {}

session_id = (session.get('session_id') or '')[:8]
cwd        = session.get('cwd') or ''
project    = os.path.basename(cwd) if cwd else ''

# ── Load config (telegram/.env wins, then integrations config) ────────────────
script_dir = os.path.dirname(os.path.abspath(__file__))

config: dict = {}
env_file = os.path.join(script_dir, '.env')
if os.path.exists(env_file):
    for line in open(env_file):
        line = line.strip()
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            config[k.strip()] = v.strip()

bot_token = (
    os.environ.get('BOT_TOKEN') or
    config.get('BOT_TOKEN', '')
)
chat_ids_str = (
    os.environ.get('ALLOWED_CHAT_IDS') or
    os.environ.get('ALLOWED_CHAT_ID') or
    config.get('ALLOWED_CHAT_IDS') or
    config.get('ALLOWED_CHAT_ID', '')
)

# Fall back to ~/.claude/agenttower-integrations.json
if not chat_ids_str:
    try:
        path = os.path.expanduser('~/.claude/agenttower-integrations.json')
        with open(path) as f:
            integrations = json.load(f)
        ids = integrations.get('telegram', {}).get('allowedChatIds', [])
        chat_ids_str = ','.join(str(i) for i in ids)
    except Exception:
        pass

if not bot_token or not chat_ids_str:
    sys.exit(0)

chat_ids = [c.strip() for c in chat_ids_str.split(',') if c.strip()]

# ── Build message ─────────────────────────────────────────────────────────────
lines = ['✅ <b>Session complete</b>']
if project:
    line = f'📁 <code>{project}</code>'
    if session_id:
        line += f'  <code>{session_id}</code>'
    lines.append(line)
elif session_id:
    lines.append(f'<code>{session_id}</code>')

message = '\n'.join(lines)

# ── Send to all allowed chats ─────────────────────────────────────────────────
for chat_id in chat_ids:
    try:
        data = json.dumps({
            'chat_id': chat_id,
            'text': message,
            'parse_mode': 'HTML',
        }).encode()
        req = urllib.request.Request(
            f'https://api.telegram.org/bot{bot_token}/sendMessage',
            data=data,
            headers={'Content-Type': 'application/json'},
        )
        urllib.request.urlopen(req, timeout=5)
    except Exception:
        pass
