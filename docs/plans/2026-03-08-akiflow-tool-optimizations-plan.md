# Akiflow CLI Tool Optimizations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Improve the akiflow CLI tools available to container agents — better search, consolidated views, clearer output, and eventually hybrid vector+keyword search.

**Architecture:** Phase 1 modifies only the bash functions in the container agent SKILL.md. Phase 2 extends the existing RAG service with a new Qdrant collection and adds a vector indexer to the akiflow-sync daemon.

**Tech Stack:** Bash/SQLite (Phase 1), TypeScript/Qdrant/OpenAI embeddings (Phase 2)

**Design doc:** `docs/plans/2026-03-08-akiflow-tool-optimizations-design.md`

**Test infrastructure:** Test DB clone and helpers were set up at `/tmp/akiflow-test-README.md`. See cleanup checklist in design doc. **Do not ship any code referencing `/tmp/akiflow` paths.**

---

## Phase 1: CLI Tool Improvements

All Phase 1 tasks modify a single file:
- **Modify:** `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

Test commands use the cloned test DB:
```bash
source /tmp/akiflow-helpers.sh   # loads AKIFLOW_DB=/tmp/akiflow-test.db
```

After each task, re-source the SKILL.md functions to test:
```bash
export AKIFLOW_DB=/tmp/akiflow-test.db
source <(sed -n '/^```bash$/,/^```$/{ /^```/d; p; }' .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md)
```

---

### Task 1: Add empty result messages to all list/search functions

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md` (lines 47-188, 414-491, 639-686)

**Step 1: Add helper function at the top of the bash section**

Insert after line 41 (after the `AKIFLOW_DB` paragraph), before `## Tasks`:

````markdown
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
````

**Step 2: Refactor `akiflow:list-all` to use the helper**

Replace the sqlite3 call in `akiflow:list-all()` (lines 53-58) with:

```bash
  _akiflow_query "No active tasks found." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE done = 0 AND deleted_at IS NULL
      AND status IN ('inbox','planned','snoozed','someday')
    ORDER BY sorting ASC"
```

Note: also drop the `links` column from the default SELECT (too wide). Links are available via `akiflow:get-task`.

**Step 3: Refactor all other list functions the same way**

Apply the `_akiflow_query` pattern to each function, with appropriate empty messages:

| Function | Empty message |
|----------|--------------|
| `list-inbox` | `"No inbox tasks."` |
| `list-today` | `"No tasks scheduled for today."` |
| `list-upcoming` | `"No tasks in the next $days days."` |
| `list-someday` | `"No someday tasks."` |
| `search-tasks` | `"No tasks match '$query'."` |
| `list-labels` | `"No labels found."` |
| `list-calendars` | `"No calendars found."` |
| `list-events` | `"No events found for $start to $end."` |
| `list-slots` | `"No time slots found."` |
| `list-slots-today` | `"No time slots for $date."` |

Also drop `links` from the default SELECT in all list functions that currently include it: `list-all`, `list-today`, `list-upcoming`, `search-tasks`.

**Step 4: Test**

```bash
export AKIFLOW_DB=/tmp/akiflow-test.db
source <(sed -n '/^```bash$/,/^```$/{ /^```/d; p; }' .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md)
akiflow:list-events tomorrow    # Should show "No events found for ..."
akiflow:search-tasks 'zzzzz'    # Should show "No tasks match 'zzzzz'."
akiflow:list-today               # Should show overdue tasks (non-empty)
```

**Step 5: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add empty result messages and drop links from default output"
```

---

### Task 2: Add `akiflow:list-overdue` and fix `akiflow:list-today`

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md` (lines 78-96)

**Step 1: Add `akiflow:list-overdue` function**

Insert a new section after `### List today's tasks` (after line 96):

````markdown
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
````

**Step 2: Update `akiflow:list-today` to exclude overdue**

Replace the SQL in `akiflow:list-today()` (lines 88-94) so it only shows today:

```bash
  local today
  today=$(date +%Y-%m-%d)
  _akiflow_query "No tasks scheduled for today. (Use akiflow:list-overdue for past-due tasks.)" "
    SELECT title, status, label, org, datetime, priority, id
    FROM tasks_display
    WHERE scheduled_date = '$today'
      AND done = 0 AND deleted_at IS NULL
    ORDER BY datetime ASC, sorting ASC"
```

**Step 3: Test**

```bash
akiflow:list-overdue             # Should show 44 tasks with summary header
akiflow:list-overdue --limit 5   # Should show 5 tasks
akiflow:list-today               # Should show "No tasks scheduled for today." (since all are overdue)
```

