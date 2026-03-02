---
name: akiflow
description: Manage your Akiflow tasks, projects, calendar events, and time slots. Use for creating tasks, scheduling, reviewing inbox, checking your calendar, completing items, and managing your someday list.
allowed-tools: Bash(akiflow:*)
---

# Akiflow

Full task and calendar management via a local SQLite database kept in sync by the akiflow-sync daemon.

## When to Use

- User wants to add, view, update, complete, or delete tasks
- User wants to check today's schedule, upcoming events, or inbox
- User wants to plan a task for a specific date or assign it to a project/tag
- User wants to create or manage calendar events
- User wants to review or move items on their someday list

## Core Concepts

| Concept | Notes |
|---|---|
| **Inbox** (status 1) | New unscheduled tasks. Default for newly created tasks. |
| **Planned** (status 2) | Has a `date` assigned. With `date` only → appears as a to-do. With `date` + `datetime` → appears on calendar. |
| **Completed** (status 3) | Done. Set `done: true`, `done_at: <epoch ms>`, `status: 3`. |
| **Snoozed** (status 4) | Temporarily hidden. |
| **Archived** (status 5) | Archived. |
| **Deleted** (status 6) | Soft-deleted. |
| **Someday** (status 7) | "Maybe later" — no date, no active pressure. |
| **Hidden** (status 8) | Hidden from view. |
| **Permanently Deleted** (status 9) | Removed permanently. |
| **Trashed** (status 10) | In trash. |
| **Cancelled** (status 11) | Cancelled. |
| **Labels** | Both **projects** (`is_tag: false`) and **tags** (`is_tag: true`). `label_id` = primary project, `tags_ids` = array of tag UUIDs. |
| **Time Slots** | Calendar containers for activity types (e.g., "Deep Work", "Admin"). Hold tasks, not events. Tasks reference them via `time_slot_id`. |
| **Events** | Calendar events (meetings, appointments) from connected Google/Outlook accounts. |

**Always call `akiflow:list-labels` first** if you need to assign a project or tag — you need the UUID.
**Always call `akiflow:list-calendars` first** if you need to create an event — you need the `calendarId`.

The `AKIFLOW_DB` environment variable points to the local SQLite database maintained by the akiflow-sync daemon. Reads are instant; writes are queued via `pending_writes` and synced to the server automatically.

## Tasks

### List all active tasks
```bash
akiflow:list-all() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL
      AND json_extract(data,'$.status') IN (1,2,4,7)" \
    | jq '[.[].data | fromjson]'
}
```

### List inbox tasks (unscheduled)
```bash
akiflow:list-inbox() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.status') = 1
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL
    ORDER BY json_extract(data,'$.sorting') ASC" \
    | jq '[.[].data | fromjson]'
}
```

### List today's tasks
```bash
akiflow:list-today() {
  local today
  today=$(date +%Y-%m-%d | sed "s/'/''/g")
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.date') = '$today'
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL" \
    | jq '[.[].data | fromjson]'
}
```

### List upcoming tasks
```bash
akiflow:list-upcoming() {
  local days="${1:-7}"
  if ! [[ "$days" =~ ^[0-9]+$ ]] || (( days < 1 || days > 365 )); then
    echo "akiflow: days must be a number between 1 and 365" >&2; return 1
  fi
  local end_date today
  end_date=$(date -d "+${days} days" +%Y-%m-%d 2>/dev/null || date -v+${days}d +%Y-%m-%d | sed "s/'/''/g")
  today=$(date +%Y-%m-%d | sed "s/'/''/g")
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL
      AND json_extract(data,'$.date') >= '$today'
      AND json_extract(data,'$.date') <= '$end_date'" \
    | jq '[.[].data | fromjson]'
}
```

### List someday tasks
```bash
akiflow:list-someday() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.status') = 7
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL" \
    | jq '[.[].data | fromjson]'
}
```

### Search tasks by title (case-insensitive substring)
```bash
akiflow:search-tasks() {
  local query="$1"
  local escaped_query
  escaped_query=$(echo "$query" | tr '[:upper:]' '[:lower:]' | sed "s/'/''/g")
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE lower(json_extract(data,'$.title')) LIKE '%${escaped_query}%'
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL" \
    | jq '[.[].data | fromjson]'
}
```

