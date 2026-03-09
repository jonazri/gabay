# whatsapp.test.ts overlay intent — media-processing skill

## What changed
- Added `vi.mock('../group-folder.js')` returning a stub `resolveGroupFolderPath`
- Added `vi.mock('../media-processing.js')` returning a stub `processMediaAttachment` that resolves to null

## Why
The whatsapp.ts overlay imports `resolveGroupFolderPath` and `processMediaAttachment`.
Without these mocks, the imports throw during test setup, silently breaking all
message-handling tests (errors caught by the try/catch in messages.upsert handler).

## Ordering constraint
Same as the whatsapp.ts overlay — this skill MUST be last in installed-skills.yaml
so that earlier `_accumulated` overlays don't overwrite the mocks.
