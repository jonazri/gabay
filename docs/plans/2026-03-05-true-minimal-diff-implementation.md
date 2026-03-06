# True Minimal-Diff Overlays — Implementation Plan

> **For Claude:** Use superpowers:subagent-driven-development. Tasks 1-5 are fully independent — dispatch them in parallel. Task 6 runs after all complete.

**Goal:** Convert 5 full-file index.ts overlays (4,486 total lines) into true minimal-diff overlays (~943 lines) using a star topology where all downstream skills share `modify_base: lifecycle-hooks`.

**Architecture:** lifecycle-hooks remains the sole full-file overlay (628 lines). Each downstream overlay contains only the lifecycle-hooks base file + that skill's unique additions. The merge engine computes `diff(lifecycle-hooks-overlay, downstream-overlay)` and applies just the unique additions to the accumulated state. A placement convention ensures insertions anchor to unique context lines so `git merge-file` never conflicts.

**Tech Stack:** TypeScript, NanoClaw skill overlay system (`git merge-file` three-way merge), Vitest.

---

## How the merge engine works (READ THIS FIRST)

The skill engine applies overlays using `git merge-file current base overlay`:

- **current**: the file as it stands after all prior skills have been applied
- **base**: the "common ancestor" — determines what counts as a change
- **overlay**: the skill's version of the file

The engine computes `diff(base, overlay)` (= what THIS skill changed relative to its base) and applies that diff to `current`. If the diff inserts at a location that hasn't been touched in `current`, the merge is clean.

### What `modify_base: lifecycle-hooks` means

When a manifest says `modify_base: { src/index.ts: lifecycle-hooks }`, the engine uses the lifecycle-hooks skill's overlay file (`.claude/skills/add-lifecycle-hooks/modify/src/index.ts`) as the base instead of the upstream snapshot.

So: `diff(lifecycle-hooks-overlay, this-skill's-overlay)` = only THIS skill's unique additions. That diff gets applied to whatever `current` is (the accumulated state from all previously applied skills).

### What makes overlays "minimal"

A **minimal-diff overlay** = lifecycle-hooks overlay + ONLY this skill's unique additions. The diff between the lifecycle-hooks overlay and this skill's overlay should show ONLY lines this skill uniquely needs. No inherited state from other skills.

### Why insertions must anchor to unique lines

`git merge-file` conflicts when two diffs insert at the **exact same context line**. If skill A inserts after line 52 and skill B also inserts after line 52, conflict. If they insert after lines 52 and 53 respectively — clean merge. Minimum safe distance: **1 line apart**.

### CRITICAL: Do NOT produce full-file overlays

The current overlays are 628-859 lines each because they're full copies of the accumulated state. A true minimal overlay for google-home (which adds ~8 unique lines) should be 628 + 8 = ~636 lines, NOT 776 lines. If your overlay is within 30 lines of the lifecycle-hooks base (628), you're doing it right. If it's 700+ lines, you've accidentally included another skill's additions.

---

## Task Dependency Graph

```
Task 1 (reactions)        ──┐
Task 2 (refresh-oauth)    ──┤
Task 3 (group-lifecycle)  ──┼──► Task 6 (validation)
Task 4 (google-home)      ──┤
Task 5 (shabbat-mode)     ──┘
```

### Parallelization

| Parallel Group | Tasks | Why parallel |
|---|---|---|
| **All overlays** | 1, 2, 3, 4, 5 | All build from the same base (lifecycle-hooks). Independent files. No shared state. |
| **Validation** | 6 | Sequential — must run after all overlays complete |

All 5 overlay tasks touch DIFFERENT skill directories (`.claude/skills/add-reactions/`, `.claude/skills/add-refresh-oauth/`, etc.). They can run simultaneously without conflicts.

---

### Task 1: Convert reactions overlay to minimal diff

**Depends on:** nothing | **Parallelizable with:** Tasks 2-5

**Files:**
- Modify: `.claude/skills/add-reactions/modify/src/index.ts`
- Modify: `.claude/skills/add-reactions/manifest.yaml`

