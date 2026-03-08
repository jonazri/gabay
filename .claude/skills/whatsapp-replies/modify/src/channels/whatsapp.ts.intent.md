# Intent: whatsapp.ts

## Changes
Adds reply/quote context extraction and passthrough. Extracts reply metadata from `contextInfo` in extended/image/video messages and includes it in the message payload sent to `onMessage`. Implements quoted message handling in `sendMessage` for sending replies.

## Key Sections
- `extractQuotedText` function (line 44-61): Extract text from various message types in quoted message proto
- Message handler at line 268-281: Extract contextInfo and quoted message fields
- Fields stored: `repliedToId`, `repliedToSender`, `repliedToContent` (line 274-281)
- `sendMessage` method (line 450-465): Handle optional `quotedKey` parameter and construct `quoted` field for Baileys

## Invariants
- `contextInfo` is extracted from the appropriate message type (extendedTextMessage, imageMessage, or videoMessage)
- `stanzaId` becomes `repliedToId` (extracted from context)
- `participant` becomes `repliedToSender` (extracted from context)
- When sending a reply, `quotedKey` includes id, remoteJid, fromMe, and participant for Baileys
