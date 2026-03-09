# media-processing.ts overlay intent — image-vision skill

## What changed
- Added imports for `isImageMessage` and `processImage` from `./image.js`
- Replaced image placeholder comment with image attachment handler

## Key sections
- **Imports**: Added image.js imports
- **processMediaAttachment function**: Added image detection, download, resize, and content marker generation

## Invariants (must-keep)
- `downloadMediaMessage` import from Baileys (shared by all handlers)
- `logger` import
- `MediaResult` interface
- `processMediaAttachment` function signature
- Document attachments placeholder comment (for pdf-reader)
- `return null` at end of function
