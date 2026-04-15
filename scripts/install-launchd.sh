#!/bin/bash
set -e

# Install the SaaS Dashboard backend as a launchd service (auto-start on login)

DASHBOARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_LAUNCHAGENTS="$HOME/Library/LaunchAgents"
PLIST_SRC="$DASHBOARD_DIR/config/launchd/com.saasdashboard.backend.plist"
PLIST_DEST="$HOME_LAUNCHAGENTS/com.saasdashboard.backend.plist"

# Detect node path
NODE_PATH=$(which node)
if [ -z "$NODE_PATH" ]; then
  echo "ERROR: node not found in PATH. Install Node.js first."
  exit 1
fi

mkdir -p "$HOME_LAUNCHAGENTS"
mkdir -p "$DASHBOARD_DIR/logs"

# Unload if already installed
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Write plist with real paths
sed \
  -e "s|{DASHBOARD_PATH}|$DASHBOARD_DIR|g" \
  -e "s|{HOME_PATH}|$HOME|g" \
  -e "s|/usr/local/bin/node|$NODE_PATH|g" \
  "$PLIST_SRC" > "$PLIST_DEST"

launchctl load "$PLIST_DEST"

echo "✓ com.saasdashboard.backend installed and started"
echo "  Dashboard: http://localhost:5200  (open frontend manually with: bash scripts/start.sh)"
echo "  Backend API: http://localhost:3000"
echo "  Logs: $DASHBOARD_DIR/logs/backend.log"
echo ""
echo "To uninstall: launchctl unload $PLIST_DEST && rm $PLIST_DEST"
