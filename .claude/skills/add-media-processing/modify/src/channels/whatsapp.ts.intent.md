# whatsapp.ts overlay intent — media-processing skill

## What changed
- Added `resolveGroupFolderPath` import from `../group-folder.js`
- Added `processMediaAttachment` import from `../media-processing.js`
- Changed `const content` to `let content` (allows media handlers to override)
- Added `processMediaAttachment()` call with `resolveGroupFolderPath()` after text extraction, before `!content` guard

## Key sections
- **Module imports**: Added group-folder and media-processing imports AFTER registry.js (avoids context conflicts with other skills)
- **messages.upsert handler**: Changed const→let, added processMediaAttachment call with resolveGroupFolderPath

## Ordering constraint
This skill MUST be the last skill in installed-skills.yaml that modifies
whatsapp.ts, because earlier skills use `_accumulated` overlays that would
overwrite our changes if they applied after us.

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
