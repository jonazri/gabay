# Akiflow Sync Service — Design

**Date:** 2026-03-02
**Status:** Approved
**Replaces:** `add-akiflow` skill (curl-based, full fetch on every agent invocation)

---

## Problem

The current `add-akiflow` skill fetches the full task list from the Akiflow API on every agent invocation: ~2400 tasks across 3 paginated HTTP requests (~3s). There is no local cache, no real-time awareness of changes made in the Akiflow app, and no write queuing — writes go directly to the API from inside the container with full token access.

---

## Solution

A standalone always-on sync daemon that:
- Connects to Akiflow's Pusher WebSocket for real-time change notifications
- Maintains a local SQLite database of all Akiflow entities
- Processes outbound writes queued by the agent

The agent reads from SQLite (instant, no network) and queues writes via a `pending_writes` table. The daemon owns all API communication.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  NanoClaw Host (Linux)                                       │
│                                                              │
│  ┌─────────────────────────┐    ┌──────────────────────┐    │
│  │  akiflow-sync daemon    │    │  NanoClaw process    │    │
│  │  (standalone TS service)│    │  (WhatsApp, agents)  │    │
│  │                         │    └──────────────────────┘    │
│  │  • Pusher WebSocket     │                                 │
│  │  • V5 sync engine       │    ┌──────────────────────┐    │
│  │  • V3 sync engine       │    │  Agent container     │    │
│  │  • Pending write poller │    │                      │    │
│  │                         │    │  • akiflow:* fns     │    │
│  └──────────┬──────────────┘    │    (bash + sqlite3)  │    │
│             │ read/write        │                      │    │
│             ▼                   └──────────┬───────────┘    │
│  ┌──────────────────────┐                  │                 │
│  │  akiflow/akiflow.db  │◄─── bind mount ──┘                │
│  │  (SQLite, WAL mode)  │                                    │
│  └──────────────────────┘                                    │
└──────────────────────────────────────────────────────────────┘
                    │ Pusher WS + HTTPS
                    ▼
         Akiflow API / web.akiflow.com
```

**Key properties:**
- Daemon is the sole writer to entity tables; agent only writes to `pending_writes` and optimistic entity rows
- SQLite WAL mode allows concurrent reads without blocking the daemon's writes
- No token management inside the container — the daemon owns all credentials
- Agent interface is identical to the current skill (same function names, same JSON output)

---

## Components

### `akiflow-sync` daemon

Standalone Node.js/TypeScript service, managed by systemd alongside NanoClaw.

```
akiflow-sync/
  src/
    daemon.ts       ← entry point: wires together all modules
    auth.ts         ← token refresh, Pusher channel auth
    sync/
      v5.ts         ← V5 entity sync (sync_token pattern)
      v3.ts         ← V3 legacy sync (updatedAfter pattern)
    db.ts           ← schema init, upsert helpers
    conflict.ts     ← LWW conflict resolution
    pending.ts      ← pending writes processor
  package.json
  tsconfig.json
  akiflow-sync.service
```

### `akiflow.db` (SQLite)

Lives in the project folder: `./akiflow/akiflow.db` (relative to project root, configured via `AKIFLOW_DB_PATH` in `.env`). Bind-mounted into agent containers at the same absolute path.

### Agent skill

Updated `akiflow` container skill — same `akiflow:*` bash function interface, backed by SQLite queries instead of API calls. `sqlite3` added to the container Dockerfile.

---

## SQLite Schema

```sql
-- Entity tables (identical structure for all entities)
-- V5: tasks, labels, tags, time_slots, calendars, accounts, settings
-- V3: events, event_modifiers
CREATE TABLE tasks (
  id                TEXT PRIMARY KEY,
  data              TEXT NOT NULL,       -- full JSON blob from API
  updated_at        INTEGER,             -- local epoch ms
  global_updated_at INTEGER,             -- server-confirmed epoch ms (LWW anchor)
  deleted_at        INTEGER,             -- null if active
  synced_at         INTEGER              -- when last written from API
);

