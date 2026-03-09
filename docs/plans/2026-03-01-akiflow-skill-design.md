# Akiflow Skill — Design Document

**Date:** 2026-03-01
**Status:** Approved
**Branch:** feat/akiflow

---

## Overview

Add an `akiflow` container skill that gives the NanoClaw agent full task and calendar management via the Akiflow REST API. Accessible from the main group only.

## Akiflow Concepts (Reference)

Understanding these is required to write correct API calls:

- **Inbox** (status 1): New, unscheduled tasks. Default for new tasks.
- **Planned** (status 2): Tasks with a `date` assigned. With `date` only → appears as a "to-do" on that day. With `date` + `dateTime` → appears scheduled on the calendar.
- **Completed** (status 3): Done. Set `done: true`, `doneAt: <epoch ms>`, `status: 3`.
- **Snoozed** (status 4): Temporarily hidden until a snooze time.
- **Someday** (status 7): "Maybe later" list — no date, no active pressure.
- **Labels**: Unified model for both **projects** (`isTag: false`) and **tags** (`isTag: true`). Tasks use `labelId` (primary project) and `labelIds` (array of additional tag UUIDs).
- **Time Slots**: Calendar containers for organizing tasks by activity type (e.g., "Deep Work", "Admin"). They appear on the calendar but hold tasks, not events. Tasks reference them via `timeSlotId`. Distinct from calendar events.
- **Events**: Calendar events (meetings, appointments) from connected Google/Outlook accounts. Use v3 API.
- **Folders**: Organize labels/projects into groups. Referenced via `folderId` on labels.

