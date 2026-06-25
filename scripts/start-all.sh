#!/bin/bash

PROJECT_DIR="/Users/server/Projects_dashboard"

cd "$PROJECT_DIR/backend"
npm run dev > /tmp/dashboard-backend.log 2>&1 &

cd "$PROJECT_DIR/frontend"
npm run dev > /tmp/dashboard-frontend.log 2>&1 &

wait
