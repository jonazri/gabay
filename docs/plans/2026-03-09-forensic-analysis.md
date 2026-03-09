# Forensic Analysis — Consolidated Report

**Date:** 2026-03-09
**Phase 2 of Skill Overlay Cleanup**

## Executive Summary

All 20 installed skills analyzed. Key findings:
- **6 skills are clean** (no overlays or all hunks are fork-unique): whatsapp-types, feature-request, whatsapp-summary, voice-recognition (whatsapp.ts/test), whatsapp-replies (router.ts, types.ts)
- **14 skills need overlay rebuilds** due to accumulated cross-skill pollution
- **3 regressions** found in ipc-handler-registry+self-heal overlays (dropped `update_task`, dropped `data.taskId||`, cosmetic `date→scheduled` rename)
- **1 skill to remove** from installed list: refresh-oauth (superseded by credential proxy)
- **1 skill merge**: ipc-handler-registry + self-heal → single skill
- **4 stale depends** to fix

## Per-Skill Classification

### 1. lifecycle-hooks
**Dir:** add-lifecycle-hooks | **Modifies:** src/index.ts | **modify_base:** none

| Hunk | Classification | Notes |
|------|---------------|-------|
| fileURLToPath import | FORK-KEEP | Needed for isDirectRun guard |
| Remove CREDENTIAL_PROXY_PORT, startCredentialProxy | ACCUMULATED | Belongs to credential-proxy removal (no skill owns this) |
| Remove PROXY_BIND_HOST | ACCUMULATED | Same as above |
| Remove getRegisteredGroup import | ACCUMULATED | Dead import cleanup, not lifecycle-hooks concern |
| lifecycle.js, cursor-manager.js, message-events.js imports | FORK-KEEP | Core skill imports |
| CursorManager replacing lastAgentTimestamp | FORK-KEEP | Core infrastructure |
| loadState/saveState CursorManager migration | FORK-KEEP | |
| shouldProcessMessages() guard | FORK-KEEP | Guard integration |
| emitAgent* event calls | FORK-KEEP | message-events integration |
| wasGuarded + runGuardLiftedHooks loop | FORK-KEEP | Core guard loop |
| runStartupHooks/runShutdownHooks | FORK-KEEP | Lifecycle hook calls |
| Remove proxyServer start/close | ACCUMULATED | Belongs to credential-proxy removal |
| runChannelsReadyHooks | FORK-KEEP | |
| isDirectRun rewrite | FORK-KEEP | Robust module detection |

**Action:** Rebuild src/index.ts overlay — remove 4 accumulated hunks, keep all lifecycle hunks.

### 2. whatsapp-types
**Dir:** add-whatsapp-types | **Modifies:** none | **modify_base:** none

**Action:** Keep as-is. No overlays. Adds qrcode-terminal.d.ts + npm deps.

### 3. whatsapp
**Dir:** add-whatsapp | **Modifies:** src/channels/index.ts, setup/index.ts | **modify_base:** none

| File | Hunk | Classification |
|------|------|---------------|
| channels/index.ts | `import './whatsapp.js'` | FORK-KEEP |
| setup/index.ts | `channels: () => import('./channels.js')` | STALE — no channels.js file exists |
| setup/index.ts | `'whatsapp-auth': () => import('./whatsapp-auth.js')` | FORK-KEEP |

**Action:** Rebuild setup/index.ts — drop stale `channels` entry.

### 4. ipc-handler-registry + self-heal (to be merged)
**Dirs:** ipc-handler-registry, add-self-heal | **Modifies:** src/ipc.ts | **modify_base:** self-heal has `src/ipc.ts: ipc-handler-registry`

