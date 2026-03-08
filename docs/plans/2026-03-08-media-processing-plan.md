# Media Processing Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Install image vision and PDF reader as skills using a shared media-processing foundation, avoiding whatsapp.ts overlay conflicts.

**Architecture:** Three layered skills — `media-processing` (foundation with whatsapp.ts hook), `image-vision` (reworked to overlay media-processing.ts instead of whatsapp.ts), `pdf-reader` (reworked the same way). See `docs/plans/2026-03-08-media-processing-design.md` for rationale.

**Tech Stack:** TypeScript, Baileys (WhatsApp), sharp (image resize), poppler-utils (PDF extraction), Claude Agent SDK (multimodal)

---

### Task 1: Create media-processing skill directory and manifest

**Files:**
- Create: `.claude/skills/add-media-processing/manifest.yaml`

**Step 1: Create the manifest**

```yaml
skill: media-processing
version: 1.0.0
description: "Shared media attachment processing for WhatsApp (foundation for image/PDF/etc. skills)"
core_version: 1.2.8
adds:
  - src/media-processing.ts
  - src/media-processing.test.ts
modifies:
  - src/channels/whatsapp.ts
structured:
  npm_dependencies: {}
  env_additions: []
conflicts: []
depends:
  - whatsapp
test: "npx vitest run --config vitest.skills.config.ts .claude/skills/add-media-processing/tests/media-processing.test.ts"
```

**Step 2: Commit**

```bash
git add .claude/skills/add-media-processing/manifest.yaml
git commit -m "feat(media-processing): add skill manifest"
```

---

### Task 2: Create the base media-processing module

**Files:**
- Create: `.claude/skills/add-media-processing/add/src/media-processing.ts`
- Create: `.claude/skills/add-media-processing/add/src/media-processing.test.ts`

**Step 1: Write the module**

```typescript
// src/media-processing.ts
import {
  downloadMediaMessage,
  type WAMessage,
} from '@whiskeysockets/baileys';

import { logger } from './logger.js';

export interface MediaResult {
  content: string;
}

/**
 * Process media attachments from an incoming WhatsApp message.
 * Returns enriched content with attachment markers, or null if no media detected.
 * Individual media handlers are added by skill overlays (image-vision, pdf-reader, etc.).
 */
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

**Step 2: Write the unit test**

```typescript
// src/media-processing.test.ts
import { describe, it, expect } from 'vitest';

import { processMediaAttachment } from './media-processing.js';

describe('processMediaAttachment', () => {
  it('returns null when no media handlers match', async () => {
    const msg = { message: { conversation: 'hello' } } as any;
    const result = await processMediaAttachment(msg, { conversation: 'hello' }, '/tmp/test');
    expect(result).toBeNull();
  });
});
```

**Step 3: Commit**

```bash
git add .claude/skills/add-media-processing/add/
git commit -m "feat(media-processing): add base module and unit test"
```

---

### Task 3: Create the whatsapp.ts overlay for media-processing

The overlay is the full upstream whatsapp.ts (from `.claude/skills/add-whatsapp/add/src/channels/whatsapp.ts`) with ONLY these delta changes:

**Files:**
- Create: `.claude/skills/add-media-processing/modify/src/channels/whatsapp.ts`
- Create: `.claude/skills/add-media-processing/modify/src/channels/whatsapp.ts.intent.md`

**Step 1: Create the overlay**

Copy the base whatsapp.ts from `.claude/skills/add-whatsapp/add/src/channels/whatsapp.ts` to `.claude/skills/add-media-processing/modify/src/channels/whatsapp.ts`, then apply these 4 changes:

**Change 1 — Add GROUPS_DIR to config import (line 16):**
```typescript
// BEFORE:
import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  STORE_DIR,
} from '../config.js';

