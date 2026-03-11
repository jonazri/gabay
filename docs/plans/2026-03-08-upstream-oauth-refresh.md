# Upstream OAuth Refresh — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package lifecycle-hooks and refresh-oauth as upstream-quality skills for PR to qwibitai/nanoclaw.

**Architecture:** Two skills in one PR. lifecycle-hooks adds startup/shutdown/guard/event infrastructure to index.ts. refresh-oauth adds OAuth token lifecycle management (proactive refresh, fallback mode, auth error recovery). All overlays are minimal deltas. ipc-handler-registry is inlined into refresh-oauth.

**Tech Stack:** TypeScript, Node.js, vitest, git three-way merge (skills engine)

**Working directory:** Worktree at `/home/yaz/code/yonibot/gabay-upstream-oauth`

---

## Task 1: Create Worktree

**Files:** None (git operation)

**Step 1: Create worktree and branch**
```bash
cd /home/yaz/code/yonibot/gabay
git worktree add ../gabay-upstream-oauth feat/upstream-oauth-refresh
cd /home/yaz/code/yonibot/gabay-upstream-oauth
```

**Step 2: Verify clean upstream state**
```bash
git status  # clean
wc -l src/index.ts  # 589 lines (upstream)
```

**Step 3: Commit** — nothing to commit yet.

---

## Task 2: Create lifecycle-hooks Skill — add/ Files

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/add/src/lifecycle.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/message-events.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/cursor-manager.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/lifecycle.test.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/message-events.test.ts`
- Create: `.claude/skills/add-lifecycle-hooks/add/src/cursor-manager.test.ts`

**Step 1: Create directory structure**
```bash
mkdir -p .claude/skills/add-lifecycle-hooks/{add/src,modify/src,tests}
```

**Step 2: Copy existing add/ files from fork**

These files are production-ready and carry forward as-is:
```bash
ORIG=/home/yaz/code/yonibot/gabay/.claude/skills/add-lifecycle-hooks/add/src
cp "$ORIG"/lifecycle.ts .claude/skills/add-lifecycle-hooks/add/src/
cp "$ORIG"/message-events.ts .claude/skills/add-lifecycle-hooks/add/src/
cp "$ORIG"/cursor-manager.ts .claude/skills/add-lifecycle-hooks/add/src/
cp "$ORIG"/lifecycle.test.ts .claude/skills/add-lifecycle-hooks/add/src/
cp "$ORIG"/message-events.test.ts .claude/skills/add-lifecycle-hooks/add/src/
cp "$ORIG"/cursor-manager.test.ts .claude/skills/add-lifecycle-hooks/add/src/
```

**Step 3: Verify**
```bash
ls .claude/skills/add-lifecycle-hooks/add/src/
# 6 files: lifecycle.ts, message-events.ts, cursor-manager.ts, + 3 test files
```

**Step 4: Commit**
```bash
git add .claude/skills/add-lifecycle-hooks/add/
git commit -m "feat(skills): add lifecycle-hooks — add/ files"
```

---

## Task 3: Create lifecycle-hooks Overlay — src/index.ts

This is the most complex overlay. It modifies `src/index.ts` (589 lines) with ~50-70 lines of additions.

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/modify/src/index.ts`

**Step 1: Copy upstream as base**
```bash
cp src/index.ts .claude/skills/add-lifecycle-hooks/modify/src/index.ts
```

**Step 2: Add imports (after line 54, before the blank line)**

After `import { logger } from './logger.js';` (line 54), add:
```typescript
import {
  runChannelsReadyHooks,
  runShutdownHooks,
  runStartupHooks,
  shouldProcessMessages,
  runGuardLiftedHooks,
} from './lifecycle.js';
import { CursorManager } from './cursor-manager.js';
import {
  emitAgentStarting,
  emitAgentOutput,
  emitAgentSuccess,
  emitAgentError,
  emitMessagePiped,
} from './message-events.js';
```

**Step 3: Replace state variable (line 62)**

Replace:
```typescript
let lastAgentTimestamp: Record<string, string> = {};
```
With:
```typescript
const agentCursors = new CursorManager();
```

**Step 4: Update loadState() (lines 70-76)**

Replace:
```typescript
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
```
With:
```typescript
  try {
    agentCursors.loadAll(agentTs ? JSON.parse(agentTs) : {});
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    agentCursors.loadAll({});
  }
```

**Step 5: Update saveState() (line 87)**

Replace:
```typescript
  setRouterState('last_agent_timestamp', JSON.stringify(lastAgentTimestamp));
```
With:
```typescript
  setRouterState('last_agent_timestamp', JSON.stringify(agentCursors.getAll()));
```

**Step 6: Update processGroupMessages() cursor reads**

Replace all `lastAgentTimestamp[chatJid]` with `agentCursors.get(chatJid)` in processGroupMessages:
- Line 155: `const sinceTimestamp = lastAgentTimestamp[chatJid] || '';` → `const sinceTimestamp = agentCursors.get(chatJid);`
- Line 179: `const previousCursor = lastAgentTimestamp[chatJid] || '';` → `const previousCursor = agentCursors.get(chatJid);`

**Step 7: Update processGroupMessages() cursor advances**

