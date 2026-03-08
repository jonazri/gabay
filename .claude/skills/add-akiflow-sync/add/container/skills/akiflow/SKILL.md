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
| **Labels** | Both **projects** (`is_tag: false`) and **tags** (`is_tag: true`). `listId` = primary project, `tags_ids` = array of tag UUIDs. |
| **Time Slots** | Calendar containers for activity types (e.g., "Deep Work", "Admin"). Hold tasks, not events. Tasks reference them via `time_slot_id`. |
| **Events** | Calendar events (meetings, appointments) from connected Google/Outlook accounts. |

**Always call `akiflow:list-labels` first** if you need to assign a project or tag — you need the UUID.
**Always call `akiflow:list-calendars` first** if you need to create an event — you need the `calendarId`.

The `AKIFLOW_DB` environment variable points to the local SQLite database maintained by the akiflow-sync daemon. Reads are instant; writes are queued via `pending_writes` and synced to the server automatically.

## Helpers

```bash
# Internal: run sqlite3 query, print message if empty
_akiflow_query() {
  local msg="$1"; shift
  local result
  result=$(sqlite3 -markdown "$AKIFLOW_DB" "$@")
  if [[ -z "$result" ]]; then
    echo "$msg"
  else
    echo "$result"
  fi
}

_akiflow_query_json() {
  local msg="$1"; shift
  local result
  result=$(sqlite3 -json "$AKIFLOW_DB" "$@")
  if [[ -z "$result" || "$result" == "[]" ]]; then
    echo "$msg"
  else
    echo "$result"
  fi
}
```

## Tasks

### List all active tasks
```bash
akiflow:list-all() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-all"
    echo "List all active tasks (inbox, planned, snoozed, someday)."
    return 0
  fi
  _akiflow_query "No active tasks found." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE done = 0 AND deleted_at IS NULL
      AND status IN ('inbox','planned','snoozed','someday')
    ORDER BY sorting ASC"
}
```

### List inbox tasks (unscheduled)
```bash
akiflow:list-inbox() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-inbox"
    echo "List inbox tasks (unscheduled)."
    return 0
  fi
  _akiflow_query "No inbox tasks." "
    SELECT title, label, org, priority, id
    FROM tasks_display
    WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL
    ORDER BY sorting ASC"
}
```

### List today's tasks
```bash
akiflow:list-today() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-today"
    echo "List tasks scheduled for today."
    return 0
  fi
  local today
  today=$(date +%Y-%m-%d)
  _akiflow_query "No tasks scheduled for today. (Use akiflow:list-overdue for past-due tasks.)" "
    SELECT title, status, label, org, datetime, priority, id
    FROM tasks_display
    WHERE scheduled_date = '$today'
      AND done = 0 AND deleted_at IS NULL
    ORDER BY datetime ASC, sorting ASC"
}
```

### List overdue tasks
```bash
akiflow:list-overdue() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-overdue [--limit N]"
    echo "List tasks with scheduled dates in the past."
    return 0
  fi
  local limit=""
  if [[ "${1:-}" == "--limit" && -n "${2:-}" ]]; then limit="LIMIT $2"; fi
  local today
  today=$(date +%Y-%m-%d)
  # Summary line
  local counts
  counts=$(sqlite3 "$AKIFLOW_DB" "
    SELECT count(*) || ' overdue tasks (' ||
      group_concat(label_count, ', ') || ')'
    FROM (
      SELECT COALESCE(NULLIF(org,''), 'Other') || ': ' || count(*) as label_count
      FROM tasks_display
      WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL
      GROUP BY COALESCE(NULLIF(org,''), 'Other')
      ORDER BY count(*) DESC
    )")
  if [[ "$counts" == *"0 overdue"* || -z "$counts" ]]; then
    echo "No overdue tasks."
    return 0
  fi
  echo "$counts"
  echo ""
  _akiflow_query "No overdue tasks." "
    SELECT title, label, org, scheduled_date, priority, id
    FROM tasks_display
    WHERE scheduled_date < '$today'
      AND done = 0 AND deleted_at IS NULL
    ORDER BY scheduled_date ASC, sorting ASC
    $limit"
}
```

