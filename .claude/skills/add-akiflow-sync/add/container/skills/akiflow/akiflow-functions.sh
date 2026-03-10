#!/bin/bash
# Auto-extracted from SKILL.md — all akiflow bash function definitions.
# Source this file to make all akiflow commands available in the current shell.

# Ensure all required views exist (idempotent, runs once on source)
if [[ -n "$AKIFLOW_DB" && -f "$AKIFLOW_DB" ]]; then
  sqlite3 "$AKIFLOW_DB" "
    CREATE VIEW IF NOT EXISTS task_stats AS
    SELECT
      COALESCE(NULLIF(label, ''), 'Other')  AS label,
      COALESCE(NULLIF(org, ''), 'Other')    AS org,
      status,
      CASE priority
        WHEN 4 THEN 'goal'
        WHEN 3 THEN 'high'
        WHEN 2 THEN 'medium'
        WHEN 1 THEN 'low'
        ELSE 'none'
      END AS priority_label,
      scheduled_date,
      done
    FROM tasks_display
    WHERE done = 0 AND deleted_at IS NULL;
  " 2>/dev/null
fi

# Internal: run sqlite3 query, print message if empty
# Usage: _akiflow_query "empty msg" "SQL" [--format json] [--limit N]
_akiflow_query() {
  local msg="$1"; shift
  local format="markdown" limit="" query="$1"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format) format="$2"; shift 2 ;;
      --limit) if [[ "$2" =~ ^[0-9]+$ ]]; then limit="LIMIT $2"; else echo "akiflow: invalid --limit: '$2' (expected number)" >&2; return 1; fi; shift 2 ;;
      *) shift ;;
    esac
  done
  if [[ -n "$limit" ]]; then query="$query $limit"; fi
  local result
  if [[ "$format" == "json" ]]; then
    result=$(sqlite3 -json "$AKIFLOW_DB" "$query")
    if [[ -z "$result" || "$result" == "[]" ]]; then echo "$msg"; else echo "$result"; fi
  else
    result=$(sqlite3 -markdown "$AKIFLOW_DB" "$query")
    if [[ -z "$result" ]]; then echo "$msg"; else echo "$result"; fi
  fi
}

# Internal: call RAG endpoint for hybrid vector+keyword search
# Usage: _akiflow_rag_search "query" [--type task|event] [--label label] [--limit N]
# Outputs raw JSON response; empty string if RAG unavailable
_akiflow_rag_search() {
  local query="$1"; shift
  local type="" label="" limit="10"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) type="$2"; shift 2 ;;
      --label) label="$2"; shift 2 ;;
      --limit) limit="$2"; shift 2 ;;
      *) shift ;;
    esac
  done
  local body
  body=$(jq -n --arg q "$query" --arg t "$type" --arg l "$label" --argjson lim "$limit" '{
    query: $q,
    limit: $lim,
    filters: (
      {}
      | if $t != "" then .entity_type = $t else . end
      | if $l != "" then .label = $l else . end
    )
  }')
  curl -s --max-time 5 http://host.docker.internal:3847/api/akiflow/search \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null
}

