# Akiflow Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a NanoClaw skill (`add-akiflow`) that gives the container agent full Akiflow task and calendar management via bash functions.

**Architecture:** A pure container skill — no new host services or IPC. The skill adds `container/skills/akiflow/SKILL.md` (bash functions for the container agent) and patches `src/container-runner.ts` to pass `AKIFLOW_REFRESH_TOKEN` as a secret. Token caching uses a 25-minute `/tmp` file TTL so refresh calls are minimized across a session.

**Tech Stack:** Bash (container skill functions), TypeScript (one-line host patch), vitest (existing test suite), `curl` + `jq` (runtime API calls inside container)

**Task Dependencies:**

```
Task 1 (scaffold)
    ├── Task 2 (container SKILL.md)    ─┐
    ├── Task 3 (container-runner patch)  ├── Task 5 (build + test) → Task 6 (smoke test)
    └── Task 4 (SKILL.md + registry)   ─┘
```

- **Task 1** must run first — creates the directory structure all other tasks write into
- **Tasks 2, 3, 4** are fully independent of each other and can run in parallel once Task 1 is done; they write to different files and only Task 3 runs `apply-skills`
- **Task 5** gates on Tasks 2, 3, and 4 all being complete before building
- **Task 6** gates on Task 5

---

## Context: How NanoClaw Skills Work

Skills live in `.claude/skills/<name>/`. Running `npm run apply-skills` patches `src/` with all installed skills, then `tsc` compiles. `npm run clean-skills` restores `src/` to upstream.

A skill package contains:
- `manifest.yaml` — metadata and dependency declaration
- `SKILL.md` — install instructions (what `/add-akiflow` shows to Claude Code)
- `add/` — new files to create verbatim
- `modify/` — complete file replacements (must be the FULL accumulated file, not a diff)

The `modify/src/container-runner.ts` file must be the **accumulated state** after all currently-installed skills. Get it by running `npm run apply-skills`, editing `src/container-runner.ts`, then saving that file.

**Design doc:** `docs/plans/2026-03-01-akiflow-skill-design.md`
**API reference:** `akiflow-docs/aki-mcp/AKIFLOW-API.md`

---

## Task 1: Scaffold the skill directory

**Files:**
- Create: `.claude/skills/add-akiflow/manifest.yaml`

**Step 1: Create directory structure**

```bash
mkdir -p .claude/skills/add-akiflow/add/container/skills/akiflow
mkdir -p .claude/skills/add-akiflow/modify/src
```

**Step 2: Write `manifest.yaml`**

Create `.claude/skills/add-akiflow/manifest.yaml`:

```yaml
skill: akiflow
version: 1.0.0
description: "Full Akiflow task + calendar management for the container agent"
core_version: 0.1.0
adds:
  - container/skills/akiflow/SKILL.md
modifies:
  - src/container-runner.ts
modify_base:
  src/container-runner.ts: _accumulated
conflicts: []
incompatible_with: []
depends:
  - auth-recovery
  - container-hardening
  - perplexity-research
tested_with: []
test: "npx tsc --noEmit"
```

**Step 3: Commit**

```bash
git add .claude/skills/add-akiflow/manifest.yaml
git commit -m "feat(akiflow): scaffold skill directory and manifest"
```

---

## Task 2: Write the container skill SKILL.md

**Files:**
- Create: `.claude/skills/add-akiflow/add/container/skills/akiflow/SKILL.md`

This is the skill the container agent sees. It provides bash function patterns using `curl` and `jq` against the Akiflow API.

**Step 1: Write the container SKILL.md**

Create `.claude/skills/add-akiflow/add/container/skills/akiflow/SKILL.md` with this exact content:

````markdown
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
| **Planned** (status 2) | Has a `date` assigned. With `date` only → appears as a to-do. With `date` + `dateTime` → appears on calendar. |
| **Completed** (status 3) | Done. Set `done: true`, `doneAt: <epoch ms>`, `status: 3`. |
| **Snoozed** (status 4) | Temporarily hidden. |
| **Someday** (status 7) | "Maybe later" — no date, no active pressure. |
| **Labels** | Both **projects** (`isTag: false`) and **tags** (`isTag: true`). `labelId` = primary project, `labelIds` = array of tag UUIDs. |
| **Time Slots** | Calendar containers for activity types (e.g., "Deep Work", "Admin"). Hold tasks, not events. Tasks reference them via `timeSlotId`. |
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

### List all active tasks
```bash
akiflow:list-all() {
  curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.done == false and .deletedAt == null and (.status == 1 or .status == 2 or .status == 4 or .status == 7))]'
}
```

### List inbox tasks (unscheduled)
```bash
akiflow:list-inbox() {
  curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.done == false and .deletedAt == null and .status == 1)]'
}
```

