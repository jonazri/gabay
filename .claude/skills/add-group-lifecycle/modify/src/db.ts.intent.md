# db.ts Overlay Intent

## Overview
Adds group lifecycle management functions and migration logic for the main group flag during JSON-to-SQLite migration.

## Key Additions

### 1. `deleteRegisteredGroup(jid: string)` function (after line 598)
- **Purpose**: Delete a registered group by JID from the database
- **Returns**: Boolean indicating success (true if row was deleted)
- **Location**: After `setRegisteredGroup()`, before `getAllRegisteredGroups()`

### 2. JSON migration preservation logic (in `migrateJsonState()`, ~line 696)
- **Purpose**: Preserve the `isMain` flag for the main group during migration from JSON files to SQLite
- **Logic**: If a group's folder is 'main' and `isMain` is not explicitly set to true, set it to true
- **Location**: In the `for (const [jid, group] of Object.entries(groups))` loop

## Base File Structure
- Schema definition: `createSchema()` (lines 17-142)
- Database initialization: `initDatabase()` (lines 144-153)
- Chat metadata functions: `storeChatMetadata()`, `updateChatName()`, `getAllChats()`, etc. (lines 164-257)
- Task CRUD: `createTask()`, `getTaskById()`, `updateTask()`, `deleteTask()`, `getDueTasks()` (lines 366-481)
- Registered groups accessors: `getRegisteredGroup()`, `setRegisteredGroup()`, `getAllRegisteredGroups()` (lines 542-642)
- Migration handler: `migrateJsonState()` (lines 646-708)

## Invariants to Preserve
- SQL schema and table structure unchanged
- `registered_groups` table relationships: jid→folder uniqueness maintained
- Migration function only called during `initDatabase()` startup
- All existing column names and types in prepared statements remain consistent
- The `isMain` column logic: folder='main' entries always have isMain=1 after migration
- Foreign key constraints on task_run_logs → scheduled_tasks