**Step 1: Build the minimal overlay**

Start from the lifecycle-hooks base:
```bash
cp .claude/skills/add-lifecycle-hooks/modify/src/index.ts .claude/skills/add-reactions/modify/src/index.ts
```

Then add ONLY the reactions-unique content. The additions are grouped by location in the file. Each group lists the anchor line (the existing line after which to insert) and the content to add.

**Import additions** (anchor: after `import { startSchedulerLoop }` — line 50 of upstream):
```typescript
import { StatusTracker } from './status-tracker.js';
```

Also add to the db.js import block (anchor: after `getAllRegisteredGroups,`):
```typescript
  getMessageFromMe,
```

**Remove** sender-allowlist import (delete the entire block lines 44-49 of upstream):
```typescript
// DELETE:
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
```

**Timer clamp** (insert at very top of file, before `import fs`):
```typescript
// Clamp setTimeout/setInterval to the max safe 32-bit signed integer to prevent
// TimeoutOverflowWarning from Baileys' internal session key expiry timers (~365 days).
const MAX_TIMER_MS = 0x7fff_ffff; // 2^31 - 1 ≈ 24.8 days
const _origSetTimeout = globalThis.setTimeout;
const _origSetInterval = globalThis.setInterval;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.setTimeout = ((cb: any, ms?: number, ...args: any[]) =>
  _origSetTimeout(
    cb,
    ms !== undefined && ms > MAX_TIMER_MS ? MAX_TIMER_MS : ms,
    ...args,
  )) as typeof setTimeout;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
globalThis.setInterval = ((cb: any, ms?: number, ...args: any[]) =>
  _origSetInterval(
    cb,
    ms !== undefined && ms > MAX_TIMER_MS ? MAX_TIMER_MS : ms,
    ...args,
  )) as typeof setInterval;
```

**State variable** (anchor: after `const agentCursors = new CursorManager();`):
```typescript
let statusTracker: StatusTracker;
```

**loadState addition** (anchor: after `agentCursors.loadAll` block):
```typescript
  const pipeCursor = getRouterState('cursor_before_pipe');
  try {
    agentCursors.loadSavedAll(pipeCursor ? JSON.parse(pipeCursor) : {});
  } catch {
    logger.warn('Corrupted cursor_before_pipe in DB, resetting');
    agentCursors.loadSavedAll({});
  }
```

**saveState addition** (anchor: after `setRouterState('last_agent_timestamp'...)`):
```typescript
  setRouterState('cursor_before_pipe', JSON.stringify(agentCursors.getSavedAll()));
```

**processGroupMessages additions** (anchor: before `await emitAgentStarting`):
```typescript
  // markReceived and markThinking blocks (16 lines)
```

**Streaming callback additions** (anchor: inside `if (result.result)` block):
```typescript
  // firstOutputSeen + markWorking (6 lines)
```

**Success/error handler additions**:
```typescript
  // markAllDone on success, enhanced error recovery with cursorBeforePipe (40 lines)
```

**Trigger check simplification** (both in processGroupMessages and startMessageLoop):
Replace sender-allowlist trigger check with simplified version.

**startMessageLoop additions**:
```typescript
  // markReceived per message, pipe cursor save (11 lines)
```

**recoverPendingMessages additions**:
```typescript
  // Piped-cursor rollback recovery (25 lines)
```

**Shutdown addition** (anchor: after `for (const ch of channels) await ch.disconnect()`):
```typescript
    await statusTracker.shutdown();
```

**Startup addition** (anchor: after channel connect loop, before `runChannelsReadyHooks`):
```typescript
  // StatusTracker initialization (20 lines)
```

**IPC deps additions** (anchor: after `registerGroup,`):
```typescript
    sendReaction: async (jid, emoji, messageId) => { ... },  // 18 lines
```

After `writeGroupsSnapshot:`:
```typescript
    statusHeartbeat: () => statusTracker.heartbeatCheck(),
    recoverPendingMessages,
```

After IPC watcher call:
```typescript
  await statusTracker.recover();
```