### List today's tasks
```bash
akiflow:list-today() {
  local today
  today=$(date +%Y-%m-%d)
  curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq --arg today "$today" '[.data[] | select(.done == false and .deletedAt == null and .date == $today)]'
}
```

### List upcoming tasks
```bash
akiflow:list-upcoming() {
  local days="${1:-7}"
  local end_date today
  end_date=$(date -d "+${days} days" +%Y-%m-%d 2>/dev/null || date -v+${days}d +%Y-%m-%d)
  today=$(date +%Y-%m-%d)
  curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq --arg start "$today" --arg end "$end_date" \
        '[.data[] | select(.done == false and .deletedAt == null and .date != null and .date >= $start and .date <= $end)]'
}
```

### List someday tasks
```bash
akiflow:list-someday() {
  curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.done == false and .deletedAt == null and .status == 7)]'
}
```

### Search tasks by title (case-insensitive substring)
```bash
akiflow:search-tasks() {
  local query="$1"
  curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq --arg q "$query" '[.data[] | select(.done == false and .deletedAt == null and (.title | ascii_downcase | contains($q | ascii_downcase)))]'
}
```

### Create a task

Pass a JSON object. Required: `title`. Optional fields:

| Field | Type | Notes |
|---|---|---|
| `status` | number | Default 1 (INBOX). Use 2 (PLANNED) with a `date`. |
| `date` | string | ISO date: `"2026-03-05"` |
| `dateTime` | number | Epoch ms for specific time |
| `duration` | number | Minutes |
| `priority` | number | 0=none, 1=low, 2=medium, 3=high, 4=goal |
| `labelId` | string | Primary project UUID |
| `labelIds` | string[] | Additional tag UUIDs |
| `description` | string | Rich text notes |
| `originUrl` | string | Link to source (email, web page, etc.) |

```bash
akiflow:create-task() {
  local json="$1"
  local id
  id=$(uuidgen | tr '[:upper:]' '[:lower:]')
  local payload
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id} | if .status == null then . + {status: 1} else . end')
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
akiflow:create-task '{"title": "Review PR", "date": "2026-03-03", "status": 2, "priority": 2, "labelId": "project-uuid"}'

# Task with link, tags, and description
akiflow:create-task '{"title": "Read this article", "originUrl": "https://example.com", "labelIds": ["tag-uuid"], "description": "Important context"}'
```

### Update a task

Pass the task UUID and a partial JSON object with only the fields to change.

```bash
akiflow:update-task() {
  local id="$1"
  local patch="$2"
  local payload
  payload=$(echo "$patch" | jq --arg id "$id" '. + {id: $id}')
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
akiflow:update-task "task-uuid" '{"priority": 3, "labelId": "project-uuid"}'

# Add tags
akiflow:update-task "task-uuid" '{"labelIds": ["tag-uuid-1", "tag-uuid-2"]}'

# Add URL and description
akiflow:update-task "task-uuid" '{"originUrl": "https://example.com", "description": "Notes here"}'

# Move to someday (remove date)
akiflow:update-task "task-uuid" '{"status": 7, "date": null, "dateTime": null}'

# Assign to a time slot
akiflow:update-task "task-uuid" '{"timeSlotId": "slot-uuid"}'
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
    -d "[{\"id\":\"$id\",\"done\":true,\"doneAt\":$now_ms,\"status\":3}]" | jq '.data[0]'
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
    -d "[{\"id\":\"$id\",\"status\":6,\"deletedAt\":$now_ms}]" | jq '.data[0]'
}
```

## Labels (Projects & Tags)

### List all labels
```bash
akiflow:list-labels() {
  curl -sf "https://api.akiflow.com/v5/labels?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.deletedAt == null)] | sort_by(.sorting)'
}
```

Response fields: `id`, `name`, `color` (hex), `isTag` (false=project, true=tag), `folderId` (optional folder grouping).