// AFTER:
import {
  ASSISTANT_HAS_OWN_NUMBER,
  ASSISTANT_NAME,
  GROUPS_DIR,
  STORE_DIR,
} from '../config.js';
```

**Change 2 — Add media-processing import (after the db import, before logger):**
```typescript
// BEFORE:
import { logger } from '../logger.js';

// AFTER:
import { logger } from '../logger.js';
import { processMediaAttachment } from '../media-processing.js';
```

**Change 3 — Change const to let (line ~206):**
```typescript
// BEFORE:
            const content =

// AFTER:
            let content =
```

**Change 4 — Add processMediaAttachment call (between content extraction and the !content guard):**
```typescript
// BEFORE:
              '';

            // Skip protocol messages with no text content

// AFTER:
              '';

            // Process media attachments (images, PDFs, etc.)
            const groupDir = path.join(GROUPS_DIR, groups[chatJid].folder);
            const mediaResult = await processMediaAttachment(msg, normalized, groupDir);
            if (mediaResult) content = mediaResult.content;

            // Skip protocol messages with no text content
```

**Step 2: Write the intent doc**

```markdown
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
```

**Step 3: Commit**

```bash
git add .claude/skills/add-media-processing/modify/
git commit -m "feat(media-processing): add whatsapp.ts overlay"
```

---

### Task 4: Create media-processing skill package test

**Files:**
- Create: `.claude/skills/add-media-processing/tests/media-processing.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const skillDir = path.resolve(__dirname, '..');

describe('media-processing skill package', () => {
  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(content.skill).toBe('media-processing');
    expect(content.adds).toContain('src/media-processing.ts');
    expect(content.modifies).toContain('src/channels/whatsapp.ts');
    expect(content.depends).toContain('whatsapp');
  });

  it('has the base module', () => {
    const modulePath = path.join(skillDir, 'add', 'src', 'media-processing.ts');
    expect(fs.existsSync(modulePath)).toBe(true);

    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('export async function processMediaAttachment');
    expect(content).toContain('export interface MediaResult');
    expect(content).toContain('downloadMediaMessage');
    expect(content).toContain('--- Image attachments ---');
    expect(content).toContain('--- Document attachments ---');
    expect(content).toContain('return null');
  });

  it('has the unit test', () => {
    const testPath = path.join(skillDir, 'add', 'src', 'media-processing.test.ts');
    expect(fs.existsSync(testPath)).toBe(true);

    const content = fs.readFileSync(testPath, 'utf-8');
    expect(content).toContain('processMediaAttachment');
    expect(content).toContain('returns null');
  });

  it('has whatsapp.ts overlay with correct changes', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    // Delta changes
    expect(content).toContain("import { processMediaAttachment } from '../media-processing.js';");
    expect(content).toContain('GROUPS_DIR');
    expect(content).toContain('let content =');
    expect(content).toContain('processMediaAttachment(msg, normalized, groupDir)');

    // Invariants
    expect(content).toContain('class WhatsAppChannel');
    expect(content).toContain("registerChannel('whatsapp'");
    expect(content).toContain('normalizeMessageContent');
    expect(content).toContain('translateJid');
  });

  it('has intent doc for whatsapp.ts', () => {
    const intentPath = path.join(skillDir, 'modify', 'src', 'channels', 'whatsapp.ts.intent.md');
    expect(fs.existsSync(intentPath)).toBe(true);
  });
});
```

**Step 2: Run the test**

```bash
npx vitest run --config vitest.skills.config.ts .claude/skills/add-media-processing/tests/media-processing.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add .claude/skills/add-media-processing/tests/
git commit -m "feat(media-processing): add skill package test"
```

---

### Task 5: Rework image-vision skill — update manifest and remove whatsapp overlays

**Files:**
- Modify: `.claude/skills/add-image-vision/manifest.yaml`
- Delete: `.claude/skills/add-image-vision/modify/src/channels/whatsapp.ts`
- Delete: `.claude/skills/add-image-vision/modify/src/channels/whatsapp.ts.intent.md`
- Delete: `.claude/skills/add-image-vision/modify/src/channels/whatsapp.test.ts`
- Delete: `.claude/skills/add-image-vision/modify/src/channels/whatsapp.test.ts.intent.md`

**Step 1: Update manifest.yaml**

```yaml
skill: add-image-vision
version: 2.0.0
description: "Add image vision to NanoClaw agents via WhatsApp image attachments"
core_version: 1.2.8
adds:
  - src/image.ts
  - src/image.test.ts