**onMessage simplification**: Replace sender-allowlist `onMessage` with:
```typescript
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
```

**Step 2: Update manifest**

```yaml
modify_base:
  src/index.ts: lifecycle-hooks
depends: [lifecycle-hooks]
```

**Step 3: Test independently**

```bash
git checkout -- src/ && rm -rf .nanoclaw/base
# Temporarily set only lifecycle-hooks + reactions in installed-skills.yaml
npm run apply-skills
npx tsc --noEmit
# Restore installed-skills.yaml
```

**Step 4: Commit**

```bash
git add .claude/skills/add-reactions/
git commit -m "fix(skills): convert reactions to true minimal-diff overlay"
```

---

### Task 2: Convert refresh-oauth overlay to minimal diff

**Depends on:** nothing | **Parallelizable with:** Tasks 1, 3-5

**Files:**
- Modify: `.claude/skills/add-refresh-oauth/modify/src/index.ts`
- Modify: `.claude/skills/add-refresh-oauth/manifest.yaml`

**Step 1: Build the minimal overlay**

Start from lifecycle-hooks base:
```bash
cp .claude/skills/add-lifecycle-hooks/modify/src/index.ts .claude/skills/add-refresh-oauth/modify/src/index.ts
```

Add ONLY refresh-oauth unique content:

**Import** (anchor: after `import path from 'path'` — line 2 of upstream):
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

**notifyMainGroup function** (anchor: before `async function runAgent`):
```typescript
function notifyMainGroup(text: string): void {
  const mainJid = Object.entries(registeredGroups).find(
    ([_, g]) => g.isMain === true,
  )?.[0];
  if (!mainJid) return;
  const channel = findChannel(channels, mainJid);
  channel?.sendMessage(mainJid, text);
}
```

**Pre-flight in runAgent** (anchor: before `const output = await runContainerAgent`):
```typescript
    await ensureTokenFresh();
```

**Auth recovery** (anchor: inside `if (output.status === 'error')`, before existing error log):
```typescript
      if (output.error && (await attemptAuthRecovery(...))) { ... }  // 29 lines
```

**Shutdown timer stops** (anchor: before `await queue.shutdown(10000)`):
```typescript
    stopTokenRefreshScheduler();
    stopPrimaryProbe();
```

**Startup OAuth init** (anchor: after `if (channels.length === 0)` block):
```typescript
  initOAuthState();
  await ensureTokenFresh();
  if (readOAuthState().usingFallback) {
    const oauthAlert = (msg: string) => notifyMainGroup(`[system] ${msg}`);
    startTokenRefreshScheduler(oauthAlert);
    startPrimaryProbe(oauthAlert);
  }
```

**Step 2: Update manifest**

```yaml
modify_base:
  src/index.ts: lifecycle-hooks
depends: [ipc-handler-registry, lifecycle-hooks]
```

**Step 3: Test independently + commit**

Same pattern as Task 1.

---

### Task 3: Convert group-lifecycle overlay to minimal diff

**Depends on:** nothing | **Parallelizable with:** Tasks 1-2, 4-5

**Files:**
- Modify: `.claude/skills/add-group-lifecycle/modify/src/index.ts`
- Modify: `.claude/skills/add-group-lifecycle/manifest.yaml`

**Step 1: Build the minimal overlay**

Start from lifecycle-hooks base. Add ONLY:

**Import** (anchor: after `import { resolveGroupFolderPath }` — line 41):
```typescript
import './ipc-handlers/group-lifecycle.js';
```

Also add to db.js import (anchor: after `getAllChats,`):
```typescript
  deleteRegisteredGroup,
```

**unregisterGroup function** (anchor: after `registerGroup()` function closing brace):
```typescript
function unregisterGroup(jid: string): boolean {
  const deleted = deleteRegisteredGroup(jid);
  if (deleted) {
    delete registeredGroups[jid];
    logger.info({ jid }, 'Group unregistered');
  }
  return deleted;
}
```

**IPC dep** (anchor: after `getAvailableGroups,`):
```typescript
    unregisterGroup,
```