**Step 4: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add list-overdue, fix list-today to exclude overdue"
```

---

### Task 3: Add `akiflow:daily-brief`

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

**Step 1: Add `akiflow:daily-brief` function**

Insert a new section before `### List all active tasks` (before line 45):

````markdown
### Daily brief (consolidated today view)
```bash
akiflow:daily-brief() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:daily-brief"
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
    SELECT count(*) || ' overdue (' ||
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
```
````

**Step 2: Test**

```bash
akiflow:daily-brief
# Should show consolidated view with all 4 sections
```

**Step 3: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add daily-brief consolidated view"
```

---

### Task 4: Add multi-keyword search + `akiflow:search-events`

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md` (lines 166-188, after line 491)

**Step 1: Update `akiflow:search-tasks` for multi-keyword support**

Replace the `akiflow:search-tasks()` function (lines 168-188) with:

````markdown
### Search tasks by title
```bash
akiflow:search-tasks() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:search-tasks '<query>'"
    echo "Search active tasks by title (case-insensitive). Use | for OR: 'tax|IRS|filing'"
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow:search-tasks '<query>'" >&2
    return 1
  fi
  local query="$1"
  local where_clause=""
  IFS='|' read -ra terms <<< "$query"
  for term in "${terms[@]}"; do
    local escaped
    escaped=$(printf '%s' "$term" | tr '[:upper:]' '[:lower:]' | sed "s/'/''/g")
    if [[ -n "$where_clause" ]]; then where_clause="$where_clause OR "; fi
    where_clause="${where_clause}lower(title) LIKE '%${escaped}%'"
  done
  _akiflow_query "No tasks match '$query'." "
    SELECT title, status, label, org, scheduled_date, datetime, priority, id
    FROM tasks_display
    WHERE ($where_clause)
      AND done = 0 AND deleted_at IS NULL"
}
```
````

**Step 2: Add `akiflow:search-events` function**

Insert a new section after `### List events for a period` (after line 491):

````markdown
### Search events by title
```bash
akiflow:search-events() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:search-events '<query>'"
    echo "Search events by title (case-insensitive). Use | for OR: 'standup|meeting'"
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow:search-events '<query>'" >&2
    return 1
  fi
  local query="$1"
  local where_clause=""
  IFS='|' read -ra terms <<< "$query"
  for term in "${terms[@]}"; do
    local escaped
    escaped=$(printf '%s' "$term" | tr '[:upper:]' '[:lower:]' | sed "s/'/''/g")
    if [[ -n "$where_clause" ]]; then where_clause="$where_clause OR "; fi
    where_clause="${where_clause}lower(title) LIKE '%${escaped}%'"
  done
  _akiflow_query "No events match '$query'." "
    SELECT start, end, title, account,
      CASE WHEN recurring THEN 'Y' ELSE '' END AS recurring, id
    FROM events_view
    WHERE ($where_clause)
    ORDER BY start ASC"
}
```
````

**Step 3: Test**

```bash
akiflow:search-tasks 'tax|IRS|filing|accountant'   # Should find tax-related tasks
akiflow:search-tasks 'parsley'                      # Should find Parsley Health
akiflow:search-events 'parsley'                     # Should find Parsley Health event
akiflow:search-events 'JLI|platform'                # Should find JLI Platform event
akiflow:search-events 'zzzzz'                       # Should show "No events match 'zzzzz'."
```

**Step 4: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add multi-keyword search and search-events"
```

---

### Task 5: Add `akiflow:stats`

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

**Step 1: Add `akiflow:stats` function**

Insert before the `## Sync Status` section (before line 673):

````markdown
### Quick stats
```bash
akiflow:stats() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:stats"
    echo "Show task and event counts."
    return 0
  fi
  local today
  today=$(date +%Y-%m-%d)
  sqlite3 "$AKIFLOW_DB" "
    SELECT
      'Overdue: ' || (SELECT count(*) FROM tasks_display WHERE scheduled_date < '$today' AND done = 0 AND deleted_at IS NULL)
    UNION ALL SELECT
      'Today: ' || (SELECT count(*) FROM tasks_display WHERE scheduled_date = '$today' AND done = 0 AND deleted_at IS NULL)
    UNION ALL SELECT
      'Upcoming 7d: ' || (SELECT count(*) FROM tasks_display WHERE scheduled_date > '$today' AND scheduled_date <= date('$today', '+7 days') AND done = 0 AND deleted_at IS NULL)
    UNION ALL SELECT
      'Inbox: ' || (SELECT count(*) FROM tasks_display WHERE status = 'inbox' AND done = 0 AND deleted_at IS NULL)
    UNION ALL SELECT
      'Someday: ' || (SELECT count(*) FROM tasks_display WHERE status = 'someday' AND done = 0 AND deleted_at IS NULL)
    UNION ALL SELECT
      'Events today: ' || (SELECT count(*) FROM events_view WHERE start >= '$today' AND start < date('$today', '+1 day'))
    UNION ALL SELECT
      'Events this week: ' || (SELECT count(*) FROM events_view WHERE start >= date('$today', '-' || (strftime('%w','$today')) || ' days') AND start < date('$today', '-' || (strftime('%w','$today')) || ' days', '+7 days'))"
}
```
````

