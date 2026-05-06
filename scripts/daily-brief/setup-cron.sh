#!/usr/bin/env bash
# Sets up cron jobs for the daily brief on St3ve.
# Run once after configuring .env:  bash setup-cron.sh

set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ ! -f "$SCRIPT_DIR/.env" ]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill in values."
  exit 1
fi

source "$SCRIPT_DIR/.env"

# Read schedule from AgentTower config
MORNING_TIME="${MORNING_TIME:-08:00}"
EVENING_TIME="${EVENING_TIME:-20:00}"

morning_hour=$(echo "$MORNING_TIME" | cut -d: -f1 | sed 's/^0//')
morning_min=$(echo "$MORNING_TIME"  | cut -d: -f2 | sed 's/^0//')
evening_hour=$(echo "$EVENING_TIME" | cut -d: -f1 | sed 's/^0//')
evening_min=$(echo "$EVENING_TIME"  | cut -d: -f2 | sed 's/^0//')

# Validate
[[ "$morning_hour" =~ ^[0-9]+$ ]] || { echo "Bad MORNING_TIME"; exit 1; }
[[ "$evening_hour" =~ ^[0-9]+$ ]] || { echo "Bad EVENING_TIME"; exit 1; }

LOGDIR="$SCRIPT_DIR/logs"
mkdir -p "$LOGDIR"

# Build cron entries
MORNING_CRON="${morning_min} ${morning_hour} * * * cd $SCRIPT_DIR && node morning-brief.mjs >> $LOGDIR/morning.log 2>&1"
EVENING_CRON="${evening_min} ${evening_hour} * * * cd $SCRIPT_DIR && node evening-brief.mjs >> $LOGDIR/evening.log 2>&1"

# Remove old daily-brief entries and add new ones
TMPFILE=$(mktemp)
crontab -l 2>/dev/null | grep -v "daily-brief\|morning-brief\|evening-brief" > "$TMPFILE" || true
echo "# daily-brief morning" >> "$TMPFILE"
echo "$MORNING_CRON" >> "$TMPFILE"
echo "# daily-brief evening" >> "$TMPFILE"
echo "$EVENING_CRON" >> "$TMPFILE"
crontab "$TMPFILE"
rm "$TMPFILE"

echo "Cron jobs installed:"
echo "  Morning: ${morning_min}:${morning_hour} → morning-brief.mjs"
echo "  Evening: ${evening_min}:${evening_hour} → evening-brief.mjs"
echo ""
echo "Start the approval bot (keep running):"
echo "  cd $SCRIPT_DIR && node daily-bot.mjs"
echo "  Or with pm2: pm2 start daily-bot.mjs --name daily-brief-bot"
