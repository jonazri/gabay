# Intent: db.ts

## Changes
Adds database schema columns and query logic for reply context. Updates `messages` table with three new nullable TEXT columns: `replied_to_id`, `replied_to_sender`, `replied_to_content`. Updates all message insert/update/select operations to handle these fields.

## Key Sections
- Schema in `createSchema` (line 35-49): Three new columns in `messages` table
- Migration code (line 135-142): ALTER TABLE to add reply columns for existing databases
- `storeMessage` function (line 298-314): Include replied_to fields in INSERT
- Query functions like `getMessagesSince` (line 374-392): SELECT and return reply fields

## Invariants
- Reply columns are nullable TEXT in schema
- All queries that return `NewMessage[]` must include the three replied_to fields
- Migration must be idempotent (try/catch around ALTER TABLE)
- Field names in SQL match the `NewMessage` interface names (with underscores)