### Create a task

Pass a JSON object. Required: `title`. Optional fields:

| Field | Type | Notes |
|---|---|---|
| `status` | number | Default 1 (INBOX). Use 2 (PLANNED) with a `date`. |
| `date` | string | ISO date: `"2026-03-05"` |
| `datetime` | number | Epoch ms for specific time |
| `duration` | number | Minutes |
| `priority` | number | 0=none, 1=low, 2=medium, 3=high, 4=goal |
| `label_id` | string | Primary project UUID |
| `tags_ids` | string[] | Additional tag UUIDs |
| `description` | string | Rich text notes |
| `origin_url` | string | Link to source (email, web page, etc.) |

```bash
akiflow:create-task() {
  local json="$1"
  local id now_ms payload escaped

  id=$(node -e "process.stdout.write(require('crypto').randomUUID())")
  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" --argjson ts "$now_ms" \
    '. + {id: $id, done: false, updated_at: $ts} | if .status == null then . + {status: 1} else . end')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id', json('$escaped'), $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$escaped'), $now_ms);
    COMMIT;"

  echo "$payload"
}
```

**Examples:**
```bash
# Quick inbox capture
akiflow:create-task '{"title": "Buy groceries"}'

# Planned for a date with priority and project
akiflow:create-task '{"title": "Review PR", "date": "2026-03-03", "status": 2, "priority": 2, "label_id": "project-uuid"}'
```

### Update a task

Pass the task UUID and a partial JSON object with only the fields to change.

```bash
akiflow:update-task() {
  local id="$1"
  local patch="$2"
  local now_ms payload escaped

  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi

  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$patch" | jq --arg id "$id" --argjson ts "$now_ms" '. + {id: $id, updated_at: $ts}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id',
        json(json_patch(
          COALESCE((SELECT data FROM tasks WHERE id = '$id'), '{}'),
          '$escaped'
        )),
        $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$escaped'), $now_ms);
    COMMIT;"

  sqlite3 -json "$AKIFLOW_DB" "SELECT data FROM tasks WHERE id = '$id'" \
    | jq '.[0].data | fromjson'
}
```

**Examples:**
```bash
# Reschedule to a date
akiflow:update-task "task-uuid" '{"date": "2026-03-05", "status": 2}'

# Set high priority
akiflow:update-task "task-uuid" '{"priority": 3}'

# Move to someday
akiflow:update-task "task-uuid" '{"status": 7, "date": null, "datetime": null}'
```

### Complete a task
```bash
akiflow:complete-task() {
  local id="$1"
  local now_ms escaped_payload
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  escaped_payload="{\"id\":\"$id\",\"done\":true,\"done_at\":$now_ms,\"status\":3,\"updated_at\":$now_ms}"
  local escaped
  escaped=$(echo "$escaped_payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id',
        json(json_patch(
          COALESCE((SELECT data FROM tasks WHERE id = '$id'), '{}'),
          '$escaped'
        )),
        $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$escaped'), $now_ms);
    COMMIT;"
}
```

### Delete a task (soft delete)
```bash
akiflow:delete-task() {
  local id="$1"
  local now_ms escaped_payload escaped
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  escaped_payload="{\"id\":\"$id\",\"status\":6,\"deleted_at\":$now_ms,\"updated_at\":$now_ms}"
  escaped=$(echo "$escaped_payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id',
        json(json_patch(
          COALESCE((SELECT data FROM tasks WHERE id = '$id'), '{}'),
          '$escaped'
        )),
        $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$escaped'), $now_ms);
    COMMIT;"
}
```

## Labels (Projects & Tags)

### List all labels
```bash
akiflow:list-labels() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM labels
    WHERE json_extract(data,'$.deleted_at') IS NULL
    ORDER BY json_extract(data,'$.sorting') ASC" \
    | jq '[.[].data | fromjson]'
}
```

Response fields: `id`, `name`, `color` (hex), `is_tag` (false=project, true=tag), `folder_id` (optional folder grouping).