**Step 2: Test**

```bash
akiflow:stats
# Expected output like:
# Overdue: 44
# Today: 0
# Upcoming 7d: 0
# Inbox: 4
# Someday: 68
# Events today: 0
# Events this week: 1
```

**Step 3: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add stats command"
```

---

### Task 6: Add `--format json` and `--limit N` flags

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

**Step 1: Update `_akiflow_query` helper to support flags**

Replace the `_akiflow_query` helper (added in Task 1) with:

```bash
_akiflow_query() {
  local msg="$1"; shift
  local format="markdown" limit="" query="$1"
  shift
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --format) format="$2"; shift 2 ;;
      --limit) limit="LIMIT $2"; shift 2 ;;
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
```

**Step 2: Update functions to pass through flags**

For each list function, parse `--format` and `--limit` from args and pass to `_akiflow_query`. Example for `akiflow:list-all`:

```bash
akiflow:list-all() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:list-all [--format json] [--limit N]"
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
```

Apply the same pattern to: `list-inbox`, `list-today`, `list-upcoming`, `list-someday`, `list-overdue`, `search-tasks`, `search-events`, `list-labels`, `list-events`, `list-slots`, `list-slots-today`.

**Step 3: Test**

```bash
akiflow:list-overdue --format json --limit 3   # JSON array, 3 items
akiflow:list-overdue --limit 5                  # Markdown table, 5 rows
akiflow:search-tasks 'tax' --format json        # JSON output
```

**Step 4: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add --format json and --limit N flags to all list commands"
```

---

### Task 7: Add `akiflow:reschedule-task` and improve help text

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

**Step 1: Add `akiflow:reschedule-task` convenience wrapper**

Insert after the `### Update a task` section:

````markdown
### Reschedule a task
```bash
akiflow:reschedule-task() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:reschedule-task <id> <YYYY-MM-DD>"
    echo "Move a task to a new date. Sets status to planned and clears datetime."
    return 0
  fi
  if [[ -z "${1:-}" || -z "${2:-}" ]]; then
    echo "Error: missing id or date" >&2
    echo "Usage: akiflow:reschedule-task <id> <YYYY-MM-DD>" >&2
    return 1
  fi
  local id="$1" date="$2"
  if ! [[ "$date" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]]; then
    echo "akiflow: invalid date: '$date' (expected YYYY-MM-DD)" >&2; return 1
  fi
  akiflow:update-task "$id" "{\"date\": \"$date\", \"status\": 2, \"datetime\": null}"
}
```
````

**Step 2: Add status codes to `create-task` and `update-task` help output**

In `akiflow:create-task()` help block, add after the existing help lines:

```bash
    echo "Status codes: 1=inbox, 2=planned, 3=completed, 4=snoozed, 5=archived, 6=deleted, 7=someday"
    echo "Priority: 0=none, 1=low, 2=medium, 3=high, 4=goal"
```

Same for `akiflow:update-task()`.

**Step 3: Add timezone note to Tips section**

Append to the `## Tips` section (line 699):

```markdown
- All `datetime` values are ISO 8601 UTC (ending in `Z`). The `TZ` env var is set to the user's local timezone for display formatting.
- `duration` is in minutes (e.g., `30` = 30 minutes).
```

**Step 4: Test**

```bash
akiflow:reschedule-task --help    # Should show usage with date format
akiflow:create-task --help        # Should include status codes
```

**Step 5: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add reschedule-task, improve help text and tips"
```

---

### Task 8: Run agent test prompts to validate Phase 1

**Files:**
- No file changes — validation only

**Step 1: Re-run the 5 test prompts from the original session**

Use the same 5 prompts from the design doc testing section. For each, launch an agent with the updated bash functions sourced, and count tool calls.

**Step 2: Compare results**

Target: ~18 total tool calls (down from 38). Verify:
- Empty result messages appear correctly
- `daily-brief` handles prompt 1 in a single call
- Multi-keyword search handles prompt 3 in fewer calls
- `search-events` handles prompt 5 without period-scanning

**Step 3: Document results**

Append results to `/tmp/akiflow-tool-optimizations.md` under a new `## Phase 1 Validation` section.

