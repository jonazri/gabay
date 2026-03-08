# ipc.ts Overlay Intent

## Overview
Extends IPC handler with reaction message support, periodic message recovery heartbeat, and group lifecycle operations (unregister, status heartbeat). Removes task update operation in favor of separate lifecycle handlers.

## Key Additions

### 1. Extended IpcDeps interface (lines 15-31)
- `sendReaction?: (jid: string, emoji: string, messageId?: string) => Promise<void>` — optional reaction sender
- `unregisterGroup?: (jid: string) => boolean` — optional group deletion
- `statusHeartbeat?: () => void` — optional periodic status check
- `recoverPendingMessages?: () => void` — optional message recovery

### 2. Recovery interval constant (line 34)
- `RECOVERY_INTERVAL_MS = 60_000` — 60 second interval for periodic recovery

### 3. Recovery timing state (line 47)
- `let lastRecoveryTime = Date.now()` — tracks when last recovery ran

### 4. Reaction message handling in IPC message loop (lines 104-139)
- Checks for `data.type === 'reaction'` with `chatJid`, `emoji`, and optional `messageId`
- Same authorization checks as message: main group or self-group can send
- Try-catch wrapper to handle individual reaction failures
- Logs successful sends and errors separately
- Cleanup: unlinkSync after successful reaction

### 5. Periodic recovery and heartbeat calls (lines 196-205)
- Calls `deps.statusHeartbeat?.()` unconditionally
- Calls `deps.recoverPendingMessages?.()` every 60 seconds (checks elapsed time)
- Both called before `setTimeout(processIpcFiles, IPC_POLL_INTERVAL)`

### 6. Task ID generation simplification (line 307)
- **Before**: `data.taskId || 'task-${Date.now()}...'` (allowed override)
- **After**: Always generate new ID: `'task-${Date.now()}...'` (fixed)

### 7. Variable naming clarity (line 296)
- **Before**: `const date = new Date(...)`
- **After**: `const scheduled = new Date(...)` (matches intent)

### 8. Removed: `update_task` case (was lines 327-395 in base)
- Entire task update operation removed — delegated to separate handler/lifecycle

## Base File Structure
- IpcDeps interface: message/group sync callback signatures (lines 13-25)
- IPC watcher setup and polling loop: `startIpcWatcher()` (lines 38-212)
- Message/reaction file processing: loops in `processIpcFiles()` (lines 77-195)
- Task IPC handler: `processTaskIpc()` function (lines 214-447)
- Task operations: schedule_task, pause_task, resume_task, cancel_task, update_task (base), refresh_groups, register_group

## Invariants to Preserve
- IPC directory structure: `DATA_DIR/ipc/{groupFolder}/{messages,tasks}/`
- File format: JSON files with `type`, `chatJid`, and operation-specific fields
- Authorization model: main group can act on all groups, non-main groups self-only
- Reaction cleanup: `fs.unlinkSync()` only on successful send, move to errors dir on failure
- Error handling: failed messages/reactions logged but don't abort loop
- Folder identity: `sourceGroup` derived from directory path, not from message data
- isMain lookup: built from `registeredGroups[].isMain` once per loop iteration
- Recovery timing: uses wall-clock `Date.now()` to avoid drift in interval checks
- Task fields validation: taskId, prompt, schedule_type, schedule_value, chatJid required
- Cron/interval parsing: unchanged, uses `CronExpressionParser` with timezone
