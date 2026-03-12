# Bug: StatusTracker sends 👀 reaction to Andy's own outgoing messages

**Date:** 2026-03-11
**Status:** resolved
**Fixed in:** `04f383e` — fix: skip 👀 reaction on own outgoing messages
**Requested by:** Yonatan
**Priority:** important

## Problem

The `StatusTracker.markReceived()` method sends a 👀 reaction to any message in the main group, including outgoing messages sent by Andy himself (`fromMe: true`). This results in Andy reacting with 👀 to his own messages, which is confusing and incorrect.

## Root Cause

In `src/status-tracker.ts`, `markReceived()` accepts a `fromMe` parameter but never uses it to guard against reacting to own messages:

```typescript
markReceived(messageId: string, chatJid: string, fromMe: boolean): boolean {
  if (!this.deps.isMainGroup(chatJid)) return false;
  if (this.tracked.has(messageId)) return false;
  // Missing: if (fromMe) return false;
  // ... proceeds to send 👀
}
```

## Fix

Add a `fromMe` guard at the top of `markReceived()`:

```typescript
markReceived(messageId: string, chatJid: string, fromMe: boolean): boolean {
  if (!this.deps.isMainGroup(chatJid)) return false;
  if (fromMe) return false;  // ← add this
  if (this.tracked.has(messageId)) return false;
  // ...
}
```

## Acceptance Criteria

- [ ] Andy does not send 👀 reactions to his own outgoing messages
- [ ] Andy continues to send 👀 reactions to inbound messages from the user
- [ ] Existing tests updated to cover `fromMe: true` case

## Technical Notes

- File: `src/status-tracker.ts`, `markReceived()` method
- The `fromMe` value is already correctly passed in at the call site in `src/index.ts`
- One-line fix