akiflow:daily-brief() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow daily-brief"
    echo "Show today's events, tasks, overdue summary, and inbox in one view."
    return 0
  fi
  local today today_display
  today=$(date +%Y-%m-%d)
  today_display=$(date +"%A, %B %-d, %Y")
  echo "=== Today: $today_display ==="
  echo ""

  # Events
  echo "--- Events ---"
  local events
  events=$(sqlite3 -markdown "$AKIFLOW_DB" "
    SELECT start, end, title, account, id
    FROM events_view
    WHERE start >= '$today' AND start < date('$today', '+1 day')
    ORDER BY start ASC")
  if [[ -z "$events" ]]; then echo "No meetings today."; else echo "$events"; fi
  echo ""

  # Today's tasks
  echo "--- Tasks ---"
  local tasks
  tasks=$(sqlite3 -markdown "$AKIFLOW_DB" "
    SELECT title, label, org, datetime, priority, id
    FROM tasks_display
    WHERE scheduled_date = '$today' AND done = 0 AND deleted_at IS NULL
    ORDER BY datetime ASC, sorting ASC")
  if [[ -z "$tasks" ]]; then echo "No tasks scheduled for today."; else echo "$tasks"; fi
  echo ""

  # Overdue summary
  echo "--- Overdue ---"
  local overdue
  overdue=$(sqlite3 "$AKIFLOW_DB" "
    SELECT (SELECT count(*) FROM tasks_display WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL)
      || ' overdue (' ||
      COALESCE(group_concat(lc, ', '), 'none') || ')'
    FROM (
      SELECT COALESCE(NULLIF(org,''), 'Other') || ': ' || count(*) as lc
      FROM tasks_display
      WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL
      GROUP BY COALESCE(NULLIF(org,''), 'Other')
      ORDER BY count(*) DESC
    )")
  if [[ "$overdue" == *"0 overdue"* ]]; then echo "No overdue tasks."; else echo "$overdue"; fi
  echo ""

  # Inbox
  echo "--- Inbox ---"
  local inbox
  inbox=$(sqlite3 "$AKIFLOW_DB" "
    SELECT count(*) FROM tasks_display
    WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL")
  if [[ "$inbox" == "0" ]]; then
    echo "Inbox empty."
  else
    echo "$inbox unscheduled:"
    sqlite3 "$AKIFLOW_DB" "
      SELECT '- ' || title FROM tasks_display
      WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL
      ORDER BY sorting ASC"
  fi
}

akiflow:weekly-plan() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow weekly-plan"
    echo "Show this week's events and tasks, next week's events, overdue summary, and inbox."
    return 0
  fi
  local today dow week_start week_end next_week_start next_week_end
  today=$(date +%Y-%m-%d)
  dow=$(date +%u)  # 1=Mon, 7=Sun
  week_start=$(date -d "-$((dow-1)) days" +%Y-%m-%d 2>/dev/null || date -v-$((dow-1))d +%Y-%m-%d)
  week_end=$(date -d "+$((7-dow)) days" +%Y-%m-%d 2>/dev/null || date -v+$((7-dow))d +%Y-%m-%d)
  next_week_start=$(date -d "+$((8-dow)) days" +%Y-%m-%d 2>/dev/null || date -v+$((8-dow))d +%Y-%m-%d)
  next_week_end=$(date -d "+$((14-dow)) days" +%Y-%m-%d 2>/dev/null || date -v+$((14-dow))d +%Y-%m-%d)

  local week_start_display
  week_start_display=$(date -d "$week_start" +"%B %-d" 2>/dev/null || date -j -f "%Y-%m-%d" "$week_start" +"%B %-d")
  local week_end_display
  week_end_display=$(date -d "$week_end" +"%B %-d, %Y" 2>/dev/null || date -j -f "%Y-%m-%d" "$week_end" +"%B %-d, %Y")
  echo "=== Week of $week_start_display - $week_end_display ==="
  echo ""

  # Events this week
  echo "--- Events this week ---"
  local events_this
  events_this=$(sqlite3 -markdown "$AKIFLOW_DB" "
    SELECT start, end, title, account, id
    FROM events_view
    WHERE start >= '$week_start' AND start < date('$week_end', '+1 day')
    ORDER BY start ASC")
  if [[ -z "$events_this" ]]; then echo "No meetings this week."; else echo "$events_this"; fi
  echo ""

  # Events next week
  echo "--- Events next week ---"
  local events_next
  events_next=$(sqlite3 -markdown "$AKIFLOW_DB" "
    SELECT start, end, title, account, id
    FROM events_view
    WHERE start >= '$next_week_start' AND start < date('$next_week_end', '+1 day')
    ORDER BY start ASC")
  if [[ -z "$events_next" ]]; then echo "No meetings next week."; else echo "$events_next"; fi
  echo ""

  # Tasks this week
  echo "--- Tasks this week ---"
  local tasks
  tasks=$(sqlite3 -markdown "$AKIFLOW_DB" "
    SELECT title, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE scheduled_date >= '$week_start' AND scheduled_date <= '$week_end'
      AND done = 0 AND deleted_at IS NULL
    ORDER BY scheduled_date ASC, datetime ASC, sorting ASC")
  if [[ -z "$tasks" ]]; then echo "No tasks scheduled this week."; else echo "$tasks"; fi
  echo ""

  # Overdue summary (reuse the same pattern from daily-brief)
  echo "--- Overdue ---"
  local overdue
  overdue=$(sqlite3 "$AKIFLOW_DB" "
    SELECT (SELECT count(*) FROM tasks_display WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL)
      || ' overdue (' ||
      COALESCE(group_concat(lc, ', '), 'none') || ')'
    FROM (
      SELECT COALESCE(NULLIF(org,''), 'Other') || ': ' || count(*) as lc
      FROM tasks_display
      WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL
      GROUP BY COALESCE(NULLIF(org,''), 'Other')
      ORDER BY count(*) DESC
    )")
  if [[ "$overdue" == *"0 overdue"* ]]; then echo "No overdue tasks."; else echo "$overdue"; fi
  echo ""

  # Inbox
  echo "--- Inbox ---"
  local inbox
  inbox=$(sqlite3 "$AKIFLOW_DB" "
    SELECT count(*) FROM tasks_display
    WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL")
  if [[ "$inbox" == "0" ]]; then
    echo "Inbox empty."
  else
    echo "$inbox unscheduled:"
    sqlite3 "$AKIFLOW_DB" "
      SELECT '- ' || title FROM tasks_display
      WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL
      ORDER BY sorting ASC"
  fi
}

akiflow:list-all() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-all [--format json] [--limit N]"
    echo "List all active tasks (inbox, planned, snoozed, someday)."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No active tasks found." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE done = 0 AND deleted_at IS NULL
      AND status IN ('inbox','planned','snoozed','someday')
    ORDER BY sorting ASC" "${flags[@]}"
}

akiflow:list-inbox() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-inbox [--format json] [--limit N]"
    echo "List inbox tasks (unscheduled)."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No inbox tasks." "
    SELECT title, label, org, priority, id
    FROM tasks_display
    WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL
    ORDER BY sorting ASC" "${flags[@]}"
}

akiflow:list-today() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-today [--format json] [--limit N]"
    echo "List tasks scheduled for today."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  local today
  today=$(date +%Y-%m-%d)
  _akiflow_query "No tasks scheduled for today. (Use akiflow list-overdue for past-due tasks.)" "
    SELECT title, status, label, org, datetime, priority, id
    FROM tasks_display
    WHERE scheduled_date = '$today'
      AND done = 0 AND deleted_at IS NULL
    ORDER BY datetime ASC, sorting ASC" "${flags[@]}"
}

akiflow:list-overdue() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-overdue [--format json] [--limit N]"
    echo "List tasks with scheduled dates in the past."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  local today
  today=$(date +%Y-%m-%d)
  # Summary line
  local counts
  counts=$(sqlite3 "$AKIFLOW_DB" "
    SELECT (SELECT count(*) FROM tasks_display WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL)
      || ' overdue tasks (' || group_concat(label_count, ', ') || ')'
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
    ORDER BY scheduled_date ASC, sorting ASC" "${flags[@]}"
}

akiflow:list-upcoming() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-upcoming [days] [--format json] [--limit N]"
    echo "List tasks scheduled within the next N days (default: 7, max: 365)."
    return 0
  fi
  local days=7
  if [[ $# -gt 0 && "$1" != --* ]]; then
    days="$1"; shift
  fi
  if ! [[ "$days" =~ ^[0-9]+$ ]] || (( days < 1 || days > 365 )); then
    echo "akiflow: days must be a number between 1 and 365" >&2; return 1
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  local end_date today
  end_date=$(date -d "+${days} days" +%Y-%m-%d 2>/dev/null || date -v+${days}d +%Y-%m-%d)
  today=$(date +%Y-%m-%d)
  _akiflow_query "No tasks in the next $days days." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE done = 0 AND deleted_at IS NULL
      AND scheduled_date >= '$today'
      AND scheduled_date <= '$end_date'
    ORDER BY scheduled_date ASC, datetime ASC" "${flags[@]}"
}

akiflow:list-someday() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-someday [--format json] [--limit N]"
    echo "List someday tasks (no date, no active pressure)."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No someday tasks." "
    SELECT title, label, org, priority, id
    FROM tasks_display
    WHERE status = 'someday' AND done = 0 AND deleted_at IS NULL
    ORDER BY sorting ASC" "${flags[@]}"
}

akiflow:get-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow get-task <id>"
    echo "Get the full raw JSON data for a single task."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow get-task <id>" >&2
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

akiflow:search-tasks() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow search-tasks '<query>' [--format json] [--limit N]"
    echo "Hybrid semantic + keyword search for active tasks. Use | for OR in keyword fallback: 'tax|IRS|filing'"
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow search-tasks '<query>'" >&2
    return 1
  fi
  local query="$1"; shift
  local format="markdown" limit=""
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format) format="$2"; flags+=("$1" "$2"); shift 2 ;;
      --limit) limit="$2"; flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done

  # Try hybrid search via RAG (skip if AKIFLOW_SKIP_RAG is set)
  local rag_args=(--type task)
  [[ -n "$limit" ]] && rag_args+=(--limit "$limit")
  local response=""
  if [[ -z "${AKIFLOW_SKIP_RAG:-}" ]]; then
    response=$(_akiflow_rag_search "$query" "${rag_args[@]}")
  fi
  if [[ -n "$response" ]] && echo "$response" | jq -e '.results' >/dev/null 2>&1; then
    local count
    count=$(echo "$response" | jq '.total')
    if [[ "$count" == "0" ]]; then
      echo "No tasks match '$query'."
      return 0
    fi
    if [[ "$format" == "json" ]]; then
      echo "$response" | jq '.results'
    else
      echo "$response" | jq -r '
        .results[] |
        "| \(.title) | \(.status) | \(.label // "-") | \(.org // "-") | \(.scheduled_date // "-") | \(.priority) | \(.entity_id) |"
      ' | (echo "| title | status | label | org | scheduled_date | priority | id |"; echo "|-------|--------|-------|-----|----------------|----------|-----|"; cat)
    fi
    return 0
  fi

  # Fallback: keyword-only search via SQLite
  local where_clause=""
  IFS='|' read -ra terms <<< "$query"
  for term in "${terms[@]}"; do
    local trimmed
    trimmed=$(printf '%s' "$term" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -z "$trimmed" ]] && continue
    local escaped
    escaped=$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]' | sed "s/'/''/g")
    if [[ -n "$where_clause" ]]; then where_clause="$where_clause OR "; fi
    if [[ ${#escaped} -le 3 ]]; then
      where_clause="${where_clause}(' ' || lower(title) || ' ' LIKE '% ${escaped} %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}s %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}es %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}ed %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}ing %')"
    else
      where_clause="${where_clause}lower(title) LIKE '%${escaped}%'"
    fi
  done
  _akiflow_query "No tasks match '$query'." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE ($where_clause)
      AND done = 0 AND deleted_at IS NULL" "${flags[@]}"
}

akiflow:create-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow create-task '<json>'"
    echo "Create a new task. Required: title. Optional: status (1=inbox,2=planned,7=someday), date, datetime, duration, priority (0-4), listId, tags_ids, description, origin_url."
    echo "Status codes: 1=inbox, 2=planned, 3=completed, 4=snoozed, 5=archived, 6=deleted, 7=someday"
    echo "Priority: 0=none, 1=low, 2=medium, 3=high, 4=goal"
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing JSON argument" >&2
    echo "Usage: akiflow create-task '<json>'" >&2
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

akiflow:update-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow update-task <id> '<json>'"
    echo "Update a task. Pass the task UUID and a partial JSON object with fields to change."
    echo "Status codes: 1=inbox, 2=planned, 3=completed, 4=snoozed, 5=archived, 6=deleted, 7=someday"
    echo "Priority: 0=none, 1=low, 2=medium, 3=high, 4=goal"
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow update-task <id> '<json>'" >&2
    return 1
  fi
  if [[ -z "${2:-}" ]]; then
    echo "Error: missing JSON patch argument" >&2
    echo "Usage: akiflow update-task <id> '<json>'" >&2
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

akiflow:reschedule-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow reschedule-task <id> <YYYY-MM-DD>"
    echo "Move a task to a new date. Sets status to planned and clears datetime."
    return 0
  fi
  if [[ -z "${1:-}" || -z "${2:-}" ]]; then
    echo "Error: missing id or date" >&2
    echo "Usage: akiflow reschedule-task <id> <YYYY-MM-DD>" >&2
    return 1
  fi
  local id="$1" date="$2"
  if ! [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid date: '$date' (expected YYYY-MM-DD)" >&2; return 1
  fi
  akiflow:update-task "$id" "{\"date\": \"$date\", \"status\": 2, \"datetime\": null}"
}

akiflow:complete-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow complete-task <id>"
    echo "Mark a task as completed."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow complete-task <id>" >&2
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

akiflow:delete-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow delete-task <id>"
    echo "Soft-delete a task (sets status to deleted)."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing task ID" >&2
    echo "Usage: akiflow delete-task <id>" >&2
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

akiflow:list-labels() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-labels [--format json] [--limit N]"
    echo "List all labels (projects and tags)."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No labels found." "
    SELECT title, color, is_tag, folder_id, id
    FROM labels_view
    WHERE deleted_at IS NULL
    ORDER BY sorting ASC" "${flags[@]}"
}

akiflow:list-calendars() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-calendars [--format json] [--limit N]"
    echo "List all calendars."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No calendars found." "
    SELECT title, color, id
    FROM calendars_view
    WHERE deleted_at IS NULL" "${flags[@]}"
}

