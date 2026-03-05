# Phase 5: Overlay Reduction — Design

**Date:** 2026-03-05
**Status:** Approved
**Branch:** TBD (from main)

## Problem

After the v1.2.1 upgrade (Phases 2-4), 17 skills apply cleanly but overlay duplication remains extreme: 6 skills ship 594-925 line copies of index.ts to contribute 0-165 unique lines each. Four skills ship 396-503 line copies of ipc.ts. Total overlay weight: ~5,914 lines of which ~93% is duplicated upstream or accumulated content.

## Goal

Reduce overlay surface by ~5,200 lines through registration patterns (lifecycle hooks, message events, IPC message dispatch) that let skills declare behavior instead of copying entire files. Convert `_accumulated` overlays to delta style as they shrink.

## Strategy

Infrastructure first (Approach A): build all registries/abstractions, then migrate skills in order of increasing complexity.

## Component 1: Lifecycle Hook Registry

**New file:** `src/lifecycle.ts` (added by expanding `ipc-handler-registry` skill or a new `lifecycle-hooks` skill)

### API

```typescript
// Startup/shutdown
export function onStartup(fn: () => void | Promise<void>): void;
export function onShutdown(fn: () => void | Promise<void>): void;
export function onChannelsReady(fn: (channels: Channel[]) => void | Promise<void>): void;

// Message processing guards
export function registerProcessingGuard(fn: () => boolean): void;
export function onGuardLifted(fn: () => void | Promise<void>): void;

// Dispatch (called from index.ts)
export async function runStartupHooks(): Promise<void>;
export async function runShutdownHooks(): Promise<void>;
export async function runChannelsReadyHooks(channels: Channel[]): Promise<void>;
export function shouldProcessMessages(): boolean;
export async function runGuardLiftedHooks(): Promise<void>;
```

### Integration Points in index.ts

- `main()` after DB init: `await runStartupHooks()`
- `main()` after channel connect loop: `await runChannelsReadyHooks(channels)`
- shutdown handler: `await runShutdownHooks()`
- message loop: check `shouldProcessMessages()` before processing; detect guard transitions and call `runGuardLiftedHooks()`

### Skills Affected

| Skill | Current | After |
|-------|---------|-------|
| google-home | 594-line index.ts overlay (4 unique lines) | Overlay **eliminated** — registers `onShutdown(shutdownGoogleAssistant)` via barrel import |
| group-lifecycle | 598-line index.ts overlay (13 unique lines) | Overlay **eliminated** — `unregisterGroup` passed through IPC handler deps |
| shabbat-mode | 671-line index.ts overlay (63 unique lines) | Shrinks to **~30 lines** — registers `registerProcessingGuard(isShabbatOrYomTov)` + `onGuardLifted(sendPostShabbatSummary)` + `onStartup` + `onShutdown` |

## Component 2: Message Lifecycle Events

**New file:** `src/message-events.ts`

### API

```typescript
export function onAgentStarting(fn: (chatJid: string, group: RegisteredGroup) => void | Promise<void>): void;
export function onAgentOutput(fn: (chatJid: string, output: ContainerOutput) => void | Promise<void>): void;
export function onAgentSuccess(fn: (chatJid: string) => void | Promise<void>): void;
export function onAgentError(fn: (chatJid: string, error: string | null) => void | Promise<void>): void;
export function onMessagePiped(fn: (chatJid: string, messageCount: number) => void | Promise<void>): void;

// Dispatch functions called from index.ts
export async function emitAgentStarting(chatJid: string, group: RegisteredGroup): Promise<void>;
export async function emitAgentOutput(chatJid: string, output: ContainerOutput): Promise<void>;
export async function emitAgentSuccess(chatJid: string): Promise<void>;
export async function emitAgentError(chatJid: string, error: string | null): Promise<void>;
export async function emitMessagePiped(chatJid: string, messageCount: number): Promise<void>;
```

### CursorManager

**New file:** `src/cursor-manager.ts`

Extracts the scattered `lastAgentTimestamp` + `previousCursor` logic from index.ts into a shared class:

```typescript
export class CursorManager {
  private cursors: Record<string, string> = {};
  private savedCursors: Record<string, string> = {};

  advance(chatJid: string, timestamp: string): void;
  save(chatJid: string): void;      // snapshot before agent run
  rollback(chatJid: string): void;  // restore on error
  get(chatJid: string): string;
  getAll(): Record<string, string>;  // for persistence
  loadAll(cursors: Record<string, string>): void;  // from DB on startup
}
```

### Impact on reactions skill

Reactions' StatusTracker integration moves from inline code in index.ts to event registrations:

