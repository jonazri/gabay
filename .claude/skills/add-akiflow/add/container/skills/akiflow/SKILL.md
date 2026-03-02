---
name: akiflow
description: Manage your Akiflow tasks, projects, calendar events, and time slots. Use for creating tasks, scheduling, reviewing inbox, checking your calendar, completing items, and managing your someday list.
allowed-tools: Bash(akiflow:*)
---

# Akiflow

Full task and calendar management via the Akiflow API.

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
| **Someday** (status 7) | "Maybe later" — no date, no active pressure. |
| **Labels** | Both **projects** (`is_tag: false`) and **tags** (`is_tag: true`). `label_id` = primary project, `tags_ids` = array of tag UUIDs. |
| **Time Slots** | Calendar containers for activity types (e.g., "Deep Work", "Admin"). Hold tasks, not events. Tasks reference them via `time_slot_id`. |
| **Events** | Calendar events (meetings, appointments) from connected Google/Outlook accounts. Use v3 API. |

**Always call `akiflow:list-labels` first** if you need to assign a project or tag — you need the UUID.
**Always call `akiflow:list-calendars` first** if you need to create an event — you need the `calendarId`.

## Auth Helper

```bash
akiflow:token() {
  local cache="/tmp/akiflow_token"
  local max_age=1500
  if [[ -f "$cache" ]]; then
    local mtime now age
    mtime=$(stat -c %Y "$cache" 2>/dev/null || stat -f %m "$cache" 2>/dev/null)
    now=$(date +%s)
    age=$(( now - mtime ))
    if (( age < max_age )); then cat "$cache"; return 0; fi
  fi
  local tok
  # NOTE: The response includes a new refresh_token. Akiflow may rotate tokens;
  # if so, the cached .env value will eventually expire. Re-run setup to update it.
  tok=$(curl -sf -X POST "https://web.akiflow.com/oauth/refreshToken" \
    -H "Content-Type: application/json" \
    -d "{\"client_id\":\"1\",\"refresh_token\":\"$AKIFLOW_REFRESH_TOKEN\"}" \
    | jq -r '.access_token')
  [[ -z "$tok" || "$tok" == "null" ]] && { echo "akiflow: token refresh failed" >&2; return 1; }
  echo "$tok" > "$cache"
  echo "$tok"
}
```

Token is cached for 25 minutes in `/tmp/akiflow_token`. Refresh tokens rotate — the cache avoids hammering the auth endpoint.

## Tasks

### Pagination helper (internal)

The v5 tasks API returns 250 tasks per page. This helper fetches all pages and returns a flat JSON array.

```bash
akiflow:_fetch-all-tasks() {
  local token=""
  local all_tasks="[]"
  local response has_next
  while true; do
    response=$(curl -sf "https://api.akiflow.com/v5/tasks?sync_token=${token}" \
      -H "Authorization: Bearer $(akiflow:token)") || return 1
    all_tasks=$(echo "$all_tasks" | jq --argjson page "$(echo "$response" | jq '.data')" '. + $page') || return 1
    has_next=$(echo "$response" | jq -r '.has_next_page // false')
    [[ "$has_next" == "true" ]] || break
    token=$(echo "$response" | jq -r '.sync_token // ""')
    [[ -z "$token" ]] && break
  done
  echo "$all_tasks"
}
```

### List all active tasks
```bash
akiflow:list-all() {
  akiflow:_fetch-all-tasks \
    | jq '[.[] | select(.done == false and .deleted_at == null and (.status == 1 or .status == 2 or .status == 4 or .status == 7))]'
}
```

### List inbox tasks (unscheduled)
```bash
akiflow:list-inbox() {
  akiflow:_fetch-all-tasks \
    | jq '[.[] | select(.done == false and .deleted_at == null and .status == 1)]'
}
```

### List today's tasks
```bash
akiflow:list-today() {
  local today
  today=$(date +%Y-%m-%d)
  akiflow:_fetch-all-tasks \
    | jq --arg today "$today" '[.[] | select(.done == false and .deleted_at == null and .date == $today)]'
}
```

