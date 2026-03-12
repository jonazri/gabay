# Feature Request: Status Tracker Should React to All Queued Messages, Not Just Trigger Message

**Date:** 2026-03-11
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

When a new message arrives while Andy is already mid-turn processing a previous message, the `StatusTracker` does not send a 👀 (received) reaction for it. The message gets queued and eventually processed, but the user never sees any acknowledgment that their second message was seen.

### Observed behavior (from logs)

```
17:42:30 — 👀 sent for message 3B32A26B (trigger message)
17:42:44 — ✅ sent for message 3B32A26B (response complete)
17:43:17 — "New messages: 1" logged (message 3B3FCF arrived while sub-agent was running)
17:44:06 — "New messages: 1" logged (message 3BF3B3 arrived)
              ← no 👀 sent for either queued message
```

User reported: "no emoji reaction on this last message at all."

### Root cause

`StatusTracker.markReceived()` is only called for the message(s) that trigger the current agent turn. Messages that arrive while a turn is already in progress are queued but `markReceived()` is never called for them — so no 👀 reaction fires.

## Proposed Solution

When the message queue is drained and queued messages are dispatched for processing, `markReceived()` should be called for each queued message before it's processed — just like it is for messages that trigger a fresh agent turn.

Relevant files:
- `/workspace/project/src/status-tracker.ts` — `markReceived()` method
- `/workspace/project/src/index.ts` — where messages are dequeued and dispatched

Specifically, wherever `missedMessages` or queued messages are iterated before agent invocation, ensure `statusTracker?.markReceived(msg.id, chatJid, fromMe)` is called for each.

## Alternatives Considered

- **Send 👀 immediately on arrival regardless of queue state** — better UX but requires hooking into the message ingestion layer before queueing, which is a larger change.
- **Send a "queue depth" indicator** (e.g., react with a number) — too complex, nonstandard.

## Acceptance Criteria

- [ ] When message B arrives while Andy is processing message A, message B receives a 👀 reaction before or when it starts being processed
- [ ] The 👀 for queued messages fires before the ✅ for the previous message's response
- [ ] No duplicate reactions (markReceived guard still applies)
- [ ] Existing behavior for single-message turns is unchanged

## Technical Notes

- `markReceived()` already guards against double-registration via `this.tracked.has(messageId)`
- The fix is likely a small addition in the queue drain/dispatch loop in `src/index.ts`
- The `StatusTracker` is only active for `isMain: true` groups, so this only affects the main chat
- This was confirmed via log analysis on 2026-03-11 during a turn that involved a sub-agent (code exploration), during which two user messages arrived untracked
