# Media Processing: Image Vision + PDF Reader

Date: 2026-03-08

## Problem

The upstream `add-image-vision` and `add-pdf-reader` skills ship with ~420-line full-file whatsapp.ts overlays built against vanilla upstream. This fork has 6+ skills already modifying whatsapp.ts (voice-transcription, reactions, whatsapp-replies, etc.). Installing them as-is would cause merge conflicts in the messages.upsert handler — particularly around `const`/`let content`, the `!content` guard, and the import block.

## Approach: Foundation Skill + Reworked Overlays

Three skills, layered:

| Skill | Type | Purpose |
|-------|------|---------|
| `media-processing` | New foundational | Shared module + minimal whatsapp.ts overlay |
| `image-vision` | Reworked from upstream | Image handler in media-processing + multimodal threading |
| `pdf-reader` | Reworked from upstream | PDF handler in media-processing + container CLI |

Neither image-vision nor pdf-reader touches whatsapp.ts. All media detection logic goes through the shared module.

## Skill 1: `media-processing` (Foundation)

### New file: `src/media-processing.ts`

```typescript
import {
  downloadMediaMessage,
  WAMessage,
} from '@whiskeysockets/baileys';

export interface MediaResult {
  content: string;
}

export async function processMediaAttachment(
  msg: WAMessage,
  normalized: Record<string, any> | null | undefined,
  groupDir: string,
): Promise<MediaResult | null> {
  // --- Image attachments ---
  // (added by image-vision skill)

  // --- Document attachments ---
  // (added by pdf-reader skill)

  return null;
}
```

Base module imports `downloadMediaMessage` so handler overlays don't conflict adding the same import. Placeholder comments in clearly separated regions enable non-overlapping three-way merges.

### whatsapp.ts overlay (minimal delta)

Changes:
1. Add `import { processMediaAttachment } from '../media-processing.js';`
2. Add `GROUPS_DIR` to config import
3. Change `const content =` to `let content =`
4. Insert after content extraction, before `!content` guard:

```typescript
const groupDir = path.join(GROUPS_DIR, groups[chatJid].folder);
const mediaResult = await processMediaAttachment(msg, normalized, groupDir);
if (mediaResult) content = mediaResult.content;
```

### Three-way merge compatibility with voice-transcription

The `const`→`let` change merges cleanly because voice-transcription's overlay has `const content` (same as upstream base), so `git merge-file` preserves media-processing's `let content`. Voice's `!content && !isVoiceMessage(msg)` guard and `let finalContent` pattern are in non-overlapping hunks.

Result after both overlays:
```typescript
let content = normalized.conversation || ...;
const mediaResult = await processMediaAttachment(msg, normalized, groupDir);
if (mediaResult) content = mediaResult.content;
if (!content && !isVoiceMessage(msg)) continue;
// ... sender checks ...
let finalContent = content;
if (isVoiceMessage(msg)) { finalContent = `[Voice: ...]`; }
this.opts.onMessage(chatJid, { content: finalContent, ... });
```

## Skill 2: `image-vision` (Reworked)

### Files

| File | Action | Notes |
|------|--------|-------|
| `add/src/image.ts` | Add | Reuse upstream: `isImageMessage()`, `processImage()`, `parseImageReferences()` |
| `add/src/image.test.ts` | Add | Reuse upstream unit tests |
| `modify/src/media-processing.ts` | Overlay | Image handler in the "Image attachments" section |
| `modify/src/index.ts` | Overlay | Reuse upstream: `parseImageReferences` + `imageAttachments` threading |
| `modify/src/container-runner.ts` | Overlay | Reuse upstream: `imageAttachments?` in `ContainerInput` |
| `modify/container/agent-runner/src/index.ts` | Overlay | Reuse upstream: multimodal types, `pushMultimodal()`, image loading |

**Removed from upstream:** `modify/src/channels/whatsapp.ts`, `modify/src/channels/whatsapp.test.ts`

### media-processing.ts overlay (image section)

```typescript
// --- Image attachments ---
if (isImageMessage(msg)) {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    const caption = (normalized as any)?.imageMessage?.caption ?? '';
    const result = await processImage(buffer as Buffer, groupDir, caption);
    if (result) {
      return { content: result.content };
    }
  } catch (err) {
    // Fall through to text content on failure
  }
}
```

### Multimodal flow (both disk-based + API vision)

1. WhatsApp → image saved to disk → `[Image: attachments/...]` in content → stored in DB
2. `index.ts` → `parseImageReferences()` extracts paths from stored messages
3. `container-runner.ts` → `imageAttachments` array passed to container via stdin
4. `agent-runner` → reads files, base64-encodes, sends as Claude API multimodal content blocks

Agent both "sees" the image natively (multimodal API) and can reference the file path.

### npm dependency

`sharp@^0.34.5`

## Skill 3: `pdf-reader` (Reworked)

### Files

| File | Action | Notes |
|------|--------|-------|
| `add/container/skills/pdf-reader/SKILL.md` | Add | Reuse upstream: agent-facing CLI docs |
| `add/container/skills/pdf-reader/pdf-reader` | Add | Reuse upstream: bash wrapper for poppler-utils |
| `modify/container/Dockerfile` | Overlay | Reuse upstream: install `poppler-utils`, copy script |
| `modify/src/media-processing.ts` | Overlay | PDF handler in the "Document attachments" section |

**Removed from upstream:** `modify/src/channels/whatsapp.ts`, `modify/src/channels/whatsapp.test.ts`

### media-processing.ts overlay (document section)

```typescript
// --- Document attachments ---
if ((normalized as any)?.documentMessage?.mimetype === 'application/pdf') {
  try {
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    const attachDir = path.join(groupDir, 'attachments');
    fs.mkdirSync(attachDir, { recursive: true });
    const filename = path.basename(
      (normalized as any).documentMessage.fileName || `doc-${Date.now()}.pdf`,
    );
    const filePath = path.join(attachDir, filename);
    fs.writeFileSync(filePath, buffer as Buffer);
    const sizeKB = Math.round((buffer as Buffer).length / 1024);
    const pdfRef = `[PDF: attachments/${filename} (${sizeKB}KB)]\nUse: pdf-reader extract attachments/${filename}`;
    const caption = (normalized as any).documentMessage.caption || '';
    return { content: caption ? `${caption}\n\n${pdfRef}` : pdfRef };
  } catch (err) {
    // Fall through to text content on failure
  }
}
```

Additional imports added by this overlay: `fs`, `path` (not in base module, no conflict with image overlay).

## Install Order

```yaml
skills:
  # ... existing skills ...
  - container-hardening
  - task-scheduler-fixes
  - media-processing          # NEW: foundation (before voice-transcription)
  - voice-transcription-elevenlabs
  - voice-recognition
  - image-vision              # NEW: overlays media-processing, index, container-runner, agent-runner
  - pdf-reader                # NEW: overlays media-processing, Dockerfile
  - whatsapp-search
  # ... remaining skills ...
```

## Testing

- Skill package tests: manifest, file existence, overlay content validation
- Unit tests: `media-processing.test.ts` (null return), `image.test.ts` (reused from upstream)
- Manual: send image, PDF, and voice message to verify all three paths work
- Regression: voice transcription must continue working after `const`→`let` change

## Container Changes

- Dockerfile: install `poppler-utils`, copy `pdf-reader` script
- Rebuild required: `./container/build.sh`
- `sharp` npm dependency installed on host (used for image resize before container)
