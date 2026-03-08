# Intent: types.ts

## Changes
Updates type definitions to support reply context throughout the system. Adds three optional fields to `NewMessage` interface: `replied_to_id`, `replied_to_sender`, `replied_to_content`. Adds `QuotedMessageKey` interface for outbound reply support.

## Key Sections
- `NewMessage` interface (line 45-57): Add three optional fields for reply context
- `QuotedMessageKey` interface (line 59-65): New interface with id, remoteJid, fromMe, participant, and content
- `Channel` interface (line 93-120): Ensure `sendMessage` signature includes optional `quotedKey` parameter

## Invariants
- All three replied_to fields are optional in `NewMessage`
- `QuotedMessageKey` includes all fields needed by Baileys (id, remoteJid, fromMe, participant)
- `sendMessage` method signature must accept optional `QuotedMessageKey` third parameter
- Types must be consistent across all files that import them
