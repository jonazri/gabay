# Intent: ipc.ts

## Changes
Adds reaction message handling to the IPC watcher:
1. Adds `sendReaction` as optional dependency in `IpcDeps` interface
2. Processes reaction JSON files from IPC directories alongside message files
3. Implements authorization check: main group can react anywhere, non-main groups only in their own chat
4. Calls `sendReaction` with chatJid, emoji, and optional messageId
5. Handles reaction send failures gracefully (log error, don't crash)

## Key Sections to Find
- `IpcDeps` interface definition
- Message processing loop (after line 76, before task processing)
- Authorization pattern for message sending (reuse for reactions)

## Invariants
- Reaction data structure: `{ type: 'reaction', chatJid, emoji, messageId?, ... }`
- Authorization must use same pattern as messages: `isMain || (targetGroup && folder === sourceGroup)`
- `sendReaction` call signature: `(jid, emoji, messageId)` where messageId is optional
- Error handling must not throw; log and continue
- Reaction files must be deleted after successful processing
