# Akiflow CLI Tool Optimizations Design

**Date:** 2026-03-08
**Status:** Draft

## Context

Ran 5 simulated agent test scenarios against the akiflow CLI tools using a clone of the live database. Agents made 38 tool calls across 5 prompts — many avoidable with better tooling. Full test analysis: `/tmp/akiflow-tool-optimizations.md`.

### Test Infrastructure

A test harness was set up for this work. **Before shipping any changes, verify test artifacts are cleaned up:**

- `/tmp/akiflow-test.db` — clone of live DB (read-only test copy)
- `/tmp/akiflow-helpers.sh` — bash function stubs with dry-run writes
- `/tmp/akiflow-test-README.md` — full cleanup instructions
- `/tmp/akiflow-tool-optimizations.md` — raw optimization findings

The akiflow-sync systemd service was started for initial sync then stopped. **Do not leave the service running during development** — writes from the test harness use dry-run stubs but the real service does not.

See `/tmp/akiflow-test-README.md` for re-running tests and full cleanup steps.

## Two-Phase Approach

- **Phase 1:** CLI tool improvements (bash function changes only, no new infra)
- **Phase 2:** Vector search with hybrid keyword+semantic retrieval

---

## Phase 1: CLI Tool Improvements

All changes target: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

### 1.1 Empty Result Messages

**Problem:** All list/search commands return silent nothing on 0 results. Agents can't distinguish success-with-zero-results from failure.

**Solution:** After every `sqlite3` call, check if output is empty. If so, print a contextual message:
```
No events found for today (2026-03-08).
No tasks match 'xyz'.
No overdue tasks.
```

Pattern (applied to every function):
```bash
local result
result=$(sqlite3 -markdown "$AKIFLOW_DB" "...")
if [[ -z "$result" ]]; then
  echo "No {entity} found for {context}."
else
  echo "$result"
fi
```

### 1.2 `akiflow:list-overdue`

**Problem:** `list-today` mixes overdue tasks with today's tasks. With 44 overdue items, today's actual tasks are buried.

**Solution:** Dedicated function:
```sql
SELECT title, label, org, scheduled_date, priority, links, id
FROM tasks_display
WHERE scheduled_date < '$today'
  AND done = 0 AND deleted_at IS NULL
ORDER BY scheduled_date ASC, sorting ASC
```

Includes a summary count header:
```
44 overdue tasks (JLI: 14, TTO: 9, Family: 7, Personal: 5, Other: 9)
```

Also update `akiflow:list-today` to exclude overdue (only show `scheduled_date = today`).

### 1.3 `akiflow:daily-brief`

**Problem:** "What's on my plate today?" requires 4-5 separate calls.

**Solution:** Single function that outputs:
```
=== Today: Sunday, March 8, 2026 ===

--- Events ---
No meetings today.

--- Tasks ---
No tasks scheduled for today.

--- Overdue (44) ---
JLI: 14 | TTO: 9 | Family: 7 | Personal: 5 | Other: 9
(use akiflow:list-overdue for details)

--- Inbox (4 unscheduled) ---
- Experiment OCR with Dicta Illuminate
- Ask Eliot Tanenbaum for TTO help
- Ask Michael Milgrom for TTO help
- Hand cream for YY Zirkind

--- Upcoming (next 3 days) ---
No tasks in the next 3 days.
```

Runs 4 SQL queries internally but presents one consolidated view.

### 1.4 Multi-Keyword Search

**Problem:** Agent made 5 separate `search-tasks` calls for synonyms.

**Solution:** Accept `|`-separated keywords:
```bash
akiflow:search-tasks 'tax|IRS|filing|accountant'
```

Implementation: split on `|`, build SQL:
```sql
WHERE (lower(title) LIKE '%tax%' OR lower(title) LIKE '%irs%' OR ...)
  AND done = 0 AND deleted_at IS NULL
```

Apply to both `search-tasks` and `search-events` (new function).

### 1.5 `akiflow:search-events`

