# Intent: ipc-auth.test.ts

## Changes
Adds comprehensive authorization tests for IPC reaction messages:
1. Tests `processTaskIpc()` with reaction operations
2. Tests authorization pattern: main group can react in any group, non-main only in own group
3. Tests that sendReaction dependency is mocked and called correctly
4. Tests edge cases: unregistered target JID, missing messageId (react to latest)

## Key Sections to Find
- `processTaskIpc()` function and its deps parameter
- Existing authorization test patterns (register_group, schedule_task, etc.)
- Mock setup for `sendReaction` in IpcDeps

## Invariants
- Authorization gate: `isMain || (targetGroup && targetGroup.folder === sourceGroup)`
- sendReaction must be called only if authorization passes
- Reaction data passed to startIpcWatcher: `{ type: 'reaction', chatJid, emoji, messageId? }`
- messageId is optional (undefined means react to latest)
- Unauthorized attempts must be silently blocked (no error thrown, no side effects)
