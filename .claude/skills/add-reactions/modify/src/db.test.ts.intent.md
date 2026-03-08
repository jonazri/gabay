# Intent: db.test.ts

## Changes
Adds test suite for reaction storage and retrieval:
1. Tests `storeReaction()` with various emoji values
2. Tests `_getReactionsForMessage()` retrieval
3. Tests upsert behavior (same reactor+message updates emoji)
4. Tests deletion (empty emoji string removes reaction)

## Key Sections to Find
- Test file structure and imports
- Existing message storage test patterns
- Test helper functions

## Invariants
- Tests must use `_getReactionsForMessage()` to verify stored reactions
- Reaction primary key: (message_id, message_chat_jid, reactor_jid)
- Deletion happens when emoji is empty string ''
- Upsert: same (message_id, chat_jid, reactor_jid) replaces previous emoji
- Tests must be isolated; use beforeEach to reset database