Use `isTag: false` to filter just projects; `isTag: true` for tags.

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
  payload=$(echo "$json" | jq --arg id "$id" '. + {id: $id}')
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
  curl -sf -X POST "https://api.akiflow.com/v3/events" \
    -H "Authorization: Bearer $(akiflow:token)" \
    -H "Content-Type: application/json" \
    -d "{\"id\":\"$id\",\"deletedAt\":$now_ms}" | jq '.data // .'
}
```

## Time Slots

Time Slots are calendar containers for organizing tasks by activity type (e.g., "Deep Work", "Admin"). They appear on the calendar but hold tasks — not appointments. Tasks are assigned to slots via `timeSlotId`.

See: [Time Slots docs](https://product.akiflow.com/help/articles/3089241-time-slots)

### List all time slots
```bash
akiflow:list-slots() {
  curl -sf "https://api.akiflow.com/v5/time_slots?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq '[.data[] | select(.deletedAt == null)]'
}
```

### List time slots for a specific date
```bash
akiflow:list-slots-today() {
  local date="${1:-$(date +%Y-%m-%d)}"
  curl -sf "https://api.akiflow.com/v5/time_slots?sync_token=" \
    -H "Authorization: Bearer $(akiflow:token)" \
    | jq --arg date "$date" '[.data[] | select(.deletedAt == null and .date == $date)]'
}
```

To assign a task to a slot: `akiflow:update-task "task-uuid" '{"timeSlotId": "slot-uuid"}'`

> **Note:** Creating/updating time slots follows the v5 PATCH pattern but the full field schema is undocumented. Use `akiflow:list-slots` to inspect existing slots before attempting to create new ones.

## Tips

- `date` is ISO string (`"2026-03-01"`); `dateTime` is epoch milliseconds for the specific time on that day
- Setting `status: 2` with `date` = planned; add `dateTime` to make it appear on the calendar timeline
- `labelId` = primary project UUID; `labelIds` = array of additional tag UUIDs
- `originUrl` links a task to a URL (email thread, web page, Jira ticket, etc.)
- Check `isWritable: true` on a calendar before creating events on it
- The v5 API does a full sync on empty `sync_token=` — for large task lists this returns everything; filter client-side with `jq`
````

**Step 2: Verify the file was created**

```bash
ls -la .claude/skills/add-akiflow/add/container/skills/akiflow/SKILL.md
```
Expected: file exists, ~200 lines.

**Step 3: Commit**

```bash
git add .claude/skills/add-akiflow/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow): add container agent skill with full task/calendar/slot functions"
```

---

## Task 3: Patch container-runner.ts to pass AKIFLOW_REFRESH_TOKEN

**Files:**
- Create: `.claude/skills/add-akiflow/modify/src/container-runner.ts`

The modify file must be the **complete accumulated file** (all previous skills applied) with the new key added. Get it by applying all skills first.

**Step 1: Apply current skills to src/**

```bash
npm run apply-skills
```

Expected: no errors, `src/container-runner.ts` now reflects all installed skills.

**Step 2: Add AKIFLOW_REFRESH_TOKEN to readSecrets()**

In `src/container-runner.ts`, find the `readSecrets()` function (around line 256). It looks like:

```typescript
function readSecrets(): Record<string, string> {
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'PERPLEXITY_API_KEY',
  ]);
}
```

Add `'AKIFLOW_REFRESH_TOKEN'` to the array:

```typescript
function readSecrets(): Record<string, string> {
  return readEnvFile([
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'PERPLEXITY_API_KEY',
    'AKIFLOW_REFRESH_TOKEN',
  ]);
}
```

**Step 3: Copy the modified file into the skill**

```bash
cp src/container-runner.ts .claude/skills/add-akiflow/modify/src/container-runner.ts
```

**Step 4: Restore src/ to clean upstream state**

```bash
npm run clean-skills
```

Expected: `src/container-runner.ts` no longer has `AKIFLOW_REFRESH_TOKEN` (back to upstream).

**Step 5: Verify the skill modify file has the key**

```bash
grep AKIFLOW_REFRESH_TOKEN .claude/skills/add-akiflow/modify/src/container-runner.ts
```

Expected: one match in the `readEnvFile([...])` call.

**Step 6: Commit**

```bash
git add .claude/skills/add-akiflow/modify/src/container-runner.ts
git commit -m "feat(akiflow): patch container-runner to pass AKIFLOW_REFRESH_TOKEN secret"
```

---

## Task 4: Write install SKILL.md and update registry files

**Files:**
- Create: `.claude/skills/add-akiflow/SKILL.md`
- Modify: `.env.example` — add `AKIFLOW_REFRESH_TOKEN=`
- Modify: `.nanoclaw/installed-skills.yaml` — add `akiflow` to list

**Step 1: Write the install SKILL.md**

Create `.claude/skills/add-akiflow/SKILL.md`:

```markdown
---
name: add-akiflow
description: Add full Akiflow task and calendar management to the container agent. Gives the agent bash functions to create, update, complete, and delete tasks; manage projects and tags; list and create calendar events; and inspect time slots. Auth uses AKIFLOW_REFRESH_TOKEN from .env.
---

# Add Akiflow

Installs the `akiflow` container skill, which gives the agent full access to your Akiflow tasks, projects, events, and time slots via the unofficial REST API.

## Prerequisites

Add your Akiflow refresh token to `.env`:

