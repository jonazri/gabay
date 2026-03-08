# Intent: src/ipc.ts

## What changed
Adds error recovery and structured error responses to the IPC handler system. Integrates `ipc-handlers.js` for extensible IPC command dispatch and `ipc-self-heal.js` for writing error notifications back to the container.

## Key sections

### Imports (lines 12-16)
- Added: `import { getIpcHandler } from './ipc-handlers.js'`
- Added: `import { writeIpcNotification, writeIpcErrorResponse } from './ipc-self-heal.js'`

### processTaskIpc data parameter (line 172)
- Added: `requestId?: string` field for error response routing

### processTaskIpc switch statement (lines 392-434)
- Added: `default` case that calls `getIpcHandler(data.type)`
- If handler exists: wraps execution with try/catch
  - On error: calls `writeIpcErrorResponse()` and `writeIpcNotification()`
- If no handler found: calls both error functions with `'unknown_ipc_type'` status
- Passes `sourceGroup` and `isMain` context to handlers

## Invariants (must-keep)
- All core IPC operations (schedule_task, pause_task, resume_task, cancel_task, refresh_groups, register_group) unchanged
- Authorization checks (`isMain`, `sourceGroup` comparison) unchanged
- Task creation, DB operations, and logging unchanged
- Group registration safety guards (folder validation, isMain enforcement) unchanged
- Message delivery authorization unchanged
