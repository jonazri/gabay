# Phase 5: Overlay Reduction — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan. Dispatch fresh subagents per task, review between tasks.

**Goal:** Reduce ~5,200 lines of duplicated overlay code through lifecycle hooks, message events, CursorManager, and IPC message dispatch, then convert `_accumulated` overlays to delta style.

**Architecture:** New registry modules (`src/lifecycle.ts`, `src/message-events.ts`, `src/cursor-manager.ts`) allow skills to *declare* behavior via registration calls instead of copying entire files. Upstream `index.ts` and `ipc.ts` call dispatch functions at the right points. Skills register via side-effect imports.

**Tech Stack:** TypeScript, Vitest, NanoClaw skill overlay system (three-way merge via `git merge-file`).

---

## Task Dependency Graph

```
Task 1 (lifecycle.ts)
Task 3 (CursorManager)        ──┐
Task 4 (message-events.ts)    ──┼──► Task 6 (wire events into index.ts) ──► Task 10 (shabbat)
Task 5 (IPC message registry)   │                                        ──► Task 11 (reactions)
                                 │
Task 2 (wire lifecycle into      │
        index.ts) ───────────────┤
                                 ├──► Task 8 (google-home)
                                 ├──► Task 9 (group-lifecycle)
                                 │
Task 7 (remove dead overlays) ───┘    (independent — can run anytime)

Task 12 (update installed-skills.yaml) ──► depends on Tasks 7-11
Task 13 (full validation) ──► depends on Task 12
```

### Parallelization opportunities

| Parallel Group | Tasks | Why parallel |
|---------------|-------|-------------|
| **Infra batch 1** | 1, 3, 4, 5 | Independent new files — no shared state |
| **Infra batch 2** | 2, 6 | Both modify index.ts overlay, but Task 2 = lifecycle dispatch, Task 6 = event emit. Task 6 depends on Tasks 1+4; Task 2 depends on Task 1. Can run sequentially within a single subagent. |
| **Quick wins** | 7 | Independent of everything — can run in parallel with any infra task |
| **Migrations** | 8, 9 | Both depend on Task 2 only. Independent of each other — can parallelize. |
| **Migrations** | 10, 11 | Both depend on Tasks 2+6. Independent of each other — can parallelize. But Task 11 (reactions) is the most complex — give it a dedicated subagent. |
| **Finalize** | 12, 13 | Sequential, after all migrations complete |

### Critical path

Task 1 → Task 2 → Task 6 (needs 4) → Task 10/11 → Task 12 → Task 13

---

## Phase A: Infrastructure

### Task 1: Create lifecycle hook registry

**Depends on:** nothing | **Parallelizable with:** Tasks 3, 4, 5, 7

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/add/src/lifecycle.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/lifecycle.test.ts`
- Create: `.claude/skills/add-lifecycle-hooks/manifest.yaml`

**Step 1: Create the manifest**

```yaml
# .claude/skills/add-lifecycle-hooks/manifest.yaml
skill: lifecycle-hooks
version: 1.0.0
description: "Lifecycle hook registry for startup, shutdown, channels-ready, and processing guards"
core_version: 0.1.0
adds:
  - src/lifecycle.ts
  - src/lifecycle.test.ts
modifies:
  - src/index.ts
conflicts: []
depends: []
test: "npx vitest run src/lifecycle.test.ts"
```

**Step 2: Write the failing tests**

Create `.claude/skills/add-lifecycle-hooks/add/src/lifecycle.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  onStartup,
  onShutdown,
  onChannelsReady,
  registerProcessingGuard,
  onGuardLifted,
  runStartupHooks,
  runShutdownHooks,
  runChannelsReadyHooks,
  shouldProcessMessages,
  runGuardLiftedHooks,
  _resetForTests,
} from './lifecycle.js';

beforeEach(() => _resetForTests());

describe('startup/shutdown hooks', () => {
  it('runs startup hooks in registration order', async () => {
    const order: number[] = [];
    onStartup(() => { order.push(1); });
    onStartup(() => { order.push(2); });
    await runStartupHooks();
    expect(order).toEqual([1, 2]);
  });

  it('runs shutdown hooks in reverse registration order', async () => {
    const order: number[] = [];
    onShutdown(() => { order.push(1); });
    onShutdown(() => { order.push(2); });
    await runShutdownHooks();
    expect(order).toEqual([2, 1]);
  });

  it('runs channels-ready hooks with channel list', async () => {
    const received: any[] = [];
    onChannelsReady((chs) => { received.push(chs); });
    const fakeChannels = [{ name: 'whatsapp' }] as any;
    await runChannelsReadyHooks(fakeChannels);
    expect(received).toEqual([fakeChannels]);
  });
});

describe('processing guards', () => {
  it('returns true when no guards registered', () => {
    expect(shouldProcessMessages()).toBe(true);
  });

  it('returns false when any guard returns false', () => {
    registerProcessingGuard(() => false);
    expect(shouldProcessMessages()).toBe(false);
  });

  it('returns true only when all guards return true', () => {
    registerProcessingGuard(() => true);
    registerProcessingGuard(() => true);
    expect(shouldProcessMessages()).toBe(true);
  });

  it('runs guard-lifted hooks when guard transitions from false to true', async () => {
    let guardActive = true;
    registerProcessingGuard(() => !guardActive);
    const calls: string[] = [];
    onGuardLifted(async () => { calls.push('lifted'); });

    // Guard active → shouldProcess false
    expect(shouldProcessMessages()).toBe(false);

    // Guard lifts
    guardActive = false;
    expect(shouldProcessMessages()).toBe(true);
    await runGuardLiftedHooks();
    expect(calls).toEqual(['lifted']);
  });
});
```

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/lifecycle.test.ts`
Expected: FAIL — module not found.

**Step 4: Write the implementation**

Create `.claude/skills/add-lifecycle-hooks/add/src/lifecycle.ts`:

