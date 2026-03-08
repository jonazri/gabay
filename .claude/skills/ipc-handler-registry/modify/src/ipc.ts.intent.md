# ipc-handler-registry: ipc.ts Intent

## Overview
Adds extensible IPC task handler registry to core IPC processing. Allows other skills to register custom task type handlers without modifying core switch statement.

## Changes

1. **New import** (line 12):
   - `getIpcHandler` from `./ipc-handlers.js` — retrieves handler for unrecognized task types

2. **Default case in switch** (lines 387–394):
   - Replaces bare `default: logger.warn()` with registry lookup
   - Attempts `getIpcHandler(data.type)` for unknown types
   - Calls handler with `(data, deps, context)` where context includes `sourceGroup` and `isMain`
   - Falls back to "Unknown IPC task type" warning if no handler found

## Key Sections to Locate

- `switch (data.type)` block starting at line 182
- Default case (previously line ~387, now redirects to handler registry)
- `processTaskIpc()` signature and deps parameter

## Invariants

- All built-in cases (`schedule_task`, `pause_task`, `resume_task`, `cancel_task`, `refresh_groups`, `register_group`) remain unchanged in switch
- Handler context always includes `sourceGroup` and `isMain` for authorization checks
- No changes to authorization logic (isMain checks, group folder validation)
- Handler invocation must be async-aware (awaits handler result)
- Unknown types that have no registered handler still log warning