modifies:
  - src/media-processing.ts
  - src/container-runner.ts
  - src/index.ts
  - container/agent-runner/src/index.ts
structured:
  npm_dependencies:
    sharp: "^0.34.5"
  env_additions: []
conflicts: []
depends:
  - media-processing
test: "npx vitest run --config vitest.skills.config.ts .claude/skills/add-image-vision/tests/image-vision.test.ts"
```

Key changes from v1.1.0:
- Removed `src/channels/whatsapp.ts` and `src/channels/whatsapp.test.ts` from `modifies`
- Added `src/media-processing.ts` to `modifies`
- Added `depends: [media-processing]`
- Bumped version to 2.0.0

**Step 2: Delete old whatsapp overlays**

```bash
rm -f .claude/skills/add-image-vision/modify/src/channels/whatsapp.ts
rm -f .claude/skills/add-image-vision/modify/src/channels/whatsapp.ts.intent.md
rm -f .claude/skills/add-image-vision/modify/src/channels/whatsapp.test.ts
rm -f .claude/skills/add-image-vision/modify/src/channels/whatsapp.test.ts.intent.md
rmdir .claude/skills/add-image-vision/modify/src/channels 2>/dev/null || true
```

**Step 3: Commit**

```bash
git add -A .claude/skills/add-image-vision/
git commit -m "refactor(image-vision): remove whatsapp.ts overlays, add media-processing dependency"
```

---

### Task 6: Create image-vision media-processing.ts overlay

This overlay is the base `media-processing.ts` (from Task 2) with the image handler added.

**Files:**
- Create: `.claude/skills/add-image-vision/modify/src/media-processing.ts`
- Create: `.claude/skills/add-image-vision/modify/src/media-processing.ts.intent.md`

**Step 1: Write the overlay**

Copy the base module from `.claude/skills/add-media-processing/add/src/media-processing.ts`, then apply these changes:

**Change 1 — Add image imports (after logger import):**
```typescript
// BEFORE:
import { logger } from './logger.js';

// AFTER:
import { isImageMessage, processImage } from './image.js';
import { logger } from './logger.js';
```

**Change 2 — Replace the image placeholder comment with handler code:**
```typescript
// BEFORE:
  // --- Image attachments ---
  // (added by image-vision skill)

// AFTER:
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
      logger.warn({ err, groupDir }, 'Image download/processing failed');
    }
  }