**Problem:** No way to search events by title. Agents must list events period-by-period.

**Solution:** Mirror `search-tasks` but on `events_view`:
```bash
akiflow:search-events '<query>'
```
```sql
SELECT start, end, title, account,
  CASE WHEN recurring THEN 'Y' ELSE '' END AS recurring, id
FROM events_view
WHERE lower(title) LIKE '%${query}%'
ORDER BY start ASC
```

Supports multi-keyword (`|`) same as search-tasks.

### 1.6 `akiflow:stats`

**Problem:** Every agent counted rows manually to report summary numbers.

**Solution:**
```
Overdue: 44 (JLI:14, TTO:9, Family:7, Personal:5, Other:9)
Today: 0
Upcoming 7d: 0
Inbox: 4
Someday: 68
Events today: 0
Events this week: 1
```

Single SQL query using `CASE WHEN` aggregation.

### 1.7 Output Format Improvements

**`--format json`** flag on all list commands:
```bash
akiflow:list-today --format json
```

Switches from `sqlite3 -markdown` to `sqlite3 -json`. Default remains markdown.

**`--limit N`** flag on list commands:
```bash
akiflow:list-overdue --limit 5
```

Appends `LIMIT N` to SQL query.

**`links` column** hidden by default in table output. Reduces table width significantly. Agents can use `akiflow:get-task <id>` for full details including links.

### 1.8 Minor Fixes

- **`akiflow:reschedule-task <id> <date>`** — convenience wrapper that sets `date`, `status: 2`, and clears `datetime`.
- **Duration unit clarification** — verify if seconds or minutes, document correctly.
- **Timezone note** — add to SKILL.md: "All datetime values are ISO 8601 UTC. TZ env var is set to user's local timezone."
- **Status codes in `--help`** — include status mapping in `create-task --help` and `update-task --help`.

---

## Phase 2: Hybrid Vector + Keyword Search

### 2.1 Architecture Overview

```
akiflow-sync daemon                    RAG service (port 3847)
┌──────────────────────┐              ┌─────────────────────────┐
│ resolveAndUpsert()   │              │ /api/akiflow/search     │
│   ↓                  │              │   ↓                     │
│ index queue (Set)    │              │ Parallel:               │
│   ↓ (5s poller)      │              │  ├─ Vector: embed query  │
│ Read from SQLite     │──embed+──→   │  │   → Qdrant search    │
│ Format text          │  upsert      │  └─ Keyword: SQLite LIKE│
│ Embed via OpenAI     │              │   ↓                     │
│ Upsert to Qdrant     │              │ Merge + rerank          │
└──────────────────────┘              │   ↓                     │
                                      │ Return results          │
                                      └─────────────────────────┘
                                                ↑
                                      Container agent calls via
                                      akiflow:search (curl)
```

### 2.2 Qdrant Collection: `akiflow_entities`

**Vector:** 1536-dim (OpenAI `text-embedding-3-small`, same as WhatsApp search)

**Text format for embedding:**
- **Tasks:** `"[Task] {title} | Project: {label} | Org: {org} | Status: {status} | {description_first_200_chars}"`
- **Events:** `"[Event] {title} | Account: {account} | {description_first_200_chars}"`

Labels and account names are embedded in the text so semantic search understands organizational context (e.g., searching "JLI work" surfaces JLI-labeled tasks).

**Payload (stored + filterable):**

| Field | Type | Indexed | Source |
|-------|------|---------|--------|
| `entity_type` | keyword | yes | "task" or "event" |
| `entity_id` | keyword | yes | Akiflow UUID |
| `title` | text | no | Task/event title |
| `label` | keyword | yes | From `tasks_display.label` or null |
| `org` | keyword | yes | From `tasks_display.org` or null |
| `account` | keyword | yes | From `events_view.account` or null |
| `status` | keyword | yes | inbox/planned/someday/completed/etc |
| `scheduled_date` | keyword | yes | ISO date or null |
| `start_time` | keyword | yes | ISO datetime (events only) |
| `priority` | integer | yes | 0-4 |
| `done` | bool | yes | false for active |
| `deleted` | bool | yes | false for active |
| `updated_at` | integer | no | Epoch ms for staleness checks |

