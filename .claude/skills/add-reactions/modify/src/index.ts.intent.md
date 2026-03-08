# Intent: index.ts

## Changes
Adds reaction support to the orchestrator's IPC watcher integration and status tracking:
1. Passes `sendReaction` dependency to `startIpcWatcher()` with a closure that routes reactions through the channel layer
2. Initializes `StatusTracker` with a `sendReaction` callback to enable status emoji recovery
3. Adds `getMessageFromMe()` DB call to determine if a specific message was sent by the bot (needed to set `fromMe` in messageKey)

## Key Sections to Find
- Imports section (db.js, types.js)
- `startIpcWatcher()` call (around line 709)
- `StatusTracker` initialization (around line 652)
- `findChannel()` usage pattern

## Invariants
- `startIpcWatcher` signature must accept `sendReaction` in its deps object
- `StatusTracker` constructor must accept a config object with `sendReaction` callback
- Message key structure: `{ id, remoteJid, fromMe?, participant? }`
- `getMessageFromMe()` must be imported from db.js
