# index.ts Overlay Intent

## Overview
Refactors agent cursor tracking from direct object to `CursorManager` class, adds group lifecycle handlers, lifecycle hooks integration, and message event emission. Replaces `getRegisteredGroup()` import with `deleteRegisteredGroup()` and adds new function `unregisterGroup()`.

## Key Additions

### 1. New imports (lines 3, 28-29, 45, 58-72)
- `fileURLToPath` from 'node:url' — for module resolution checks
- `deleteRegisteredGroup` from db.js — replaces `getRegisteredGroup`
- `./ipc-handlers/group-lifecycle.js` — side-effect import for handlers
- `lifecycle.js` hooks: `runChannelsReadyHooks`, `runShutdownHooks`, `runStartupHooks`, `shouldProcessMessages`, `runGuardLiftedHooks`
- `CursorManager` from cursor-manager.js
- `message-events.js` emitters: `emitAgentStarting`, `emitAgentOutput`, `emitAgentSuccess`, `emitAgentError`, `emitMessagePiped`

### 2. State variable refactor (line 79)
- **Before**: `let lastAgentTimestamp: Record<string, string> = {};`
- **After**: `const agentCursors = new CursorManager();`
- Updates all cursor access to use `.get(chatJid)`, `.advance(chatJid, timestamp)`, `.getAll()`

### 3. `unregisterGroup(jid: string)` function (lines 130-139)
- Calls `deleteRegisteredGroup()` from db
- Removes from in-memory `registeredGroups` object if successful
- Logs deletion event

### 4. Guard checks in message processing
- `processGroupMessages()`: Added `shouldProcessMessages()` guard (line 179)
- `startMessageLoop()`: Moved from initialization, detects guard lift with `wasGuarded` flag and emits `runGuardLiftedHooks()` (lines 384-396)

### 5. Message event emissions (scattered in `processGroupMessages()` and `runAgent()`)
- `emitAgentStarting()` before channel typing
- `emitAgentOutput()` on each streamed result
- `emitAgentSuccess()` when result.status === 'success'
- `emitAgentError()` when result.status === 'error'
- `emitMessagePiped()` in message loop after piping to container

### 6. Lifecycle hook calls in `main()`
- `runStartupHooks()` after database load
- `runChannelsReadyHooks(channels)` after channels connect
- `runShutdownHooks()` during graceful shutdown

## Base File Structure
- Global state: lastTimestamp, sessions, registeredGroups, messageLoopRunning (lines 76-80)
- State management: `loadState()`, `saveState()` (lines 85-105)
- Group management: `registerGroup()` (lines 107-129)
- Message processing: `processGroupMessages()` (lines 169-292), `runAgent()` (lines 294-373), `startMessageLoop()` (lines 375-490)
- Recovery and initialization: `recoverPendingMessages()` (lines 496-508), `ensureContainerSystemRunning()` (lines 510-513), `main()` (lines 515-629)

## Invariants to Preserve
- Module execution guard: only runs when imported directly (lines 631-641)
- `registeredGroups` object remains the source of truth for group registration state
- Cursor advancement happens before message processing and saves to DB
- Error recovery: cursor rolls back on output failures, not on early output delivery
- Channel callbacks: `onMessage`, `onChatMetadata` signatures and behavior unchanged
- Queue behavior: `processGroupMessages` is still registered as the message processor callback
- Group trigger logic: non-main groups require trigger unless `requiresTrigger === false`
- Idle timeout mechanism: timer resets on agent output, clears on completion/error
