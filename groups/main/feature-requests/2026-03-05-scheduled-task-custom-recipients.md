# Feature Request: Scheduled Tasks - Send to Custom Recipients

**Date:** 2026-03-05
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Scheduled tasks can only send their output to the user who created them (the task owner). There's no way to send scheduled task output to a different WhatsApp recipient.

**Current limitation:** When a scheduled task completes, its output is automatically sent to the task owner's chat (main control channel for admin, or the group JID where the task was created).

**Real use case that doesn't work:**
- Yonatan wants a daily kashrus summary sent to his wife Esther at 7 PM
- The summary should be generated from the "Mivtza Kashrus" WhatsApp group
- Currently impossible: the task output can only go to Yonatan or post in the Mivtza Kashrus group
- Workaround attempted: Task tries to use `mcp__nanoclaw__send_message`, but that tool sends to the current chat context, not arbitrary recipients

This blocks useful automation scenarios where:
- Reports/summaries should go to specific people (not the admin)
- Different stakeholders need different scheduled updates
- Family members need personalized daily digests
- Team members need role-specific notifications

## Proposed Solution

Add a `recipient` parameter to `mcp__nanoclaw__schedule_task` that specifies where the task output should be sent.

### API Design

```typescript
interface ScheduleTaskParams {
  prompt: string;
  schedule_type: 'cron' | 'interval' | 'once';
  schedule_value: string;
  context_mode?: 'group' | 'isolated';
  target_group_jid?: string;  // existing: which group context to run in
  recipient?: string;          // NEW: where to send the output
}
```

### Recipient Parameter Behavior

- **If omitted:** Output goes to task owner (current behavior - backward compatible)
- **If provided:** Output goes to specified WhatsApp JID
- **Format:** Full WhatsApp JID (e.g., `12486333711@s.whatsapp.net`)
- **Validation:** Must be a valid WhatsApp JID format

### Example Usage

```javascript
// Daily kashrus summary sent to Esther
schedule_task({
  prompt: "Generate kashrus summary from Mivtza Kashrus group...",
  schedule_type: "cron",
  schedule_value: "0 19 * * *",  // 7 PM daily
  target_group_jid: "16122756438-1595291340@g.us",  // run with this group's context
  recipient: "12486333711@s.whatsapp.net"  // send output to Esther
})

// Weekly team report to project manager
schedule_task({
  prompt: "Summarize week's progress in dev-team group...",
  schedule_type: "cron",
  schedule_value: "0 17 * * 5",  // 5 PM Friday
  target_group_jid: "dev-team-jid@g.us",
  recipient: "manager-phone@s.whatsapp.net"
})

// Omit recipient: goes to task owner (backward compatible)
schedule_task({
  prompt: "Check server status...",
  schedule_type: "interval",
  schedule_value: "3600000"
  // No recipient specified → output goes to Yonatan
})
```

### Backend Implementation Notes

When task completes:

```javascript
function sendTaskOutput(task, output) {
  const targetJid = task.recipient || task.owner_jid;

  await sendMessage({
    to: targetJid,
    message: output,
    sender: task.sender || 'Scheduled Task'
  });
}
```

### Security & Permissions

- **Permission check:** Only main group (admin) can schedule tasks with custom recipients
- **Reason:** Prevents non-admin groups from spamming arbitrary users
- **Alternative approach:** Allow custom recipients only if:
  - Recipient is in the group's registered allowlist, OR
  - Task creator is main/admin

### Task Listing Display

Update task list output to show recipient:

```
- [task-abc] Daily kashrus summary (cron: 0 19 * * *) → Esther Azrielant
- [task-xyz] Server health check (interval: 3600000) → Main (you)
```

## Alternatives Considered

### 1. Task writes to IPC file, host picks it up
- **Pros:** No API changes
- **Cons:** Complex file-based protocol, no validation, unclear delivery semantics, harder to debug
- **Rejected:** Too fragile, poor developer experience