### List upcoming tasks
```bash
akiflow:list-upcoming() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-upcoming [days]"
    echo "List tasks scheduled within the next N days (default: 7, max: 365)."
    return 0
  fi
  local days="${1:-7}"
  if ! [[ "$days" =~ ^[0-9]+$ ]] || (( days < 1 || days > 365 )); then
    echo "akiflow: days must be a number between 1 and 365" >&2; return 1
  fi
  local end_date today
  end_date=$(date -d "+${days} days" +%Y-%m-%d 2>/dev/null || date -v+${days}d +%Y-%m-%d)
  today=$(date +%Y-%m-%d)
  _akiflow_query "No tasks in the next $days days." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE done = 0 AND deleted_at IS NULL
      AND scheduled_date >= '$today'
      AND scheduled_date <= '$end_date'
    ORDER BY scheduled_date ASC, datetime ASC"
}
```

### List someday tasks
```bash
akiflow:list-someday() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-someday"
    echo "List someday tasks (no date, no active pressure)."
    return 0
  fi
  _akiflow_query "No someday tasks." "
    SELECT title, label, org, priority, id
    FROM tasks_display
    WHERE status = 'someday' AND done = 0 AND deleted_at IS NULL
    ORDER BY sorting ASC"
}
```

### Get a single task (raw JSON)
```bash
akiflow:get-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:get-task <id>"
    echo "Get the full raw JSON data for a single task."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow:get-task <id>" >&2
    return 1
  fi
  local id="$1"
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  local result
  result=$(sqlite3 -json "$AKIFLOW_DB" "SELECT data FROM tasks WHERE id = '$id'")
  if [[ -z "$result" || "$result" == "[]" ]]; then
    echo "Error: task not found: $id" >&2
    return 1
  fi
  echo "$result" | jq '.[0].data | fromjson'
}
```

### Search tasks by title (case-insensitive substring)
```bash
akiflow:search-tasks() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:search-tasks '<query>'"
    echo "Search active tasks by title (case-insensitive substring match)."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow:search-tasks '<query>'" >&2
    return 1
  fi
  local query="$1"
  local escaped_query
  escaped_query=$(printf '%s' "$query" | tr '[:upper:]' '[:lower:]' | sed "s/'/''/g")
  _akiflow_query "No tasks match '$query'." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE lower(title) LIKE '%${escaped_query}%'
      AND done = 0 AND deleted_at IS NULL"
}
```

### Create a task

Pass a JSON object. Required: `title`. Optional fields:

| Field | Type | Notes |
|---|---|---|
| `status` | number | Default 1 (INBOX). Use 2 (PLANNED) with a `date`. |
| `date` | string | ISO date: `"2026-03-05"` |
| `datetime` | string | ISO datetime: `"2026-03-05T15:00:00.000Z"` |
| `duration` | number | Minutes |
| `priority` | number | 0=none, 1=low, 2=medium, 3=high, 4=goal |
| `listId` | string | Primary project UUID |
| `tags_ids` | string[] | Additional tag UUIDs |
| `description` | string | Rich text notes |
| `origin_url` | string | Link to source (email, web page, etc.) |

```bash
akiflow:create-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:create-task '<json>'"
    echo "Create a new task. Required: title. Optional: status (1=inbox,2=planned,7=someday), date, datetime, duration, priority (0-4), listId, tags_ids, description, origin_url."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing JSON argument" >&2
    echo "Usage: akiflow:create-task '<json>'" >&2
    return 1
  fi
  local json="$1"
  if ! echo "$json" | jq empty 2>/dev/null; then
    echo "Error: invalid JSON: $json" >&2
    return 1
  fi
  local id now_ms payload escaped

  id=$(node -e "process.stdout.write(require('crypto').randomUUID())")
  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" --argjson ts "$now_ms" \
    '. + {id: $id, done: false, updated_at: $ts} | if .status == null then . + {status: 1} else . end')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  if ! sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id', json('$escaped'), $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$escaped'), $now_ms);
    COMMIT;"; then
    echo "Error: failed to create task" >&2
    return 1
  fi

  echo "Created task $id"
  echo "$payload"
}
```