```typescript
import { Channel } from './types.js';
import { logger } from './logger.js';

type AsyncVoidFn = () => void | Promise<void>;
type ChannelsReadyFn = (channels: Channel[]) => void | Promise<void>;
type GuardFn = () => boolean;

const startupHooks: AsyncVoidFn[] = [];
const shutdownHooks: AsyncVoidFn[] = [];
const channelsReadyHooks: ChannelsReadyFn[] = [];
const processingGuards: GuardFn[] = [];
const guardLiftedHooks: AsyncVoidFn[] = [];

// --- Registration ---

export function onStartup(fn: AsyncVoidFn): void {
  startupHooks.push(fn);
}

export function onShutdown(fn: AsyncVoidFn): void {
  shutdownHooks.push(fn);
}

export function onChannelsReady(fn: ChannelsReadyFn): void {
  channelsReadyHooks.push(fn);
}

export function registerProcessingGuard(fn: GuardFn): void {
  processingGuards.push(fn);
}

export function onGuardLifted(fn: AsyncVoidFn): void {
  guardLiftedHooks.push(fn);
}

// --- Dispatch ---

export async function runStartupHooks(): Promise<void> {
  for (const fn of startupHooks) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, 'Startup hook failed');
    }
  }
}

export async function runShutdownHooks(): Promise<void> {
  // Reverse order: last registered shuts down first (LIFO)
  for (const fn of [...shutdownHooks].reverse()) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, 'Shutdown hook failed');
    }
  }
}

export async function runChannelsReadyHooks(channels: Channel[]): Promise<void> {
  for (const fn of channelsReadyHooks) {
    try {
      await fn(channels);
    } catch (err) {
      logger.error({ err }, 'Channels-ready hook failed');
    }
  }
}

export function shouldProcessMessages(): boolean {
  return processingGuards.every((fn) => fn());
}

export async function runGuardLiftedHooks(): Promise<void> {
  for (const fn of guardLiftedHooks) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, 'Guard-lifted hook failed');
    }
  }
}

/** @internal - for tests only */
export function _resetForTests(): void {
  startupHooks.length = 0;
  shutdownHooks.length = 0;
  channelsReadyHooks.length = 0;
  processingGuards.length = 0;
  guardLiftedHooks.length = 0;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lifecycle.test.ts`
Expected: PASS (all 6 tests).

**Step 6: Commit**

```bash
git add .claude/skills/add-lifecycle-hooks/
git commit -m "feat(skills): add lifecycle hook registry (Phase 5A.1)"
```

---

### Task 2: Wire lifecycle hooks into index.ts

**Depends on:** Task 1 | **Parallelizable with:** Task 7

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/modify/src/index.ts` (delta overlay vs upstream)

The overlay adds 4 dispatch points to upstream `src/index.ts`:

**Step 1: Write the delta overlay**

The overlay needs to add to upstream `src/index.ts`:

1. **Import** (after line 52, the logger import):
   ```typescript
   import {
     runChannelsReadyHooks,
     runShutdownHooks,
     runStartupHooks,
     shouldProcessMessages,
     runGuardLiftedHooks,
   } from './lifecycle.js';
   ```

2. **In `main()` after `loadState()` (line 467):**
   ```typescript
   await runStartupHooks();
   ```

3. **In `shutdown()` after `ch.disconnect()` loop (line 473):**
   ```typescript
   await runShutdownHooks();
   ```

4. **In `main()` after channel connect loop (after line 525):**
   ```typescript
   await runChannelsReadyHooks(channels);
   ```

5. **In `startMessageLoop()` at top of `while(true)` body (after line 348):**
   ```typescript
   if (!shouldProcessMessages()) {
     await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
     continue;
   }
   ```

6. **Guard transition detection in `startMessageLoop()` (before the while loop):**
   ```typescript
   let wasGuarded = !shouldProcessMessages();
   ```
   And inside the loop, after the guard check:
   ```typescript
   const currentlyGuarded = !shouldProcessMessages();
   if (wasGuarded && !currentlyGuarded) {
     await runGuardLiftedHooks();
   }
   wasGuarded = currentlyGuarded;
   ```

7. **In `processGroupMessages()` at the top, after the group/channel checks (after line 148):**
   ```typescript
   if (!shouldProcessMessages()) return true;
   ```

**Step 2: Build the overlay as a delta against upstream**

Create the overlay by copying upstream `src/index.ts` and applying only the above additions. This is a delta overlay — it should match upstream exactly except for the added lines. **Do not use `_accumulated` — use delta style.**

Since this is the first overlay in the lifecycle-hooks skill, its `modify_base` is implicit (upstream).

**Step 3: Update manifest**

Add `src/index.ts` to the `modifies:` list in the manifest.

**Step 4: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base
```

Temporarily add `lifecycle-hooks` to `.nanoclaw/installed-skills.yaml` as the first skill (before `whatsapp-types`):

```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  # ... rest unchanged
```

Run:
```bash
npm run apply-skills
```
Expected: No conflicts.

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 5: Commit**

```bash
git add .claude/skills/add-lifecycle-hooks/modify/src/index.ts .claude/skills/add-lifecycle-hooks/manifest.yaml
git commit -m "feat(skills): wire lifecycle hooks into index.ts (Phase 5A.2)"
```

---

### Task 3: Create CursorManager

**Depends on:** nothing | **Parallelizable with:** Tasks 1, 4, 5, 7

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/add/src/cursor-manager.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/cursor-manager.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { CursorManager } from './cursor-manager.js';

