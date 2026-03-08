# Intent: ipc-mcp-stdio.ts

## Changes
Adds MCP tool for agents to react to messages:
1. Implements `react_to_message` tool: react to specific message by ID or latest message
2. Tool accepts emoji (required) and message_id (optional)
3. Writes reaction IPC file with: type='reaction', chatJid, emoji, messageId, groupFolder, timestamp
4. Returns success message or error if parameters are invalid
5. Supports emoji removal by passing empty emoji string

## Key Sections to Find
- Server tool definitions
- `send_message` tool (for pattern reference)
- IPC file writing pattern (writeIpcFile)
- Environment variables setup

## Invariants
- Tool name: `react_to_message`
- IPC file location: MESSAGES_DIR (not TASKS_DIR)
- Required param: emoji (string)
- Optional param: message_id (string, omit for latest message)
- IPC data structure: `{ type: 'reaction', chatJid, emoji, messageId?, groupFolder, timestamp }`
- Atomic write using temp file + rename pattern
- Success response acknowledges the emoji that was sent