**Examples:**
```bash
# Quick inbox capture
akiflow:create-task '{"title": "Buy groceries"}'

# Planned for a date with priority and project
akiflow:create-task '{"title": "Review PR", "date": "2026-03-03", "status": 2, "priority": 2, "listId": "project-uuid"}'
```

### Update a task

Pass the task UUID and a partial JSON object with only the fields to change.

```bash
akiflow:update-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:update-task <id> '<json>'"
    echo "Update a task. Pass the task UUID and a partial JSON object with fields to change."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow:update-task <id> '<json>'" >&2
    return 1
  fi
  if [[ -z "${2:-}" ]]; then
    echo "Error: missing JSON patch argument" >&2
    echo "Usage: akiflow:update-task <id> '<json>'" >&2
    return 1
  fi
  local id="$1"
  local patch="$2"
  local now_ms payload escaped

  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  if ! echo "$patch" | jq empty 2>/dev/null; then
    echo "Error: invalid JSON: $patch" >&2
    return 1
  fi

  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$patch" | jq --arg id "$id" --argjson ts "$now_ms" '. + {id: $id, updated_at: $ts}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  if ! sqlite3 "$AKIFLOW_DB" "
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
    COMMIT;"; then
    echo "Error: failed to update task $id" >&2
    return 1
  fi

  echo "Updated task $id"
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
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:complete-task <id>"
    echo "Mark a task as completed."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow:complete-task <id>" >&2
    return 1
  fi
  local id="$1"
  local now_ms escaped_payload
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  escaped_payload="{\"id\":\"$id\",\"done\":true,\"done_at\":$now_ms,\"status\":3,\"updated_at\":$now_ms}"
  local escaped
  escaped=$(echo "$escaped_payload" | sed "s/'/''/g")

  if ! sqlite3 "$AKIFLOW_DB" "
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
    COMMIT;"; then
    echo "Error: failed to complete task $id" >&2
    return 1
  fi
  echo "Completed task $id"
}
```

### Delete a task (soft delete)
```bash
akiflow:delete-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:delete-task <id>"
    echo "Soft-delete a task (sets status to deleted)."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow:delete-task <id>" >&2
    return 1
  fi
  local id="$1"
  local now_ms escaped_payload escaped
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  escaped_payload="{\"id\":\"$id\",\"status\":6,\"deleted_at\":$now_ms,\"updated_at\":$now_ms}"
  escaped=$(echo "$escaped_payload" | sed "s/'/''/g")

  if ! sqlite3 "$AKIFLOW_DB" "
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
    COMMIT;"; then
    echo "Error: failed to delete task $id" >&2
    return 1
  fi
  echo "Deleted task $id"
}
```

## Labels (Projects & Tags)

### List all labels
```bash
akiflow:list-labels() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-labels"
    echo "List all labels (projects and tags)."
    return 0
  fi
  _akiflow_query "No labels found." "
    SELECT title, color, is_tag, folder_id, id
    FROM labels_view
    WHERE deleted_at IS NULL
    ORDER BY sorting ASC"
}
```

Response fields: `id`, `title`, `color` (hex), `is_tag` (0=project, 1=tag), `folder_id` (optional folder grouping).

## Calendars & Events

### List calendars
```bash
akiflow:list-calendars() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-calendars"
    echo "List all calendars."
    return 0
  fi
  _akiflow_query "No calendars found." "
    SELECT title, color, id
    FROM calendars_view
    WHERE deleted_at IS NULL"
}
```

