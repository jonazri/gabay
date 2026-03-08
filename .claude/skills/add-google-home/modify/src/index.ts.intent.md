# Overlay Intent: index.ts

## Summary
Integrates Google Home voice assistant support and event-based architecture with lifecycle guards (Shabbat mode, etc.). Introduces cursor manager for per-group message tracking, lifecycle hooks, and message event emissions.

## Changes

### 1. Imports (Lines 1-78)
**What:** Adds 8 new import blocks for Google Home, lifecycle, event emission, and cursor management
**Where to add:**
- Line 3: Add `import { fileURLToPath } from 'node:url';`
- Line 32: Remove `getRegisteredGroup` from db imports (was in base, now unused)
- Line 44: After ipc.js import, add Google Assistant imports block (6 functions)
- Line 45: Add `import './ipc-handlers/google-home.js';` (side-effect import)
- Line 62: After logger import, add lifecycle, cursor, and message-events imports

**Removed imports:** `getRegisteredGroup` from db destructuring

### 2. State Variables (Lines 86-88)
**What:** Replace `lastAgentTimestamp` Record with `CursorManager` instance
**Line to find:** `let lastAgentTimestamp: Record<string, string> = {};`
**Action:** Replace with: `const agentCursors = new CursorManager();`
**Purpose:** Per-group cursor tracking with encapsulation instead of bare object

### 3. loadState() Function (Lines 96-100)
**What:** Use CursorManager API instead of direct JSON parsing
**Lines to find:** `lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};` (and error handler)
**Action:** Replace both with `agentCursors.loadAll(...)`
**Invariant:** Both success and error paths must call `loadAll()` (not direct assignment)

### 4. saveState() Function (Line 111)
**What:** Use CursorManager getter instead of direct object serialization
**Line to find:** `setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));`
**Action:** Replace with: `setRouterState('last_agent_timestamp', JSON.stringify(agentCursors.getAll()));`

### 5. processGroupMessages() Function
**Changes:**
- **Line 177:** Add early return guard: `if (!shouldProcessMessages()) return true;`
- **Line 181:** Replace `lastAgentTimestamp[chatJid] || ''` with `agentCursors.get(chatJid)`
- **Lines 205-210:** Replace direct assignment with `agentCursors.advance(chatJid, timestamp)` call
- **Line 231:** Add `await emitAgentStarting(chatJid, group);` before setTyping
- **Line 237:** Add `await emitAgentOutput(chatJid, result);` at start of output callback
- **Lines 256, 262:** Add `await emitAgentSuccess/Error()` calls in result status handlers
- **Line 280:** Replace direct assignment with `agentCursors.advance(chatJid, previousCursor)`

**Purpose:** Guard message processing during active restrictions (Shabbat mode); emit events for external listeners; use CursorManager API

### 6. startMessageLoop() Function
**Changes:**
- **Lines 382-394:** Add lifecycle guard block before message processing loop:
  ```typescript
  let wasGuarded = !shouldProcessMessages();
  while (true) {
    if (!shouldProcessMessages()) {
      wasGuarded = true;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }
    if (wasGuarded) {
      await runGuardLiftedHooks();
      wasGuarded = false;
    }
    // ... existing try-catch
  ```
- **Line 404:** Change comment from `lastAgentTimestamp` to `agentCursors`
- **Line 408:** Replace `lastAgentTimestamp[chatJid] || ''` with `agentCursors.get(chatJid)`
- **Line 461:** Add `await emitMessagePiped(chatJid, messagesToSend.length);` after sendMessage check
- **Lines 420-421:** Replace direct assignment with `agentCursors.advance()` call

**Purpose:** Skip processing when lifecycle guards active; resume with hook on guard lift; emit piping events

### 7. recoverPendingMessages() Function (Line 496)
**Change:** Replace `lastAgentTimestamp[chatJid] || ''` with `agentCursors.get(chatJid)`