**Step 4: Commit validation results note**

No code commit needed — this is a validation checkpoint.

---

## Phase 2: Hybrid Vector + Keyword Search

### Task 9: Add Qdrant + OpenAI deps to akiflow-sync

**Files:**
- Modify: `akiflow-sync/package.json` (line 12-17, dependencies)

**Step 1: Install dependencies**

```bash
cd akiflow-sync && npm install @qdrant/js-client-rest openai
```

**Step 2: Verify package.json updated**

```bash
cat akiflow-sync/package.json | grep -A2 qdrant
cat akiflow-sync/package.json | grep -A2 openai
```

**Step 3: Commit**

```bash
git add akiflow-sync/package.json akiflow-sync/package-lock.json
git commit -m "chore(akiflow-sync): add qdrant and openai dependencies"
```

---

### Task 10: Create the vector indexer module

**Files:**
- Create: `akiflow-sync/src/indexer.ts`

**Step 1: Write the indexer**

This module:
1. Maintains an in-memory `Map<string, Set<string>>` of entities needing re-indexing
2. Exposes `markForReindex(table, id)` called from `resolveAndUpsert()`
3. Runs a 5-second background poller that drains the queue
4. Reads entity data from SQLite views (`tasks_display`, `events_view`)
5. Formats text for embedding
6. Calls OpenAI `text-embedding-3-small` for batch embeddings
7. Upserts to Qdrant collection `akiflow_entities`

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { logger } from './logger.js';

const COLLECTION = 'akiflow_entities';
const VECTOR_SIZE = 1536;
const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 100;

interface IndexableEntity {
  entity_type: 'task' | 'event';
  entity_id: string;
  title: string;
  label: string | null;
  org: string | null;
  account: string | null;
  status: string;
  scheduled_date: string | null;
  start_time: string | null;
  priority: number;
  done: boolean;
  deleted: boolean;
  updated_at: number;
  text: string; // formatted for embedding
}

const pendingIndex = new Map<string, Set<string>>();

export function markForReindex(table: string, id: string): void {
  if (table !== 'tasks' && table !== 'events') return;
  if (!pendingIndex.has(table)) pendingIndex.set(table, new Set());
  pendingIndex.get(table)!.add(id);
}

function pointId(entityType: string, entityId: string): string {
  const hash = crypto.createHash('md5').update(`${entityType}:${entityId}`).digest('hex');
  return [
    hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16),
    hash.slice(16, 20), hash.slice(20, 32),
  ].join('-');
}

function formatTaskText(row: Record<string, unknown>): string {
  const parts = [`[Task] ${row.title}`];
  if (row.label) parts.push(`Project: ${row.label}`);
  if (row.org && row.org !== row.label) parts.push(`Org: ${row.org}`);
  if (row.status) parts.push(`Status: ${row.status}`);
  if (row.description) {
    const desc = String(row.description).slice(0, 200);
    parts.push(desc);
  }
  return parts.join(' | ');
}

function formatEventText(row: Record<string, unknown>): string {
  const parts = [`[Event] ${row.title}`];
  if (row.account) parts.push(`Account: ${row.account}`);
  if (row.description) {
    const desc = String(row.description).slice(0, 200);
    parts.push(desc);
  }
  return parts.join(' | ');
}

async function ensureCollection(qdrant: QdrantClient): Promise<void> {
  const collections = await qdrant.getCollections();
  if (collections.collections.some((c) => c.name === COLLECTION)) return;
  await qdrant.createCollection(COLLECTION, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
  // Create payload indexes
  for (const field of ['entity_type', 'label', 'org', 'status', 'done', 'deleted']) {
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: field,
      field_schema: field === 'done' || field === 'deleted' ? 'bool' : 'keyword',
    });
  }
  await qdrant.createPayloadIndex(COLLECTION, {
    field_name: 'priority',
    field_schema: 'integer',
  });
  logger.info(`[indexer] created collection ${COLLECTION}`);
}

