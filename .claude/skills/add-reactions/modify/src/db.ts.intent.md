# Intent: db.ts

## Changes
Adds SQLite table and API for storing and querying message reactions:
1. Creates `reactions` table in schema with primary key (message_id, chat_jid, reactor_jid)
2. Adds indexes on message_id+chat_jid (query reactions for a message), reactor_jid, emoji, and timestamp
3. Implements `storeReaction()`: insert or update reaction, delete if emoji is empty string
4. Implements `_getReactionsForMessage()`: test helper to query reactions for a specific message

## Key Sections to Find
- `createSchema()` function
- Existing table definitions (messages, chats, etc.)
- Function exports at end of file

## Invariants
- Primary key must be (message_id, message_chat_jid, reactor_jid) to allow one reaction per user per message
- Null emoji should delete the reaction (upsert logic)
- Table must exist before any storeReaction calls
- `_getReactionsForMessage()` is test-only; not used in production
- Indexes must support efficient lookups by message, reactor, emoji, and timestamp
