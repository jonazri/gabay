# Intent: whatsapp.test.ts

## Changes
Adds comprehensive tests for reply/quote context handling. New tests verify:
- Reply context extraction from message metadata
- Reply attributes in the message payload delivered to `onMessage`
- Proper escaping and field handling for null/undefined values

## Key Sections
- Message test helpers: Look for `createTestOpts()` and `triggerMessages()` patterns
- New test suite in `describe('message handling')`: Test cases for messages with `replied_to_*` fields
- Message object construction: Verify `replied_to_id`, `replied_to_sender`, `replied_to_content` are in the payload

## Invariants
- Reply fields must be part of the `onMessage` callback payload
- `replied_to_id` must be undefined (not null) when not present
- Field names in test assertions match the database schema and router format