Replace lines 180-182:
```typescript
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();
```
With:
```typescript
  agentCursors.advance(chatJid, missedMessages[missedMessages.length - 1].timestamp);
  saveState();
```

**Step 8: Add event emissions in processGroupMessages()**

Before `const output = await runAgent(...)` (line 207), add:
```typescript
  await emitAgentStarting(chatJid, group);
```

In the streaming callback (inside the `if (result.status === 'success')` and `if (result.status === 'error')` blocks around lines 225-231), add after each status check:
```typescript
    if (result.status === 'success') {
      await emitAgentSuccess(chatJid);
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      await emitAgentError(chatJid, result.error || null);
      hadError = true;
    }
```

After the streaming output text send (around line 222), add:
```typescript
      await emitAgentOutput(chatJid, result);
```

**Step 9: Update cursor rollback (line 248)**

Replace:
```typescript
    lastAgentTimestamp[chatJid] = previousCursor;
```
With:
```typescript
    agentCursors.advance(chatJid, previousCursor);
```

**Step 10: Add guard mechanism in startMessageLoop()**

After `messageLoopRunning = true;` (line 346), add:
```typescript
  let wasGuarded = !shouldProcessMessages();
```

At the top of the `while (true)` loop body, before any message processing, add:
```typescript
    if (!shouldProcessMessages()) {
      wasGuarded = true;
      await sleep(pollInterval);
      continue;
    }
    if (wasGuarded) {
      await runGuardLiftedHooks();
      wasGuarded = false;
    }
```

**Step 11: Add emitMessagePiped in startMessageLoop()**

Find the section where messages are piped to an active container (where `queue.pipeMessages` is called). After piping, add:
```typescript
      await emitMessagePiped(chatJid, messagesToSend.length);
```

**Step 12: Update startMessageLoop() cursor operations**

Replace any remaining `lastAgentTimestamp[chatJid]` references in startMessageLoop and recoverPendingMessages with `agentCursors.get(chatJid)` / `agentCursors.advance(chatJid, ...)`.

**Step 13: Add lifecycle hooks in main()**

After `loadState();` (line 469), add:
```typescript
  await runStartupHooks();
```

Update the shutdown handler (lines 472-477) to:
```typescript
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    await runShutdownHooks();
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
```

After all channels are connected and before `startSchedulerLoop` (after `if (channels.length === 0)` block, around line 532), add:
```typescript
  await runChannelsReadyHooks(channels);
```

**Step 14: Remove unused import**

If `getRegisteredGroup` from `./db.js` is no longer used anywhere (check with grep), remove it from the import.

**Step 15: Verify minimal delta**
```bash
wc -l src/index.ts .claude/skills/add-lifecycle-hooks/modify/src/index.ts
# Upstream: 589, Overlay: ~640-660 (growth: ~50-70 lines, ~10%)
```

**Step 16: Commit**
```bash
git add .claude/skills/add-lifecycle-hooks/modify/
git commit -m "feat(skills): add lifecycle-hooks overlay for src/index.ts"
```

---

## Task 4: Create lifecycle-hooks Documentation

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/modify/src/index.ts.intent.md`
- Create: `.claude/skills/add-lifecycle-hooks/SKILL.md`
- Create: `.claude/skills/add-lifecycle-hooks/manifest.yaml`

**Step 1: Write intent.md**

```markdown
# Intent: src/index.ts

## What this skill changes

Adds lifecycle hook infrastructure to the main orchestrator:

1. **Imports**: lifecycle hooks, CursorManager, message event emitters
2. **State**: Replaces `lastAgentTimestamp` Record with `CursorManager` instance
3. **loadState/saveState**: Uses `agentCursors.loadAll()` / `.getAll()` for serialization
4. **processGroupMessages**: Emits agent lifecycle events (starting, output, success, error). Uses CursorManager for cursor operations.
5. **startMessageLoop**: Adds processing guard check (`shouldProcessMessages()`). Emits `messagePiped` event. Uses CursorManager for cursors.
6. **main()**: Calls `runStartupHooks()` after DB init, `runShutdownHooks()` on shutdown, `runChannelsReadyHooks()` after channels connect.

## Invariants