| Hunk | Classification | Source |
|------|---------------|--------|
| getIpcHandler import | FORK-KEEP | ipc-handler-registry |
| date→scheduled rename | STALE | Both — revert to upstream |
| Drop data.taskId|| | STALE/REGRESSION | Both — restore upstream |
| Drop update_task case (64 lines) | STALE/REGRESSION | Both — restore upstream |
| Default case with registry lookup | SUPERSEDED | ipc-handler-registry (replaced by self-heal's version) |
| writeIpcNotification/writeIpcErrorResponse imports | FORK-KEEP | self-heal |
| requestId? in data type | FORK-KEEP | self-heal |
| Default case with try/catch + error writes | FORK-KEEP | self-heal |

**Action:** Merge into single skill. Rebuild ipc.ts: use self-heal's default case, restore `date` variable, restore `data.taskId||`, restore `update_task` case.

### 5. reactions
**Dir:** add-reactions | **Modifies:** 10 files | **modify_base:** none (upstream's version after merge)

Key findings per file:
- **src/db.ts:** Reaction interface, table, functions are FORK-KEEP. `getNewMessages`/`getMessagesSince` limit param is a REGRESSION vs upstream.
- **src/types.ts:** `sendReaction?` and `reactToLatestMessage?` FORK-KEEP. `isMain` removal from RegisteredGroup is STALE.
- **src/ipc.ts:** `sendReaction?` in IpcDeps and reaction dispatch FORK-KEEP. `statusHeartbeat?`, `recoverPendingMessages?`, `RECOVERY_INTERVAL_MS` are FORK-KEEP. `taskId` regression and `update_task` deletion are STALE.
- **src/index.ts:** `getMessageFromMe` import and `sendReaction` callback FORK-KEEP. StatusTracker/cursorBeforePipe/credential-proxy removal are ACCUMULATED.
- **src/channels/whatsapp.ts:** Full file overlay carries add-whatsapp content. Reactions-specific: messages.reaction handler, sendReaction(), reactToLatestMessage().
- **container/agent-runner/src/ipc-mcp-stdio.ts:** `react_to_message` tool FORK-KEEP. `update_task` removal is STALE. `schedule_task` reformatting is ACCUMULATED.

**Action:** Rebuild all 10 overlay files as pure upstream deltas.

### 6. refresh-oauth (REMOVAL)
**Dir:** add-refresh-oauth

**Dependencies on it:**
- google-home: `depends: [refresh-oauth]`, `modify_base: src/container-runner.ts: refresh-oauth`
- perplexity-research: imports AUTH_ERROR_PATTERN (used in streaming failsafe)
- shabbat-mode: imports AUTH_ERROR_PATTERN, ensureTokenFresh, refreshOAuthToken
- akiflow-sync: dead import of AUTH_ERROR_PATTERN, readOAuthState

**Action:** Remove from installed-skills.yaml. Update google-home, perplexity-research, shabbat-mode, akiflow-sync manifests/overlays.

### 7. group-lifecycle
**Dir:** add-group-lifecycle | **Modifies:** src/db.ts, src/index.ts, src/ipc.ts | **modify_base:** 3 entries

| File | Unique Hunks | Accumulated Hunks |
|------|-------------|-------------------|
| src/db.ts | deleteRegisteredGroup (7 lines), isMain migration fix (3 lines) | Reaction interface, reactions table, reaction functions |
| src/index.ts | deleteRegisteredGroup import, ipc-handlers/group-lifecycle import, unregisterGroup fn, wire into deps | All lifecycle-hooks content |
| src/ipc.ts | unregisterGroup in IpcDeps (1 line) | All ipc-handler-registry + reactions content |

**Action:** Rebuild all 3 overlays with only unique hunks.

### 8. google-home
**Dir:** add-google-home | **Modifies:** src/index.ts, src/container-runner.ts, container/Dockerfile | **modify_base:** index.ts→lifecycle-hooks, container-runner.ts→refresh-oauth

| File | Unique Hunks | Accumulated |
|------|-------------|-------------|
| src/index.ts | google-assistant imports, shutdown teardown, startup calls | All lifecycle-hooks content |
| src/container-runner.ts | responses/ mkdir, sockets mount | All refresh-oauth content |
| container/Dockerfile | jq install, google-home CLI copy, responses/sockets mkdirs | comment change (refresh-oauth) |

**Bug:** `notifyMainGroup` referenced but never defined.

**Action:** Rebuild all 3 overlays. Fix notifyMainGroup reference. Drop refresh-oauth from depends.

### 9. shabbat-mode
**Dir:** add-shabbat-mode | **Modifies:** src/index.ts, src/task-scheduler.ts, src/task-scheduler.test.ts, src/ipc.ts | **modify_base:** 2 entries

| File | Unique Hunks | Accumulated |
|------|-------------|-------------|
| src/index.ts | shabbat imports, isShabbatOrYomTov guard, sendPostShabbatSummary fn, wasShabbat tracking, initShabbatSchedule, stopCandleLightingNotifier, candle lighting startup | All lifecycle-hooks content |
| src/task-scheduler.ts | isShabbatOrYomTov import + Shabbat guard in startSchedulerLoop | 8 hunks from task-scheduler-fixes + refresh-oauth |
| src/task-scheduler.test.ts | 0 unique hunks | All content accumulated |
| src/ipc.ts | isShabbatOrYomTov import + Shabbat guard | 3 accumulated hunks |

**Action:** Rebuild src/index.ts, src/task-scheduler.ts, src/ipc.ts. Drop src/task-scheduler.test.ts overlay entirely.

### 10. container-hardening
**Dir:** add-container-hardening | **Modifies:** src/group-queue.ts, src/container-runner.ts | **modify_base:** container-runner.ts→google-home

| File | Unique Hunks | Accumulated |
|------|-------------|-------------|
| src/group-queue.ts | Dead-process guard, isActive() method | None — clean |
| src/container-runner.ts | import os, plugins sync, plugins cache mount, log rotation, safeResolve guard + all resolve→safeResolve | google-home + refresh-oauth content |

**Action:** group-queue.ts: keep as-is. container-runner.ts: rebuild with only hardening hunks.

### 11. task-scheduler-fixes
**Dir:** add-task-scheduler-fixes | **Modifies:** src/task-scheduler.ts | **modify_base:** none

| Hunk | Classification |
|------|---------------|
| computeNextRun JSDoc removal | UPSTREAMED — upstream has it with better comments |
| Inline comments removal | UPSTREAMED |
| @g.us guard + scheduleClose removal | FORK-KEEP |
| IPC routing comment | FORK-KEEP |
| Pre-advance comment | FORK-KEEP |
| Pre-advance next_run in startSchedulerLoop | FORK-KEEP |

**Action:** Rebuild — drop upstreamed JSDoc/comment hunks, keep safety guard and pre-advance fix.

### 12. voice-transcription-elevenlabs
**Dir:** add-voice-transcription-elevenlabs | **Modifies:** src/channels/whatsapp.ts, src/channels/whatsapp.test.ts | **modify_base:** whatsapp.ts→_accumulated, whatsapp.test.ts→reactions

| File | Unique Hunks | Accumulated |
|------|-------------|-------------|
| whatsapp.ts | normalizeMessageContent import, transcription.js import, messages.upsert handler rewrite | 3 cosmetic trailing-comma hunks |
| whatsapp.test.ts | transcription mock, normalizeMessageContent mock, 3 voice tests | None — clean |

**Action:** Rebuild whatsapp.ts to strip cosmetic noise. Keep whatsapp.test.ts as-is.

### 13. voice-recognition
**Dir:** add-voice-recognition | **Modifies:** src/config.ts, src/channels/whatsapp.ts, src/channels/whatsapp.test.ts, src/transcription.ts | **modify_base:** 3 entries

| File | Finding |
|------|---------|
| src/config.ts | OWNER_NAME additions are FORK-KEEP. But overlay drops CREDENTIAL_PROXY_PORT (STALE drift). |
| whatsapp.ts | All hunks FORK-KEEP (speaker ID integration) |
| whatsapp.test.ts | All hunks FORK-KEEP |
| src/transcription.ts | NOT a no-op (verified). Has real diffs: logger.warn vs console.warn, TranscriptionResult return type, readEnvFile import. FORK-KEEP. |

**Action:** Rebuild src/config.ts. Keep src/transcription.ts, whatsapp.ts/test as-is.

### 14. whatsapp-search
**Dir:** add-whatsapp-search | **Modifies:** src/container-runner.ts | **modify_base:** none

Container-runner overlay is a full rewrite with credential-proxy removal. Only 1 line is actually whatsapp-search-specific: `--add-host host.docker.internal:host-gateway`.

**Action:** Rebuild container-runner.ts with just the --add-host line.

### 15. perplexity-research
**Dir:** add-perplexity-research | **Modifies:** src/container-runner.ts | **modify_base:** _accumulated

Container-runner overlay has **zero perplexity-specific code** — the API key is injected via `structured.container_secrets` in the manifest. All 110 lines of diff are accumulated infrastructure.

**Action:** If `structured.container_secrets` works, drop the container-runner.ts overlay entirely. Otherwise, rebuild with only the key injection.

### 16. feature-request
**Dir:** add-feature-request | **Modifies:** none | **modify_base:** none

**Action:** Keep as-is. Pure add (container skill doc).

### 17. whatsapp-summary
**Dir:** add-whatsapp-summary | **Modifies:** none | **modify_base:** none

**Action:** Keep as-is. Pure add (container skill doc).

### 18. whatsapp-replies
**Dir:** whatsapp-replies | **Modifies:** 10 files | **modify_base:** 9 are _accumulated, 1 is group-lifecycle

| File | Finding |
|------|---------|
| ipc-mcp-stdio.ts | quotedMessageId + react_to_message FORK-KEEP. update_task deletion + taskId refactor + register_group narrowing are ACCUMULATED/STALE. |
| rag-system/src/ingestion.ts | Entire file is new — should be add/ not modify/ |
| whatsapp.ts | Entire file is new — should be add/ not modify/ |
| whatsapp.test.ts | Entire file is new — should be add/ not modify/ |
| src/db.test.ts | Reply test suites FORK-KEEP. LIMIT test deletion is ACCUMULATED. |
| src/db.ts | Reply columns + storeReaction etc FORK-KEEP. deleteRegisteredGroup + migration fix are ACCUMULATED. |
| src/formatting.test.ts | Reply tests FORK-KEEP. Timezone test deletion is ACCUMULATED. |
| src/index.ts | getMessageById import + quotedKey lookup FORK-KEEP. Credential-proxy deletion ACCUMULATED. |
| src/ipc.ts | quotedMessageId + sendReaction + reaction handler FORK-KEEP. Shabbat, ipc-handler-registry, recovery hunks ACCUMULATED. |
| src/router.ts | All FORK-KEEP — clean. |
| src/types.ts | All FORK-KEEP — clean. |

**Action:** Rebuild 7 files. Reclassify 3 files as add/. Keep router.ts, types.ts as-is.

### 19. akiflow-sync
**Dir:** add-akiflow-sync | **Modifies:** src/container-runner.ts, container/Dockerfile | **modify_base:** both _accumulated

| File | Unique | Accumulated |
|------|--------|-------------|
| container-runner.ts | Akiflow DB mount, AKIFLOW_DB env var, OPENAI/PERPLEXITY keys in readSecrets | All credential-proxy removal + sockets + oauth |
| Dockerfile | sqlite3, jq, akiflow CLI install | google-home CLI copy |

**Stale depends:** `auth-recovery` doesn't exist.
**Orphaned files:** rag-system/config/rag-config.json and rag-system/src/server.ts in modify/ but not in manifest.
**Unlisted add:** add/rag-system/src/akiflow-search.ts not in manifest adds.

**Action:** Rebuild both overlays. Fix stale depends. Fix manifest (add orphaned files).

## Cross-Cutting Issues

### Credential Proxy Removal
Multiple skills accumulated the removal of the credential proxy (CREDENTIAL_PROXY_PORT, startCredentialProxy, PROXY_BIND_HOST, detectAuthMode, hostGatewayArgs). No single skill owns this. After removing refresh-oauth and rebuilding overlays as pure upstream deltas, the credential proxy from upstream will remain intact — which is correct since it's the upstream architecture.

### Common Regressions
1. **`update_task` case deleted** from src/ipc.ts — present in ipc-handler-registry, self-heal, reactions, whatsapp-replies overlays
2. **`data.taskId||` dropped** from taskId generation — present in ipc-handler-registry, self-heal, reactions overlays
3. **`date→scheduled` rename** in ipc.ts — cosmetic, present in multiple overlays

### container_secrets Not Implemented
perplexity-research declares `container_secrets: [PERPLEXITY_API_KEY]` in its manifest but skills-engine/structured.ts does NOT handle `container_secrets`. The key won't actually be injected into containers. The perplexity overlay's container-runner.ts changes (which include the accumulated `readSecrets()` function) are what actually make the key available — via the `readSecrets()` function that reads from .env. When we strip the accumulated content, we need to ensure PERPLEXITY_API_KEY is still injected. Options: (a) implement container_secrets in the engine, (b) add PERPLEXITY_API_KEY to the upstream readSecrets list if we keep that pattern, or (c) rely on the credential proxy architecture.

### Stale Dependencies
1. akiflow-sync depends on `auth-recovery` — doesn't exist
2. google-home depends on `refresh-oauth` — being removed
3. shabbat-mode imports from `oauth.js` — being removed
4. perplexity-research imports AUTH_ERROR_PATTERN from `oauth.js` — being removed

### Files That Should Be add/ Not modify/
- whatsapp-replies: `whatsapp.ts`, `whatsapp.test.ts`, `rag-system/src/ingestion.ts`
- These files don't exist in upstream, so they're new files, not modifications

### modify_base Entries to Strip (Phase 3)
Total: 17 modify_base entries across all manifests (to be removed since the new engine doesn't use them).