akiflow:list-events() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-events [period | start-date [end-date]] [--format json] [--limit N]"
    echo "List calendar events. Period: today (default), tomorrow, this-week, next-week."
    echo "Or pass one date (single day) or two dates (range): akiflow list-events 2026-03-15 2026-03-21"
    return 0
  fi
  local period="today" second_arg="" flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      --*) shift ;;
      *)
        if [[ "$period" == "today" && "$1" != "today" ]]; then
          period="$1"
        elif [[ -z "$second_arg" ]]; then
          second_arg="$1"
        fi
        shift ;;
    esac
  done
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
      start="$period"; end="${second_arg:-$period}"
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
    ORDER BY start ASC" "${flags[@]}"
}

akiflow:search-events() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow search-events '<query>' [--format json] [--limit N]"
    echo "Hybrid semantic + keyword search for events. Use | for OR in keyword fallback: 'standup|meeting'"
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow search-events '<query>'" >&2
    return 1
  fi
  local query="$1"; shift
  local format="markdown" limit=""
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format) format="$2"; flags+=("$1" "$2"); shift 2 ;;
      --limit) limit="$2"; flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done

  # Try hybrid search via RAG (skip if AKIFLOW_SKIP_RAG is set)
  local rag_args=(--type event)
  [[ -n "$limit" ]] && rag_args+=(--limit "$limit")
  local response=""
  if [[ -z "${AKIFLOW_SKIP_RAG:-}" ]]; then
    response=$(_akiflow_rag_search "$query" "${rag_args[@]}")
  fi
  if [[ -n "$response" ]] && echo "$response" | jq -e '.results' >/dev/null 2>&1; then
    local count
    count=$(echo "$response" | jq '.total')
    if [[ "$count" == "0" ]]; then
      echo "No events match '$query'."
      return 0
    fi
    if [[ "$format" == "json" ]]; then
      echo "$response" | jq '.results'
    else
      echo "$response" | jq -r '
        .results[] |
        "| \(.start_time // "-") | \(.title) | \(.account // "-") | \(.status) | \(.score) | \(.entity_id) |"
      ' | (echo "| start | title | account | status | score | id |"; echo "|-------|-------|---------|--------|-------|-----|"; cat)
    fi
    return 0
  fi

  # Fallback: keyword-only search via SQLite
  local where_clause=""
  IFS='|' read -ra terms <<< "$query"
  for term in "${terms[@]}"; do
    local trimmed
    trimmed=$(printf '%s' "$term" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    [[ -z "$trimmed" ]] && continue
    local escaped
    escaped=$(printf '%s' "$trimmed" | tr '[:upper:]' '[:lower:]' | sed "s/'/''/g")
    if [[ -n "$where_clause" ]]; then where_clause="$where_clause OR "; fi
    if [[ ${#escaped} -le 3 ]]; then
      where_clause="${where_clause}(' ' || lower(title) || ' ' LIKE '% ${escaped} %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}s %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}es %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}ed %' OR ' ' || lower(title) || ' ' LIKE '% ${escaped}ing %')"
    else
      where_clause="${where_clause}lower(title) LIKE '%${escaped}%'"
    fi
  done
  _akiflow_query "No events match '$query'." "
    SELECT start, end, title, account,
      CASE WHEN recurring THEN 'Y' ELSE '' END AS recurring, id
    FROM events_view
    WHERE ($where_clause)
    ORDER BY start ASC" "${flags[@]}"
}

akiflow:create-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow create-event '<json>'"
    echo "Create a calendar event. Required: calendarId, title, start, end."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing JSON argument" >&2
    echo "Usage: akiflow create-event '<json>'" >&2
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

akiflow:update-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow update-event <id> '<json>'"
    echo "Update a calendar event. Pass the event UUID and a partial JSON object."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing event ID" >&2
    echo "Usage: akiflow update-event <id> '<json>'" >&2
    return 1
  fi
  if [[ -z "${2:-}" ]]; then
    echo "Error: missing JSON patch argument" >&2
    echo "Usage: akiflow update-event <id> '<json>'" >&2
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

akiflow:reschedule-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow reschedule-event <id> <YYYY-MM-DD>"
    echo "Move an event to a new date, preserving the original time-of-day and duration."
    return 0
  fi
  if [[ -z "${1:-}" || -z "${2:-}" ]]; then
    echo "Error: missing id or date" >&2
    echo "Usage: akiflow reschedule-event <id> <YYYY-MM-DD>" >&2
    return 1
  fi
  local id="$1" new_date="$2"
  if ! [[ "$new_date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid date: '$new_date' (expected YYYY-MM-DD)" >&2; return 1
  fi
  if ! [[ "$id" =~ ^[a-zA-Z0-9_-]{1,100}$ ]]; then
    echo "akiflow: invalid id: '$id'" >&2; return 1
  fi

  # Get current start/end from events table
  local event_data
  event_data=$(sqlite3 -json "$AKIFLOW_DB" "SELECT data FROM events WHERE id = '$id'")
  if [[ -z "$event_data" || "$event_data" == "[]" ]]; then
    echo "Error: event not found: $id" >&2
    return 1
  fi

  local current_start current_end
  current_start=$(echo "$event_data" | jq -r '.[0].data | fromjson | .start_time // empty')
  current_end=$(echo "$event_data" | jq -r '.[0].data | fromjson | .end_time // empty')

  if [[ -z "$current_start" || -z "$current_end" ]]; then
    echo "Error: event $id has no start/end times" >&2
    return 1
  fi

  # Extract date and time portions
  local start_date start_time end_date end_time
  start_date="${current_start%%T*}"
  start_time="${current_start#*T}"
  end_date="${current_end%%T*}"
  end_time="${current_end#*T}"

  # Compute day offset between original start and end (handles midnight-crossing events)
  local day_offset=0
  if [[ "$start_date" != "$end_date" ]]; then
    local s_epoch e_epoch
    s_epoch=$(date -d "$start_date" +%s 2>/dev/null)
    e_epoch=$(date -d "$end_date" +%s 2>/dev/null)
    day_offset=$(( (e_epoch - s_epoch) / 86400 ))
  fi

  local new_start="${new_date}T${start_time}"
  local new_end_date
  if (( day_offset > 0 )); then
    new_end_date=$(date -d "$new_date +${day_offset} days" +%Y-%m-%d 2>/dev/null)
  else
    new_end_date="$new_date"
  fi
  local new_end="${new_end_date}T${end_time}"

  akiflow:update-event "$id" "{\"start_time\": \"$new_start\", \"end_time\": \"$new_end\"}"
}

akiflow:delete-event() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow delete-event <id>"
    echo "Delete a calendar event."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing event ID" >&2
    echo "Usage: akiflow delete-event <id>" >&2
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

akiflow:list-slots() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-slots [--format json] [--limit N]"
    echo "List all time slots."
    return 0
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No time slots found." "
    SELECT title, date, start, end, id
    FROM time_slots_view
    WHERE deleted_at IS NULL" "${flags[@]}"
}

akiflow:list-slots-today() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow list-slots-today [YYYY-MM-DD] [--format json] [--limit N]"
    echo "List time slots for a specific date (default: today)."
    return 0
  fi
  local date
  if [[ $# -gt 0 && "$1" != --* ]]; then
    date="$1"; shift
  else
    date="$(date +%Y-%m-%d)"
  fi
  if ! [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid date: '$date' (expected YYYY-MM-DD)" >&2; return 1
  fi
  local flags=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format|--limit) flags+=("$1" "$2"); shift 2 ;;
      *) shift ;;
    esac
  done
  _akiflow_query "No time slots for $date." "
    SELECT title, date, start, end, id
    FROM time_slots_view
    WHERE deleted_at IS NULL
      AND date = '$date'" "${flags[@]}"
}

akiflow:stats() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow stats [--by label|org|priority|status] [--label <name>] [--org <name>]"
    echo "Show task and event counts."
    echo "  --by <dim>     Pivot counts by label, org, priority, or status"
    echo "  --label <name> Filter to a specific label"
    echo "  --org <name>   Filter to a specific org"
    return 0
  fi
  local today by="" filter_label="" filter_org=""
  today=$(date +%Y-%m-%d)
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --by) by="$2"; shift 2 ;;
      --label) filter_label="$2"; shift 2 ;;
      --org) filter_org="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  # Build optional WHERE filter (task_stats already filters done=0, deleted_at IS NULL)
  local filter=""
  if [[ -n "$filter_label" ]]; then
    local safe_label="${filter_label//'/''}"
    filter="$filter AND label = '$safe_label'"
  fi
  if [[ -n "$filter_org" ]]; then
    local safe_org="${filter_org//'/''}"
    filter="$filter AND org = '$safe_org'"
  fi

  if [[ -n "$by" ]]; then
    # Validate and map dimension to task_stats column
    local col
    case "$by" in
      label|org|status) col="$by" ;;
      priority) col="priority_label" ;;
      *) echo "Error: --by must be label, org, priority, or status" >&2; return 1 ;;
    esac

    sqlite3 -markdown "$AKIFLOW_DB" "
      SELECT $col as $by,
        SUM(CASE WHEN scheduled_date < '$today' THEN 1 ELSE 0 END) as overdue,
        SUM(CASE WHEN scheduled_date = '$today' THEN 1 ELSE 0 END) as today,
        SUM(CASE WHEN scheduled_date > '$today' AND scheduled_date <= date('$today', '+7 days') THEN 1 ELSE 0 END) as upcoming_7d,
        SUM(CASE WHEN status = 'inbox' THEN 1 ELSE 0 END) as inbox,
        SUM(CASE WHEN status = 'someday' THEN 1 ELSE 0 END) as someday,
        count(*) as total
      FROM task_stats
      WHERE 1=1 $filter
      GROUP BY $col
      ORDER BY total DESC"
  else
    # Flat counts (original behavior) with optional filter
    sqlite3 "$AKIFLOW_DB" "
      SELECT
        'Overdue: '     || SUM(CASE WHEN scheduled_date < '$today' THEN 1 ELSE 0 END),
        'Today: '       || SUM(CASE WHEN scheduled_date = '$today' THEN 1 ELSE 0 END),
        'Upcoming 7d: ' || SUM(CASE WHEN scheduled_date > '$today' AND scheduled_date <= date('$today', '+7 days') THEN 1 ELSE 0 END),
        'Inbox: '       || SUM(CASE WHEN status = 'inbox' THEN 1 ELSE 0 END),
        'Someday: '     || SUM(CASE WHEN status = 'someday' THEN 1 ELSE 0 END)
      FROM task_stats
      WHERE 1=1 $filter" | tr '|' '\n'
  fi

  # Event counts always appended
  echo ""
  sqlite3 "$AKIFLOW_DB" "
    SELECT
      'Events today: ' || (SELECT count(*) FROM events_view WHERE start >= '$today' AND start < date('$today', '+1 day'))
    UNION ALL SELECT
      'Events this week: ' || (SELECT count(*) FROM events_view WHERE start >= date('$today', '-' || (strftime('%w','$today')) || ' days') AND start < date('$today', '-' || (strftime('%w','$today')) || ' days', '+7 days'))"
}

