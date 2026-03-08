# whatsapp.ts overlay intent — media-processing skill

## What changed
- Added `GROUPS_DIR` to config import
- Added `processMediaAttachment` import from `../media-processing.js`
- Changed `const content` to `let content` (allows media handlers to override)
- Added `processMediaAttachment()` call after text extraction, before `!content` guard

## Key sections
- **Config import block**: Added GROUPS_DIR
- **Module imports**: Added media-processing import
- **messages.upsert handler**: Changed const→let, added processMediaAttachment call

## Invariants (must-keep)
- Connection lifecycle (connect, reconnect, disconnect)
- Auth (QR code, pairing code, creds.update)
- LID-to-phone JID translation
- Group metadata sync (24h cache)
- Outgoing message queue and flush
- Typing indicators
- All existing text extraction logic (conversation, extendedTextMessage, captions)
- The `!content` guard (unchanged)
- onMessage callback structure
- registerChannel call
