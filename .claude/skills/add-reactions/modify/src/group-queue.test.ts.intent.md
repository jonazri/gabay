# Intent: group-queue.test.ts

## Changes
Adds test coverage for the `sendReaction` method in IPC authorization tests:
1. Tests that sendReaction IPC dependency is called correctly
2. Tests authorization pattern: main can react anywhere, non-main only in own group
3. Tests the authorization guard inline to mirror startIpcWatcher logic
4. Verifies sendReaction mock is invoked with correct parameters (jid, emoji, messageId)

## Key Sections to Find
- Test structure and mocking patterns
- Existing IPC message authorization tests
- Mock setup for deps object

## Invariants
- sendReaction authorization must match message authorization exactly
- Mock signature: `async (jid: string, emoji: string, messageId?: string)`
- Tests must verify the authorization gate blocks unauthorized attempts
- No actual socket calls; all deps are mocks