```
AKIFLOW_REFRESH_TOKEN=def502...
```

To get the refresh token: open Akiflow desktop app DevTools → Network tab → find any API request → copy the `refresh_token` from a `/oauth/refreshToken` request body, or capture it during login. See `akiflow-docs/aki-mcp/AKIFLOW-API.md` for details.

## What Gets Added

- `container/skills/akiflow/SKILL.md` — bash functions for the container agent:
  - `akiflow:token` — auto-refreshing cached access token (25 min TTL)
  - Task reads: `list-all`, `list-inbox`, `list-today`, `list-upcoming`, `list-someday`, `search-tasks`
  - Task writes: `create-task`, `update-task`, `complete-task`, `delete-task`
  - Labels: `list-labels` (projects + tags)
  - Calendar: `list-calendars`, `list-events`, `create-event`, `update-event`, `delete-event`
  - Time slots: `list-slots`, `list-slots-today`

- `src/container-runner.ts` — patched to include `AKIFLOW_REFRESH_TOKEN` in the secrets passed to containers

## Install

```bash
# 1. Add to installed-skills.yaml (already done if you're reading this via npm run build)
# 2. Ensure AKIFLOW_REFRESH_TOKEN is in .env
# 3. Build
npm run build
```
```

**Step 2: Add key to .env.example**

Open `.env.example` and add at the bottom:

```
# Akiflow task manager (unofficial API — see akiflow-docs/aki-mcp/AKIFLOW-API.md)
AKIFLOW_REFRESH_TOKEN=
```

**Step 3: Add skill to installed-skills.yaml**

Open `.nanoclaw/installed-skills.yaml` and add `akiflow` after `perplexity-research`:

```yaml
skills:
  - reactions
  - refresh-oauth
  - auth-recovery
  - group-lifecycle
  - google-home
  - shabbat-mode
  - container-hardening
  - task-scheduler-fixes
  - whatsapp-resilience
  - voice-transcription-elevenlabs
  - voice-recognition
  - whatsapp-search
  - perplexity-research
  - akiflow              # ← add this line
  - feature-request
  - whatsapp-summary
```

**Step 4: Commit**

```bash
git add .claude/skills/add-akiflow/SKILL.md .env.example .nanoclaw/installed-skills.yaml
git commit -m "feat(akiflow): add install SKILL.md, register skill, document env key"
```

---

## Task 5: Build and verify

**Step 1: Run full build**

```bash
npm run build
```

Expected: applies all skills (including akiflow), compiles TypeScript, restores `src/`. No errors.

**Step 2: Verify AKIFLOW_REFRESH_TOKEN is in compiled output**

```bash
grep AKIFLOW_REFRESH_TOKEN dist/container-runner.js
```

Expected: one match.

**Step 3: Run the test suite**

```bash
npx vitest run
```

Expected: all tests pass. The container-runner tests mock fs/spawn so the new key doesn't affect them.

**Step 4: Verify the container skill is in the right place**

```bash
ls container/skills/akiflow/SKILL.md
```

Expected: file exists (was copied during build's apply-skills step — but then cleaned). Check the skill source instead:

```bash
ls .claude/skills/add-akiflow/add/container/skills/akiflow/SKILL.md
```

Expected: file exists.

**Step 5: Commit**

```bash
git add dist/
git commit -m "feat(akiflow): build — compiled with AKIFLOW_REFRESH_TOKEN in readSecrets"
```

---

## Task 6: Smoke test (manual)

**Step 1: Verify token refresh works**

With `.env` containing `AKIFLOW_REFRESH_TOKEN`, test the get-token.py script (still in aki-mcp docs):

```bash
python3 akiflow-docs/aki-mcp/get-token.py
```

Expected: prints an access token (JWT starting with `eyJ`). This confirms the refresh token in `.env` is valid.

**Step 2: Smoke test list-inbox directly**

```bash
TOKEN=$(python3 akiflow-docs/aki-mcp/get-token.py -q)
curl -sf "https://api.akiflow.com/v5/tasks?sync_token=" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.data[] | select(.done == false and .deletedAt == null and .status == 1)] | length'
```

Expected: a number (your current inbox count). This confirms the API is reachable and the token works.

**Step 3: Final commit if smoke test passes**

```bash
git add .
git commit -m "feat(akiflow): skill complete — token verified, API reachable"
```

---

## Done

The `akiflow` container skill is installed. On next `npm run build`, `container/skills/akiflow/SKILL.md` will be present in the built project and auto-synced into every group's `.claude/skills/` directory at container startup.

The agent in the main group can now use all `akiflow:*` bash functions. Start with `akiflow:list-labels` to get project/tag UUIDs and `akiflow:list-calendars` to get calendar IDs.
