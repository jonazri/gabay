# Akiflow Sync
Always-on Akiflow sync daemon with Pusher WebSocket, SQLite local DB, and conflict resolution.

## Prerequisites
- skill/container-hardening

## Installation
1. `git fetch origin skill/akiflow-sync`
2. `git merge origin/skill/akiflow-sync`
3. `npm install`
4. `cd akiflow-sync && npm install`

## Verification
- `npm run build && npm test`
- `cd akiflow-sync && npm test`

## Environment Variables
- `AKIFLOW_REFRESH_TOKEN` — Akiflow API refresh token
- `AKIFLOW_DB_PATH` — Path to Akiflow SQLite database