### List upcoming tasks
```bash
akiflow:list-upcoming() {
  local days="${1:-7}"
  # Validate days is a positive integer (1-365) to prevent unexpected date output
  if ! [[ "$days" =~ ^[0-9]+$ ]] || (( days < 1 || days > 365 )); then
    echo "akiflow: days must be a number between 1 and 365" >&2; return 1
  fi
  local end_date today
  end_date=$(date -d "+${days} days" +%Y-%m-%d 2>/dev/null || date -v+${days}d +%Y-%m-%d)
  today=$(date +%Y-%m-%d)
  akiflow:_fetch-all-tasks \
    | jq --arg start "$today" --arg end "$end_date" \
        '[.[] | select(.done == false and .deleted_at == null and .date != null and .date >= $start and .date <= $end)]'
}
```

### List someday tasks
```bash
akiflow:list-someday() {
  akiflow:_fetch-all-tasks \
    | jq '[.[] | select(.done == false and .deleted_at == null and .status == 7)]'
}
```

### Search tasks by title (case-insensitive substring)
```bash
akiflow:search-tasks() {
  local query="$1"
  akiflow:_fetch-all-tasks \
    | jq --arg q "$query" '[.[] | select(.done == false and .deleted_at == null and (.title | ascii_downcase | contains($q | ascii_downcase)))]'
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
  local id
  id=$(node -e "process.stdout.write(crypto.randomUUID())") || return 1
  local payload
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id} | if .status == null then . + {status: 1} else . end') || return 1
  curl -sf -X PATCH "https://api.akiflow.com/v5/tasks" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "[$payload]" | jq '.data[0]'
}
```

**Examples:**
```bash
# Quick inbox capture
akiflow:create-task '{"title": "Buy groceries"}'

# Planned for a date with priority and project
akiflow:create-task '{"title": "Review PR", "date": "2026-03-03", "status": 2, "priority": 2, "label_id": "project-uuid"}'

# Task with link, tags, and description
akiflow:create-task '{"title": "Read this article", "origin_url": "https://example.com", "tags_ids": ["tag-uuid"], "description": "Important context"}'
```

### Update a task

Pass the task UUID and a partial JSON object with only the fields to change.

```bash
akiflow:update-task() {
  local id="$1"
  local patch="$2"
  local payload
  payload=$(echo "$patch" | jq --arg id "$id" '. + {id: $id}') || return 1
  curl -sf -X PATCH "https://api.akiflow.com/v5/tasks" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "[$payload]" | jq '.data[0]'
}
```

**Examples:**
```bash
# Reschedule to a date
akiflow:update-task "task-uuid" '{"date": "2026-03-05", "status": 2}'

# Set high priority and assign to project
akiflow:update-task "task-uuid" '{"priority": 3, "label_id": "project-uuid"}'

# Add tags
akiflow:update-task "task-uuid" '{"tags_ids": ["tag-uuid-1", "tag-uuid-2"]}'

# Add URL and description
akiflow:update-task "task-uuid" '{"origin_url": "https://example.com", "description": "Notes here"}'

# Move to someday (remove date)
akiflow:update-task "task-uuid" '{"status": 7, "date": null, "datetime": null}'

# Assign to a time slot
akiflow:update-task "task-uuid" '{"time_slot_id": "slot-uuid"}'
```

### Complete a task
```bash
akiflow:complete-task() {
  local id="$1"
  local now_ms
  now_ms=$(( $(date +%s) * 1000 ))
  curl -sf -X PATCH "https://api.akiflow.com/v5/tasks" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "[{\"id\":\"$id\",\"done\":true,\"done_at\":$now_ms,\"status\":3}]" | jq '.data[0]'
}
```

### Delete a task (soft delete)
```bash
akiflow:delete-task() {
  local id="$1"
  local now_ms
  now_ms=$(( $(date +%s) * 1000 ))
  curl -sf -X PATCH "https://api.akiflow.com/v5/tasks" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "[{\"id\":\"$id\",\"status\":6,\"deleted_at\":$now_ms}]" | jq '.data[0]'
}
```

## Labels (Projects & Tags)