### List events for a period
```bash
akiflow:list-events() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-events [period | start-date [end-date]]"
    echo "List calendar events. Period: today (default), tomorrow, this-week, next-week."
    echo "Or pass one date (single day) or two dates (range): akiflow:list-events 2026-03-15 2026-03-21"
    return 0
  fi
  local period="${1:-today}"  # today, tomorrow, this-week, next-week, YYYY-MM-DD, YYYY-MM-DD YYYY-MM-DD
  local start end

  case "$period" in
    today)
      start=$(date +%Y-%m-%d); end="$start" ;;
    tomorrow)
      start=$(date -d "+1 day" +%Y-%m-%d 2>/dev/null || date -v+1d +%Y-%m-%d)
      end="$start" ;;
    this-week)
      # Monday to Sunday of current week
      local dow=$(date +%u)  # 1=Mon, 7=Sun
      start=$(date -d "-$((dow-1)) days" +%Y-%m-%d 2>/dev/null || date -v-$((dow-1))d +%Y-%m-%d)
      end=$(date -d "+$((7-dow)) days" +%Y-%m-%d 2>/dev/null || date -v+$((7-dow))d +%Y-%m-%d) ;;
    next-week)
      local dow=$(date +%u)
      start=$(date -d "+$((8-dow)) days" +%Y-%m-%d 2>/dev/null || date -v+$((8-dow))d +%Y-%m-%d)
      end=$(date -d "+$((14-dow)) days" +%Y-%m-%d 2>/dev/null || date -v+$((14-dow))d +%Y-%m-%d) ;;
    *)
      # Accepts "YYYY-MM-DD" (single day) or "YYYY-MM-DD YYYY-MM-DD" (range)
      start="$1"; end="${2:-$1}"
      if ! [[ "$start" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        echo "akiflow: invalid period or date: '$period'" >&2; return 1
      fi
      if ! [[ "$end" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
        echo "akiflow: invalid end date: '$end'" >&2; return 1
      fi ;;
  esac

  _akiflow_query "No events found for $start to $end." "
    SELECT start, end, title, account, CASE WHEN recurring THEN 'Y' ELSE '' END AS recurring, id
    FROM events_view
    WHERE start >= '$start' AND start < date('$end', '+1 day')
    ORDER BY start ASC"
}
```

Modifiers: `today`, `tomorrow`, `this-week`, `next-week`, or explicit dates. The `account` column maps calendar email domains to short names (JLI = myjli.com, TTO = tefillinconnection.org, DLN = dichalane.com, Personal = gmail.com).

Examples:
```bash
akiflow:list-events today
akiflow:list-events next-week
akiflow:list-events 2026-03-15 2026-03-21
```

### Create an event

Events are written to the server directly. Required: `calendarId`, `title`, `start`, `end`.

```bash
akiflow:create-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:create-event '<json>'"
    echo "Create a calendar event. Required: calendarId, title, start, end."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing JSON argument" >&2
    echo "Usage: akiflow:create-event '<json>'" >&2
    return 1
  fi
  local json="$1"
  if ! echo "$json" | jq empty 2>/dev/null; then
    echo "Error: invalid JSON: $json" >&2
    return 1
  fi
  local id now_ms payload escaped

  id=$(node -e "process.stdout.write(require('crypto').randomUUID())")
  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  # pending_writes stores single-object payloads; the daemon wraps them into an
  # array before sending to the API (processBatch in akiflow-sync/src/pending.ts)
  if ! sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO events (id, data, updated_at)
      VALUES ('$id', json('$escaped'), $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('events', 'POST', json('$escaped'), $now_ms);
    COMMIT;"; then
    echo "Error: failed to create event" >&2
    return 1
  fi

  echo "Created event $id"
  echo "$payload"
}
```

