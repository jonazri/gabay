# Feature Request: WhatsApp Media Sending

**Date:** 2026-03-03
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Andy can generate images (via browser screenshots, diagrams, charts, etc.) and other media files, but has no way to send them through WhatsApp. The `mcp__nanoclaw__send_message` tool only accepts text content.

This creates a poor user experience when:
- User asks for a screenshot of a website → Andy can capture it but can't send it
- Andy generates a chart or visualization → User never sees it
- Andy creates a document/PDF → No way to deliver it to the user

Currently, Andy can only describe the image in text, which defeats the purpose of visual content.

## Proposed Solution

Extend the `mcp__nanoclaw__send_message` tool to support media attachments.

### API Design

Add optional `media` parameter to send_message:

```typescript
interface SendMessageParams {
  text: string;
  quoted_message_id?: string;
  sender?: string;
  media?: {
    path: string;           // Absolute path to file in container
    type: 'image' | 'video' | 'audio' | 'document';
    mimetype?: string;      // Optional, auto-detect if not provided
    caption?: string;       // Optional caption (alternative to text param)
    filename?: string;      // Optional filename for documents
  };
}
```

### Example Usage

```javascript
// Send screenshot
mcp__nanoclaw__send_message({
  text: "Here's the website screenshot you requested:",
  media: {
    path: "/tmp/screenshot.png",
    type: "image"
  }
})

// Send document with caption
mcp__nanoclaw__send_message({
  media: {
    path: "/workspace/group/report.pdf",
    type: "document",
    filename: "Monthly Report.pdf",
    caption: "Here's the monthly report you requested"
  }
})
```

### Backend Implementation

Using Baileys (WhatsApp library):

```javascript
const { prepareWAMessageMedia, generateWAMessageFromContent } = require('@whiskeysockets/baileys');

async function sendMediaMessage(chatJid, params) {
  const fileBuffer = await fs.readFile(params.media.path);

  // Prepare media message
  const media = await prepareWAMessageMedia(
    { [params.media.type]: fileBuffer },
    { upload: sock.waUploadToServer }
  );

  // Generate message
  const message = generateWAMessageFromContent(chatJid, {
    [params.media.type + 'Message']: {
      ...media[params.media.type + 'Message'],
      caption: params.media.caption || params.text,
      fileName: params.media.filename,
    }
  }, {
    quoted: params.quoted_message_id ? { key: { id: params.quoted_message_id } } : undefined
  });

  await sock.relayMessage(chatJid, message.message, {
    messageId: message.key.id
  });
}
```

### File Cleanup

After sending, automatically delete temp files:
- If path starts with `/tmp/`, delete after successful send
- If path is in `/workspace/`, preserve (user may want to keep)
- Add optional `deleteAfterSend: boolean` parameter for explicit control

## Alternatives Considered

### 1. Separate `send_media` tool
- **Pros:** Keeps send_message simple
- **Cons:** Duplicates common params (quoted_message_id, sender), requires two tool calls for media with text
- **Rejected:** Media is just another message type, should be unified

### 2. Base64 encode media in text parameter
- **Pros:** No API changes
- **Cons:** Extremely inefficient for large files, unreadable params, hits message size limits
- **Rejected:** Not practical

### 3. Host watches a special directory for files to send
- **Pros:** No tool changes needed
- **Cons:** No way to specify recipient, caption, or message metadata; file-based IPC is fragile
- **Rejected:** Lacks essential functionality

### 4. Return media URLs that user clicks to download
- **Pros:** Works with current tools
- **Cons:** Terrible UX - user must leave WhatsApp to view content
- **Rejected:** Defeats purpose of WhatsApp as unified interface

## Acceptance Criteria

- [ ] `mcp__nanoclaw__send_message` accepts optional `media` parameter
- [ ] Supports image, video, audio, and document types
- [ ] Auto-detects mimetype from file extension if not provided
- [ ] Sends media with optional caption
- [ ] Preserves threaded reply context (`quoted_message_id`) when sending media
- [ ] Automatically cleans up temp files (`/tmp/*`) after successful send
- [ ] Preserves workspace files unless `deleteAfterSend: true`
- [ ] Returns error if file doesn't exist or is unreadable
- [ ] Returns error if file exceeds WhatsApp size limits (image: 5MB, video: 16MB, doc: 100MB)
- [ ] Works in both private chat and group contexts
- [ ] Respects `sender` parameter for multi-agent scenarios

## Technical Notes

### Relevant Files
- Host message sender (likely `src/whatsapp/sender.ts` or similar)
- MCP tool definition for `mcp__nanoclaw__send_message`
- Baileys WhatsApp integration

### WhatsApp Media Size Limits
- Images: 5 MB
- Videos: 16 MB
- Audio: 16 MB
- Documents: 100 MB

### Supported MIME Types
Common types to handle:
- Images: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- Videos: `video/mp4`, `video/3gpp`
- Audio: `audio/ogg`, `audio/mpeg`, `audio/mp4`
- Documents: `application/pdf`, `text/plain`, `application/vnd.openxmlformats-officedocument.*`

### Error Handling
- File not found → Clear error message with path
- File too large → Error with size limit info
- Upload failure → Retry once, then fail with error
- Unsupported mime type → Error listing supported types

### Security Considerations
- Validate file path is within container (no path traversal)
- Check file size before upload attempt
- Sanitize filenames (strip path components, limit length)

## Use Cases Unlocked

1. **Browser screenshots** - User asks "show me what myjli.com looks like" → Andy sends full screenshot
2. **Charts & visualizations** - Andy generates data visualization → sends as image
3. **Reports & documents** - Andy creates PDF report → sends directly
4. **Voice notes** - Future: Andy could generate/forward audio
5. **Diagrams** - Andy creates architecture diagram → sends as PNG
6. **QR codes** - Andy generates QR code → sends as image

## Related

None - this is a new capability gap.