```

**Step 2: Write the intent doc**

```markdown
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
```

**Step 3: Commit**

```bash
git add .claude/skills/add-image-vision/modify/src/media-processing.ts*
git commit -m "feat(image-vision): add media-processing.ts overlay with image handler"
```

---

### Task 7: Update image-vision skill package test

**Files:**
- Modify: `.claude/skills/add-image-vision/tests/image-vision.test.ts`

**Step 1: Rewrite the test**

The test needs to reflect the new file structure (media-processing.ts instead of whatsapp.ts/whatsapp.test.ts).

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const skillDir = path.resolve(__dirname, '..');

describe('image-vision skill package', () => {
  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(content.skill).toBe('add-image-vision');
    expect(content.adds).toContain('src/image.ts');
    expect(content.adds).toContain('src/image.test.ts');
    expect(content.modifies).toContain('src/media-processing.ts');
    expect(content.modifies).toContain('src/index.ts');
    expect(content.modifies).toContain('src/container-runner.ts');
    expect(content.modifies).toContain('container/agent-runner/src/index.ts');
    expect(content.structured.npm_dependencies.sharp).toBeDefined();
    expect(content.depends).toContain('media-processing');
  });

  it('does NOT modify whatsapp.ts', () => {
    const content = yaml.parse(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    );
    const modifies = content.modifies || [];
    expect(modifies).not.toContain('src/channels/whatsapp.ts');
    expect(modifies).not.toContain('src/channels/whatsapp.test.ts');
  });

  it('has image.ts with required exports', () => {
    const filePath = path.join(skillDir, 'add', 'src', 'image.ts');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('export function isImageMessage');
    expect(content).toContain('export async function processImage');
    expect(content).toContain('export function parseImageReferences');
  });

  it('has image.test.ts', () => {
    const filePath = path.join(skillDir, 'add', 'src', 'image.test.ts');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('has media-processing.ts overlay with image handler', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'media-processing.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('isImageMessage');
    expect(content).toContain('processImage');
    expect(content).toContain('downloadMediaMessage');
    // Must preserve document placeholder for pdf-reader
    expect(content).toContain('--- Document attachments ---');
  });

  it('has index.ts overlay with image attachment threading', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'index.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('parseImageReferences');
    expect(content).toContain('imageAttachments');
  });

  it('has container-runner.ts overlay with imageAttachments field', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'container-runner.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('imageAttachments');
    expect(content).toContain('ContainerInput');
  });

  it('has agent-runner overlay with multimodal support', () => {
    const overlayPath = path.join(
      skillDir, 'modify', 'container', 'agent-runner', 'src', 'index.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('ImageContentBlock');
    expect(content).toContain('pushMultimodal');
    expect(content).toContain('imageAttachments');
    expect(content).toContain('base64');
  });

  it('has intent docs for all modified files', () => {
    const intentFiles = [
      'modify/src/media-processing.ts.intent.md',
      'modify/src/index.ts.intent.md',
      'modify/src/container-runner.ts.intent.md',
      'modify/container/agent-runner/src/index.ts.intent.md',
    ];
    for (const file of intentFiles) {
      expect(fs.existsSync(path.join(skillDir, file))).toBe(true);
    }
  });
});
```

**Step 2: Run the test**

```bash
npx vitest run --config vitest.skills.config.ts .claude/skills/add-image-vision/tests/image-vision.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add .claude/skills/add-image-vision/tests/
git commit -m "test(image-vision): update skill package test for media-processing architecture"
```

---

### Task 8: Rework pdf-reader skill — update manifest and remove whatsapp overlays

**Files:**
- Modify: `.claude/skills/add-pdf-reader/manifest.yaml`
- Delete: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts`
- Delete: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts.intent.md`
- Delete: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts`
- Delete: `.claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts.intent.md`

**Step 1: Update manifest.yaml**

```yaml
skill: add-pdf-reader
version: 2.0.0
description: "Add PDF reading to NanoClaw agents via WhatsApp document attachments"
core_version: 1.2.8
adds:
  - container/skills/pdf-reader/SKILL.md
  - container/skills/pdf-reader/pdf-reader
modifies:
  - container/Dockerfile
  - src/media-processing.ts
structured:
  npm_dependencies: {}
  env_additions: []
conflicts: []
depends:
  - media-processing