async function processBatch(
  db: Database.Database,
  openai: OpenAI,
  qdrant: QdrantClient,
  table: string,
  ids: string[],
): Promise<void> {
  const entities: IndexableEntity[] = [];

  if (table === 'tasks') {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, title, status, done, label, org, scheduled_date,
        datetime, priority, description, deleted_at
      FROM tasks_display WHERE id IN (${placeholders})
    `).all(...ids) as Record<string, unknown>[];

    for (const row of rows) {
      entities.push({
        entity_type: 'task',
        entity_id: String(row.id),
        title: String(row.title || ''),
        label: row.label ? String(row.label) : null,
        org: row.org ? String(row.org) : null,
        account: null,
        status: String(row.status || 'unknown'),
        scheduled_date: row.scheduled_date ? String(row.scheduled_date) : null,
        start_time: null,
        priority: Number(row.priority || 0),
        done: Boolean(row.done),
        deleted: row.deleted_at != null,
        updated_at: Date.now(),
        text: formatTaskText(row),
      });
    }
  } else if (table === 'events') {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, title, start, end, account, description, status, recurring
      FROM events_view WHERE id IN (${placeholders})
    `).all(...ids) as Record<string, unknown>[];

    for (const row of rows) {
      entities.push({
        entity_type: 'event',
        entity_id: String(row.id),
        title: String(row.title || ''),
        label: null,
        org: null,
        account: row.account ? String(row.account) : null,
        status: String(row.status || ''),
        scheduled_date: null,
        start_time: row.start ? String(row.start) : null,
        priority: 0,
        done: false,
        deleted: false,
        updated_at: Date.now(),
        text: formatEventText(row),
      });
    }
  }

  if (entities.length === 0) return;

  // Batch embed
  const texts = entities.map((e) => e.text);
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  const vectors = response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  // Upsert to Qdrant
  const points = entities.map((e, i) => ({
    id: pointId(e.entity_type, e.entity_id),
    vector: vectors[i],
    payload: {
      entity_type: e.entity_type,
      entity_id: e.entity_id,
      title: e.title,
      label: e.label,
      org: e.org,
      account: e.account,
      status: e.status,
      scheduled_date: e.scheduled_date,
      start_time: e.start_time,
      priority: e.priority,
      done: e.done,
      deleted: e.deleted,
      updated_at: e.updated_at,
    },
  }));

  await qdrant.upsert(COLLECTION, { points, wait: true });
  logger.info(`[indexer] indexed ${points.length} ${table}`);
}

export async function startIndexer(db: Database.Database): Promise<void> {
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.info('[indexer] OPENAI_API_KEY not set, vector indexing disabled');
    return;
  }

  const qdrant = new QdrantClient({ url: qdrantUrl });
  const openai = new OpenAI({ apiKey });

  await ensureCollection(qdrant);

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      for (const [table, ids] of pendingIndex.entries()) {
        if (ids.size === 0) continue;
        const batch = [...ids].slice(0, BATCH_SIZE);
        batch.forEach((id) => ids.delete(id));
        if (ids.size === 0) pendingIndex.delete(table);
        await processBatch(db, openai, qdrant, table, batch);
      }
    } catch (err) {
      logger.error(`[indexer] error: ${err}`);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);

  logger.info('[indexer] started (5s poll interval)');
}
```

**Step 2: Build and verify compilation**

```bash
cd akiflow-sync && npm run build
```
Expected: compiles without errors.

**Step 3: Commit**

```bash
git add akiflow-sync/src/indexer.ts
git commit -m "feat(akiflow-sync): add vector indexer module"
```

---

### Task 11: Hook indexer into the sync pipeline

**Files:**
- Modify: `akiflow-sync/src/conflict.ts` (line 9-33)
- Modify: `akiflow-sync/src/daemon.ts` (lines 113-114, 214, 242)
- Modify: `akiflow-sync/src/expand-recurrence.ts` (after instance insertion)

**Step 1: Hook `markForReindex` into `resolveAndUpsert`**

In `akiflow-sync/src/conflict.ts`, add import at top:
```typescript
import { markForReindex } from './indexer.js';
```

After each `upsertEntity()` call (lines 13, 26, 86), add:
```typescript
markForReindex(ctx.table, remote.id);
```

Specifically:
- After line 13: `markForReindex(ctx.table, remote.id);`
- After line 26: `markForReindex(ctx.table, entity.id);`
- After line 86: `markForReindex(ctx.table, (local as ApiEntity).id);`

**Step 2: Start the indexer in daemon.ts**

In `akiflow-sync/src/daemon.ts`, add import:
```typescript
import { startIndexer } from './indexer.js';
```

After the pending write poller start (line 114), add:
```typescript
await startIndexer(db);
logger.info('[daemon] vector indexer started');
```

**Step 3: Mark recurring event instances for re-index after expansion**

In `akiflow-sync/src/expand-recurrence.ts`, add import:
```typescript
import { markForReindex } from './indexer.js';
```

After the instance insertion transaction completes (after the `db.exec` that inserts into `event_instances`), add:
```typescript
// Mark all expanded instances for vector re-indexing
for (const inst of allInstances) {
  markForReindex('events', inst.instanceId);
}
```

Note: `events_view` unions single events + instances, so marking instance IDs will cause them to be looked up in `events_view` and re-indexed.

**Step 4: Build and verify**

```bash
cd akiflow-sync && npm run build
```

**Step 5: Commit**

```bash
git add akiflow-sync/src/conflict.ts akiflow-sync/src/daemon.ts akiflow-sync/src/expand-recurrence.ts
git commit -m "feat(akiflow-sync): hook vector indexer into sync pipeline"
```

---

### Task 12: Create the backfill script

**Files:**
- Create: `akiflow-sync/src/cli/backfill-vectors.ts`

**Step 1: Write the backfill script**

```typescript
import 'dotenv/config';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { initDb } from '../db.js';