- CursorManager must be the sole owner of cursor state (no direct `lastAgentTimestamp` access)
- Startup hooks run AFTER database init, BEFORE channels connect
- Shutdown hooks run AFTER queue shutdown, BEFORE channel disconnect
- Guard check runs at top of message loop iteration — continue (don't process) when guarded
- Event emissions are fire-and-forget (errors logged, don't break processing)
```

**Step 2: Write SKILL.md**

```markdown
---
name: add-lifecycle-hooks
description: Startup/shutdown hooks, message event emitters, and processing guards for the main orchestrator
---

# Add Lifecycle Hooks

Adds a hook-based extension system to the NanoClaw orchestrator. Skills can register callbacks for startup, shutdown, channel readiness, and message processing events without modifying core code.

Also provides:
- **Processing guards** — skills can block message processing (e.g., Shabbat mode)
- **Message event emitters** — track agent lifecycle (starting, output, success, error)
- **CursorManager** — checkpoint-based cursor tracking with rollback support

## Phase 1: Pre-flight

Check that no other skill has already added lifecycle hooks:
```bash
test -f src/lifecycle.ts && echo "Already applied" || echo "Ready to apply"
```

## Phase 2: Apply

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-lifecycle-hooks
npm run build
```

## Phase 3: Verify

```bash
npx vitest run src/lifecycle.test.ts src/message-events.test.ts src/cursor-manager.test.ts
```

Verify hooks fire on startup:
```bash
npm run dev  # Check logs for "State loaded" after startup hooks
```
```

**Step 3: Write manifest.yaml**

```yaml
skill: lifecycle-hooks
version: 1.0.0
description: "Startup/shutdown hooks, message event emitters, and processing guards"
core_version: 0.1.0

adds:
  - src/lifecycle.ts
  - src/lifecycle.test.ts
  - src/message-events.ts
  - src/message-events.test.ts
  - src/cursor-manager.ts
  - src/cursor-manager.test.ts

modifies:
  - src/index.ts

conflicts: []
incompatible_with: []
depends: []
tested_with: []
test: "npx vitest run src/lifecycle.test.ts src/message-events.test.ts src/cursor-manager.test.ts"
```

**Step 4: Commit**
```bash
git add .claude/skills/add-lifecycle-hooks/
git commit -m "feat(skills): add lifecycle-hooks docs and manifest"
```

---

## Task 5: Create lifecycle-hooks Validation Tests

**Files:**
- Create: `.claude/skills/add-lifecycle-hooks/tests/skill.test.ts`

**Step 1: Write validation tests**

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const skillDir = path.resolve(__dirname, '..');

describe('lifecycle-hooks skill structure', () => {
  it('has a valid manifest', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    expect(manifest.skill).toBe('lifecycle-hooks');
    expect(manifest.version).toBeDefined();
    expect(manifest.adds).toBeInstanceOf(Array);
    expect(manifest.modifies).toBeInstanceOf(Array);
  });

  it('has all files declared in adds', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    for (const file of manifest.adds) {
      expect(
        fs.existsSync(path.join(skillDir, 'add', file)),
        `Missing add file: ${file}`,
      ).toBe(true);
    }
  });

  it('has intent files for all modified files', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    for (const file of manifest.modifies) {
      const intentPath = path.join(skillDir, 'modify', `${file}.intent.md`);
      expect(
        fs.existsSync(intentPath),
        `Missing intent: ${file}.intent.md`,
      ).toBe(true);
    }
  });

  it('overlay preserves upstream structure', () => {
    const overlay = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );
    // Key upstream structures that must survive
    expect(overlay).toContain('async function processGroupMessages(');
    expect(overlay).toContain('async function runAgent(');
    expect(overlay).toContain('async function startMessageLoop(');
    expect(overlay).toContain('async function main(');
    expect(overlay).toContain('export { escapeXml, formatMessages }');
  });

  it('overlay adds lifecycle imports', () => {
    const overlay = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );
    expect(overlay).toContain("from './lifecycle.js'");
    expect(overlay).toContain("from './cursor-manager.js'");
    expect(overlay).toContain("from './message-events.js'");
  });

  it('overlay uses CursorManager instead of lastAgentTimestamp', () => {
    const overlay = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );
    expect(overlay).toContain('new CursorManager()');
    expect(overlay).not.toContain('let lastAgentTimestamp');
  });
});
```

**Step 2: Run tests**
```bash
npx vitest run .claude/skills/add-lifecycle-hooks/tests/skill.test.ts
```
Expected: PASS

**Step 3: Commit**
```bash
git add .claude/skills/add-lifecycle-hooks/tests/
git commit -m "test(skills): add lifecycle-hooks validation tests"
```

---

## Task 6: Create refresh-oauth Skill — add/ Files

**Files:**
- Create: `.claude/skills/add-refresh-oauth/add/src/oauth.ts`
- Create: `.claude/skills/add-refresh-oauth/add/src/oauth.test.ts`
- Create: `.claude/skills/add-refresh-oauth/add/src/ipc-handlers/refresh-oauth.ts`
- Create: `.claude/skills/add-refresh-oauth/add/src/ipc-handlers.ts` (inlined from ipc-handler-registry)
- Create: `.claude/skills/add-refresh-oauth/add/scripts/oauth/refresh.sh`
- Create: `.claude/skills/add-refresh-oauth/add/scripts/oauth/README.md`
- Create: `.claude/skills/add-refresh-oauth/add/container/skills/refresh-oauth/SKILL.md`

**Step 1: Create directory structure**
```bash
mkdir -p .claude/skills/add-refresh-oauth/{add/src/ipc-handlers,add/scripts/oauth,add/container/skills/refresh-oauth,modify/src,modify/container/agent-runner/src,tests}
```

Wait — we confirmed container/agent-runner/src/index.ts needs no changes (upstream already has auth error detection). Remove that directory:
```bash
mkdir -p .claude/skills/add-refresh-oauth/{add/src/ipc-handlers,add/scripts/oauth,add/container/skills/refresh-oauth,modify/src,tests}
```

**Step 2: Copy existing add/ files**
```bash
ORIG=/home/yaz/code/yonibot/gabay/.claude/skills/add-refresh-oauth/add
cp "$ORIG"/src/oauth.ts .claude/skills/add-refresh-oauth/add/src/
cp "$ORIG"/src/oauth.test.ts .claude/skills/add-refresh-oauth/add/src/
cp "$ORIG"/src/ipc-handlers/refresh-oauth.ts .claude/skills/add-refresh-oauth/add/src/ipc-handlers/
cp "$ORIG"/scripts/oauth/refresh.sh .claude/skills/add-refresh-oauth/add/scripts/oauth/
cp "$ORIG"/scripts/oauth/README.md .claude/skills/add-refresh-oauth/add/scripts/oauth/
cp "$ORIG"/container/skills/refresh-oauth/SKILL.md .claude/skills/add-refresh-oauth/add/container/skills/refresh-oauth/
```

**Step 3: Create inlined ipc-handlers.ts**

Copy from the existing ipc-handler-registry skill:
```bash
REGISTRY=/home/yaz/code/yonibot/gabay/.claude/skills/ipc-handler-registry/add/src
cp "$REGISTRY"/ipc-handlers.ts .claude/skills/add-refresh-oauth/add/src/
```

If the file doesn't exist at that path, create it manually. It should contain only (~26 lines):

```typescript
import { logger } from './logger.js';