test: "npx vitest run --config vitest.skills.config.ts .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts"
```

Key changes from v1.1.0:
- Removed `src/channels/whatsapp.ts` and `src/channels/whatsapp.test.ts` from `modifies`
- Added `src/media-processing.ts` to `modifies`
- Added `depends: [media-processing]`
- Bumped version to 2.0.0

**Step 2: Delete old whatsapp overlays**

```bash
rm -f .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts
rm -f .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.ts.intent.md
rm -f .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts
rm -f .claude/skills/add-pdf-reader/modify/src/channels/whatsapp.test.ts.intent.md
rmdir .claude/skills/add-pdf-reader/modify/src/channels 2>/dev/null || true
```

**Step 3: Commit**

```bash
git add -A .claude/skills/add-pdf-reader/
git commit -m "refactor(pdf-reader): remove whatsapp.ts overlays, add media-processing dependency"
```

---

### Task 9: Create pdf-reader media-processing.ts overlay

This overlay is the base `media-processing.ts` with the PDF handler added.

**Files:**
- Create: `.claude/skills/add-pdf-reader/modify/src/media-processing.ts`
- Create: `.claude/skills/add-pdf-reader/modify/src/media-processing.ts.intent.md`

**Step 1: Write the overlay**

Copy the base module from `.claude/skills/add-media-processing/add/src/media-processing.ts`, then apply these changes:

**Change 1 — Add fs and path imports at the top of the file:**
```typescript
// BEFORE:
import {

// AFTER:
import fs from 'fs';
import path from 'path';

import {
```

**Change 2 — Replace the document placeholder comment with handler code:**
```typescript
// BEFORE:
  // --- Document attachments ---
  // (added by pdf-reader skill)

// AFTER:
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
      logger.warn({ err, groupDir }, 'PDF download failed');
    }
  }
```

**Step 2: Write the intent doc**

```markdown
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
```

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/modify/src/media-processing.ts*
git commit -m "feat(pdf-reader): add media-processing.ts overlay with PDF handler"
```

---

### Task 10: Update pdf-reader skill package test

**Files:**
- Modify: `.claude/skills/add-pdf-reader/tests/pdf-reader.test.ts`

**Step 1: Rewrite the test**

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const skillDir = path.resolve(__dirname, '..');

describe('pdf-reader skill package', () => {
  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(content.skill).toBe('add-pdf-reader');
    expect(content.modifies).toContain('container/Dockerfile');
    expect(content.modifies).toContain('src/media-processing.ts');
    expect(content.depends).toContain('media-processing');
  });

  it('does NOT modify whatsapp.ts', () => {
    const content = yaml.parse(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    );
    const modifies = content.modifies || [];
    expect(modifies).not.toContain('src/channels/whatsapp.ts');
    expect(modifies).not.toContain('src/channels/whatsapp.test.ts');
  });

  it('has pdf-reader CLI script', () => {
    const scriptPath = path.join(
      skillDir, 'add', 'container', 'skills', 'pdf-reader', 'pdf-reader',
    );
    expect(fs.existsSync(scriptPath)).toBe(true);

    const content = fs.readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('pdftotext');
    expect(content).toContain('extract');
    expect(content).toContain('fetch');
    expect(content).toContain('info');
  });

  it('has container skill SKILL.md', () => {
    const docPath = path.join(
      skillDir, 'add', 'container', 'skills', 'pdf-reader', 'SKILL.md',
    );
    expect(fs.existsSync(docPath)).toBe(true);
  });

  it('has Dockerfile overlay with poppler-utils', () => {
    const overlayPath = path.join(skillDir, 'modify', 'container', 'Dockerfile');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('poppler-utils');
    expect(content).toContain('pdf-reader');
  });

  it('has media-processing.ts overlay with PDF handler', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'media-processing.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain("'application/pdf'");
    expect(content).toContain('downloadMediaMessage');
    expect(content).toContain('pdf-reader extract');
    // Must preserve image placeholder for image-vision
    expect(content).toContain('--- Image attachments ---');
  });

  it('has intent docs for modified files', () => {
    expect(fs.existsSync(
      path.join(skillDir, 'modify', 'src', 'media-processing.ts.intent.md'),
    )).toBe(true);
    expect(fs.existsSync(
      path.join(skillDir, 'modify', 'container', 'Dockerfile.intent.md'),
    )).toBe(true);
  });
});
```

**Step 2: Run the test**

```bash
npx vitest run --config vitest.skills.config.ts .claude/skills/add-pdf-reader/tests/pdf-reader.test.ts
```

Expected: PASS

**Step 3: Commit**

```bash
git add .claude/skills/add-pdf-reader/tests/
git commit -m "test(pdf-reader): update skill package test for media-processing architecture"
```

---

### Task 11: Update installed-skills.yaml

**Files:**
- Modify: `.nanoclaw/installed-skills.yaml`

**Step 1: Add the three skills**

Insert `media-processing` before `voice-transcription-elevenlabs`, then add `image-vision` and `pdf-reader` after `voice-recognition`:

```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry
  - reactions
  - refresh-oauth
  - group-lifecycle
  - self-heal
  - google-home
  - shabbat-mode
  - container-hardening
  - task-scheduler-fixes
  - media-processing
  - voice-transcription-elevenlabs
  - voice-recognition
  - image-vision
  - pdf-reader
  - whatsapp-search
  - perplexity-research
  - feature-request
  - whatsapp-summary
  - whatsapp-replies
  - regular-high-watcher
