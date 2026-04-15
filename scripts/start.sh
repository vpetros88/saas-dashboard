#!/bin/bash
# Start the SaaS Dashboard (backend + frontend)

DASHBOARD_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$DASHBOARD_DIR/logs"

mkdir -p "$LOG_DIR"

echo "=== SaaS Dashboard ==="
echo "Starting backend  → http://localhost:3000"
echo "Starting frontend → http://localhost:5200"
echo "Logs: $LOG_DIR"
echo ""

# Start backend
node "$DASHBOARD_DIR/backend/server.js" \
  >> "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

# Wait briefly then start frontend
sleep 1

cd "$DASHBOARD_DIR/frontend"
npm run dev -- --port 5200 \
  >> "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo ""
echo "Dashboard running. To stop: bash $DASHBOARD_DIR/scripts/stop.sh"