export type IpcHandler = (
  data: Record<string, any>,
  deps: IpcDeps,
  context: IpcContext,
) => void | Promise<void>;

export interface IpcContext {
  sourceGroup: string;
  isMain: boolean;
}

// Re-use the existing IpcDeps type from ipc.ts — import it where needed
export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  [key: string]: any;
}

const handlers = new Map<string, IpcHandler>();

export function registerIpcHandler(type: string, handler: IpcHandler): void {
  handlers.set(type, handler);
  logger.debug({ type }, 'IPC handler registered');
}

export function getIpcHandler(type: string): IpcHandler | undefined {
  return handlers.get(type);
}
```

**Note:** Verify the IpcDeps interface matches what's used in `src/ipc.ts`. The import in `refresh-oauth.ts` uses `import { registerIpcHandler } from '../ipc-handlers.js';` which resolves to `src/ipc-handlers.ts`. Confirm this path is correct.

**Step 4: Also copy ipc-handlers.test.ts if it exists**
```bash
# Check if test exists
ls /home/yaz/code/yonibot/gabay/.claude/skills/ipc-handler-registry/add/src/ipc-handlers.test.ts 2>/dev/null
# If it does, copy it
```

**Step 5: Verify**
```bash
find .claude/skills/add-refresh-oauth/add/ -type f | sort
```

**Step 6: Commit**
```bash
git add .claude/skills/add-refresh-oauth/add/
git commit -m "feat(skills): add refresh-oauth — add/ files"
```

---

## Task 7: Create refresh-oauth Overlay — src/index.ts

This overlay is based on the lifecycle-hooks version of index.ts (`modify_base: src/index.ts: lifecycle-hooks`).

**Files:**
- Create: `.claude/skills/add-refresh-oauth/modify/src/index.ts`

**Step 1: Copy lifecycle-hooks overlay as starting point**

The base for this overlay is lifecycle-hooks' version (not upstream):
```bash
cp .claude/skills/add-lifecycle-hooks/modify/src/index.ts .claude/skills/add-refresh-oauth/modify/src/index.ts
```

**Step 2: Add oauth imports**

After the lifecycle-hooks imports (the `message-events.js` import block), add:
```typescript
import './ipc-handlers/refresh-oauth.js';
import {
  attemptAuthRecovery,
  ensureTokenFresh,
  initOAuthState,
  readOAuthState,
  startPrimaryProbe,
  startTokenRefreshScheduler,
  stopPrimaryProbe,
  stopTokenRefreshScheduler,
} from './oauth.js';
```

**Step 3: Add pre-flight in runAgent()**

Before the `try {` block that calls `runContainerAgent()` (around upstream line 305), add:
```typescript
  await ensureTokenFresh();
```

**Step 4: Add auth recovery in runAgent()**

In the `if (output.status === 'error')` block (around upstream line 326-331), wrap the error handling:

Replace the simple error return:
```typescript
    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }
```

With auth recovery + retry:
```typescript
    if (output.status === 'error') {
      if (
        output.error &&
        (await attemptAuthRecovery(output.error, (msg) =>
          notifyMainGroup(msg),
        ))
      ) {
        logger.info({ group: group.name }, 'Auth recovered, retrying agent');
        const retry = await runContainerAgent(
          group,
          {
            prompt,
            sessionId: sessions[group.folder],
            groupFolder: group.folder,
            chatJid,
            isMain,
            assistantName: ASSISTANT_NAME,
          },
          (proc, containerName) =>
            queue.registerProcess(chatJid, proc, containerName, group.folder),
          wrappedOnOutput,
        );
        if (retry.newSessionId) {
          sessions[group.folder] = retry.newSessionId;
          setSession(group.folder, retry.newSessionId);
        }
        if (retry.status === 'success') return 'success';
      }
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }
```

**Important:** `notifyMainGroup` is a helper that sends to the main group's chat. Check if it already exists in the lifecycle-hooks overlay. If not, add a simple helper:
```typescript
function notifyMainGroup(msg: string): void {
  const mainJid = Object.entries(registeredGroups).find(([, g]) => g.isMain)?.[0];
  if (mainJid) {
    const channel = findChannel(channels, mainJid);
    channel?.sendMessage(mainJid, msg);
  }
}
```

**Step 5: Add shutdown cleanup**

In the shutdown handler, BEFORE `await queue.shutdown(10000);`, add:
```typescript
    stopTokenRefreshScheduler();
    stopPrimaryProbe();