**Step 2: Update manifest**

```yaml
modify_base:
  src/index.ts: lifecycle-hooks
depends: [ipc-handler-registry, lifecycle-hooks]
```

**Step 3: Test independently + commit**

---

### Task 4: Convert google-home overlay to minimal diff

**Depends on:** nothing | **Parallelizable with:** Tasks 1-3, 5

**Files:**
- Modify: `.claude/skills/add-google-home/modify/src/index.ts`
- Modify: `.claude/skills/add-google-home/manifest.yaml`

**Step 1: Build the minimal overlay**

Start from lifecycle-hooks base. Add ONLY:

**Import** (anchor: after `import { findChannel, formatMessages, formatOutbound }` — line 43):
```typescript
import {
  shutdownGoogleAssistant,
  startGoogleTokenScheduler,
  stopGoogleTokenScheduler,
} from './google-assistant.js';
```

**Shutdown calls** (anchor: `stopGoogleTokenScheduler()` before `queue.shutdown()`, `shutdownGoogleAssistant()` after `ch.disconnect()`):
```typescript
    stopGoogleTokenScheduler();
    // ... (after ch.disconnect)
    shutdownGoogleAssistant();
```

**Startup** (anchor: after `recoverPendingMessages()`):
```typescript
  startGoogleTokenScheduler((msg) => notifyMainGroup(`[system] ${msg}`));
```

NOTE: `notifyMainGroup` is defined by refresh-oauth. google-home depends on refresh-oauth being applied first. The placement convention ensures this: google-home's `startGoogleTokenScheduler` call anchors to a different line than refresh-oauth's additions.

**Step 2: Update manifest**

```yaml
modify_base:
  src/index.ts: lifecycle-hooks
depends: [ipc-handler-registry, lifecycle-hooks, refresh-oauth]
```

**Step 3: Test independently + commit**

---

### Task 5: Convert shabbat-mode overlay to minimal diff

**Depends on:** nothing | **Parallelizable with:** Tasks 1-4

**Files:**
- Modify: `.claude/skills/add-shabbat-mode/modify/src/index.ts`
- Modify: `.claude/skills/add-shabbat-mode/manifest.yaml`

**Step 1: Build the minimal overlay**

Start from lifecycle-hooks base. Add ONLY:

**Import** (anchor: after `import { Channel, NewMessage, RegisteredGroup }` — line 51):
```typescript
import {
  initShabbatSchedule,
  isShabbatOrYomTov,
  startCandleLightingNotifier,
  stopCandleLightingNotifier,
} from './shabbat.js';
```

**Shabbat guard in processGroupMessages** (anchor: after `if (!shouldProcessMessages()) return true;`):
```typescript
  if (isShabbatOrYomTov()) {
    logger.debug(
      { group: group.name },
      'Shabbat/Yom Tov active, skipping message processing',
    );
    return true;
  }
```

**sendPostShabbatSummary function** (anchor: before `async function startMessageLoop`):
```typescript
async function sendPostShabbatSummary(): Promise<string[]> {
  // ... 35 lines
}
```

**startMessageLoop Shabbat tracking** (anchor: after `let wasGuarded = !shouldProcessMessages();`):
```typescript
  let wasShabbat = isShabbatOrYomTov();
```

And inside the loop (anchor: after lifecycle guard `if (wasGuarded)` block):
```typescript
      const currentlyShabbat = isShabbatOrYomTov();
      if (wasShabbat && !currentlyShabbat) {
        const pendingJids = await sendPostShabbatSummary();
        for (const chatJid of pendingJids) {
          queue.enqueueMessageCheck(chatJid);
        }
      }
      wasShabbat = currentlyShabbat;
      if (currentlyShabbat) {
        logger.debug('Shabbat/Yom Tov active, skipping message processing');
        await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
        continue;
      }
```

**Shutdown** (anchor: after `stopGoogleTokenScheduler()` if google-home installed, otherwise after `queue.shutdown()`):
```typescript
    stopCandleLightingNotifier();
```