akiflow:search() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow search '<query>' [--type task|event] [--label <label>] [--limit N]"
    echo "Hybrid keyword + semantic search across tasks and events."
    echo "Falls back to keyword-only if RAG service is unreachable."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow search '<query>'" >&2
    return 1
  fi
  local query="$1"; shift
  local type="" label="" limit="10"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --type) type="$2"; shift 2 ;;
      --label) label="$2"; shift 2 ;;
      --limit) limit="$2"; shift 2 ;;
      *) shift ;;
    esac
  done

  # Try hybrid search via RAG
  local rag_args=()
  [[ -n "$type" ]] && rag_args+=(--type "$type")
  [[ -n "$label" ]] && rag_args+=(--label "$label")
  rag_args+=(--limit "$limit")
  local response
  response=$(_akiflow_rag_search "$query" "${rag_args[@]}")

  if [[ -n "$response" ]] && echo "$response" | jq -e '.results' >/dev/null 2>&1; then
    local count
    count=$(echo "$response" | jq '.total')
    if [[ "$count" == "0" ]]; then
      echo "No results for '$query'."
      return 0
    fi
    echo "Found $count results for '$query':"
    echo "$response" | jq -r '
      .results[] |
      "| \(.entity_type) | \(.title) | \(.scheduled_date // .start_time // "-") | \(.status) | \(.label // .account // "-") | \(.score) | \(.entity_id) |"
    ' | (echo "| type | title | date | status | label | score | id |"; echo "|------|-------|------|--------|-------|-------|-----|"; cat)
  else
    # Fallback: keyword-only search via SQLite (skip further RAG attempts)
    echo "(RAG service unavailable — falling back to keyword search)"
    AKIFLOW_SKIP_RAG=1 akiflow:search-tasks "$query"
    AKIFLOW_SKIP_RAG=1 akiflow:search-events "$query"
  fi
}

akiflow:sync-status() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow sync-status"
    echo "Show sync token status and pending write counts."
    return 0
  fi
  echo "=== Sync tokens ==="
  sqlite3 -markdown "$AKIFLOW_DB" "SELECT entity, token IS NOT NULL as synced, datetime(updated_at/1000, 'unixepoch') as updated FROM sync_tokens"
  echo "=== Pending writes ==="
  sqlite3 -markdown "$AKIFLOW_DB" "SELECT status, count(*) as count FROM pending_writes GROUP BY status"
}
