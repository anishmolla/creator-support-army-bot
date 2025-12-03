#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "[CSA AI Judge] Starting..."
node src/bot.js