### Reference Docs
- [Task Planning](https://product.akiflow.com/articles/8286936-task-planning) — how statuses, dates, and planning work
- [Time Slots](https://product.akiflow.com/help/articles/3089241-time-slots) — what time slots are and how tasks are assigned
- [Time Blocking 101](https://product.akiflow.com/help/articles/3677363-time-blocking-101) — time slot vs event distinction
- [What can Aki do?](https://product.akiflow.com/help/articles/5330825-what-can-aki-do) — Akiflow's own AI assistant capabilities (useful for understanding scope)
- [How to use guide index](https://how-to-use-guide.akiflow.com/) — official user guides
- [Informal API docs](../../../akiflow-docs/aki-mcp/AKIFLOW-API.md) — reverse-engineered API reference (our source of truth for endpoints)

---

## Architecture

A pure **container skill** — no new host-side services, no IPC, no daemons. Two changes to the NanoClaw host:

1. **`AKIFLOW_REFRESH_TOKEN`** added to `readSecrets()` in `src/container-runner.ts` so it's passed to every container via stdin (same pattern as `PERPLEXITY_API_KEY`).
2. **Container skill `SKILL.md`** added to `container/skills/akiflow/SKILL.md`, which gets auto-synced into every group's `.claude/skills/` at container startup.

> **Main group in practice**: The token is available to all groups, but the skill documentation and user's workflow will naturally center on the main group. No architectural restriction needed — YAGNI.

### File Structure

```
.claude/skills/add-akiflow/
├── manifest.yaml                          # Skill metadata + dependencies
├── SKILL.md                               # Install instructions (for /add-akiflow)
├── add/
│   └── container/
│       └── skills/
│           └── akiflow/
│               └── SKILL.md              # Container agent skill (bash functions)
└── modify/
    └── src/
        └── container-runner.ts           # Add AKIFLOW_REFRESH_TOKEN to readSecrets()
```

When the skill is installed and `npm run build` is run:
- `container/skills/akiflow/SKILL.md` is created in the built project
- `src/container-runner.ts` is patched to include `AKIFLOW_REFRESH_TOKEN`

---

## Authentication

**Token flow:**
1. `AKIFLOW_REFRESH_TOKEN` is stored in `.env` (gitignored) and passed to containers as a secret via stdin
2. A `akiflow:token` bash helper calls `POST https://web.akiflow.com/oauth/refreshToken` to get a short-lived access token (30 min TTL)
3. The token is cached in `/tmp/akiflow_token` with a 25-minute TTL (stat-based) to avoid redundant refresh calls within a session

**Cache strategy:** File-based TTL. On each `akiflow:token` call:
- If `/tmp/akiflow_token` exists and is `< 1500s` old → return cached token
- Otherwise → refresh from the API, write to `/tmp/akiflow_token`, return fresh token

This means at most one refresh call per 25 minutes regardless of how many operations the agent performs in a session.

---

## Exposed Functions

### Auth Helper
| Function | Description |
|---|---|
| `akiflow:token` | Returns a valid access token (cached 25 min) |

### Task Reads
| Function | Description |
|---|---|
| `akiflow:list-all` | All active (non-done) tasks |
| `akiflow:list-inbox` | Inbox tasks (status 1) |
| `akiflow:list-today` | Tasks with `date == today` |
| `akiflow:list-upcoming [days]` | Tasks in next N days (default 7) |
| `akiflow:list-someday` | Someday tasks (status 7) |
| `akiflow:search-tasks <query>` | Filter active tasks by title (case-insensitive substring) |

### Task Writes
| Function | Inputs | Description |
|---|---|---|
| `akiflow:create-task <json>` | JSON with `title` required; optional: `date`, `dateTime`, `duration`, `priority`, `labelId`, `labelIds`, `description`, `originUrl`, `status` | Create a task (auto-generates UUID) |
| `akiflow:update-task <id> <json>` | Task UUID + partial JSON patch | Update any task fields |
| `akiflow:complete-task <id>` | Task UUID | Mark done (sets `done`, `doneAt`, `status: 3`) |
| `akiflow:delete-task <id>` | Task UUID | Soft delete (sets `status: 6`, `deletedAt`) |

### Organization
| Function | Description |
|---|---|
| `akiflow:list-labels` | All active projects and tags with IDs, names, colors |

### Calendar & Events
| Function | Description |
|---|---|
| `akiflow:list-calendars` | All connected calendars (work + personal); use to get `calendarId` before creating events |
| `akiflow:list-events <start> <end>` | Events in ISO date range |
| `akiflow:create-event <json>` | Create event; requires `calendarId`, `title`, `start`, `end` |
| `akiflow:update-event <id> <json>` | Update event fields |
| `akiflow:delete-event <id>` | Soft delete event via `deletedAt` |

### Time Slots
| Function | Description |
|---|---|
| `akiflow:list-slots` | All active time slots |
| `akiflow:list-slots-today [date]` | Slots for a specific date (default today) |

> **Note on time slot CRUD**: The `POST /v5/time_slots` (PATCH pattern) exists in the API but field schema is not fully documented. The skill exposes reads. Creating/editing slots should use `akiflow:update-task` with `timeSlotId` to assign tasks to existing slots. Full slot CRUD can be added after inspecting the live API.

---

## API Reference Summary

| Entity | Read | Write | API Version |
|---|---|---|---|
| Tasks | `GET /v5/tasks?sync_token=` | `PATCH /v5/tasks` (array) | v5 |
| Labels | `GET /v5/labels?sync_token=` | `PATCH /v5/labels` (array) | v5 |
| Folders | `GET /v5/folders?sync_token=` | `PATCH /v5/folders` (array) | v5 |
| Time Slots | `GET /v5/time_slots?sync_token=` | `PATCH /v5/time_slots` (array) | v5 |
| Calendars | `GET /v3/calendars` | `PATCH /v3/calendars/{id}` | v3 |
| Events | `GET /v3/events?start=&end=` | `POST /v3/events` (create or update by id) | v3 |

Key patterns:
- v5 uses **sync_token** pattern (`sync_token=` for full sync)
- v5 writes use **PATCH with array** (create + update are the same call, identified by `id`)
- v5 deletes are **soft** via `deletedAt` timestamp or `status: 6`
- v3 uses standard REST; event updates use `POST` with an `id` field
- All IDs are **client-generated UUIDs** for new v5 entities
- Base URL: `https://api.akiflow.com`; token refresh: `https://web.akiflow.com/oauth/refreshToken`

---

## Implementation Plan

### Step 1: Skill scaffold
Create the skill directory structure and `manifest.yaml`.

### Step 2: `container-runner.ts` patch
Add `'AKIFLOW_REFRESH_TOKEN'` to the `readEnvFile([...])` array in `readSecrets()`. This is a one-line change.

### Step 3: Container `SKILL.md`
Write `container/skills/akiflow/SKILL.md` with:
- Frontmatter (`name`, `description`, `allowed-tools: Bash(akiflow:*)`)
- Concept reference (statuses, labels, time slots)
- `akiflow:token` helper with TTL caching
- All task read/write functions
- Label list function
- Calendar and event CRUD functions
- Time slot read functions
- Usage examples and tips

### Step 4: `SKILL.md` (install instructions)
Write `.claude/skills/add-akiflow/SKILL.md` describing what the skill does and how to install it (`npm run apply-skills`, add to `installed-skills.yaml`).

### Step 5: Update `.env.example`
Add `AKIFLOW_REFRESH_TOKEN=` so future setups know the key is needed.

### Step 6: Update `.nanoclaw/installed-skills.yaml`
Add `akiflow` to the installed skills list so `npm run build` applies it.

### Step 7: Build and test
Run `npm run build` to verify compilation. Smoke-test `akiflow:token` and `akiflow:list-inbox` from within a container session.

---

## Out of Scope (v1)

- Time slot creation/update (schema not documented — read-only for now)
- Folder CRUD (rarely needed interactively)
- Recurring task RRULE generation (complex; agent can set `recurrence` field manually)
- Automations via Aki Agent API (`https://aki.akiflow.com`) — separate auth flow, less stable
- Multi-account context mapping (agent reads calendar list and infers from names/emails)