## Calendars & Events

### List calendars
```bash
akiflow:list-calendars() {
  sqlite3 -json "$AKIFLOW_DB" "SELECT data FROM calendars WHERE json_extract(data,'$.deleted_at') IS NULL" \
    | jq '[.[].data | fromjson]'
}
```

### List events in a date range
```bash
akiflow:list-events() {
  local start="$1"  # ISO date: 2026-03-01
  local end="$2"    # ISO date: 2026-03-07
  if ! [[ "$start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid start date: '$start' (expected YYYY-MM-DD)" >&2; return 1
  fi
  if ! [[ "$end" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid end date: '$end' (expected YYYY-MM-DD)" >&2; return 1
  fi
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM events
    WHERE json_extract(data,'$.start') >= '${start}'
      AND json_extract(data,'$.start') < '${end}'
      AND json_extract(data,'$.deleted_at') IS NULL" \
    | jq '[.[].data | fromjson]'
}
```

### Create an event

Events are written to the server directly. Required: `calendarId`, `title`, `start`, `end`.

```bash
akiflow:create-event() {
  local json="$1"
  local id now_ms payload escaped

  id=$(node -e "process.stdout.write(require('crypto').randomUUID())")
  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  # pending_writes stores single-object payloads; the daemon wraps them into an
  # array before sending to the API (processBatch in akiflow-sync/src/pending.ts)
  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO events (id, data, updated_at)
      VALUES ('$id', json('$escaped'), $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('events', 'POST', json('$escaped'), $now_ms);
    COMMIT;"

  echo "$payload"
}
```

### Update an event
```bash
akiflow:update-event() {
  local id="$1"
  local json="$2"
  local now_ms payload escaped

  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi

  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO events (id, data, updated_at)
      VALUES ('$id',
        json(json_patch(
          COALESCE((SELECT data FROM events WHERE id = '$id'), '{}'),
          '$escaped'
        )),
        $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('events', 'POST', json('$escaped'), $now_ms);
    COMMIT;"
}
```

### Delete an event
```bash
akiflow:delete-event() {
  local id="$1"
  local now_ms escaped_payload escaped
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  escaped_payload="{\"id\":\"$id\",\"deleted_at\":$now_ms}"
  escaped=$(echo "$escaped_payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    UPDATE events SET data = json_patch(data, '$escaped'), updated_at = $now_ms WHERE id = '$id';
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('events', 'POST', json('$escaped'), $now_ms);
    COMMIT;"
}
```

## Time Slots

### List all time slots
```bash
akiflow:list-slots() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM time_slots
    WHERE json_extract(data,'$.deleted_at') IS NULL" \
    | jq '[.[].data | fromjson]'
}
```

### List time slots for a specific date
```bash
akiflow:list-slots-today() {
  local date="${1:-$(date +%Y-%m-%d)}"
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM time_slots
    WHERE json_extract(data,'$.deleted_at') IS NULL
      AND json_extract(data,'$.date') = '$date'" \
    | jq '[.[].data | fromjson]'
}
```

## Sync Status

```bash
akiflow:sync-status() {
  echo "=== Sync tokens ==="
  sqlite3 -json "$AKIFLOW_DB" "SELECT entity, token IS NOT NULL as synced, datetime(updated_at/1000, 'unixepoch') as updated FROM sync_tokens"
  echo "=== Pending writes ==="
  sqlite3 -json "$AKIFLOW_DB" "SELECT status, count(*) as count FROM pending_writes GROUP BY status"
}
```

## Tips

- `date` is ISO string (`"2026-03-01"`); `datetime` is epoch milliseconds for the specific time on that day
- Setting `status: 2` with `date` = planned; add `datetime` to make it appear on the calendar timeline
- `label_id` = primary project UUID; `tags_ids` = array of additional tag UUIDs
- `origin_url` links a task to a URL (email thread, web page, Jira ticket, etc.)
- Check `isWritable: true` on a calendar before creating events on it
- Use `akiflow:sync-status` to check if the daemon is running and writes are being processed
- Reads are instant (local SQLite); writes are queued and synced automatically by the daemon
