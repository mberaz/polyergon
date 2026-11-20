#!/bin/zsh
# Test instance: separate code copy, port 3031, data in ~/.polyergon-dev.
# Prod (port 3030, ~/.claude-session-manager) is not touched.
cd "$(dirname "$0")"
PORT=3031 NEXT_PUBLIC_POLYERGON_ENV=dev POLYERGON_DATA_DIR="$HOME/.polyergon-dev" NODE_OPTIONS="--max-old-space-size=4096" \
  nohup npm run dev > /tmp/polyergon-dev.log 2>&1 &
echo "Polyergon DEV → http://localhost:3031 (log: /tmp/polyergon-dev.log)"
