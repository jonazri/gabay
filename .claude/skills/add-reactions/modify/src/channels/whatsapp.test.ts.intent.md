# Intent: whatsapp.test.ts

## Changes
Adds tests for WhatsApp reaction functionality:
1. Tests `sendReaction()` sends correct message structure to socket
2. Tests `reactToLatestMessage()` queries DB and sends reaction
3. Tests reaction storage via `storeReaction()` DB call
4. Tests LID JID translation for reaction reactor JIDs
5. Tests authorization: only registered groups receive stored reactions
6. Tests emoji removal (empty string reaction)

## Key Sections to Find
- Test structure and fake socket setup
- Existing message handling tests
- Connection lifecycle tests
- `triggerMessages` and event emission pattern

## Invariants
- Baileys reaction event: `{ key: { id, remoteJid }, reaction: { text, key, senderTimestampMs } }`
- Socket reaction send format: `{ react: { text: emoji, key: messageKey } }`
- messageKey structure: `{ id, remoteJid, fromMe?, participant? }`
- `storeReaction` must be called for each received reaction
- Only registered groups receive and store reactions
- LID translation applies to reactor_jid in storeReaction call