-- Sync state
CREATE TABLE sync_tokens (
  entity      TEXT PRIMARY KEY,          -- 'tasks', 'labels', etc.
  token       TEXT NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE v3_sync_state (
  entity      TEXT PRIMARY KEY,          -- 'events', 'event_modifiers'
  last_sync_at INTEGER NOT NULL          -- epoch ms, used as updatedAfter
);

-- Outbound write queue
CREATE TABLE pending_writes (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  entity       TEXT NOT NULL,            -- 'tasks', 'events', etc.
  method       TEXT NOT NULL,            -- 'PATCH', 'POST'
  payload      TEXT NOT NULL,            -- JSON
  status       TEXT DEFAULT 'pending',   -- 'pending'|'processing'|'done'|'failed'
  retry_count  INTEGER DEFAULT 0,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  processed_at INTEGER
);

-- Indexes for common agent queries
CREATE INDEX idx_tasks_status   ON tasks(json_extract(data,'$.status'));
CREATE INDEX idx_tasks_date     ON tasks(json_extract(data,'$.date'));
CREATE INDEX idx_tasks_done     ON tasks(json_extract(data,'$.done'));
CREATE INDEX idx_events_start   ON events(json_extract(data,'$.start'));
CREATE INDEX idx_pending_status ON pending_writes(status, created_at);
```

The `data` column stores the raw API JSON verbatim. No field mapping, no camelCase conversion. New API fields are automatically preserved without schema changes.

---

## Sync Flow

### Startup

1. Load `AKIFLOW_REFRESH_TOKEN` from `.env`, exchange for access token via `POST /oauth/refreshToken`
2. `GET https://web.akiflow.com/user/me` → get `userId`
3. Connect Pusher (app key `4fa6328da6969ef162ec`, cluster `eu`)
4. Authenticate channel subscription: `POST https://web.akiflow.com/api/pusherAuth` with `{channel_name, socket_id}` + Bearer token
5. Subscribe to `private-user.{userId}`
6. For each V5 entity: load stored `sync_token` from DB → full sync if absent, incremental if present
7. For V3 entities: load `last_sync_at` → full sync if absent, `updatedAfter` fetch if present

### Pusher-triggered incremental sync

Mirrors `handleUserDataUpdated` from the Akiflow source exactly:

```
connector-updated fires
  └─ payload.syncEntities[]?
       ├─ present → sync only those entities
       └─ absent  → sync all entities
```

Other bound events: `user-update`, `account-connected`, `account-disconnected` (trigger full re-sync).

### V5 entity sync loop

Mirrors `getRemoteEntities`:

```
GET /v5/{entity}?limit=2500&sync_token={token}
  → apply conflict resolution to each returned item
  → upsert into SQLite
  → save new sync_token
  → if has_next_page → repeat with updated token
```

### V3 events sync

Mirrors legacy sync:

```
GET /v3/events?per_page=2500&with_deleted=true&updatedAfter={ISO}
  → upsert into SQLite
  → save max(updated_at) as new last_sync_at
  → if next_page_url → follow cursor
```

### Token refresh

Access tokens expire in 30 minutes. On any 401, refresh via `POST /oauth/refreshToken` and retry. If the response includes a new refresh token, write it back to `.env`.

---

## Conflict Resolution

Mirrors the Akiflow source (`CommonSyncHelper` + `TasksSync`) exactly.

### Entity-level LWW (all entities)

```
incoming remote entity:
  local = SELECT FROM {table} WHERE id = remote.id

  if no local row → insert, done

  if remote.global_updated_at > local.global_updated_at:
    → remote wins → overwrite local
  else:
    → local wins → keep local (pending_write will push it to server)
```

### Field-level LWW for tasks

Even when remote wins globally, two fields use their own timestamps:

| Field | Remote timestamp | Local timestamp | Winner |
|-------|-----------------|-----------------|--------|
| `list_id` + `section_id` | `global_list_id_updated_at` | `list_id_updated_at` | newer wins |
| `tags_ids` | `global_tags_ids_updated_at` | `tags_ids_updated_at` | newer wins |

These per-field timestamps are present in the API response — no extra calls needed.

### PATCH response handling

When the daemon processes a pending write and receives the server's canonical response, it re-runs conflict resolution on the returned entity. Matches Akiflow's source behaviour exactly.

### Failed writes

5 retries with exponential backoff (matching Akiflow's event modifier retry limit). After 5 failures, the write is marked `failed` and the local optimistic state is preserved — consistent with how Akiflow itself handles write failures.

---

## Pending Writes / Write Path

### Agent-side

Each write does two things in a single SQLite transaction:
1. Optimistic local update — write new state into entity table with `updated_at = now()`
2. Queue API call — insert row into `pending_writes`

```bash
akiflow:create-task() {
  local json="$1"
  local id now_ms payload

  id=$(node -e "process.stdout.write(crypto.randomUUID())")
  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" --argjson ts "$now_ms" \
    '. + {id: $id, status: 1, done: false, updated_at: $ts}')

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id', json('$payload'), $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$payload'), $now_ms);
    COMMIT;"
}
```

### Daemon-side

Polls `pending_writes WHERE status='pending'` every 100ms. Batches writes for the same entity within a 50ms window into a single PATCH array (max 100 per request, matching Akiflow's batch size).

```
pick up pending rows → mark 'processing'
  → batch by entity, call API
  → success:
      run conflict resolution on returned entities
      upsert into SQLite
      mark pending_writes 'done'
  → retryable failure:
      increment retry_count
      retry_count < 5 → back to 'pending' (exponential backoff)
      retry_count >= 5 → mark 'failed', log error
```

---

## Agent CLI Interface

All existing `akiflow:*` function names preserved. Reads are now instant SQLite queries; writes queue via `pending_writes`.

**Read examples:**

```bash
akiflow:list-inbox() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.status') = 1
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL" \
  | jq '[.[].data | fromjson]'
}

akiflow:list-today() {
  local today=$(date +%Y-%m-%d)
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.date') = '$today'
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL"
}
```

**New: `akiflow:sync-status`**

```bash
akiflow:sync-status() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT entity, token IS NOT NULL as synced, updated_at FROM sync_tokens;
    SELECT count(*) as pending FROM pending_writes WHERE status='pending';
    SELECT count(*) as failed  FROM pending_writes WHERE status='failed';"
}
```

**`AKIFLOW_DB` env var:** injected into containers by `container-runner.ts`, resolved from `AKIFLOW_DB_PATH` in `.env`.

---

## Packaging

Replaces `add-akiflow` in `.nanoclaw/installed-skills.yaml` with `add-akiflow-sync`.

### Skill layout

```
.claude/skills/add-akiflow-sync/
  manifest.yaml
  SKILL.md
  add/
    akiflow-sync/          ← standalone service (new directory in project root)
      src/...
      package.json
      tsconfig.json
      akiflow-sync.service
    container/skills/akiflow/
      SKILL.md             ← updated agent skill (SQLite-backed)
  modify/
    src/container-runner.ts   ← AKIFLOW_DB env var + bind mount
    container/Dockerfile      ← adds sqlite3
```

### Systemd unit

```ini
[Unit]
Description=Akiflow Sync Daemon
After=network.target

[Service]
WorkingDirectory=%h/code/yonibot/gabay
EnvironmentFile=%h/code/yonibot/gabay/.env
ExecStart=/usr/bin/node akiflow-sync/dist/daemon.ts
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

### `.env` additions

```bash
AKIFLOW_REFRESH_TOKEN=...   # already present from add-akiflow
AKIFLOW_DB_PATH=./akiflow/akiflow.db
```

---

## What Changes for the Agent

The agent skill's public interface is unchanged. Internally:

| Before | After |
|--------|-------|
| `curl` to Akiflow API on every call | `sqlite3` query, instant |
| Token management in container | No credentials in container |
| 3 HTTP requests, ~3s for task list | Single SQLite query, <50ms |
| Full fetch even for one task | Indexed lookup |
| Writes go directly to API | Writes queue via `pending_writes` |
| No real-time awareness | Pusher-driven, always current |
