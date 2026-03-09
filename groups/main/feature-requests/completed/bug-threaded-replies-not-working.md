# bug: Threaded replies (quoted_message_id) not passed through IPC

**Date:** 2026-03-09
**Status:** implemented
**Requested by:** Andy (self-identified)
**Priority:** important

## Problem

`mcp__nanoclaw__send_message` accepts a `quoted_message_id` parameter for sending threaded WhatsApp replies, but the IPC layer drops it — threaded replies never arrive as quoted messages on WhatsApp.

## Root Cause

In `dist/ipc.js`, the `type === 'message'` handler calls:

```js
await deps.sendMessage(data.chatJid, data.text);
```

It does NOT pass `quoted_message_id` / `quotedKey`. The `WhatsAppChannel.sendMessage()` in `whatsapp.js` already accepts a third `quotedKey` parameter and handles it correctly, but IPC never provides it.

## Proposed Solution

1. In `ipc.js`, when handling `type === 'message'`, also read `data.quoted_message_id`
2. If present, look up the message from the DB using `getMessageById(data.quoted_message_id)` to get `fromMe`, `chatJid`, `sender` fields needed to construct the Baileys message key
3. Pass the constructed `quotedKey` to `deps.sendMessage(chatJid, text, quotedKey)`
4. `deps.sendMessage` in `index.js` needs to accept and forward `quotedKey` to `channel.sendMessage()`

## Required DB lookup

```ts
// Need a new or existing DB function:
const msg = getMessageById(quotedMessageId, chatJid);
// Returns: { id, chat_jid, sender, is_from_me, content }

const quotedKey = {
  id: msg.id,
  remoteJid: msg.chat_jid,
  fromMe: msg.is_from_me,
  participant: msg.sender,
  content: msg.content,
};
```

## Acceptance Criteria

- [ ] `mcp__nanoclaw__send_message` with `quoted_message_id` sends a visually threaded reply in WhatsApp
- [ ] Works for messages in group chats (participant field populated)
- [ ] Works for messages in 1:1 chats (participant undefined)
- [ ] Gracefully falls back to plain message if `quoted_message_id` not found in DB

## Technical Notes

- `WhatsAppChannel.sendMessage(jid, text, quotedKey)` already implemented correctly
- `whatsapp-replies` skill SKILL.md documents the feature as working — it's only the IPC plumbing that's missing
- `getLatestMessage(chatJid)` already exists in `db.js` — a `getMessageById(id, chatJid)` variant is needed

## Implementation Notes

**Implemented:** 2026-03-09
**Summary:** Fixed IPC plumbing to forward `quotedMessageId` from container MCP tool through to WhatsApp channel's `sendMessage()`. The DB lookup (`getMessageById`) already existed — just needed wiring.
**Files changed:**
- `src/ipc.ts` — Updated `IpcDeps.sendMessage` signature to accept `quotedMessageId?`, forwarded `data.quotedMessageId` in IPC message handler
- `src/index.ts` — Updated IPC deps `sendMessage` handler to resolve `quotedMessageId` → `QuotedMessageKey` via `getMessageById()` DB lookup, pass to `channel.sendMessage()`
- `.claude/skills/whatsapp-replies/manifest.yaml` — Added `src/ipc.ts` and `src/index.ts` to modifies list
- `.claude/skills/whatsapp-replies/modify/src/ipc.ts` — New accumulated overlay
- `.claude/skills/whatsapp-replies/modify/src/index.ts` — New accumulated overlay