const COLLECTION = 'akiflow_entities';
const BATCH_SIZE = 100;
const DELAY_MS = 1000;

// Reuse formatTaskText/formatEventText and pointId from indexer.ts
// Import them or duplicate here for standalone usage.
import { /* exports needed */ } from '../indexer.js';

async function main() {
  const dbPath = process.env.AKIFLOW_DB_PATH;
  if (!dbPath) throw new Error('AKIFLOW_DB_PATH not set');

  const db = initDb(dbPath);
  const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || 'http://localhost:6333' });
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  // Ensure collection exists (reuse ensureCollection from indexer)
  // ...

  // Backfill tasks
  const tasks = db.prepare(`
    SELECT id, title, status, done, label, org, scheduled_date,
      datetime, priority, description, deleted_at
    FROM tasks_display
    WHERE deleted_at IS NULL
  `).all() as Record<string, unknown>[];

  console.log(`Backfilling ${tasks.length} tasks...`);
  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    // Format, embed, upsert (same as processBatch in indexer.ts)
    console.log(`  Tasks ${i + 1}-${Math.min(i + BATCH_SIZE, tasks.length)}`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  // Backfill events
  const events = db.prepare(`
    SELECT id, title, start, end, account, description, status, recurring
    FROM events_view
  `).all() as Record<string, unknown>[];

  console.log(`Backfilling ${events.length} events...`);
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    // Format, embed, upsert
    console.log(`  Events ${i + 1}-${Math.min(i + BATCH_SIZE, events.length)}`);
    await new Promise((r) => setTimeout(r, DELAY_MS));
  }

  console.log('Backfill complete.');
  db.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
```

Note: Extract `formatTaskText`, `formatEventText`, `pointId`, and `ensureCollection` from `indexer.ts` as named exports so the backfill script can import them.

**Step 2: Build and test**

```bash
cd akiflow-sync && npm run build
node dist/cli/backfill-vectors.js
```

Expected: processes all tasks and events, prints progress.

**Step 3: Commit**

```bash
git add akiflow-sync/src/cli/backfill-vectors.ts akiflow-sync/src/indexer.ts
git commit -m "feat(akiflow-sync): add vector backfill script"
```

---

### Task 13: Add search endpoint to RAG service

**Files:**
- Create: `.claude/skills/add-akiflow-sync/add/rag-system/src/akiflow-search.ts` (or modify in the existing RAG skill path)
- Modify: `.claude/skills/add-akiflow-sync/add/rag-system/src/server.ts` (add route after line 151)
- Modify: `.claude/skills/add-akiflow-sync/add/rag-system/config/rag-config.json` (add akiflow section)

Note: Since the RAG service is installed by the `add-whatsapp-search` skill, and the akiflow search is installed by `add-akiflow-sync`, we need to decide how to layer this. The cleanest approach: `add-akiflow-sync` modifies the RAG service files via its `modify/` directory, same as it modifies `src/container-runner.ts` and `container/Dockerfile`.

**Step 1: Create the akiflow search module**

Create `rag-system/src/akiflow-search.ts`:

```typescript
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import crypto from 'crypto';

const COLLECTION = 'akiflow_entities';

interface SearchRequest {
  query: string;
  filters?: {
    entity_type?: 'task' | 'event';
    label?: string;
    org?: string;
    status?: string[];
    include_done?: boolean;
    include_deleted?: boolean;
    date_range?: { start?: string; end?: string };
  };
  limit?: number;
}

interface SearchResult {
  entity_type: string;
  entity_id: string;
  title: string;
  label: string | null;
  org: string | null;
  account: string | null;
  status: string;
  scheduled_date: string | null;
  start_time: string | null;
  priority: number;
  score: number;
}

