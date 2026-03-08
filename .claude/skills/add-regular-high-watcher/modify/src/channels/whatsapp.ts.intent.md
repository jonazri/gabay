# Intent: src/channels/whatsapp.ts

## What changed
This overlay preserves the upstream WhatsApp channel with full support for regular_high app state recovery. When the Baileys library syncs the `regular_high` app state (critical for encrypted message operations), a notification is sent to the main group to inform the user that deleteForMe and other privileged operations are now available.

## Key sections

### Imports (top of file)
- No changes; all imports preserved from upstream

### connectInternal() — connection.update handler
- Lines 164-195: One-shot regular_high recovery watcher
  - Polls every 60 seconds for `app-state-sync-version-regular_high.json` file
  - On detection: sends a notification message to main group with path to setup instructions
  - Clears the interval after first trigger (one-shot behavior)

### Main invariants
- All message processing (voice, text, images, video) unchanged
- Connection lifecycle and reconnect logic unchanged
- LID translation and group sync unchanged
- Outgoing message queue and flush logic unchanged
- sendMessage, setTyping, ownsJid, isConnected — all unchanged
- Authorization and message filtering unchanged