**ID format:** UUID generated from MD5 of `{entity_type}:{entity_id}` (same pattern as WhatsApp search).

**What gets indexed:**
- All active tasks (status 1-7, not deleted)
- Completed tasks (kept for historical search, filtered by `done` flag)
- All events from `events_view` (which includes expanded recurring instances, already deduped)
- Re-index after every recurring event expansion run

### 2.3 Ingestion Pipeline (in akiflow-sync daemon)

**Change tracking:**
Hook into `resolveAndUpsert()` in `conflict.ts`. After upsert, add entity ID to an in-memory `Set<string>`:
```typescript
// New module: akiflow-sync/src/indexer.ts
const pendingIndex = new Map<string, Set<string>>();
// e.g., { "tasks": Set(["uuid1", "uuid2"]), "events": Set(["uuid3"]) }

export function markForReindex(table: string, id: string) {
  if (table !== 'tasks' && table !== 'events') return;
  if (!pendingIndex.has(table)) pendingIndex.set(table, new Set());
  pendingIndex.get(table)!.add(id);
}
```

**Background poller (5-second interval):**
1. Drain `pendingIndex` into a local copy
2. For tasks: query `tasks_display` by IDs
3. For events: query `events_view` by IDs
4. Format text strings
5. Batch embed via OpenAI (reuse existing `embeddings.ts` pattern)
6. Upsert to Qdrant with payload metadata

**Recurring event re-indexing:**
After `expandRecurringEvents()` completes, mark all instance IDs for re-index. Since instances are rebuilt from scratch each time, do a bulk delete + re-insert for the `entity_type=event AND recurring=true` segment.

**Initial backfill script:**
`akiflow-sync/src/cli/backfill-vectors.ts` — reads all tasks + events from views, embeds in batches of 100 with 1s delay, upserts to Qdrant. Run once after setup:
```bash
node akiflow-sync/dist/cli/backfill-vectors.js
```

**Deleted items:**
When `resolveAndUpsert()` processes an item with `deleted_at != null`, update the Qdrant point's `deleted` payload to `true` (don't remove — allows "search including deleted" if needed).

### 2.4 Search Endpoint

**New endpoint in RAG service:** `POST /api/akiflow/search`

```typescript
interface AkiflowSearchRequest {
  query: string;
  filters?: {
    entity_type?: "task" | "event";
    label?: string;
    org?: string;
    status?: string[];          // e.g., ["planned", "inbox"]
    include_done?: boolean;     // default false
    include_deleted?: boolean;  // default false
    date_range?: {
      start?: string;           // ISO date
      end?: string;
    };
  };
  limit?: number;               // default 10, max 50
}
```

**Hybrid search flow:**

```
Query: "taxes"
    │
    ├──→ [Vector Path] ─────────────────────────────────┐
    │    1. Embed query via OpenAI                       │
    │    2. Qdrant search with payload filters           │
    │    3. Get top 20 results with scores               │
    │    4. Normalize scores to 0-1                      │
    │                                                    │
    ├──→ [Keyword Path] ────────────────────────────────┐│
    │    1. Split query on spaces → keywords             ││
    │    2. SQLite LIKE on tasks_display + events_view   ││
    │    3. Score: 1.0 exact title, 0.7 substring title, ││
    │       0.4 description match                        ││
    │    4. Get top 20 results                           ││
    │                                                    ││
    └──→ [Merge] ←──────────────────────────────────────┘│
         1. Union results by entity_id                    │
         2. Combined = 0.6 * vector_score + 0.4 * keyword│
         3. Deduplicate                                   │
         4. Sort by combined score DESC                   │
         5. Return top N                                  │
```