### List all labels
```bash
akiflow:list-labels() {
  curl -sf "https://api.akiflow.com/v5/labels?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.deleted_at == null)] | sort_by(.sorting)'
}
```

Response fields: `id`, `name`, `color` (hex), `is_tag` (false=project, true=tag), `folder_id` (optional folder grouping).

Use `is_tag: false` to filter just projects; `is_tag: true` for tags.

## Calendars & Events

### List calendars (identify work vs personal accounts)
```bash
akiflow:list-calendars() {
  curl -sf "https://api.akiflow.com/v3/calendars" \
    -H "Authorization: Bearer $(akiflow:token)" | jq '.data'
}
```

Response includes `id`, `name`, `accountId`, `isPrimary`, `isWritable`. Use names/emails to identify work vs personal. **You must have the `calendarId` before creating events.**

### List events in a date range
```bash
akiflow:list-events() {
  local start="$1"  # ISO date: 2026-03-01
  local end="$2"    # ISO date: 2026-03-07
  curl -sf "https://api.akiflow.com/v3/events?start=${start}&end=${end}" \
    -H "Authorization: Bearer $(akiflow:token)" | jq '.data'
}
```

### Create an event

Required: `calendarId`, `title`, `start`, `end` (ISO datetimes). Optional: `allDay`, `description`, `location`, `meetingUrl`, `attendees` (array of `{email, name?}`).

```bash
akiflow:create-event() {
  local json="$1"
  curl -sf -X POST "https://api.akiflow.com/v3/events" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "$json" | jq '.data // .'
}
```

**Example:**
```bash
akiflow:create-event '{
  "calendarId": "cal-uuid",
  "title": "Team sync",
  "start": "2026-03-03T10:00:00Z",
  "end": "2026-03-03T11:00:00Z",
  "description": "Weekly team standup"
}'
```

### Update an event
```bash
akiflow:update-event() {
  local id="$1"
  local json="$2"
  local payload
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id}') || return 1
  curl -sf -X POST "https://api.akiflow.com/v3/events" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "$payload" | jq '.data // .'
}
```

### Delete an event
```bash
akiflow:delete-event() {
  local id="$1"
  local now_ms
  now_ms=$(( $(date +%s) * 1000 ))
  # NOTE: Soft delete via partial POST to /v3/events — undocumented but consistent
  # with the v5 task delete pattern. If this fails, try akiflow:list-events to verify.
  curl -sf -X POST "https://api.akiflow.com/v3/events" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$id\",\"deleted_at\":$now_ms}" | jq '.data // .'
}
```

## Time Slots

Time Slots are calendar containers for organizing tasks by activity type (e.g., "Deep Work", "Admin"). They appear on the calendar but hold tasks — not appointments. Tasks are assigned to slots via `time_slot_id`.

See: [Time Slots docs](https://product.akiflow.com/help/articles/3089241-time-slots)

### List all time slots
```bash
akiflow:list-slots() {
  curl -sf "https://api.akiflow.com/v5/time_slots?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.deleted_at == null)]'
}
```

### List time slots for a specific date
```bash
akiflow:list-slots-today() {
  local date="${1:-$(date +%Y-%m-%d)}"
  curl -sf "https://api.akiflow.com/v5/time_slots?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq --arg date "$date" '[.data[] | select(.deleted_at == null and .date == $date)]'
}
```

To assign a task to a slot: `akiflow:update-task "task-uuid" '{"time_slot_id": "slot-uuid"}'`

> **Note:** Creating/updating time slots follows the v5 PATCH pattern but the full field schema is undocumented. Use `akiflow:list-slots` to inspect existing slots before attempting to create new ones.

## Tips

- `date` is ISO string (`"2026-03-01"`); `datetime` is epoch milliseconds for the specific time on that day
- Setting `status: 2` with `date` = planned; add `datetime` to make it appear on the calendar timeline
- `label_id` = primary project UUID; `tags_ids` = array of additional tag UUIDs
- `origin_url` links a task to a URL (email thread, web page, Jira ticket, etc.)
- Check `isWritable: true` on a calendar before creating events on it
- The v5 API paginates at 250 tasks/page — use `akiflow:_fetch-all-tasks` to get all pages automatically
