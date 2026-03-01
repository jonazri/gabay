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