**Response:**
```json
{
  "query": "taxes",
  "results": [
    {
      "entity_type": "task",
      "entity_id": "12a7f6d8-...",
      "title": "Dich Alane back taxes",
      "label": "Family",
      "org": "Family",
      "status": "planned",
      "scheduled_date": "2026-02-28",
      "priority": 0,
      "score": 0.92
    }
  ],
  "total": 2
}
```

### 2.5 Container Agent Function: `akiflow:search`

```bash
akiflow:search '<query>' [--type task|event] [--label <label>] [--limit N]
```

Calls `curl http://host.docker.internal:3847/api/akiflow/search` with JSON body built from args.

Output:
```
Found 2 results for "taxes":
| type | title                | date       | status  | label  | score |           id           |
|------|----------------------|------------|---------|--------|-------|------------------------|
| task | Dich Alane back taxes| 2026-02-28 | OVERDUE | Family |  0.92 | 12a7f6d8-52f9-46b9-... |
| task | Personal back taxes  | 2026-02-28 | OVERDUE | Family |  0.87 | 7d0dab7b-6c7c-442b-... |
```

Falls back to keyword-only search if RAG service is unreachable (direct SQLite query).

### 2.6 Configuration

Add to `rag-system/config/rag-config.json`:
```json
{
  "akiflow": {
    "collection": "akiflow_entities",
    "vectorSize": 1536,
    "distance": "Cosine",
    "dbPath": null,
    "search": {
      "vectorWeight": 0.6,
      "keywordWeight": 0.4,
      "topK": 10,
      "scoreThreshold": 0.2
    }
  }
}
```

`dbPath` is set at runtime from `AKIFLOW_DB` env var (same as container mount).

---

## Testing Strategy

### Phase 1 Testing
- Re-run the 5 agent test prompts from the original test session against the updated bash functions
- Verify empty result messages appear correctly
- Verify `daily-brief` returns consolidated output
- Verify multi-keyword search works
- Compare tool call counts: target ~18 calls (down from 38)

### Phase 2 Testing
- Backfill vectors, verify collection stats match entity counts
- Test hybrid search with queries from the 5 test scenarios
- Verify incremental indexing: create a task, wait 5s, search finds it
- Verify recurring event re-indexing after expansion
- Test fallback to keyword-only when RAG service is down

### Test Infra Cleanup Checklist
Before merging either phase:
- [ ] Remove `/tmp/akiflow-test.db`
- [ ] Remove `/tmp/akiflow-helpers.sh`
- [ ] Remove `/tmp/akiflow-test-README.md`
- [ ] Remove `/tmp/akiflow-tool-optimizations.md`
- [ ] Verify akiflow-sync service is in desired state (`systemctl --user status akiflow-sync`)
- [ ] Verify no test paths leaked into SKILL.md or config files (grep for `/tmp/akiflow`)

---

## File Changes Summary

### Phase 1 (bash functions only)
| File | Changes |
|------|---------|
| `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md` | Add empty result messages, list-overdue, daily-brief, search-events, stats, multi-keyword search, --format/--limit flags, reschedule-task, hide links column, help improvements |

### Phase 2 (vector search)
| File | Changes |
|------|---------|
| `akiflow-sync/src/indexer.ts` | New — vector indexing queue + background poller |
| `akiflow-sync/src/conflict.ts` | Hook `markForReindex()` after upsert |
| `akiflow-sync/src/daemon.ts` | Start index poller, trigger re-index after expansion |
| `akiflow-sync/src/expand-recurrence.ts` | Trigger bulk re-index after instance rebuild |
| `akiflow-sync/src/cli/backfill-vectors.ts` | New — one-time backfill script |
| `akiflow-sync/package.json` | Add `@qdrant/js-client-rest`, `openai` deps |
| `rag-system/src/server.ts` | Add `/api/akiflow/search` endpoint |
| `rag-system/src/akiflow-search.ts` | New — hybrid search logic |
| `rag-system/config/rag-config.json` | Add `akiflow` section |
| `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md` | Add `akiflow:search` function |