### Update an event
```bash
akiflow:update-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:update-event <id> '<json>'"
    echo "Update a calendar event. Pass the event UUID and a partial JSON object."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing event ID" >&2
    echo "Usage: akiflow:update-event <id> '<json>'" >&2
    return 1
  fi
  if [[ -z "${2:-}" ]]; then
    echo "Error: missing JSON patch argument" >&2
    echo "Usage: akiflow:update-event <id> '<json>'" >&2
    return 1
  fi
  local id="$1"
  local json="$2"
  local now_ms payload escaped

  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  if ! echo "$json" | jq empty 2>/dev/null; then
    echo "Error: invalid JSON: $json" >&2
    return 1
  fi

  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  if ! sqlite3 "$AKIFLOW_DB" "
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
    COMMIT;"; then
    echo "Error: failed to update event $id" >&2
    return 1
  fi
  echo "Updated event $id"
}
```

### Delete an event
```bash
akiflow:delete-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:delete-event <id>"
    echo "Delete a calendar event."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing event ID" >&2
    echo "Usage: akiflow:delete-event <id>" >&2
    return 1
  fi
  local id="$1"
  local now_ms escaped_payload escaped
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi
  now_ms=$(( $(date +%s) * 1000 ))
  escaped_payload="{\"id\":\"$id\",\"deleted_at\":$now_ms}"
  escaped=$(echo "$escaped_payload" | sed "s/'/''/g")

  if ! sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    UPDATE events SET data = json_patch(data, '$escaped'), updated_at = $now_ms WHERE id = '$id';
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('events', 'POST', json('$escaped'), $now_ms);
    COMMIT;"; then
    echo "Error: failed to delete event $id" >&2
    return 1
  fi
  echo "Deleted event $id"
}
```

## Time Slots

### List all time slots
```bash
akiflow:list-slots() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-slots"
    echo "List all time slots."
    return 0
  fi
  _akiflow_query "No time slots found." "
    SELECT title, date, start, end, id
    FROM time_slots_view
    WHERE deleted_at IS NULL"
}
```

### List time slots for a specific date
```bash
akiflow:list-slots-today() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-slots-today [YYYY-MM-DD]"
    echo "List time slots for a specific date (default: today)."
    return 0
  fi
  local date="${1:-$(date +%Y-%m-%d)}"
  if ! [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid date: '$date' (expected YYYY-MM-DD)" >&2; return 1
  fi
  _akiflow_query "No time slots for $date." "
    SELECT title, date, start, end, id
    FROM time_slots_view
    WHERE deleted_at IS NULL
      AND date = '$date'"
}
```

## Sync Status

```bash
akiflow:sync-status() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:sync-status"
    echo "Show sync token status and pending write counts."
    return 0
  fi
  echo "=== Sync tokens ==="
  sqlite3 -markdown "$AKIFLOW_DB" "SELECT entity, token IS NOT NULL as synced, datetime(updated_at/1000, 'unixepoch') as updated FROM sync_tokens"
  echo "=== Pending writes ==="
  sqlite3 -markdown "$AKIFLOW_DB" "SELECT status, count(*) as count FROM pending_writes GROUP BY status"
}
```

## Tips

- `date` is ISO date (`"2026-03-01"`); `datetime` is ISO datetime (`"2026-03-01T15:00:00.000Z"`) for a specific time on that day
- Setting `status: 2` with `date` = planned as a to-do; add `datetime` to make it appear on the calendar timeline
- Read helpers query `tasks_display` view which provides `scheduled_date` (calculated from `date` or `plan_unit`/`plan_period`), human-readable `status`, `label`, and `org`
- `listId` = primary project UUID; `tags_ids` = array of additional tag UUIDs
- `origin_url` links a task to a URL (email thread, web page, Jira ticket, etc.)
- Recurring events are read-only — `update-event` and `delete-event` only affect single instances. To change a recurring series, the user must edit it in Akiflow directly.
- Use `akiflow:sync-status` to check if the daemon is running and writes are being processed
- Reads are instant (local SQLite); writes are queued and synced automatically by the daemon