```

**Step 6: Add startup initialization**

In `main()`, after `await runStartupHooks();` (added by lifecycle-hooks), add:
```typescript
  initOAuthState();
  await ensureTokenFresh();

  if (readOAuthState().usingFallback) {
    const oauthAlert = (msg: string) => notifyMainGroup(`[system] ${msg}`);
    startTokenRefreshScheduler(oauthAlert);
    startPrimaryProbe(oauthAlert);
  }
```

**Step 7: Verify minimal delta vs lifecycle-hooks base**
```bash
wc -l .claude/skills/add-lifecycle-hooks/modify/src/index.ts .claude/skills/add-refresh-oauth/modify/src/index.ts
# lifecycle-hooks: ~640-660, refresh-oauth: ~700-720 (growth: ~40-60 lines)
```

**Step 8: Commit**
```bash
git add .claude/skills/add-refresh-oauth/modify/src/index.ts
git commit -m "feat(skills): add refresh-oauth overlay for src/index.ts"
```

---

## Task 8: Create refresh-oauth Overlay — src/task-scheduler.ts

**Files:**
- Create: `.claude/skills/add-refresh-oauth/modify/src/task-scheduler.ts`

**Step 1: Copy upstream as base**
```bash
cp src/task-scheduler.ts .claude/skills/add-refresh-oauth/modify/src/task-scheduler.ts
```

**Step 2: Add import (after line 22)**

After `import { RegisteredGroup, ScheduledTask } from './types.js';`, add:
```typescript
import { attemptAuthRecovery, ensureTokenFresh } from './oauth.js';
```

**Step 3: Add pre-flight in runTask()**

Before the `try {` that calls `runContainerAgent()` (line 171), add:
```typescript
  await ensureTokenFresh();
```

**Step 4: Add auth recovery in runTask()**

After the `try/catch` block's error handling (around line 203-218), add auth recovery.

Replace the section after `if (output.status === 'error')` (lines 203-208):
```typescript
    if (output.status === 'error') {
      error = output.error || 'Unknown error';
    } else if (output.result) {
      result = output.result;
    }
```

With:
```typescript
    if (output.status === 'error') {
      const outputError = output.error || 'Unknown error';
      const notifyMain = (msg: string) => deps.sendMessage(task.chat_jid, msg);
      if (await attemptAuthRecovery(outputError, notifyMain)) {
        logger.info({ taskId: task.id }, 'Auth recovered, retrying task');
        const retry = await runContainerAgent(
          group,
          {
            prompt: task.prompt,
            sessionId,
            groupFolder: task.group_folder,
            chatJid: task.chat_jid,
            isMain,
            isScheduledTask: true,
            assistantName: ASSISTANT_NAME,
          },
          (proc, containerName) =>
            deps.onProcess(task.chat_jid, proc, containerName, task.group_folder),
        );
        if (retry.status === 'success' && retry.result) {
          result = retry.result;
          error = null;
        } else {
          error = retry.error || outputError;
        }
      } else {
        error = outputError;
      }
    } else if (output.result) {
      result = output.result;
    }
```

**Step 5: Verify minimal delta**
```bash
wc -l src/task-scheduler.ts .claude/skills/add-refresh-oauth/modify/src/task-scheduler.ts
# Upstream: 282, Overlay: ~310-320 (growth: ~30-40 lines)
```

**Step 6: Commit**
```bash
git add .claude/skills/add-refresh-oauth/modify/src/task-scheduler.ts
git commit -m "feat(skills): add refresh-oauth overlay for task-scheduler.ts"
```

---

## Task 9: Create refresh-oauth Overlay — src/container-runner.ts

**Files:**
- Create: `.claude/skills/add-refresh-oauth/modify/src/container-runner.ts`

**Step 1: Copy upstream as base**
```bash
cp src/container-runner.ts .claude/skills/add-refresh-oauth/modify/src/container-runner.ts
```

**Step 2: Add import (after line 27)**

After `import { RegisteredGroup } from './types.js';`, add:
```typescript
import { AUTH_ERROR_PATTERN, readOAuthState } from './oauth.js';
```

**Step 3: Modify readSecrets() (lines 217-224)**

Replace the existing `readSecrets()` with token-precedence logic:
```typescript
function readSecrets(): Record<string, string> {
  const SECRET_KEYS = [
    'CLAUDE_CODE_OAUTH_TOKEN',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'ANTHROPIC_AUTH_TOKEN',
  ];
  const envSecrets = readEnvFile(SECRET_KEYS);

  // In fallback mode, .env has the freshly-refreshed short-lived token — it wins.
  // In primary mode, process.env has the long-lived token — it wins.
  if (readOAuthState().usingFallback) {
    return envSecrets;
  }
  const merged: Record<string, string> = { ...envSecrets };
  for (const key of SECRET_KEYS) {
    if (process.env[key]) merged[key] = process.env[key]!;
  }
  return merged;
}
```

**Step 4: Add streaming auth error detection**

In the `container.stdout.on('data')` handler, inside the `while` loop that parses output markers (around line 355-365), after `const parsed: ContainerOutput = JSON.parse(jsonStr);`, add auth error detection:

```typescript
            // Abort early on auth errors to trigger host-side refresh
            if (parsed.error && AUTH_ERROR_PATTERN.test(parsed.error)) {
              logger.warn(
                { group: group.name },
                'Auth error detected in stream, stopping container',
              );
              exec(stopContainer(containerName), { timeout: 15000 });
            }
```

**Step 5: Verify minimal delta**
```bash
wc -l src/container-runner.ts .claude/skills/add-refresh-oauth/modify/src/container-runner.ts
# Upstream: 703, Overlay: ~730-740 (growth: ~25-35 lines)
```

**Step 6: Commit**
```bash
git add .claude/skills/add-refresh-oauth/modify/src/container-runner.ts
git commit -m "feat(skills): add refresh-oauth overlay for container-runner.ts"
```

---

## Task 10: Create refresh-oauth Overlay — src/ipc.ts

**Files:**
- Create: `.claude/skills/add-refresh-oauth/modify/src/ipc.ts`

**Step 1: Copy upstream as base**
```bash
cp src/ipc.ts .claude/skills/add-refresh-oauth/modify/src/ipc.ts
```

**Step 2: Add import (near the top imports)**

After existing imports, add:
```typescript
import { getIpcHandler } from './ipc-handlers.js';
```

**Step 3: Modify the default case (lines 452-454)**

Replace:
```typescript
    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
```

With:
```typescript
    default: {
      const handler = getIpcHandler(data.type);
      if (handler) {
        try {
          await handler(data, deps, { sourceGroup, isMain });
        } catch (err) {
          logger.error({ type: data.type, err }, 'IPC handler error');
        }
      } else {
        logger.warn({ type: data.type }, 'Unknown IPC task type');
      }
      break;
    }
```

**Step 4: Verify minimal delta**
```bash
wc -l src/ipc.ts .claude/skills/add-refresh-oauth/modify/src/ipc.ts
# Upstream: 456, Overlay: ~468 (growth: ~12 lines)
```

**Step 5: Commit**
```bash
git add .claude/skills/add-refresh-oauth/modify/src/ipc.ts
git commit -m "feat(skills): add refresh-oauth overlay for ipc.ts"
```

---

## Task 11: Create refresh-oauth Intent Files

**Files:**
- Create: `.claude/skills/add-refresh-oauth/modify/src/index.ts.intent.md`
- Create: `.claude/skills/add-refresh-oauth/modify/src/task-scheduler.ts.intent.md`
- Create: `.claude/skills/add-refresh-oauth/modify/src/container-runner.ts.intent.md`
- Create: `.claude/skills/add-refresh-oauth/modify/src/ipc.ts.intent.md`

**Step 1: Write index.ts intent**

```markdown
# Intent: src/index.ts

## What this skill changes (base: lifecycle-hooks)

1. **Imports**: Self-registering IPC handler + oauth functions (init, recovery, refresh, probe)
2. **runAgent()**: Pre-flight `ensureTokenFresh()` before container spawn. Auth recovery wrapper on error with retry.
3. **Shutdown**: Stops token refresh scheduler and primary probe BEFORE queue shutdown.
4. **Startup**: Initializes OAuth state, ensures token fresh. Conditionally starts refresh scheduler and primary probe if in fallback mode.
5. **notifyMainGroup()**: Helper to send system alerts to the main group chat.

## Invariants

- `ensureTokenFresh()` MUST be called before every `runContainerAgent()` invocation
- Shutdown: stop schedulers/probe BEFORE `queue.shutdown()` to prevent timers firing during shutdown
- Startup: OAuth init happens AFTER `runStartupHooks()`, BEFORE message loop
- Auth recovery retries use the same session ID (preserve conversation context)
```

**Step 2: Write task-scheduler.ts intent**

```markdown
# Intent: src/task-scheduler.ts

## What this skill changes

1. **Import**: `attemptAuthRecovery`, `ensureTokenFresh` from oauth module
2. **runTask()**: Pre-flight `ensureTokenFresh()` before container spawn
3. **Error handling**: Auth recovery wrapper — detects auth errors, refreshes token, retries task once

## Invariants

- Pre-flight check runs before EVERY `runContainerAgent()` call
- Auth recovery only retries once (no infinite loops)
- Task result/error tracking correctly reflects retry outcome
```

**Step 3: Write container-runner.ts intent**

```markdown
# Intent: src/container-runner.ts

## What this skill changes

1. **Import**: `AUTH_ERROR_PATTERN`, `readOAuthState` from oauth module
2. **readSecrets()**: Token precedence — fallback mode uses .env (freshly refreshed), primary mode uses process.env (long-lived token)
3. **Streaming output**: Detects auth errors in stream and aborts container early to trigger host-side refresh

## Invariants

- Secrets never written to disk (stdin only, deleted from input after write)
- Token precedence: fallback → .env wins; primary → process.env wins
- Early abort only triggers on AUTH_ERROR_PATTERN match
```

**Step 4: Write ipc.ts intent**

```markdown
# Intent: src/ipc.ts

## What this skill changes

1. **Import**: `getIpcHandler` from the handler registry module
2. **Default case**: Before logging "unknown type", checks for a registered handler. Runs it if found, falls back to warning if not.

## Invariants

- All existing IPC task types (schedule_task, pause_task, etc.) are unaffected
- Handler errors are caught and logged (don't crash the IPC watcher)
- Unknown types with no registered handler still produce a warning
```

**Step 5: Commit**
```bash
git add .claude/skills/add-refresh-oauth/modify/*.intent.md .claude/skills/add-refresh-oauth/modify/**/*.intent.md
git commit -m "docs(skills): add refresh-oauth intent files"
```

---

## Task 12: Create refresh-oauth SKILL.md and Manifest

**Files:**
- Create: `.claude/skills/add-refresh-oauth/SKILL.md`
- Create: `.claude/skills/add-refresh-oauth/manifest.yaml`

**Step 1: Write SKILL.md**

```markdown
---
name: add-refresh-oauth
description: OAuth token management with proactive refresh, fallback mode, and auth error recovery
---

# Add OAuth Token Refresh

Manages OAuth token lifecycle so agents never fail due to expired tokens. Operates in two modes:

- **Primary mode**: Long-lived token from `.env`. No refresh needed.
- **Fallback mode**: Short-lived token from Claude CLI credentials. Auto-refreshes 30 minutes before expiry. Probes primary token hourly to restore when available.

The skill integrates at three points: pre-flight (before container spawn), error recovery (after 401), and IPC (agent-requested refresh).

## Phase 1: Pre-flight

Requires lifecycle-hooks skill to be applied first:
```bash
# Check lifecycle-hooks
test -f src/lifecycle.ts && echo "Ready" || echo "Apply lifecycle-hooks first"
```

Requires Claude CLI to be authenticated:
```bash
claude --version  # Must be installed
test -f ~/.claude/.credentials.json && echo "Credentials found" || echo "Run: claude login"
```

## Phase 2: Apply

```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-refresh-oauth
npm run build
./container/build.sh  # Rebuild container for agent-side skill docs
```

## Phase 3: Verify

Test token refresh manually:
```bash
bash scripts/oauth/refresh.sh
tail -5 logs/oauth-refresh.log
```

Run unit tests:
```bash
npx vitest run src/oauth.test.ts
```

## Troubleshooting

- **"claude: command not found"**: Ensure Claude CLI is in PATH. The refresh script searches common locations.
- **Token never refreshes**: Check `~/.claude/.credentials.json` exists and has `refreshToken`.
- **Stuck in fallback mode**: Delete `.oauth-state.json` and restart to reset state.
```

**Step 2: Write manifest.yaml**

```yaml
skill: refresh-oauth
version: 1.1.0
description: "OAuth token management: proactive refresh, fallback mode, and auth error recovery"
core_version: 0.1.0

adds:
  - src/oauth.ts
  - src/oauth.test.ts
  - src/ipc-handlers.ts
  - src/ipc-handlers/refresh-oauth.ts
  - scripts/oauth/refresh.sh
  - scripts/oauth/README.md
  - container/skills/refresh-oauth/SKILL.md

modifies:
  - src/index.ts
  - src/task-scheduler.ts
  - src/container-runner.ts
  - src/ipc.ts

modify_base:
  src/index.ts: lifecycle-hooks

conflicts: []
incompatible_with: []

depends:
  - lifecycle-hooks

tested_with: []
test: "npx vitest run src/oauth.test.ts"
```

**Step 3: Commit**
```bash
git add .claude/skills/add-refresh-oauth/SKILL.md .claude/skills/add-refresh-oauth/manifest.yaml
git commit -m "feat(skills): add refresh-oauth docs and manifest"
```

---

## Task 13: Create refresh-oauth Validation Tests

**Files:**
- Create: `.claude/skills/add-refresh-oauth/tests/skill.test.ts`

**Step 1: Write validation tests**

```typescript
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'js-yaml';

const skillDir = path.resolve(__dirname, '..');

describe('refresh-oauth skill structure', () => {
  it('has a valid manifest', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    expect(manifest.skill).toBe('refresh-oauth');
    expect(manifest.version).toBeDefined();
    expect(manifest.depends).toContain('lifecycle-hooks');
  });

  it('has all files declared in adds', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    for (const file of manifest.adds) {
      expect(
        fs.existsSync(path.join(skillDir, 'add', file)),
        `Missing: ${file}`,
      ).toBe(true);
    }
  });

  it('has intent files for all modified files', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    for (const file of manifest.modifies) {
      const intentPath = path.join(skillDir, 'modify', `${file}.intent.md`);
      expect(
        fs.existsSync(intentPath),
        `Missing intent: ${file}.intent.md`,
      ).toBe(true);
    }
  });

  it('declares lifecycle-hooks as dependency', () => {
    const manifest = yaml.load(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    ) as Record<string, any>;
    expect(manifest.depends).toContain('lifecycle-hooks');
    expect(manifest.modify_base?.['src/index.ts']).toBe('lifecycle-hooks');
  });

  it('does not modify container/agent-runner (upstream already has auth detection)', () => {
    expect(
      fs.existsSync(
        path.join(skillDir, 'modify', 'container', 'agent-runner'),
      ),
    ).toBe(false);
  });

  it('overlays are minimal deltas', () => {
    const modifies = ['src/index.ts', 'src/task-scheduler.ts', 'src/container-runner.ts', 'src/ipc.ts'];
    for (const file of modifies) {
      const overlayPath = path.join(skillDir, 'modify', file);
      if (!fs.existsSync(overlayPath)) continue;
      const overlay = fs.readFileSync(overlayPath, 'utf-8');
      const upstream = fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
      const growth = overlay.split('\n').length - upstream.split('\n').length;
      // Each overlay should add < 60 lines (minimal delta)
      expect(growth, `${file} overlay too large: +${growth} lines`).toBeLessThan(60);
    }
  });

  it('overlay preserves runAgent signature', () => {
    const overlay = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );
    expect(overlay).toContain('async function runAgent(');
    expect(overlay).toContain('async function main(');
  });

  it('overlay adds oauth imports', () => {
    const overlay = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'index.ts'),
      'utf-8',
    );
    expect(overlay).toContain("from './oauth.js'");
    expect(overlay).toContain('ensureTokenFresh');
    expect(overlay).toContain('attemptAuthRecovery');
  });

  it('ipc overlay adds handler registry lookup', () => {
    const overlay = fs.readFileSync(
      path.join(skillDir, 'modify', 'src', 'ipc.ts'),
      'utf-8',
    );
    expect(overlay).toContain("from './ipc-handlers.js'");
    expect(overlay).toContain('getIpcHandler(data.type)');
  });
});
```

**Step 2: Run tests**
```bash
npx vitest run .claude/skills/add-refresh-oauth/tests/skill.test.ts
```
Expected: PASS

**Step 3: Commit**
```bash
git add .claude/skills/add-refresh-oauth/tests/
git commit -m "test(skills): add refresh-oauth validation tests"
```

---

## Task 14: Integration Test — Apply Both Skills

**Step 1: Verify src/ is clean upstream**
```bash
git diff src/  # Should be empty
```

**Step 2: Apply lifecycle-hooks**
```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-lifecycle-hooks
```

**Step 3: Verify lifecycle-hooks applied**
```bash
grep "CursorManager" src/index.ts && echo "lifecycle-hooks applied"
```

**Step 4: Apply refresh-oauth**
```bash
npx tsx scripts/apply-skill.ts .claude/skills/add-refresh-oauth
```

**Step 5: Verify refresh-oauth applied**
```bash
grep "ensureTokenFresh" src/index.ts && echo "oauth applied to index.ts"
grep "ensureTokenFresh" src/task-scheduler.ts && echo "oauth applied to task-scheduler.ts"
grep "readOAuthState" src/container-runner.ts && echo "oauth applied to container-runner.ts"
grep "getIpcHandler" src/ipc.ts && echo "oauth applied to ipc.ts"
```

**Step 6: Build**
```bash
npm run build
```
Expected: Clean compilation, no errors.

**Step 7: Run all tests**
```bash
npx vitest run
```
Expected: All tests pass.

**Step 8: Type check**
```bash
npx tsc --noEmit
```
Expected: No type errors.

**Step 9: Restore src/ to upstream**
```bash
git checkout -- src/ container/
```

---

## Task 15: Final Cleanup and Verification

**Step 1: Run all validation tests**
```bash
npx vitest run .claude/skills/add-lifecycle-hooks/tests/skill.test.ts .claude/skills/add-refresh-oauth/tests/skill.test.ts
```

**Step 2: Verify no upstream src/ changes in git**
```bash
git diff src/  # Should be empty
git diff container/  # Should be empty
```

**Step 3: Review commit log**
```bash
git log --oneline feat/upstream-oauth-refresh ^main
```

**Step 4: Verify file structure**
```bash
find .claude/skills/add-lifecycle-hooks/ -type f | sort
find .claude/skills/add-refresh-oauth/ -type f | sort
```

Expected structure:
```
.claude/skills/add-lifecycle-hooks/
├── SKILL.md
├── manifest.yaml
├── add/src/{lifecycle,message-events,cursor-manager}.ts + 3 test files
├── modify/src/index.ts + index.ts.intent.md
└── tests/skill.test.ts

.claude/skills/add-refresh-oauth/
├── SKILL.md
├── manifest.yaml
├── add/src/{oauth,oauth.test,ipc-handlers,ipc-handlers/refresh-oauth}.ts
├── add/scripts/oauth/{refresh.sh,README.md}
├── add/container/skills/refresh-oauth/SKILL.md
├── modify/src/{index,task-scheduler,container-runner,ipc}.ts + 4 intent files
└── tests/skill.test.ts
```

**Step 5: Squash or tidy commits if needed, then the branch is ready for PR**