describe('CursorManager', () => {
  let cm: CursorManager;
  beforeEach(() => { cm = new CursorManager(); });

  it('returns empty string for unknown chatJid', () => {
    expect(cm.get('unknown')).toBe('');
  });

  it('advances cursor', () => {
    cm.advance('jid1', '2026-01-01T00:00:00Z');
    expect(cm.get('jid1')).toBe('2026-01-01T00:00:00Z');
  });

  it('saves and rolls back', () => {
    cm.advance('jid1', 'ts1');
    cm.save('jid1');
    cm.advance('jid1', 'ts2');
    expect(cm.get('jid1')).toBe('ts2');
    cm.rollback('jid1');
    expect(cm.get('jid1')).toBe('ts1');
  });

  it('rollback is no-op without prior save', () => {
    cm.advance('jid1', 'ts1');
    cm.rollback('jid1');
    expect(cm.get('jid1')).toBe('ts1');
  });

  it('getAll returns all cursors', () => {
    cm.advance('a', '1');
    cm.advance('b', '2');
    expect(cm.getAll()).toEqual({ a: '1', b: '2' });
  });

  it('loadAll restores state', () => {
    cm.loadAll({ x: '3', y: '4' });
    expect(cm.get('x')).toBe('3');
    expect(cm.get('y')).toBe('4');
  });

  it('clearSaved removes saved cursor', () => {
    cm.advance('jid1', 'ts1');
    cm.save('jid1');
    cm.advance('jid1', 'ts2');
    cm.clearSaved('jid1');
    cm.rollback('jid1'); // no-op, saved was cleared
    expect(cm.get('jid1')).toBe('ts2');
  });

  it('hasSaved returns correct state', () => {
    expect(cm.hasSaved('jid1')).toBe(false);
    cm.advance('jid1', 'ts1');
    cm.save('jid1');
    expect(cm.hasSaved('jid1')).toBe(true);
    cm.clearSaved('jid1');
    expect(cm.hasSaved('jid1')).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cursor-manager.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```typescript
/**
 * Manages per-group message cursors (timestamps that track which messages
 * have been processed). Supports save/rollback for crash recovery.
 */
export class CursorManager {
  private cursors: Record<string, string> = {};
  private savedCursors: Record<string, string> = {};

  /** Move cursor forward for a group. */
  advance(chatJid: string, timestamp: string): void {
    this.cursors[chatJid] = timestamp;
  }

  /** Snapshot current cursor before a risky operation (e.g. agent run). */
  save(chatJid: string): void {
    this.savedCursors[chatJid] = this.cursors[chatJid] || '';
  }

  /** Restore cursor to last saved snapshot (e.g. on agent error). */
  rollback(chatJid: string): void {
    if (chatJid in this.savedCursors) {
      this.cursors[chatJid] = this.savedCursors[chatJid];
      delete this.savedCursors[chatJid];
    }
  }

  /** Clear saved cursor without rolling back (e.g. on success). */
  clearSaved(chatJid: string): void {
    delete this.savedCursors[chatJid];
  }

  /** Check if a saved cursor exists for a group. */
  hasSaved(chatJid: string): boolean {
    return chatJid in this.savedCursors;
  }

  /** Get current cursor for a group. */
  get(chatJid: string): string {
    return this.cursors[chatJid] || '';
  }

  /** Get all cursors (for persistence). */
  getAll(): Record<string, string> {
    return { ...this.cursors };
  }

  /** Get all saved cursors (for persistence). */
  getSavedAll(): Record<string, string> {
    return { ...this.savedCursors };
  }

  /** Load cursors from persisted state (on startup). */
  loadAll(cursors: Record<string, string>): void {
    this.cursors = { ...cursors };
  }

  /** Load saved cursors from persisted state (on startup). */
  loadSavedAll(saved: Record<string, string>): void {
    this.savedCursors = { ...saved };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cursor-manager.test.ts`
Expected: PASS (all 8 tests).

**Step 5: Update manifest and commit**

Add `src/cursor-manager.ts` and `src/cursor-manager.test.ts` to the manifest `adds:` list.

```bash
git add .claude/skills/add-lifecycle-hooks/add/src/cursor-manager.ts .claude/skills/add-lifecycle-hooks/add/src/cursor-manager.test.ts .claude/skills/add-lifecycle-hooks/manifest.yaml
git commit -m "feat(skills): add CursorManager class (Phase 5A.3)"
```

---

### Task 4: Create message lifecycle events

**Depends on:** nothing | **Parallelizable with:** Tasks 1, 3, 5, 7

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/add/src/message-events.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/message-events.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import {
  onAgentStarting,
  onAgentOutput,
  onAgentSuccess,
  onAgentError,
  onMessagePiped,
  emitAgentStarting,
  emitAgentOutput,
  emitAgentSuccess,
  emitAgentError,
  emitMessagePiped,
  _resetForTests,
} from './message-events.js';

beforeEach(() => _resetForTests());

describe('message lifecycle events', () => {
  it('emits agentStarting to all listeners', async () => {
    const calls: string[] = [];
    onAgentStarting(async (jid) => { calls.push(`a:${jid}`); });
    onAgentStarting(async (jid) => { calls.push(`b:${jid}`); });
    await emitAgentStarting('jid1', { name: 'test' } as any);
    expect(calls).toEqual(['a:jid1', 'b:jid1']);
  });

  it('emits agentOutput with ContainerOutput', async () => {
    const outputs: any[] = [];
    onAgentOutput(async (_jid, out) => { outputs.push(out); });
    await emitAgentOutput('jid1', { result: 'hello' } as any);
    expect(outputs).toEqual([{ result: 'hello' }]);
  });

  it('emits agentSuccess', async () => {
    const calls: string[] = [];
    onAgentSuccess(async (jid) => { calls.push(jid); });
    await emitAgentSuccess('jid1');
    expect(calls).toEqual(['jid1']);
  });

  it('emits agentError', async () => {
    const calls: Array<[string, string | null]> = [];
    onAgentError(async (jid, err) => { calls.push([jid, err]); });
    await emitAgentError('jid1', 'boom');
    expect(calls).toEqual([['jid1', 'boom']]);
  });

  it('emits messagePiped', async () => {
    const calls: Array<[string, number]> = [];
    onMessagePiped(async (jid, count) => { calls.push([jid, count]); });
    await emitMessagePiped('jid1', 5);
    expect(calls).toEqual([['jid1', 5]]);
  });

  it('listener errors do not break other listeners', async () => {
    const calls: string[] = [];
    onAgentSuccess(async () => { throw new Error('boom'); });
    onAgentSuccess(async (jid) => { calls.push(jid); });
    await emitAgentSuccess('jid1');
    expect(calls).toEqual(['jid1']);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/message-events.test.ts`
Expected: FAIL — module not found.

**Step 3: Write the implementation**

```typescript
import { ContainerOutput } from './container-runner.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';

type AgentStartingFn = (chatJid: string, group: RegisteredGroup) => void | Promise<void>;
type AgentOutputFn = (chatJid: string, output: ContainerOutput) => void | Promise<void>;
type AgentSuccessFn = (chatJid: string) => void | Promise<void>;
type AgentErrorFn = (chatJid: string, error: string | null) => void | Promise<void>;
type MessagePipedFn = (chatJid: string, messageCount: number) => void | Promise<void>;

const agentStartingListeners: AgentStartingFn[] = [];
const agentOutputListeners: AgentOutputFn[] = [];
const agentSuccessListeners: AgentSuccessFn[] = [];
const agentErrorListeners: AgentErrorFn[] = [];
const messagePipedListeners: MessagePipedFn[] = [];

// --- Registration ---

export function onAgentStarting(fn: AgentStartingFn): void { agentStartingListeners.push(fn); }
export function onAgentOutput(fn: AgentOutputFn): void { agentOutputListeners.push(fn); }
export function onAgentSuccess(fn: AgentSuccessFn): void { agentSuccessListeners.push(fn); }
export function onAgentError(fn: AgentErrorFn): void { agentErrorListeners.push(fn); }
export function onMessagePiped(fn: MessagePipedFn): void { messagePipedListeners.push(fn); }

// --- Dispatch ---

async function emit<T extends any[]>(listeners: Array<(...args: T) => void | Promise<void>>, ...args: T): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(...args);
    } catch (err) {
      logger.error({ err }, 'Message event listener failed');
    }
  }
}

export async function emitAgentStarting(chatJid: string, group: RegisteredGroup): Promise<void> {
  await emit(agentStartingListeners, chatJid, group);
}

export async function emitAgentOutput(chatJid: string, output: ContainerOutput): Promise<void> {
  await emit(agentOutputListeners, chatJid, output);
}

export async function emitAgentSuccess(chatJid: string): Promise<void> {
  await emit(agentSuccessListeners, chatJid);
}

export async function emitAgentError(chatJid: string, error: string | null): Promise<void> {
  await emit(agentErrorListeners, chatJid, error);
}

export async function emitMessagePiped(chatJid: string, messageCount: number): Promise<void> {
  await emit(messagePipedListeners, chatJid, messageCount);
}

/** @internal - for tests only */
export function _resetForTests(): void {
  agentStartingListeners.length = 0;
  agentOutputListeners.length = 0;
  agentSuccessListeners.length = 0;
  agentErrorListeners.length = 0;
  messagePipedListeners.length = 0;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/message-events.test.ts`
Expected: PASS (all 6 tests).

**Step 5: Update manifest and commit**

Add `src/message-events.ts` and `src/message-events.test.ts` to the manifest `adds:` list.

```bash
git add .claude/skills/add-lifecycle-hooks/add/src/message-events.ts .claude/skills/add-lifecycle-hooks/add/src/message-events.test.ts .claude/skills/add-lifecycle-hooks/manifest.yaml
git commit -m "feat(skills): add message lifecycle events (Phase 5A.4)"
```

---

### Task 5: Extend IPC handler registry with message handlers

**Depends on:** nothing | **Parallelizable with:** Tasks 1, 3, 4, 7

**Files:**
- Modify: `.claude/skills/ipc-handler-registry/add/src/ipc-handlers.ts`
- Modify: `.claude/skills/ipc-handler-registry/add/src/ipc-handlers.test.ts`

The existing `ipc-handlers.ts` already has task handler registry. Add a parallel message handler registry.

**Step 1: Add message handler types and registry**

Append to `.claude/skills/ipc-handler-registry/add/src/ipc-handlers.ts`:

```typescript
// --- IPC Message Handlers (for processIpcFiles message types) ---

export type IpcMessageHandler = (
  data: Record<string, any>,
  deps: IpcDeps,
  context: IpcContext,
) => void | Promise<void>;

const messageHandlers = new Map<string, IpcMessageHandler>();

export function registerIpcMessageHandler(type: string, handler: IpcMessageHandler): void {
  if (messageHandlers.has(type)) {
    throw new Error(`IPC message handler already registered for type: ${type}`);
  }
  messageHandlers.set(type, handler);
}

export function getIpcMessageHandler(type: string): IpcMessageHandler | undefined {
  return messageHandlers.get(type);
}
```

**Step 2: Add tests**

Append to `.claude/skills/ipc-handler-registry/add/src/ipc-handlers.test.ts`:

```typescript
describe('IPC message handler registry', () => {
  it('registers and retrieves a message handler', () => {
    const handler = vi.fn();
    registerIpcMessageHandler('reaction', handler);
    expect(getIpcMessageHandler('reaction')).toBe(handler);
  });

  it('returns undefined for unregistered message type', () => {
    expect(getIpcMessageHandler('nonexistent')).toBeUndefined();
  });

  it('throws on duplicate message handler registration', () => {
    registerIpcMessageHandler('test_msg', vi.fn());
    expect(() => registerIpcMessageHandler('test_msg', vi.fn())).toThrow();
  });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/ipc-handlers.test.ts`
Expected: PASS.

**Step 4: Update ipc.ts overlay to delegate to message handlers**

In the `ipc-handler-registry` skill's `modify/src/ipc.ts` overlay, the `processIpcFiles` function's message processing section currently only handles `type === 'message'`. After the existing message handling, add a fallback to the message handler registry:

In the `else` clause after the `if (data.type === 'message' && data.chatJid && data.text)` block, add:

```typescript
} else {
  const msgHandler = getIpcMessageHandler(data.type);
  if (msgHandler) {
    await msgHandler(data, deps, { sourceGroup, isMain });
  }
}
```

This mirrors the task handler pattern: unknown message types delegate to the registry.

**Step 5: Commit**

```bash
git add .claude/skills/ipc-handler-registry/
git commit -m "feat(skills): add IPC message handler registry (Phase 5A.5)"
```

---

### Task 6: Wire message events into index.ts overlay

**Depends on:** Tasks 1, 2, 4 | **Blocks:** Tasks 10, 11

**Files:**
- Modify: `.claude/skills/add-lifecycle-hooks/modify/src/index.ts`

Add emit calls at the appropriate points in the lifecycle-hooks index.ts overlay:

1. **Import** (add to existing lifecycle imports):
   ```typescript
   import {
     emitAgentStarting,
     emitAgentOutput,
     emitAgentSuccess,
     emitAgentError,
     emitMessagePiped,
   } from './message-events.js';
   ```

2. **In `processGroupMessages()`** before `runAgent()` call:
   ```typescript
   await emitAgentStarting(chatJid, group);
   ```

3. **In the streaming output callback** (inside `runAgent` call in `processGroupMessages`), after `result.result` handling:
   ```typescript
   await emitAgentOutput(chatJid, result);
   ```

4. **On success** (in the streaming callback when `result.status === 'success'`):
   ```typescript
   await emitAgentSuccess(chatJid);
   ```

5. **On error** (in the streaming callback when `result.status === 'error'`):
   ```typescript
   await emitAgentError(chatJid, result.error || null);
   ```

6. **In `startMessageLoop()`** when messages are piped to active container:
   ```typescript
   await emitMessagePiped(chatJid, messagesToSend.length);
   ```

**Step 1: Update the overlay**

Modify the existing lifecycle-hooks index.ts overlay to include these emit calls.

**Step 2: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add .claude/skills/add-lifecycle-hooks/modify/src/index.ts
git commit -m "feat(skills): wire message events into index.ts (Phase 5A.6)"
```

---

## Phase B: Quick Wins

### Task 7: Remove whatsapp-replies dead overlays

**Depends on:** nothing | **Parallelizable with:** any task (fully independent)

**Files:**
- Delete: `.claude/skills/whatsapp-replies/modify/src/index.ts` (925 lines)
- Delete: `.claude/skills/whatsapp-replies/modify/src/ipc.ts` (503 lines)
- Modify: `.claude/skills/whatsapp-replies/manifest.yaml`

The whatsapp-replies skill's `modify/src/index.ts` and `modify/src/ipc.ts` are `_accumulated` overlays that contribute zero unique content — they're full-file copies of the accumulated state from all prior skills. By the time all preceding skills have been applied, these overlays produce no diff.

**Step 1: Verify they're dead**

```bash
# Apply all skills except whatsapp-replies
# Temporarily comment out whatsapp-replies in installed-skills.yaml
npm run apply-skills
# Save the applied state
cp src/index.ts /tmp/without-wr-index.ts
cp src/ipc.ts /tmp/without-wr-ipc.ts

# Restore and apply all skills
git checkout -- src/ && rm -rf .nanoclaw/base
# Uncomment whatsapp-replies
npm run apply-skills
diff /tmp/without-wr-index.ts src/index.ts  # Should show NO diff for index.ts unique content
diff /tmp/without-wr-ipc.ts src/ipc.ts      # Should show NO diff for ipc.ts unique content
```

Note: whatsapp-replies' other overlays (whatsapp.ts, db.ts, types.ts, router.ts, etc.) are NOT dead — only index.ts and ipc.ts are.

**Step 2: Delete dead overlays**

```bash
rm .claude/skills/whatsapp-replies/modify/src/index.ts
rm .claude/skills/whatsapp-replies/modify/src/ipc.ts
```

**Step 3: Update manifest**

Remove `src/index.ts` and `src/ipc.ts` from `modifies:` and `modify_base:` in `.claude/skills/whatsapp-replies/manifest.yaml`.

**Step 4: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add .claude/skills/whatsapp-replies/
git commit -m "fix(skills): remove dead whatsapp-replies index.ts+ipc.ts overlays (Phase 5B.1)"
```

---

## Phase C: Skill Migrations

### Task 8: Migrate google-home — eliminate index.ts overlay

**Depends on:** Task 2 | **Parallelizable with:** Task 9

**Files:**
- Modify: `.claude/skills/add-google-home/modify/src/index.ts` → convert to delta or eliminate
- Modify: `.claude/skills/add-google-home/manifest.yaml`

**Current unique additions** (from diff analysis):

1. Import `shutdownGoogleAssistant, startGoogleTokenScheduler, stopGoogleTokenScheduler` from `./google-assistant.js`
2. `stopGoogleTokenScheduler()` in shutdown handler
3. `shutdownGoogleAssistant()` in shutdown handler
4. `startGoogleTokenScheduler(...)` after channel connect
5. Import `./ipc-handlers/google-home.js` (side-effect registration)

**Migration:** All 5 additions map to lifecycle hooks:
- Items 2-3: `onShutdown(() => { stopGoogleTokenScheduler(); shutdownGoogleAssistant(); })`
- Item 4: `onChannelsReady(() => startGoogleTokenScheduler(...))`
- Item 5: Side-effect import stays in the google-home skill's own barrel file

**Step 1: Create a registration module**

Create `.claude/skills/add-google-home/add/src/lifecycle/google-home.ts`:

```typescript
import { onShutdown, onChannelsReady } from '../lifecycle.js';
import {
  shutdownGoogleAssistant,
  startGoogleTokenScheduler,
  stopGoogleTokenScheduler,
} from '../google-assistant.js';
import '../ipc-handlers/google-home.js';

onShutdown(async () => {
  stopGoogleTokenScheduler();
  shutdownGoogleAssistant();
});

// NOTE: startGoogleTokenScheduler needs a notifyMainGroup callback.
// This will be wired via the onChannelsReady hook once we have the
// messaging infrastructure available. For now, keep the index.ts overlay
// for this one line until the notifyMainGroup helper is extracted.
```

**Problem:** `startGoogleTokenScheduler` needs `notifyMainGroup`, a function that depends on `channels`, `registeredGroups`, and `findChannel` — all local to `index.ts`.

**Solution:** The lifecycle-hooks overlay should export a `notifyMainGroup` helper (or the google-home skill can access it through `onChannelsReady` which provides the channels array). Better approach: keep a **tiny delta overlay** for google-home that only adds the `startGoogleTokenScheduler` call in `main()`, leveraging the fact that `notifyMainGroup` is defined in the lifecycle-hooks overlay.

**Revised approach:** Convert the 594-line `_accumulated` overlay to a ~15-line delta overlay.

**Step 2: Create minimal delta overlay**

Replace `.claude/skills/add-google-home/modify/src/index.ts` with a delta overlay that adds only:

```typescript
// Delta additions to upstream src/index.ts:
// 1. Import google-assistant functions
// 2. Import google-home IPC handler (side-effect)
// 3. stopGoogleTokenScheduler() in shutdown
// 4. shutdownGoogleAssistant() in shutdown
// 5. startGoogleTokenScheduler() after channels connect
```

The delta overlay should be based on upstream `src/index.ts` and add the 5 unique lines at the correct locations.

**Step 3: Update manifest**

Change `modify_base` from `_accumulated` to remove the entry (delta vs upstream):

```yaml
modifies:
  - src/index.ts
  - src/container-runner.ts
# Remove modify_base for src/index.ts entirely (delta vs upstream)
depends: [ipc-handler-registry, lifecycle-hooks]
```

**Step 4: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add .claude/skills/add-google-home/
git commit -m "fix(skills): convert google-home index.ts to delta overlay (Phase 5C.1)"
```

---

### Task 9: Migrate group-lifecycle — eliminate index.ts overlay

**Depends on:** Task 2 | **Parallelizable with:** Task 8

**Files:**
- Modify: `.claude/skills/add-group-lifecycle/modify/src/index.ts` → convert to delta or eliminate
- Modify: `.claude/skills/add-group-lifecycle/manifest.yaml`

**Current unique additions** (from diff analysis, 599 lines → 13 unique):

1. Import `deleteRegisteredGroup` from `./db.js`
2. Import `./ipc-handlers/group-lifecycle.js` (side-effect)
3. `unregisterGroup()` function definition (7 lines)
4. Pass `unregisterGroup` to `startIpcWatcher` deps

**Migration:** Items 1, 3, 4 can stay as a delta overlay but much smaller. Item 2 is a side-effect import.

**Step 1: Create minimal delta overlay**

Replace the 599-line `_accumulated` overlay with a delta that adds only:
- The `deleteRegisteredGroup` db import
- The `import './ipc-handlers/group-lifecycle.js'`
- The `unregisterGroup()` function
- The `unregisterGroup` in `startIpcWatcher` deps

**Step 2: Update manifest**

Remove `modify_base` entry. The overlay is now a delta vs upstream.

```yaml
depends:
  - ipc-handler-registry
  - reactions  # still depends on reactions for ipc.ts base
```

**Step 3: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add .claude/skills/add-group-lifecycle/
git commit -m "fix(skills): convert group-lifecycle index.ts to delta overlay (Phase 5C.2)"
```

---

### Task 10: Migrate shabbat-mode — shrink index.ts + eliminate ipc.ts

**Depends on:** Tasks 2, 6 | **Parallelizable with:** Task 11

**Files:**
- Modify: `.claude/skills/add-shabbat-mode/modify/src/index.ts` → convert to delta
- Delete: `.claude/skills/add-shabbat-mode/modify/src/ipc.ts` → eliminated via lifecycle guard
- Modify: `.claude/skills/add-shabbat-mode/manifest.yaml`

**Current unique additions to index.ts** (from diff, 671 lines → ~63 unique):

1. Imports: `initShabbatSchedule, isShabbatOrYomTov, startCandleLightingNotifier, stopCandleLightingNotifier` from `./shabbat.js`
2. Shabbat guard in `processGroupMessages()`: `if (isShabbatOrYomTov()) return true` (8 lines)
3. `sendPostShabbatSummary()` function (35 lines)
4. Guard transition in `startMessageLoop()`: `wasShabbat` tracking + post-Shabbat catch-up (17 lines)
5. `stopCandleLightingNotifier()` in shutdown
6. `initShabbatSchedule()` in startup
7. `startCandleLightingNotifier()` after channels connect (14 lines)

**Migration using lifecycle hooks:**

- Item 2: **Eliminated** — `registerProcessingGuard(() => !isShabbatOrYomTov())` replaces both the `processGroupMessages` guard AND the `startMessageLoop` guard (Task 2 already wired `shouldProcessMessages()` at both points)
- Item 4: **Eliminated** — `onGuardLifted(sendPostShabbatSummary)` replaces the `wasShabbat` transition detection
- Item 5: `onShutdown(stopCandleLightingNotifier)`
- Item 6: `onStartup(initShabbatSchedule)`
- Item 7: `onChannelsReady(...)` with the candle lighting notifier setup

**What remains in the overlay:** Only `sendPostShabbatSummary()` function and the registration calls. This can be a side-effect registration module.

**Current ipc.ts unique addition** (461 lines → 6 unique):

1. Import `isShabbatOrYomTov` from `./shabbat.js`
2. Guard at top of `processIpcFiles`: `if (isShabbatOrYomTov()) return` (6 lines)

**Migration:** The `shouldProcessMessages()` guard will cover this too if we also add the guard check in the IPC watcher. OR: we can keep this as a simple 6-line delta. Decision: **eliminate** — the lifecycle guard already covers message processing. IPC tasks during Shabbat should still be processed (e.g. scheduling tasks for after Shabbat).

Actually, the original shabbat-mode blocks ALL IPC processing during Shabbat. This is intentional — the agent shouldn't process any tasks during Shabbat. We should keep this behavior by also checking the guard in processIpcFiles.

**Revised approach for ipc.ts:** Add a `shouldProcessIpc()` check to the lifecycle hooks overlay's ipc.ts delta. This way shabbat-mode's ipc.ts overlay is eliminated.

**Step 1: Create shabbat-mode registration module**

Create `.claude/skills/add-shabbat-mode/add/src/lifecycle/shabbat.ts`:

```typescript
import {
  onStartup,
  onShutdown,
  onChannelsReady,
  registerProcessingGuard,
  onGuardLifted,
} from '../lifecycle.js';
import {
  initShabbatSchedule,
  isShabbatOrYomTov,
  startCandleLightingNotifier,
  stopCandleLightingNotifier,
} from '../shabbat.js';
import { findChannel } from '../router.js';
import { getMessagesSince } from '../db.js';
import { ASSISTANT_NAME } from '../config.js';
import { logger } from '../logger.js';
import type { Channel, RegisteredGroup } from '../types.js';

// These will be set by onChannelsReady
let _channels: Channel[] = [];
let _registeredGroups: () => Record<string, RegisteredGroup>;
let _lastAgentTimestamp: () => Record<string, string>;
let _queue: { enqueueMessageCheck: (jid: string) => void };

registerProcessingGuard(() => !isShabbatOrYomTov());

onStartup(() => initShabbatSchedule());

onShutdown(() => stopCandleLightingNotifier());

onGuardLifted(async () => {
  // Post-Shabbat catch-up
  const groups = _registeredGroups();
  const timestamps = _lastAgentTimestamp();
  const pendingJids: string[] = [];

  const userJid = Object.entries(groups).find(
    ([_, g]) => g.isMain === true,
  )?.[0];
  if (!userJid) return;

  const channel = findChannel(_channels, userJid);
  if (!channel) return;

  const summaryLines: string[] = [];
  for (const [chatJid, group] of Object.entries(groups)) {
    const sinceTimestamp = timestamps[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      summaryLines.push(`• ${group.name}: ${pending.length} messages`);
      pendingJids.push(chatJid);
    }
  }

  let text = 'Shavua Tov!';
  if (summaryLines.length > 0) {
    text += `\n\nHere's what happened over Shabbat:\n${summaryLines.join('\n')}\n\nCatching up now.`;
  }

  await channel.sendMessage(userJid, text);
  logger.info(
    { groupsWithActivity: summaryLines.length },
    'Post-Shabbat summary sent',
  );

  for (const chatJid of pendingJids) {
    _queue.enqueueMessageCheck(chatJid);
  }
});

// Export init function that receives runtime dependencies
export function initShabbatHooks(deps: {
  channels: Channel[];
  registeredGroups: () => Record<string, RegisteredGroup>;
  lastAgentTimestamp: () => Record<string, string>;
  queue: { enqueueMessageCheck: (jid: string) => void };
}): void {
  _channels = deps.channels;
  _registeredGroups = deps.registeredGroups;
  _lastAgentTimestamp = deps.lastAgentTimestamp;
  _queue = deps.queue;
}
```

**NOTE:** This registration module needs runtime state (channels, registeredGroups, etc.) that isn't available at import time. The `initShabbatHooks()` function provides these. The shabbat-mode index.ts overlay shrinks to just calling `initShabbatHooks()` in `main()` + `startCandleLightingNotifier()`.

**Step 2: Create minimal delta overlay for index.ts**

The new shabbat-mode index.ts overlay (delta vs upstream) adds only:
- Import of `./lifecycle/shabbat.js` and `initShabbatHooks`
- Import of `startCandleLightingNotifier` from `./shabbat.js`
- `initShabbatHooks({...})` call in `main()` after channels connect
- `startCandleLightingNotifier(...)` call

This should be ~30 lines of unique additions.

**Step 3: Delete ipc.ts overlay**

The Shabbat IPC guard is now handled by `shouldProcessMessages()` being checked in the lifecycle-hooks ipc.ts overlay. Delete `.claude/skills/add-shabbat-mode/modify/src/ipc.ts`.

**Step 4: Update manifest**

```yaml
modifies:
  - src/index.ts
  - src/task-scheduler.ts
  - src/task-scheduler.test.ts
# Remove src/ipc.ts from modifies
# Remove modify_base entries for src/index.ts and src/ipc.ts
depends:
  - lifecycle-hooks
  - reactions
```

**Step 5: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
npx vitest run src/shabbat.test.ts
```

**Step 6: Commit**

```bash
git add .claude/skills/add-shabbat-mode/
git commit -m "fix(skills): migrate shabbat-mode to lifecycle hooks, eliminate ipc.ts overlay (Phase 5C.3)"
```

---

### Task 11: Migrate reactions — shrink index.ts + eliminate ipc.ts

**Depends on:** Tasks 2, 3, 5, 6 | **Parallelizable with:** Task 10 | **Note:** Most complex task — give dedicated subagent

**Files:**
- Modify: `.claude/skills/add-reactions/modify/src/index.ts` → convert to smaller delta
- Modify: `.claude/skills/add-reactions/modify/src/ipc.ts` → eliminate or shrink
- Modify: `.claude/skills/add-reactions/manifest.yaml`

**Current unique additions to index.ts** (720 lines → ~133 unique):

1. Import `StatusTracker` from `./status-tracker.js`, `getMessageFromMe` from `./db.js`
2. `cursorBeforePipe` state variable + load/save in `loadState`/`saveState`
3. `statusTracker` initialization in `main()` (17 lines)
4. `statusTracker.markReceived()` calls in `startMessageLoop()` (5 lines)
5. `statusTracker.markThinking()` calls in `startMessageLoop()` (5 lines)
6. Pipe cursor save logic in `startMessageLoop()` (3 lines)
7. `statusTracker.markReceived()` + `markThinking()` in `processGroupMessages()` (10 lines)
8. `markWorking()` on first output (5 lines)
9. `markAllDone()` on success, `markAllFailed()` on error (scattered)
10. Enhanced cursor rollback with `cursorBeforePipe` in error handlers (15 lines)
11. `statusTracker.shutdown()` in shutdown handler
12. `statusTracker.recover()` after channels connect
13. `sendReaction` in IPC watcher deps (15 lines)
14. `statusHeartbeat` + `recoverPendingMessages` in IPC watcher deps (2 lines)
15. Simplified `onMessage` callback (removed sender-allowlist drop)
16. Simplified trigger check (removed sender-allowlist)

**Migration using message events:**

Items 4-5 (markReceived/markThinking in startMessageLoop) → `onMessagePiped` handler
Items 7-8 (markReceived/markThinking/markWorking in processGroupMessages) → `onAgentStarting` + `onAgentOutput` handlers
Item 9 (markAllDone/markAllFailed) → `onAgentSuccess` + `onAgentError` handlers

**What stays in the overlay:**
- StatusTracker initialization (needs channels, registeredGroups, queue — runtime deps)
- CursorManager integration (cursorBeforePipe state)
- Enhanced cursor rollback logic
- `sendReaction` IPC dep
- `statusHeartbeat` + `recoverPendingMessages` IPC deps
- `statusTracker.recover()` call
- `statusTracker.shutdown()` call
- Sender-allowlist removal

This is still significant — the reactions skill is deeply integrated. Estimate: overlay shrinks from 720 to ~200 lines. Converting from `_accumulated` to delta still saves 520 lines.

**Step 1: Create reactions event registration module**

Create `.claude/skills/add-reactions/add/src/message-events/reactions.ts` that registers the StatusTracker callbacks with message events.

**Step 2: Convert index.ts to delta overlay**

Replace the 720-line accumulated overlay with a delta that adds only unique lines to upstream.

**Step 3: Convert ipc.ts to use message handler registry**

The reactions ipc.ts overlay adds:
- `sendReaction` to IpcDeps (interface extension)
- Reaction message handling (type === 'reaction')
- `statusHeartbeat` + `recoverPendingMessages` to IpcDeps
- Heartbeat/recovery calls at end of processIpcFiles

The reaction message handling can move to a registered message handler. The IpcDeps extension and heartbeat/recovery stays as a delta overlay.

**Step 4: Update manifest**

Remove `modify_base` entries. Change to delta overlays.

**Step 5: Verify**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
npx vitest run
```

**Step 6: Commit**

```bash
git add .claude/skills/add-reactions/
git commit -m "fix(skills): convert reactions overlays to delta, use message events (Phase 5C.4)"
```

---

### Task 12: Update installed-skills.yaml and dependency graph

**Depends on:** Tasks 7, 8, 9, 10, 11 | **Blocks:** Task 13

**Files:**
- Modify: `.nanoclaw/installed-skills.yaml`

**Step 1: Add lifecycle-hooks to the install order**

The lifecycle-hooks skill must come before any skill that depends on it. Insert it as the first skill:

```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry
  - reactions
  - refresh-oauth
  - group-lifecycle
  - google-home
  - shabbat-mode
  # ... rest unchanged
```

**Step 2: Remove stale dependencies from manifests**

- `add-shabbat-mode`: Remove `auth-recovery` from depends (was merged into refresh-oauth in PR #40)
- `add-google-home`: Add `lifecycle-hooks` to depends
- `add-group-lifecycle`: Verify depends list
- `add-reactions`: Verify depends list

**Step 3: Verify full build**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
npx tsc --noEmit
npx vitest run
```

Expected: All skills apply cleanly, zero type errors, all tests pass.

**Step 4: Commit**

```bash
git add -f .nanoclaw/installed-skills.yaml .claude/skills/*/manifest.yaml
git commit -m "fix(skills): update install order and dependencies for lifecycle-hooks (Phase 5C.5)"
```

---

## Phase D: Validation

### Task 13: Full validation

**Depends on:** Task 12 | **Cannot parallelize** — must run after everything

**Step 1: Clean build from scratch**

```bash
git checkout -- src/ container/
rm -rf .nanoclaw/base
npm run apply-skills
```

Expected: All skills apply without conflicts.

**Step 2: Type check**

```bash
npx tsc --noEmit
```

Expected: Zero errors.

**Step 3: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass (existing + new lifecycle/cursor-manager/message-events tests).

**Step 4: Manual diff review**

```bash
# Compare applied src/ against upstream
git diff src/
```

Review that:
- All lifecycle hook dispatch points are present in index.ts
- All message event emit calls are present
- CursorManager is properly integrated
- No `_accumulated` overlay markers remain in shabbat-mode or google-home manifests
- whatsapp-replies dead overlays are gone

**Step 5: Metrics verification**

Count overlay lines to verify reduction:

```bash
# Before (from design doc): ~5,914 lines
# After target: ~686 lines
find .claude/skills -name '*.ts' -path '*/modify/src/index.ts' -exec wc -l {} + 2>/dev/null
find .claude/skills -name '*.ts' -path '*/modify/src/ipc.ts' -exec wc -l {} + 2>/dev/null
```

**Step 6: Restore and commit**

```bash
git checkout -- src/ container/
git commit -m "chore: Phase 5 overlay reduction complete — validation passed"
```

---

## Notes for the implementing engineer

### Skill overlay system rules

- **Delta overlay** = upstream file + only this skill's unique additions. Created by copying upstream and adding lines.
- **`_accumulated` overlay** = full-file copy including all prior skills' changes. **Avoid** — causes exponential duplication.
- `modify_base: skillname` means the overlay is a delta against that skill's output, not upstream.
- Test overlays with: `git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills`
- Overlays merge via `git merge-file current base overlay` — context lines matter for match.

### Registration pattern

Skills register behavior at **import time** via side-effect imports:
```typescript
// In skill's add/src/lifecycle/my-skill.ts
import { onStartup } from '../lifecycle.js';
onStartup(() => doThing());

// In skill's modify/src/index.ts (delta overlay adds one import line)
import './lifecycle/my-skill.js';
```

### Dependency ordering

Skills that register hooks must be imported before the dispatch functions run. The `startMessageLoop()` runs after all channel connections, so any hook registered during import or `main()` will be available.

### Key constraint

The lifecycle-hooks skill must be the **first** in `installed-skills.yaml` because all other skills depend on it for the dispatch points in index.ts.
