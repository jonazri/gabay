# Intent: src/task-scheduler.ts modifications

## What changed
Prevent duplicate task execution and improve task result routing safety.

## Key sections

### computeNextRun() helper (new, above SchedulerDependencies)
- Extracted inline cron/interval/once logic into a reusable function
- Returns ISO string for cron and interval tasks, null for one-shot tasks
- Used in both `runTask()` (post-run update) and `startSchedulerLoop()` (pre-advance)

### runTask() stream callback
- Added: guard that blocks sending scheduled task results to group chats (`@g.us`)
- If `task.chat_jid` ends with `@g.us`, logs an error and returns without sending
- Results should only go to the main group, never to arbitrary group chats

### runTask() post-run next_run calculation
- Replaced inline cron/interval parsing with `computeNextRun(task)` call
- Added comment noting that next_run was already pre-advanced before enqueuing

### startSchedulerLoop() pre-advance
- Added: `computeNextRun()` + `updateTask()` BEFORE `enqueueTask()`
- Prevents the next 60s poll from re-discovering a still-running task
- Without this, long-running tasks would be enqueued and executed twice

## Invariants (must-keep)
- All existing task execution, error handling, and logging unchanged
- Task status checks (paused/cancelled) unchanged
- Queue interaction and closeStdin logic unchanged
- Idle timeout handling unchanged
- No auth-related imports or logic (belongs to auth-recovery skill)