```

**Step 2: Commit**

```bash
git add .nanoclaw/installed-skills.yaml
git commit -m "feat: add media-processing, image-vision, pdf-reader to skill install order"
```

---

### Task 12: Test full skill application

**Step 1: Restore clean upstream state**

```bash
git checkout -- src/
rm -rf .nanoclaw/base
```

**Step 2: Apply all skills**

```bash
npm run apply-skills
```

Expected: All skills apply without merge conflicts. Watch for:
- media-processing: whatsapp.ts overlay merges cleanly with existing overlays
- image-vision: media-processing.ts overlay merges cleanly, index.ts/container-runner.ts/agent-runner overlays merge cleanly
- pdf-reader: media-processing.ts overlay merges cleanly (non-overlapping with image handler), Dockerfile overlay merges cleanly

**Step 3: Verify key files have correct content**

```bash
# Check whatsapp.ts has media-processing call + voice transcription + reactions
grep -n 'processMediaAttachment\|isVoiceMessage\|storeReaction\|let content' src/channels/whatsapp.ts

# Check media-processing.ts has both handlers
grep -n 'isImageMessage\|application/pdf' src/media-processing.ts

# Check index.ts has imageAttachments threading
grep -n 'parseImageReferences\|imageAttachments' src/index.ts

# Check container-runner.ts has imageAttachments in ContainerInput
grep -n 'imageAttachments' src/container-runner.ts
```

**Step 4: Run TypeScript compilation**

```bash
npx tsc --noEmit
```

Expected: No type errors.

**Step 5: Run unit tests**

```bash
npx vitest run src/media-processing.test.ts src/image.test.ts
```

Expected: PASS

**Step 6: If conflicts or errors, debug and fix overlays, then re-run from Step 1**

---

### Task 13: Install sharp and build

**Step 1: Install sharp**

```bash
npm install sharp@^0.34.5
```

**Step 2: Build the project**

```bash
npm run build
```

Expected: Build succeeds (apply-skills → compile → restore src/).

**Step 3: Rebuild the container**

```bash
./container/build.sh
```

Expected: Container builds successfully with poppler-utils and pdf-reader CLI.

**Step 4: Commit package.json changes**

```bash
git add package.json package-lock.json
git commit -m "deps: add sharp for image processing"
```

---

### Task 14: Manual verification

**Step 1: Start the service**

```bash
npm run dev
```

**Step 2: Send an image to a registered WhatsApp group**

Check logs for:
- `Image - download` or similar log line
- Message stored with `[Image: attachments/img-*.jpg]` content

**Step 3: Send a PDF to a registered WhatsApp group**

Check logs for:
- `Downloaded PDF attachment` log line
- Message stored with `[PDF: attachments/*.pdf (NKB)]` content

**Step 4: Send a voice message (regression test)**

Check logs for:
- `Transcribed voice message` log line
- Message stored with `[Voice: ...]` content

**Step 5: Send a plain text message (regression test)**

Verify normal message flow is unaffected.