```typescript
// add-reactions/add/src/message-events/reactions.ts
onAgentStarting(async (chatJid) => statusTracker.markProcessing(chatJid, lastMessageId));
onAgentSuccess(async (chatJid) => statusTracker.markComplete(chatJid));
onAgentError(async (chatJid) => statusTracker.markError(chatJid));
onMessagePiped(async (chatJid) => statusTracker.markProcessing(chatJid, lastMessageId));
```

Reactions index.ts overlay shrinks from 719 lines to ~50 lines (event registrations + any remaining unique logic).

## Component 3: IPC Message Dispatch Registry

**Extension to existing `src/ipc-handlers.ts`:**

```typescript
// New (message handlers) — mirrors existing task handler pattern
export type IpcMessageHandler = (
  data: Record<string, any>,
  deps: IpcDeps,
  context: IpcContext,
) => void | Promise<void>;

export function registerIpcMessageHandler(type: string, handler: IpcMessageHandler): void;
export function getIpcMessageHandler(type: string): IpcMessageHandler | undefined;
```

In `src/ipc.ts`, `processMessageIpc`'s `default:` case delegates to the message handler registry (same pattern as `processTaskIpc`).

### Impact

| Skill | Current ipc.ts | After |
|-------|---------------|-------|
| reactions | 454-line overlay | **Eliminated** — registers `reaction` message handler |
| shabbat-mode | 461-line overlay | **Eliminated** — guard moves to lifecycle processingGuard |
| whatsapp-replies | 503-line overlay | Already dead (removed in 5.1) |

## Component 4: Quick Wins

### 5.1: Remove whatsapp-replies dead overlays

Delete `whatsapp-replies/modify/src/index.ts` (925 lines) and `modify/src/ipc.ts` (503 lines). These contribute zero unique content — the accumulated state from prior skills is identical.

### 5.4: Clean stale ipc.ts overlays

After migrating reactions and shabbat-mode, delete their stale `modify/src/ipc.ts` overlays.

## _accumulated → Delta Conversion

As overlays shrink, convert from `_accumulated` (full-file copy) to delta style:

| Skill | File | Action |
|-------|------|--------|
| google-home | index.ts | Overlay eliminated → remove from manifest |
| shabbat-mode | index.ts | Shrinks to ~30 lines → convert to delta |
| shabbat-mode | ipc.ts | Eliminated → remove from manifest |
| reactions | index.ts | Shrinks to ~50 lines → convert to delta |
| reactions | ipc.ts | Eliminated → remove from manifest |
| whatsapp-replies | index.ts, ipc.ts | Dead overlays removed in 5.1 |

Leave untouched: voice-transcription-elevenlabs, voice-recognition (whatsapp.ts), perplexity-research (container-runner.ts).

## Execution Sequence

### Phase A: Infrastructure
1. Create `src/lifecycle.ts` with all 5 hook types + tests
2. Create `src/message-events.ts` with all 5 event types + tests
3. Create `src/cursor-manager.ts` + tests
4. Extend `src/ipc-handlers.ts` with message handler registry
5. Wire dispatch points into index.ts and ipc.ts overlays

### Phase B: Quick Wins
6. Remove whatsapp-replies dead overlays (5.1)
7. Clean stale ipc.ts overlays (5.4)

### Phase C: Skill Migrations (increasing complexity)
8. google-home → eliminate index.ts overlay
9. group-lifecycle → eliminate index.ts overlay
10. shabbat-mode → shrink index.ts + eliminate ipc.ts + convert to delta
11. reactions → shrink index.ts + eliminate ipc.ts + convert to delta
12. IPC message dispatch (5.6) — if not already done in step 11

### Phase D: Validation
13. `npm run apply-skills` — all 17 skills clean
14. `npx tsc --noEmit` — zero type errors
15. `npx vitest run` — all tests pass
16. Manual diff review of applied src/ vs upstream

## Expected Impact

| Metric | Before | After |
|--------|--------|-------|
| Total overlay lines | ~5,914 | ~686 |
| Skills with index.ts overlay | 6 | 3 (refresh-oauth, shabbat-mode, reactions — all <100 lines) |
| Skills with ipc.ts overlay | 4 | 1 (ipc-handler-registry — the base registry) |
| _accumulated overlays (index.ts/ipc.ts) | 6 | 0 |
| New infrastructure files | 0 | 3 (lifecycle.ts, message-events.ts, cursor-manager.ts) |

## Risks

| Risk | Mitigation |
|------|------------|
| Lifecycle hooks change execution order | Hooks run in registration order (barrel import order). Skills that need ordering use `depends:` in manifest. |
| CursorManager breaks message cursor persistence | Full test coverage. CursorManager wraps existing logic, doesn't change semantics. |
| Delta overlays conflict on narrow context | Use `modify_base` where skills chain. Test with `npm run apply-skills` after each migration. |
| Shabbat-mode guard timing changes | Guard check moves from inline to hook dispatch — functionally identical. Verify with existing shabbat tests. |
