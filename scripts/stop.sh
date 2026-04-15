#!/bin/bash
# Stop the SaaS Dashboard (backend + frontend)

echo "Stopping SaaS Dashboard..."

pkill -f "node.*Projects_dashboard/backend/server.js" 2>/dev/null || true
pkill -f "vite.*5200" 2>/dev/null || true

sleep 1

# Force-kill if still alive
if lsof -ti :3000 > /dev/null 2>&1; then
  kill -9 $(lsof -ti :3000) 2>/dev/null || true
fi
if lsof -ti :5200 > /dev/null 2>&1; then
  kill -9 $(lsof -ti :5200) 2>/dev/null || true
fi

echo "Done."
