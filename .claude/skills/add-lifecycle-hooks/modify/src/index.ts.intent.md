# Intent: add-lifecycle-hooks / src/index.ts

## Overview
Integrates lifecycle hook system into the orchestrator for startup, shutdown, guard lifting, and channel readiness events.

## Changes

### Imports
- Adds `lifecycle.js` import: `runChannelsReadyHooks`, `runShutdownHooks`, `runStartupHooks`, `shouldProcessMessages`, `runGuardLiftedHooks`
- Adds `cursor-manager.js` import: `CursorManager` class
- Adds `message-events.js` import: event emission functions (`emitAgentStarting`, `emitAgentOutput`, `emitAgentSuccess`, `emitAgentError`, `emitMessagePiped`)
- Removes `getRegisteredGroup` import from `db.js` (no longer used)

### State Management
- Replaces `lastAgentTimestamp: Record<string, string>` with `agentCursors: CursorManager` instance
- Uses `CursorManager` API: `.get(chatJid)`, `.advance(chatJid, timestamp)`, `.loadAll()`, `.getAll()`
- Cursor loading/saving now delegates to CursorManager in `loadState()` and `saveState()`

### Message Loop Guard
- Adds guard check in `startMessageLoop()` (line 376-385):
  - Respects `shouldProcessMessages()` guard (e.g., Shabbat mode)
  - Tracks `wasGuarded` state for one-time `runGuardLiftedHooks()` execution when guard lifts
- Guard prevents message processing but allows the loop to continue polling

### Lifecycle Hooks Integration
- `main()` calls `runStartupHooks()` after DB initialization (line 509)
- `main()` calls `runShutdownHooks()` in graceful shutdown handler (line 516)
- Channel connection completion calls `runChannelsReadyHooks(channels)` (line 569)
- All hook calls are awaited

### Message Event Emissions
- New events emitted during message processing and agent execution:
  - `emitAgentStarting(chatJid, group)` before agent starts (line 222)
  - `emitAgentOutput(chatJid, result)` on each agent result (line 228)
  - `emitAgentSuccess(chatJid)` on success status (line 247)
  - `emitAgentError(chatJid, error)` on error status (line 252)
  - `emitMessagePiped(chatJid, count)` when messages are piped to container (line 452)

## Key Sections to Locate in Base

1. **Imports section** (lines 1-54 in overlay)
   - All `lifecycle.js`, `cursor-manager.js`, and `message-events.js` imports are new
   - Removal of `getRegisteredGroup` from `db.js` import

2. **Global state declarations** (lines 74-81)
   - Replace `lastAgentTimestamp: Record<string, string>` with `agentCursors = new CursorManager()`

3. **loadState() function** (lines 83-98)
   - Update agent timestamp loading to use CursorManager (was direct JSON parse of `lastAgentTimestamp`)

4. **saveState() function** (lines 100-103)
   - Update to use `agentCursors.getAll()` instead of direct `lastAgentTimestamp`

5. **startMessageLoop() function** (lines 364-479)
   - Add guard check and `wasGuarded` tracking before the main `while (true)` loop
   - Hook calls occur at guard lift points

6. **main() function** (lines 504-617)
   - Call `runStartupHooks()` after DB initialization
   - Call `runChannelsReadyHooks(channels)` after all channels connect
   - Call `runShutdownHooks()` in shutdown handler before `process.exit(0)`

7. **processGroupMessages() function** (lines 158-281)
   - All cursor operations now use `agentCursors.get()` and `agentCursors.advance()`
   - Event emission calls interspersed in output handling and status checking

## Invariants

1. **CursorManager state consistency**: Cursor advances must always be saved to DB via `saveState()` immediately after modification to prevent losing progress on crash
2. **Guard flag lifecycle**: `wasGuarded` must be reset to `false` after `runGuardLiftedHooks()` to avoid re-triggering
3. **Event emission order**:
   - `emitAgentStarting` must fire before agent execution
   - Status events (`emitAgentSuccess`, `emitAgentError`) must fire based on actual result status, not predicted
4. **Hook call ordering**:
   - Startup hooks run after DB init but before channels connect (allows hooks to configure system state)
   - Channels ready hooks run after all channels connected successfully
   - Shutdown hooks run before process.exit()
5. **Guard lift timing**: `runGuardLiftedHooks()` executes once when transitioning from guarded to unguarded state, not on every iteration
6. **Message flow**: Cursor advances in message processing path must use same CursorManager instance as agent processing path to maintain consistency
