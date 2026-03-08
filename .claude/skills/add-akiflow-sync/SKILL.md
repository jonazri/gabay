---
name: add-akiflow-sync
description: Add the Akiflow sync daemon. Installs a standalone always-on service that syncs tasks, events, labels, and all other Akiflow entities to a local SQLite database via Pusher WebSocket. Agent reads from SQLite instead of calling the API on every invocation. Run after initial NanoClaw setup.
---

# add-akiflow-sync

Installs the Akiflow sync daemon and updates the agent skill to use local SQLite instead of the API.

## What this skill does

- Adds `akiflow-sync/` — standalone TypeScript daemon that syncs with Akiflow via Pusher WebSocket
- Updates `container/skills/akiflow/SKILL.md` — SQLite-backed agent skill (reads instant, writes queued)
- Modifies `src/container-runner.ts` — injects AKIFLOW_DB env var and mounts akiflow dir
- Modifies `container/Dockerfile` — adds sqlite3 CLI

## Setup steps after installing

1. Add to `.env`:
   ```
   AKIFLOW_REFRESH_TOKEN=<your-token>
   AKIFLOW_DB_PATH=./akiflow/akiflow.db
   ```
2. Run `npm run build` to apply the skill
3. Run `./akiflow-sync/install.sh` to install and start the systemd service
4. Verify: `sqlite3 akiflow/akiflow.db "SELECT count(*) FROM tasks"`

## Logs

```bash
tail -f akiflow/akiflow-sync.log
```

## Replaces

`add-akiflow` — incompatible, cannot be installed alongside.
