# media-processing.ts overlay intent — pdf-reader skill

## What changed
- Added `fs` and `path` imports
- Replaced document placeholder comment with PDF attachment handler

## Key sections
- **Imports**: Added fs, path (needed for file system operations)
- **processMediaAttachment function**: Added PDF detection, download, save to disk, and content marker generation

## Invariants (must-keep)
- `downloadMediaMessage` import from Baileys (shared by all handlers)
- `logger` import
- `MediaResult` interface
- `processMediaAttachment` function signature
- Image attachments section (from image-vision skill or placeholder)
- `return null` at end of function
