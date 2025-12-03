#!/usr/bin/env bash

# Move to project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.." || exit 1

# Load .env if exists
if [ -f ".env" ]; then
  export $(grep -v '^#' .env | xargs)
fi

echo "[CSA] Starting Agreement Board Bot..."
node src/bot.js
