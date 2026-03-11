---
name: whatsapp-replies
description: "See reply/quote context on inbound messages; send threaded replies via send_message MCP tool; persists and RAG-indexes reply context"
---

# whatsapp-replies

Adds WhatsApp reply/quote threading to NanoClaw:

- **Inbound**: Extracts `contextInfo` from Baileys and surfaces `replied_to_id`, `replied_to_sender`, `replied_to_content` in the agent's message XML as `<reply_to>` elements
- **Outbound**: Adds `quoted_message_id` param to the `send_message` MCP tool so the agent can thread replies in WhatsApp
- **Persistence**: Stores reply fields in the `messages` SQLite table with auto-migration
- **RAG**: Indexes reply context in Qdrant alongside message content

Depends on: `skill/whatsapp`, `skill/whatsapp-search`

## Phase 1: Pre-flight

### Check if already applied

Check if `src/router.ts` contains `replied_to_id` — if so, skip to Phase 4 (Verify).

### Check dependencies

Confirm WhatsApp and whatsapp-search skills are merged:
```bash
git log --oneline --merges | grep -E 'skill/(whatsapp|whatsapp-search)'
```

## Phase 2: Apply Code Changes

```bash
git fetch origin skill/whatsapp-replies
git merge origin/skill/whatsapp-replies
npm install
```

No post-apply config required. DB migration runs automatically on next startup.

### Validate

```bash
npm run build
npx vitest run
```

Expected: all tests pass (includes reply-context tests).

## Phase 3: Build and Restart

```bash
npm run build
```

Linux:
```bash
systemctl --user restart nanoclaw
```

macOS:
```bash
launchctl kickstart -k gui/$(id -u)/com.nanoclaw
```

## Phase 4: Verify

1. Send a WhatsApp reply to an existing message in a registered group
2. Check that the agent prompt includes `replied_to_id` and `<reply_to>` in the message XML
3. Send a message via `send_message` with `quoted_message_id` set — confirm it threads in WhatsApp

## Troubleshooting

**Reply fields not appearing**: Ensure the message has a `contextInfo.stanzaId` in Baileys (only present when the sender explicitly quoted a message, not for @mentions).

**DB migration failed**: Check that `replied_to_id`, `replied_to_sender`, `replied_to_content` columns exist in the `messages` table — the migration is `ALTER TABLE ADD COLUMN` with a catch for existing columns.
