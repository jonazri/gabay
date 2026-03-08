# Intent: db.test.ts

## Changes
Adds tests for reply context persistence through database operations. New tests verify:
- Storage and retrieval of `replied_to_id`, `replied_to_sender`, `replied_to_content`
- Proper handling when reply fields are undefined/not set
- Round-trip storage in `messages` table

## Key Sections
- Test suite "reply context storage" starting around line 576: Tests for storing and retrieving reply fields
- `storeMessage` calls: Include reply context in test messages
- Assertions: Verify retrieved messages have correct `replied_to_*` values

## Invariants
- Reply fields default to undefined (not null) when not provided
- Fields are nullable in the database schema
- `getMessagesSince` and other query functions must preserve reply context