### 8. main() Function
**Changes:**
- **Line 518:** Add `await runStartupHooks();` after `loadState()`
- **Lines 524-527:** Add Google Assistant teardown before channel disconnect:
  ```typescript
  stopGoogleTokenScheduler();
  stopGoogleAssistantSocket();
  shutdownGoogleAssistant();
  ```
- **Line 531:** Add `await runShutdownHooks();` after channels disconnect
- **Line 581:** Add `await runChannelsReadyHooks(channels);` after all channels connected
- **Lines 625-627:** Add Google Assistant startup calls before message loop:
  ```typescript
  startGoogleTokenScheduler((msg) => notifyMainGroup(`[system] ${msg}`));
  startGoogleAssistantSocket();
  initGoogleAssistantDaemon().catch(() => {});
  ```

**Purpose:** Integrate Google Home daemon lifecycle; run extension hooks at key points

### 9. Direct Execution Guard (Lines 635-637)
**What:** Replace URL-based file equality check with simpler path resolution
**Lines to find:** The `isDirectRun` const using `new URL(...).pathname` comparisons
**Action:** Replace with:
```typescript
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isDirectRun = entryFile != null && thisFile === entryFile;
```
**Purpose:** More reliable cross-platform path comparison; avoid URL parsing edge cases

## Invariants to Preserve

1. **CursorManager API contract:** Use `.get()`, `.advance()`, `.getAll()`, and `.loadAll()` consistently — never direct object access
2. **Lifecycle guard placement:** Guard check must be at top of message loop, before message fetching
3. **Hook calling convention:** All hooks are async; must be awaited where called (startup, channels ready, shutdown, guard lifted)
4. **Event emission order:** `emitAgentStarting` → `setTyping(true)` → `runAgent` → `emitAgentOutput` (per streamed result) → `emitAgentSuccess/Error` → `setTyping(false)`
5. **Google Assistant teardown order:** Stop token scheduler → stop socket → shutdown daemon (reverse of startup order)
6. **notifyMainGroup function:** Must be implemented in a separate file/handler; used as callback to `startGoogleTokenScheduler`; sends system messages to main group only
7. **Message piping events:** `emitMessagePiped` called only when `queue.sendMessage()` succeeds (message piped to active container, not enqueued)
8. **Error handling:** All await calls in message loop wrapped in try-catch; shutdown handlers don't throw

## Key Sections in Base File

- Imports: Lines 1-62
- State initialization: Lines 85-88
- Load/save functions: Lines 92-112
- `processGroupMessages()`: Lines 167-290
- `runAgent()`: Lines 292-371
- `startMessageLoop()`: Lines 373-488
- `recoverPendingMessages()`: Lines 494-506
- `main()`: Lines 513-632
- Execution guard: Lines 635-643

## Dependencies

- **CursorManager class:** Must be imported from `./cursor-manager.js`; handles per-group timestamp tracking
- **Lifecycle hooks:** Must be imported from `./lifecycle.js`; `shouldProcessMessages()`, `runStartupHooks()`, `runShutdownHooks()`, `runGuardLiftedHooks()`, `runChannelsReadyHooks()`
- **Message events:** Must be imported from `./message-events.js`; `emitAgentStarting()`, `emitAgentOutput()`, `emitAgentSuccess()`, `emitAgentError()`, `emitMessagePiped()`
- **Google Assistant:** Must be imported from `./google-assistant.js`; provides daemon and socket/token scheduler functions
- **IPC handler:** `./ipc-handlers/google-home.js` (side-effect import, sets up message handlers)
- **notifyMainGroup helper:** Must exist or be implemented to send system messages to main group chat (implementation location TBD)

## Notes

- This overlay substantially refactors message processing with lifecycle awareness and per-group cursor tracking
- Early return guards at function start are preferred over deep nesting to maintain readability
- All timestamp operations now go through CursorManager to prevent direct state corruption