export async function akiflowSearch(
  qdrant: QdrantClient,
  openai: OpenAI,
  db: Database.Database | null,
  req: SearchRequest,
): Promise<{ results: SearchResult[]; total: number }> {
  const limit = Math.min(req.limit || 10, 50);
  const filters = req.filters || {};

  // Build Qdrant filter
  const must: Record<string, unknown>[] = [];
  if (!filters.include_done) must.push({ key: 'done', match: { value: false } });
  if (!filters.include_deleted) must.push({ key: 'deleted', match: { value: false } });
  if (filters.entity_type) must.push({ key: 'entity_type', match: { value: filters.entity_type } });
  if (filters.label) must.push({ key: 'label', match: { value: filters.label } });
  if (filters.org) must.push({ key: 'org', match: { value: filters.org } });
  if (filters.status?.length) must.push({ key: 'status', match: { any: filters.status } });

  // Vector search
  const embResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: req.query,
  });
  const queryVector = embResponse.data[0].embedding;

  const vectorResults = await qdrant.search(COLLECTION, {
    vector: queryVector,
    limit: limit * 2,
    filter: must.length > 0 ? { must } : undefined,
    with_payload: true,
    score_threshold: 0.2,
  });

  // Normalize vector scores to 0-1
  const maxVectorScore = vectorResults.length > 0
    ? Math.max(...vectorResults.map((r) => r.score)) : 1;
  const vectorMap = new Map<string, { payload: Record<string, unknown>; score: number }>();
  for (const r of vectorResults) {
    const p = r.payload as Record<string, unknown>;
    const key = `${p.entity_type}:${p.entity_id}`;
    vectorMap.set(key, { payload: p, score: r.score / maxVectorScore });
  }

  // Keyword search (parallel — already complete by this point since vector was awaited)
  const keywordMap = new Map<string, { payload: Record<string, unknown>; score: number }>();
  if (db) {
    const terms = req.query.split(/\s+/).filter(Boolean);
    const likeClauses = terms.map((t) => {
      const escaped = t.toLowerCase().replace(/'/g, "''");
      return `lower(title) LIKE '%${escaped}%'`;
    });
    const whereKeyword = likeClauses.join(' OR ');

    // Search tasks
    const taskRows = db.prepare(`
      SELECT id, title, status, label, org, scheduled_date, datetime, priority, done, deleted_at
      FROM tasks_display
      WHERE (${whereKeyword})
        ${!filters.include_done ? 'AND done = 0' : ''}
        ${!filters.include_deleted ? 'AND deleted_at IS NULL' : ''}
        ${filters.entity_type === 'event' ? 'AND 1=0' : ''}
        ${filters.label ? `AND label = '${filters.label.replace(/'/g, "''")}'` : ''}
      LIMIT ${limit * 2}
    `).all() as Record<string, unknown>[];

    for (const row of taskRows) {
      const titleLower = String(row.title).toLowerCase();
      const queryLower = req.query.toLowerCase();
      const score = titleLower === queryLower ? 1.0
        : titleLower.includes(queryLower) ? 0.7 : 0.4;
      keywordMap.set(`task:${row.id}`, {
        payload: {
          entity_type: 'task', entity_id: row.id, title: row.title,
          label: row.label, org: row.org, account: null,
          status: row.status, scheduled_date: row.scheduled_date,
          start_time: null, priority: row.priority || 0,
        },
        score,
      });
    }

    // Search events
    if (filters.entity_type !== 'task') {
      const eventRows = db.prepare(`
        SELECT id, title, start, end, account, status, recurring
        FROM events_view
        WHERE (${whereKeyword})
        LIMIT ${limit * 2}
      `).all() as Record<string, unknown>[];

      for (const row of eventRows) {
        const titleLower = String(row.title).toLowerCase();
        const queryLower = req.query.toLowerCase();
        const score = titleLower === queryLower ? 1.0
          : titleLower.includes(queryLower) ? 0.7 : 0.4;
        keywordMap.set(`event:${row.id}`, {
          payload: {
            entity_type: 'event', entity_id: row.id, title: row.title,
            label: null, org: null, account: row.account,
            status: row.status, scheduled_date: null,
            start_time: row.start, priority: 0,
          },
          score,
        });
      }
    }
  }

  // Merge: 0.6 vector + 0.4 keyword
  const combined = new Map<string, SearchResult>();
  const allKeys = new Set([...vectorMap.keys(), ...keywordMap.keys()]);
  for (const key of allKeys) {
    const v = vectorMap.get(key);
    const k = keywordMap.get(key);
    const vectorScore = v?.score || 0;
    const keywordScore = k?.score || 0;
    const finalScore = 0.6 * vectorScore + 0.4 * keywordScore;
    const payload = (v?.payload || k?.payload)!;
    combined.set(key, {
      entity_type: String(payload.entity_type),
      entity_id: String(payload.entity_id),
      title: String(payload.title),
      label: payload.label ? String(payload.label) : null,
      org: payload.org ? String(payload.org) : null,
      account: payload.account ? String(payload.account) : null,
      status: String(payload.status),
      scheduled_date: payload.scheduled_date ? String(payload.scheduled_date) : null,
      start_time: payload.start_time ? String(payload.start_time) : null,
      priority: Number(payload.priority || 0),
      score: Math.round(finalScore * 100) / 100,
    });
  }

  const results = [...combined.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return { results, total: results.length };
}
```

**Step 2: Add route to RAG server**

In `rag-system/src/server.ts`, after the `/api/ingest` route (line 151), add:

```typescript
app.post('/api/akiflow/search', async (req, res) => {
  try {
    const { akiflowSearch } = await import('./akiflow-search.js');
    const result = await akiflowSearch(qdrantClient, openaiClient, akiflowDb, req.body);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
```

This requires the server to have references to a Qdrant client, OpenAI client, and optionally an akiflow SQLite DB. Add initialization for these in the server startup, reading `AKIFLOW_DB` env var.

**Step 3: Update rag-config.json**

Add to `rag-system/config/rag-config.json`:

```json
{
  "akiflow": {
    "collection": "akiflow_entities",
    "vectorSize": 1536,
    "search": {
      "vectorWeight": 0.6,
      "keywordWeight": 0.4,
      "topK": 10,
      "scoreThreshold": 0.2
    }
  }
}
```

**Step 4: Build and test**

```bash
cd rag-system && npm run build
# Start service, test endpoint:
curl -s http://localhost:3847/api/akiflow/search \
  -H "Content-Type: application/json" \
  -d '{"query": "taxes"}' | jq
```

**Step 5: Commit**

```bash
git add rag-system/src/akiflow-search.ts rag-system/src/server.ts rag-system/config/rag-config.json
git commit -m "feat(rag): add akiflow hybrid search endpoint"
```

---

### Task 14: Add `akiflow:search` bash function for container agents

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

**Step 1: Add `akiflow:search` function**

Insert a new top-level section `## Unified Search` after `## Calendars & Events`:

````markdown
## Unified Search

### Search across tasks and events (hybrid keyword + semantic)
```bash
akiflow:search() {
  if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
    echo "Usage: akiflow:search '<query>' [--type task|event] [--label <label>] [--limit N]"
    echo "Hybrid keyword + semantic search across tasks and events."
    echo "Falls back to keyword-only if RAG service is unreachable."
    return 0
  fi
  if [[ -z "${1:-}" ]]; then
    echo "Error: missing search query" >&2
    echo "Usage: akiflow:search '<query>'" >&2
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

  # Build JSON body
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

  # Try RAG service first
  local response
  response=$(curl -s --max-time 5 http://host.docker.internal:3847/api/akiflow/search \
    -H "Content-Type: application/json" \
    -d "$body" 2>/dev/null)

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
    # Fallback: keyword-only search via SQLite
    echo "(RAG service unavailable — falling back to keyword search)"
    akiflow:search-tasks "$query"
    akiflow:search-events "$query"
  fi
}
```
````

**Step 2: Update the `allowed-tools` line**

The SKILL.md frontmatter already has `allowed-tools: Bash(akiflow:*)` which covers all `akiflow:` prefixed functions, so no change needed.

**Step 3: Test**

```bash
akiflow:search 'taxes'
akiflow:search 'parsley health' --type event
akiflow:search 'accounting' --label TTO --limit 5
akiflow:search --help
```

**Step 4: Commit**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add unified hybrid search function"
```

---

### Task 15: Final validation and cleanup

**Files:**
- No new files — validation and cleanup only

**Step 1: Re-run all 5 agent test prompts**

Same prompts as Task 8, but now with vector search available.

**Step 2: Verify tool call reduction**

Target: 15 or fewer total calls across 5 prompts (down from 38).

**Step 3: Clean up test infrastructure**

```bash
rm /tmp/akiflow-test.db
rm /tmp/akiflow-helpers.sh
rm /tmp/akiflow-test-README.md
rm /tmp/akiflow-tool-optimizations.md
```

**Step 4: Grep for test paths**

```bash
grep -r '/tmp/akiflow' .claude/skills/ rag-system/ akiflow-sync/src/
```
Expected: zero matches. If any found, remove them.

**Step 5: Final commit**

```bash
git add -A
git commit -m "chore: clean up test artifacts from akiflow tool optimization"
```