**Startup** (anchor: after `loadState()`, before `runStartupHooks()`):
```typescript
  initShabbatSchedule();
```

**Candle lighting notifier** (anchor: after `startGoogleTokenScheduler` if google-home installed, otherwise after `recoverPendingMessages()`):
```typescript
  const userJid = Object.entries(registeredGroups).find(
    ([_, g]) => g.isMain === true,
  )?.[0];
  if (userJid) {
    startCandleLightingNotifier((text) => {
      const channel = findChannel(channels, userJid);
      if (channel) channel.sendMessage(userJid, text);
    });
  } else {
    logger.warn('No main group registered — candle lighting notifier disabled');
  }
```

**Step 2: Update manifest**

```yaml
modify_base:
  src/index.ts: lifecycle-hooks
  src/task-scheduler.ts: _accumulated  # unchanged
depends: [lifecycle-hooks, reactions, refresh-oauth, google-home]
```

**Step 3: Test independently + commit**

---

### Task 6: Full validation

**Depends on:** Tasks 1-5 | **Cannot parallelize**

**Step 1: Clean build from scratch**

```bash
git checkout -- src/ container/
rm -rf .nanoclaw/base
npm run build
```

Expected: Build succeeds (18 skills apply, tsc compiles, clean-skills restores).

**Step 2: Run all tests**

```bash
npx vitest run
```

Expected: All tests pass.

**Step 3: Verify overlay sizes**

```bash
wc -l .claude/skills/*/modify/src/index.ts
```

Expected: lifecycle-hooks ~628, all others dramatically smaller.

**Step 4: Verify no modify_base chaining**

```bash
grep -r "modify_base" .claude/skills/*/manifest.yaml | grep "src/index.ts"
```

Expected: Every entry for src/index.ts says `lifecycle-hooks` (star topology, no chain).

**Step 5: Commit**

```bash
git add .claude/skills/ .nanoclaw/installed-skills.yaml
git commit -m "feat(skills): true minimal-diff overlays — star topology (79% reduction)"
```

---

## Testing approach for each overlay

Each overlay should be tested in isolation before the full validation:

```bash
# 1. Save current installed-skills.yaml
cp .nanoclaw/installed-skills.yaml /tmp/orig-skills.yaml

# 2. Set minimal skill list (lifecycle-hooks + prerequisites + the skill being tested)
cat > .nanoclaw/installed-skills.yaml << 'EOF'
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry
  - THE_SKILL_BEING_TESTED
EOF

# 3. Clean apply
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills

# 4. Type check
npx tsc --noEmit

# 5. Restore
cp /tmp/orig-skills.yaml .nanoclaw/installed-skills.yaml
```

This proves the overlay merges cleanly against the lifecycle-hooks base without depending on any other skill's index.ts changes.

## Quality check: how to tell if your overlay is truly minimal

After building an overlay, run:
```bash
diff .claude/skills/add-lifecycle-hooks/modify/src/index.ts .claude/skills/YOUR_SKILL/modify/src/index.ts | grep "^[<>]" | wc -l
```

This shows the total diff lines between your overlay and the base. Compare against expected:

| Skill | Expected diff lines |
|---|---|
| reactions | ~170 |
| refresh-oauth | ~70 |
| group-lifecycle | ~15 |
| google-home | ~10 |
| shabbat-mode | ~80 |

If your diff is 200+ for google-home or group-lifecycle, you've accidentally included another skill's additions. Start over from `cp .claude/skills/add-lifecycle-hooks/modify/src/index.ts`.

## Placement convention reference

Each skill anchors its imports after a DIFFERENT upstream import line:

| Skill | Anchor import after |
|---|---|
| lifecycle-hooks | `import { logger }` (L52) |
| reactions | `import { startSchedulerLoop }` (L50) |
| refresh-oauth | `import path from 'path'` (L2) |
| group-lifecycle | `import { resolveGroupFolderPath }` (L41) |
| google-home | `import { findChannel }` (L43) |
| shabbat-mode | `import { Channel, NewMessage }` (L51) |

This prevents `git merge-file` conflicts when multiple overlays add imports.
