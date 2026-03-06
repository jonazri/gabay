# Self-Heal Skill Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Catch all IPC failures and notify the container agent so it can triage errors, retry when appropriate, and file bug reports for host-side issues.

**Architecture:** Modify `processTaskIpc` to write error responses and notification messages on failure. Add a container SKILL.md that instructs the agent on error triage. Packaged as a single skill with an `ipc.ts` overlay (modifying the default handler dispatch) and a container skill file.

**Tech Stack:** TypeScript, Node.js fs, IPC file protocol

---

### Task 1: Write the `writeIpcNotification` helper test

**Files:**
- Create: `src/ipc-self-heal.test.ts`

**Step 1: Write the failing test**

Test that a helper function writes a notification file to `ipc/{group}/input/` with the correct format.

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('writeIpcNotification', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-heal-'));
    vi.stubEnv('DATA_DIR', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes notification file to ipc/{group}/input/', async () => {
    // Dynamic import to pick up stubbed DATA_DIR
    vi.resetModules();
    const { writeIpcNotification } = await import('./ipc-self-heal.js');

    writeIpcNotification('test-group', 'unknown_ipc_type', 'schedule_tasks', 'No handler registered for type "schedule_tasks"');

    const inputDir = path.join(tmpDir, 'ipc', 'test-group', 'input');
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);

    const content = JSON.parse(fs.readFileSync(path.join(inputDir, files[0]), 'utf-8'));
    expect(content.type).toBe('message');
    expect(content.text).toContain('[IPC Error]');
    expect(content.text).toContain('schedule_tasks');
    expect(content.text).toContain('unknown_ipc_type');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc-self-heal.test.ts`
Expected: FAIL — module `./ipc-self-heal.js` does not exist

**Step 3: Commit**

```bash
git add src/ipc-self-heal.test.ts
git commit -m "test(self-heal): failing test for writeIpcNotification helper"
```

---

### Task 2: Implement `writeIpcNotification` helper

**Files:**
- Create: `src/ipc-self-heal.ts`

**Step 1: Write minimal implementation**

```typescript
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export type IpcErrorCode =
  | 'unknown_ipc_type'
  | 'handler_error'
  | 'malformed_request'
  | 'invalid_request';

/**
 * Write an error notification file to ipc/{group}/input/ so the agent-runner's
 * drainIpcInput() picks it up and pipes the error message into the running
 * conversation.
 */
export function writeIpcNotification(
  sourceGroup: string,
  errorCode: IpcErrorCode,
  ipcType: string,
  errorMessage: string,
): void {
  const inputDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'input');
  fs.mkdirSync(inputDir, { recursive: true });

  const agentAction =
    errorCode === 'unknown_ipc_type'
      ? 'If this is your mistake (typo, wrong type name), correct and retry. If the type matches a known CLI tool or skill, it\'s a host-side bug — the handler registration is broken. Write a bug report to /workspace/group/feature-requests/.'
      : errorCode === 'handler_error'
        ? 'The host handler crashed. This is a host-side bug. Write a bug report to /workspace/group/feature-requests/ and inform the user.'
        : 'This is likely your mistake. Fix the request and retry.';

  const text = `[IPC Error] Type "${ipcType}" failed (${errorCode}): ${errorMessage}. ${agentAction}`;

  const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const filePath = path.join(inputDir, `${timestamp}.json`);
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ type: 'message', text }));
  fs.renameSync(tempFile, filePath);

  logger.info(
    { sourceGroup, errorCode, ipcType },
    'IPC error notification written for agent',
  );
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/ipc-self-heal.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/ipc-self-heal.ts
git commit -m "feat(self-heal): writeIpcNotification helper"
```

---

### Task 3: Write the `writeIpcErrorResponse` helper test

**Files:**
- Modify: `src/ipc-self-heal.test.ts`

**Step 1: Add the failing test**

```typescript
describe('writeIpcErrorResponse', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-heal-'));
    vi.stubEnv('DATA_DIR', tmpDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes error response to ipc/{group}/responses/{requestId}.json', async () => {
    vi.resetModules();
    const { writeIpcErrorResponse } = await import('./ipc-self-heal.js');

    writeIpcErrorResponse('test-group', 'req-123', 'unknown_ipc_type', 'bad_type', 'No handler');

    const responsePath = path.join(tmpDir, 'ipc', 'test-group', 'responses', 'req-123.json');
    expect(fs.existsSync(responsePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
    expect(content.status).toBe('error');
    expect(content.error_code).toBe('unknown_ipc_type');
    expect(content.ipc_type).toBe('bad_type');
    expect(content.error).toBe('No handler');
  });

  it('skips writing when requestId is undefined', async () => {
    vi.resetModules();
    const { writeIpcErrorResponse } = await import('./ipc-self-heal.js');

    writeIpcErrorResponse('test-group', undefined, 'handler_error', 'foo', 'Crash');

    const responsesDir = path.join(tmpDir, 'ipc', 'test-group', 'responses');
    expect(fs.existsSync(responsesDir)).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc-self-heal.test.ts`
Expected: FAIL — `writeIpcErrorResponse` not exported

**Step 3: Implement `writeIpcErrorResponse`**

Add to `src/ipc-self-heal.ts`:

```typescript
/**
 * Write an error response to ipc/{group}/responses/{requestId}.json for IPC
 * calls that include a requestId (e.g., google-home CLI tool polling pattern).
 * No-op if requestId is undefined (fire-and-forget IPC calls).
 */
export function writeIpcErrorResponse(
  sourceGroup: string,
  requestId: string | undefined,
  errorCode: IpcErrorCode,
  ipcType: string,
  errorMessage: string,
): void {
  if (!requestId) return;

  const responsesDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'responses');
  fs.mkdirSync(responsesDir, { recursive: true });

  const responseFile = path.join(responsesDir, `${requestId}.json`);
  const tempFile = `${responseFile}.tmp`;
  fs.writeFileSync(
    tempFile,
    JSON.stringify({
      status: 'error',
      error_code: errorCode,
      ipc_type: ipcType,
      error: errorMessage,
    }),
  );
  fs.renameSync(tempFile, responseFile);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/ipc-self-heal.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/ipc-self-heal.ts src/ipc-self-heal.test.ts
git commit -m "feat(self-heal): writeIpcErrorResponse helper"
```

---

### Task 4: Write integration test for `processTaskIpc` error handling

**Files:**
- Modify: `src/ipc-self-heal.test.ts`

This test verifies that when `processTaskIpc` encounters an unknown IPC type, it writes both an error response and a notification. We test `processTaskIpc` directly.

**Step 1: Write the failing test**

```typescript
import { _initTestDatabase, setRegisteredGroup } from './db.js';

describe('processTaskIpc self-heal integration', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-heal-'));
    vi.stubEnv('DATA_DIR', tmpDir);
    _initTestDatabase();
    setRegisteredGroup('main@g.us', {
      name: 'Main',
      folder: 'main',
      trigger: 'always',
      added_at: '2024-01-01T00:00:00.000Z',
      isMain: true,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('unknown IPC type writes notification to input dir', async () => {
    vi.resetModules();
    const { processTaskIpc } = await import('./ipc.js');

    const deps = {
      sendMessage: async () => {},
      registeredGroups: () => ({
        'main@g.us': {
          name: 'Main', folder: 'main', trigger: 'always',
          added_at: '2024-01-01', isMain: true,
        },
      }),
      registerGroup: () => {},
      syncGroups: async () => {},
      getAvailableGroups: () => [],
      writeGroupsSnapshot: () => {},
    };

    await processTaskIpc(
      { type: 'nonexistent_type', requestId: 'req-456' },
      'main',
      true,
      deps,
    );

    // Should have written notification
    const inputDir = path.join(tmpDir, 'ipc', 'main', 'input');
    const inputFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    expect(inputFiles.length).toBeGreaterThanOrEqual(1);

    const notification = JSON.parse(fs.readFileSync(path.join(inputDir, inputFiles[0]), 'utf-8'));
    expect(notification.text).toContain('[IPC Error]');
    expect(notification.text).toContain('nonexistent_type');

    // Should have written error response
    const responsePath = path.join(tmpDir, 'ipc', 'main', 'responses', 'req-456.json');
    expect(fs.existsSync(responsePath)).toBe(true);
    const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
    expect(response.status).toBe('error');
    expect(response.error_code).toBe('unknown_ipc_type');
  });

  it('handler exception writes handler_error notification', async () => {
    vi.resetModules();
    const ipcHandlers = await import('./ipc-handlers.js');
    ipcHandlers.registerIpcHandler('crasher', async () => {
      throw new Error('handler boom');
    });
    const { processTaskIpc } = await import('./ipc.js');

    const deps = {
      sendMessage: async () => {},
      registeredGroups: () => ({
        'main@g.us': {
          name: 'Main', folder: 'main', trigger: 'always',
          added_at: '2024-01-01', isMain: true,
        },
      }),
      registerGroup: () => {},
      syncGroups: async () => {},
      getAvailableGroups: () => [],
      writeGroupsSnapshot: () => {},
    };

    await processTaskIpc(
      { type: 'crasher', requestId: 'req-789' },
      'main',
      true,
      deps,
    );

    const inputDir = path.join(tmpDir, 'ipc', 'main', 'input');
    const inputFiles = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    expect(inputFiles.length).toBeGreaterThanOrEqual(1);

    const notification = JSON.parse(fs.readFileSync(path.join(inputDir, inputFiles[0]), 'utf-8'));
    expect(notification.text).toContain('handler_error');
    expect(notification.text).toContain('handler boom');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/ipc-self-heal.test.ts`
Expected: FAIL — `processTaskIpc` doesn't call `writeIpcNotification` yet

**Step 3: Commit**

```bash
git add src/ipc-self-heal.test.ts
git commit -m "test(self-heal): integration test for processTaskIpc error handling"
```

---

### Task 5: Create the `ipc.ts` overlay

**Files:**
- Create: `.claude/skills/add-self-heal/modify/src/ipc.ts`

This overlay modifies `processTaskIpc`'s `default` case to call `writeIpcNotification` and `writeIpcErrorResponse` on unknown types and handler exceptions.

**Step 1: Determine the overlay base**

The overlay must be based on the **group-lifecycle** skill's output (last modifier of `ipc.ts`). The group-lifecycle overlay at `.claude/skills/add-group-lifecycle/modify/src/ipc.ts` is our `modify_base`.

The overlay adds:
1. Import for `writeIpcNotification` and `writeIpcErrorResponse` from `./ipc-self-heal.js`
2. In the `default` case: wrap handler call in try/catch, call notification/response helpers on error

**Step 2: Create the overlay file**

Copy group-lifecycle's `ipc.ts` overlay and add the self-heal modifications. The key delta is:

1. Add import at top:
```typescript
import { writeIpcNotification, writeIpcErrorResponse } from './ipc-self-heal.js';
```

2. Replace the `default` case (which currently reads):
```typescript
    default: {
      const handler = getIpcHandler(data.type);
      if (handler) {
        await handler(data, deps, { sourceGroup, isMain });
      } else {
        logger.warn({ type: data.type }, 'Unknown IPC task type');
      }
    }
```

With:
```typescript
    default: {
      const handler = getIpcHandler(data.type);
      if (handler) {
        try {
          await handler(data, deps, { sourceGroup, isMain });
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          logger.error({ type: data.type, err, sourceGroup }, 'IPC handler threw an exception');
          writeIpcErrorResponse(sourceGroup, data.requestId, 'handler_error', data.type, errorMessage);
          writeIpcNotification(sourceGroup, 'handler_error', data.type, errorMessage);
        }
      } else {
        const errorMessage = `No handler registered for IPC type "${data.type}"`;
        logger.warn({ type: data.type }, 'Unknown IPC task type');
        writeIpcErrorResponse(sourceGroup, data.requestId, 'unknown_ipc_type', data.type, errorMessage);
        writeIpcNotification(sourceGroup, 'unknown_ipc_type', data.type, errorMessage);
      }
    }
```

Also add `requestId?: string;` to the `data` parameter type in `processTaskIpc`.

**Step 3: Run the integration test**

Run: `git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills`
Then: `npx vitest run src/ipc-self-heal.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add .claude/skills/add-self-heal/modify/src/ipc.ts
git commit -m "feat(self-heal): ipc.ts overlay — error responses + notifications"
```

---

### Task 6: Create the container SKILL.md

**Files:**
- Create: `.claude/skills/add-self-heal/add/container/skills/self-heal/SKILL.md`

**Step 1: Write the skill file**

```markdown
---
name: self-heal
description: Triage IPC errors, retry when appropriate, and file bug reports for host-side issues. Activated automatically when you see [IPC Error] messages.
---

# Self-Heal: IPC Error Triage

When you see a message starting with `[IPC Error]`, follow this triage process.

## Error Categories

### `unknown_ipc_type` — Unknown IPC Type

The host has no handler registered for the IPC type you used.

**Check first:** Did you make a typo or use the wrong type name? Common mistakes:
- `schedule_tasks` instead of `schedule_task`
- `google_home` instead of `google_assistant_command`

**If your mistake:** Correct the type name and retry the IPC call.

**If the type matches a known CLI tool or skill:** The handler registration is broken on the host side. This is a host-side bug — the skill that provides this handler likely forgot to import its IPC handler module.

### `handler_error` — Handler Exception

The host handler exists but crashed while processing your request. This is always a host-side bug.

### `malformed_request` / `invalid_request` — Bad Request

Your IPC request has malformed JSON or missing required fields. Fix the request and retry.

## Bug Report Flow

When you identify a host-side bug (`unknown_ipc_type` that isn't your typo, or `handler_error`):

1. Write a bug report to `/workspace/group/feature-requests/` with filename `bug-<short-description>.md`
2. Include:
   - **Title:** `bug: <description>`
   - **IPC type** that failed
   - **Error message** from the `[IPC Error]` notification
   - **What you were trying to do** (the user's request that led to this)
   - **Steps to reproduce** (the exact IPC call you made)
3. Inform the user that the command failed due to a host-side bug and that you've filed a report

## Important

- Do NOT retry more than once for the same error — if it fails twice, it's a bug, not a transient issue
- Do NOT suppress the error from the user — always inform them what happened
- If a CLI tool timed out (60s), check if an `[IPC Error]` arrived — the error notification explains why
```

**Step 2: Commit**

```bash
git add .claude/skills/add-self-heal/add/container/skills/self-heal/SKILL.md
git commit -m "feat(self-heal): container SKILL.md for agent error triage"
```

---

### Task 7: Create the manifest and register the skill

**Files:**
- Create: `.claude/skills/add-self-heal/manifest.yaml`
- Modify: `.nanoclaw/installed-skills.yaml`

**Step 1: Create the manifest**

```yaml
skill: self-heal
version: 1.0.0
description: "IPC error recovery — notifies container agents of failures for triage and retry"
core_version: 0.1.0
adds:
  - src/ipc-self-heal.ts
  - src/ipc-self-heal.test.ts
  - container/skills/self-heal/SKILL.md
modifies:
  - src/ipc.ts
modify_base:
  src/ipc.ts: group-lifecycle
depends:
  - ipc-handler-registry
test: "npx vitest run src/ipc-self-heal.test.ts"
```

**Step 2: Add to installed-skills.yaml**

Add `self-heal` after `group-lifecycle` (since it depends on group-lifecycle's ipc.ts overlay):

```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry
  - reactions
  - refresh-oauth
  - group-lifecycle
  - self-heal          # <-- ADD HERE
  - google-home
  - shabbat-mode
  - container-hardening
  - task-scheduler-fixes
  - voice-transcription-elevenlabs
  - voice-recognition
  - whatsapp-search
  - perplexity-research
  - feature-request
  - whatsapp-summary
  - whatsapp-replies
```

**Step 3: Commit**

```bash
git add .claude/skills/add-self-heal/manifest.yaml .nanoclaw/installed-skills.yaml
git commit -m "feat(self-heal): manifest and skill registration"
```

---

### Task 8: Full build verification

**Step 1: Clean and apply all skills**

Run:
```bash
git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills
```
Expected: All skills apply cleanly, no merge conflicts

**Step 2: Build**

Run: `npm run build`
Expected: Build succeeds with no type errors

**Step 3: Run all tests**

Run: `npx vitest run`
Expected: All tests pass including the new `ipc-self-heal.test.ts`

**Step 4: Verify clean cycle**

Run:
```bash
npm run clean-skills && npm run apply-skills --deps-only
```
Expected: No residual changes in `src/`

**Step 5: Commit any adjustments needed**

If any fixes were needed during verification, commit them.

---

### Task 9: Deploy and verify

**Step 1: Rebuild container**

Run: `./container/build.sh`
Expected: Container builds successfully, includes `container/skills/self-heal/SKILL.md`

**Step 2: Restart services**

Run: `systemctl --user restart nanoclaw`

**Step 3: Tail logs to verify clean startup**

Run: `tail -f ~/code/yonibot/gabay/logs/nanoclaw.log`
Expected: Clean startup, no errors

**Step 4: (Optional) Trigger a test error**

If safe to test: the next time an unknown IPC type naturally occurs, verify the agent receives the `[IPC Error]` notification and triages it correctly.

---

### Task 10: Push and clean up

**Step 1: Push all commits**

Run: `git push origin main`

**Step 2: Verify CI passes**

Check that CodeQL and any triggered workflows pass.
