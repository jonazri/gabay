# Intent: whatsapp.ts

## Changes
Adds WhatsApp reaction support:
1. Listens to `messages.reaction` event from Baileys socket
2. Extracts reaction data: messageId, chatJid, reactorJid, emoji, timestamp
3. Translates LID JIDs (if needed) to phone JIDs
4. Stores reaction in DB via `storeReaction()`
5. Implements `sendReaction()` method: sends reaction back to WhatsApp via socket
6. Implements `reactToLatestMessage()` method: queries DB for latest message, then sends reaction

## Key Sections to Find
- Socket event listeners (around line 180)
- Message normalization and translation logic
- Registered groups check pattern
- `sendMessage()` implementation (for pattern reference)

## Invariants
- Reaction data structure from Baileys: `{ key: { id, remoteJid }, reaction: { text, key, senderTimestampMs } }`
- `storeReaction` import must be present from db.js
- `getLatestMessage` import must be present from db.js
- Reaction message format for sending: `{ react: { text: emoji, key: messageKey } }`
- LID translation must work for reaction participant JIDs (same as message sender)
- Emoji '' means "remove reaction" (both in store and send)
