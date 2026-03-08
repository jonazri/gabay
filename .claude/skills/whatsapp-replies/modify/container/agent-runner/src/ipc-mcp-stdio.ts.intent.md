# Intent: ipc-mcp-stdio.ts

## Changes
Adds `quoted_message_id` parameter to the `send_message` tool to enable WhatsApp reply threading. Updates the IPC message payload to include `quotedMessageId` when provided by the agent.

## Key Sections
- `send_message` tool definition (line 42-69): Look for the `args` object schema and the data payload construction
- Tool handler at line 54-68: Extracts `quoted_message_id` and includes it in the IPC message as `quotedMessageId`

## Invariants
- The `quotedMessageId` must be optional in the payload (sent as `undefined` if not provided)
- Message is still sent to `MESSAGES_DIR` via `writeIpcFile`
- Timestamp should be included alongside the new field