### 2. Task calls `mcp__nanoclaw__send_message` with recipient parameter
- **Pros:** Reuses existing tool
- **Cons:** `send_message` is designed for immediate messages during execution, not for task output; would require overloading its semantics; task output should be separate from mid-execution messages
- **Rejected:** Confuses two different concepts (task output vs. messages during execution)

### 3. Separate `send_message_to` tool for scheduled tasks
- **Pros:** Clear separation
- **Cons:** Adds tool complexity; tasks would need to call this explicitly instead of just returning output; inconsistent with how tasks work elsewhere
- **Rejected:** Makes task authoring harder, breaks the "task output = message" mental model

### 4. Create "forwarding tasks" that receive from one task and send to recipient
- **Pros:** No API changes, composable
- **Cons:** Requires two tasks for simple use case; complex chaining; failure points multiply
- **Rejected:** Overly complex for common scenario

## Acceptance Criteria

- [ ] `mcp__nanoclaw__schedule_task` accepts optional `recipient` parameter
- [ ] `recipient` must be valid WhatsApp JID format (validated at creation)
- [ ] If `recipient` is omitted, output goes to task owner (backward compatible)
- [ ] If `recipient` is provided, output goes to specified JID
- [ ] Task list shows recipient in human-readable format ("→ Name" or "→ Main (you)")
- [ ] Permission check: Only main/admin group can schedule with custom recipients
- [ ] Error handling: Invalid JID returns clear error message
- [ ] Error handling: Delivery failure logs error but doesn't crash scheduler
- [ ] Recipient can be updated by modifying task (if task modification is supported)
- [ ] Works with all schedule types: cron, interval, once

## Technical Notes

### Relevant Files
- Task scheduler (likely `src/scheduler/` or similar)
- MCP tool definition for `mcp__nanoclaw__schedule_task`
- Task execution runner
- Message sender/delivery system

### Database Schema Update

If tasks are stored in database, add column:

```sql
ALTER TABLE scheduled_tasks
ADD COLUMN recipient_jid TEXT NULL;
```

### Task File Format Update

If tasks stored as JSON files:

```json
{
  "id": "task-1772674927627-fmy9m1",
  "prompt": "...",
  "schedule_type": "cron",
  "schedule_value": "0 19 * * *",
  "context_mode": "isolated",
  "target_group_jid": "16122756438-1595291340@g.us",
  "recipient": "12486333711@s.whatsapp.net",  // NEW
  "owner_jid": "17732662600@s.whatsapp.net",
  "created_at": "2026-03-05T01:00:00Z"
}
```

### Validation Logic

```javascript
function validateRecipient(jid) {
  // WhatsApp JID format: phone@s.whatsapp.net or groupid@g.us
  const jidPattern = /^[\d\-]+@(s\.whatsapp\.net|g\.us)$/;

  if (!jidPattern.test(jid)) {
    throw new Error(`Invalid WhatsApp JID format: ${jid}`);
  }

  return true;
}
```

### Error Handling

- **Invalid JID format:** Return error at task creation time
- **Recipient doesn't exist:** Log warning but attempt delivery (WhatsApp handles non-existent numbers gracefully)
- **Delivery failure:** Log error, don't retry (scheduled tasks run again on schedule)
- **Permission denied:** Clear error message explaining only admin can send to custom recipients

## Use Cases Unlocked

1. **Family summaries** - Daily kashrus digest to spouse, daily news summary to kids
2. **Team notifications** - Project updates to stakeholders who aren't in the dev group
3. **Client reports** - Automated status reports to clients
4. **Personal reminders** - Admin schedules reminders that go to family members
5. **Multi-recipient broadcasting** - Create multiple tasks with same prompt, different recipients
6. **Delegated monitoring** - Admin sets up monitoring that notifies the right person for each system

## Related

- WhatsApp Media Sending (2026-03-03) - related to message sending but orthogonal feature
