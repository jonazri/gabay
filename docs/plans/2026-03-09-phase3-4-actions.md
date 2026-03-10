# Phase 3-4 Action Plan (Post-Forensic)

Based on verified forensic analysis. All claims verified unless noted.

## Architectural Decision: Credential Proxy

**Keep the upstream credential proxy for Anthropic keys.** It handles API key and OAuth token injection securely. Non-Anthropic keys (PERPLEXITY_API_KEY) need fork-specific injection via `-e` Docker env var in container-runner.ts overlays.

OPENAI_API_KEY and ELEVENLABS_API_KEY are consumed host-side (in src/transcription.ts), NOT in containers. No injection needed.

## Phase 3: Structural Changes

### 3.1 Merge ipc-handler-registry + self-heal

**Files to create/modify:**
- `.claude/skills/ipc-handler-registry/manifest.yaml` — add self-heal's adds to the adds list
- `.claude/skills/ipc-handler-registry/modify/src/ipc.ts` — rebuild (see below)
- `.claude/skills/ipc-handler-registry/add/src/ipc-self-heal.ts` — move from add-self-heal
- `.claude/skills/ipc-handler-registry/add/src/ipc-self-heal.test.ts` — move from add-self-heal
- `.claude/skills/ipc-handler-registry/add/container/skills/self-heal/SKILL.md` — move from add-self-heal
- DELETE `.claude/skills/add-self-heal/` directory
- `.nanoclaw/installed-skills.yaml` — remove self-heal entry

**Rebuilt ipc.ts overlay must be: upstream base + these hunks:**
1. `import { getIpcHandler } from './ipc-handlers.js'` (ipc-handler-registry)
2. `import { writeIpcNotification, writeIpcErrorResponse } from './ipc-self-heal.js'` (self-heal)
3. `requestId?: string` in data type (self-heal)
4. Default case with try/catch + error writes (self-heal's version — supersedes ipc-handler-registry's simpler version)
5. RESTORE: `data.taskId ||` in taskId generation (regression fix)
6. RESTORE: upstream `date` variable name (not `scheduled`)
7. RESTORE: full `update_task` case from upstream (regression fix)

### 3.2 Remove refresh-oauth from installed list

**Steps:**
1. Remove `refresh-oauth` from `.nanoclaw/installed-skills.yaml`
2. Keep `.claude/skills/add-refresh-oauth/` directory (still valid for non-proxy installs)
3. Update google-home manifest: remove `refresh-oauth` from depends, remove `modify_base: src/container-runner.ts: refresh-oauth`
4. The actual overlay file changes happen in Phase 4 (rebuild overlays)

### 3.3 Strip modify_base from all manifests

Every manifest with modify_base gets it removed. Count: 17 entries across these skills:
- add-self-heal (1 — removed with skill merge)
- add-group-lifecycle (3)
- add-google-home (2)
- add-shabbat-mode (2)
- add-container-hardening (1)
- add-voice-transcription-elevenlabs (2)
- add-voice-recognition (3)
- add-perplexity-research (1)
- add-whatsapp-search (0 — already has none)
- whatsapp-replies (10)
- add-akiflow-sync (2)

### 3.4 Fix stale depends, update installed-skills.yaml

1. akiflow-sync: remove `auth-recovery` from depends
2. google-home: remove `refresh-oauth` from depends
3. installed-skills.yaml final state (18 skills, no self-heal, no refresh-oauth):
   lifecycle-hooks, whatsapp-types, whatsapp, ipc-handler-registry, reactions, group-lifecycle, google-home, shabbat-mode, container-hardening, task-scheduler-fixes, voice-transcription-elevenlabs, voice-recognition, whatsapp-search, perplexity-research, feature-request, whatsapp-summary, whatsapp-replies, akiflow-sync

## Phase 4: Overlay Rebuild

For each skill, the rebuilt overlay must be: `git show upstream/main:{path}` + ONLY that skill's fork-unique hunks.

### Skills that need NO overlay changes (pure adds or already clean):
- whatsapp-types (no overlays)
- feature-request (no overlays)
- whatsapp-summary (no overlays)

### Skills that need overlay rebuilds:

#### 1. lifecycle-hooks (src/index.ts)
Remove: credential proxy removal (hunks 1b, 2, 13b), getRegisteredGroup removal (hunk 3)
Keep: all lifecycle/cursor/events hunks, fileURLToPath + isDirectRun

#### 2. whatsapp (setup/index.ts)
Remove: stale `channels` entry
Keep: `whatsapp-auth` entry
(channels/index.ts overlay is clean — keep as-is)

#### 3. ipc-handler-registry (src/ipc.ts) — rebuilt as merged skill in Phase 3
Already described in 3.1 above.

#### 4. reactions (10 files)
All 10 overlay files need rebuilding as pure upstream deltas.
Key fixes: restore update_task, restore data.taskId||, restore isMain, restore limit params.
For files that don't exist in upstream (whatsapp.ts, whatsapp.test.ts): these are in add-whatsapp's adds, so reactions overlay layers on top of add-whatsapp's version.

#### 5. group-lifecycle (src/db.ts, src/index.ts, src/ipc.ts)
Strip all accumulated hunks. Keep only:
- db.ts: deleteRegisteredGroup + isMain migration fix
- index.ts: deleteRegisteredGroup import, ipc-handlers/group-lifecycle import, unregisterGroup fn, wire into deps
- ipc.ts: unregisterGroup in IpcDeps

#### 6. google-home (src/index.ts, src/container-runner.ts, container/Dockerfile)
Strip all accumulated content. Keep only:
- index.ts: google-assistant imports, shutdown teardown, startup calls
- container-runner.ts: responses/ mkdir, sockets mount
- Dockerfile: jq, google-home CLI copy, responses/sockets mkdirs

#### 7. shabbat-mode (src/index.ts, src/task-scheduler.ts, src/ipc.ts)
Strip all accumulated content. Drop src/task-scheduler.test.ts entirely.
Keep only:
- index.ts: shabbat imports, isShabbatOrYomTov guard, sendPostShabbatSummary, wasShabbat tracking, initShabbatSchedule, stopCandleLightingNotifier, candle lighting startup
- task-scheduler.ts: isShabbatOrYomTov import + Shabbat guard
- ipc.ts: isShabbatOrYomTov import + Shabbat guard

#### 8. container-hardening (src/container-runner.ts)
group-queue.ts is clean — keep as-is.
container-runner.ts: strip accumulated. Keep only:
- import os, plugins sync, plugins cache mount, log rotation, safeResolve + all resolve→safeResolve

#### 9. task-scheduler-fixes (src/task-scheduler.ts)
Strip upstreamed JSDoc/comment hunks. Keep only:
- @g.us guard + scheduleClose removal
- Pre-advance next_run block + comments

#### 10. voice-transcription-elevenlabs (whatsapp.ts)
Strip cosmetic trailing commas. Keep functional hunks.
whatsapp.test.ts is clean — keep as-is.

#### 11. voice-recognition (src/config.ts)
Rebuild to only add OWNER_NAME. Keep everything else as-is.
(transcription.ts overlay is substantive — keep it)

#### 12. whatsapp-search (src/container-runner.ts)
Rebuild to just: `args.push('--add-host', 'host.docker.internal:host-gateway')`
(Actually this line is redundant if upstream's hostGatewayArgs() is retained. Check at build time.)

#### 13. perplexity-research (src/container-runner.ts)
Drop the overlay entirely — zero perplexity-specific code in it.
For PERPLEXITY_API_KEY injection: add a minimal overlay that passes it as `-e` Docker env var.
Or: verify if the host-side credential proxy approach can be extended.

#### 14. whatsapp-replies (7 files need rebuild, 3 need reclassification, 2 are clean)
Rebuild: ipc-mcp-stdio.ts, db.test.ts, db.ts, formatting.test.ts, index.ts, ipc.ts
Reclassify to add/: whatsapp.ts, whatsapp.test.ts, rag-system/src/ingestion.ts
Keep as-is: router.ts, types.ts

#### 15. akiflow-sync (src/container-runner.ts, container/Dockerfile)
Rebuild both as pure deltas. Fix manifest (add orphaned files).
container-runner.ts: keep only Akiflow DB mount + AKIFLOW_DB env var
Dockerfile: keep only sqlite3, jq, akiflow CLI install

## Pre-Applied Overlay State (from self-review)

The baseline commit (`f567f81`) captured some files with skill overlays already applied:
- `container/agent-runner/src/ipc-mcp-stdio.ts` — has reactions+whatsapp-replies overlays pre-applied, diverges from upstream by 403 lines. Phase 4 must reset this to upstream and let overlays re-apply.
- `container/Dockerfile` — has google-home/akiflow additions baked in. Should be reset to upstream and let skill overlays handle additions.
- `.env.example` — has fork-specific entries. Low priority, leave as-is.

## add-compact Skill (from upstream, not installed)

Upstream's merge brought in `.claude/skills/add-compact/` which modifies `src/index.ts` and `container/agent-runner/src/index.ts` (both hot files). It is NOT in `installed-skills.yaml` so it was correctly excluded from forensic analysis. If installed later, its overlays may conflict with rebuilt overlays for Group A (src/index.ts). No action needed now — just awareness.

## Hot File Rebuild Order

Skills must be rebuilt in groups based on shared files, applying sequentially within each group:

### Group A — src/index.ts (6 skills):
1. lifecycle-hooks
2. reactions
3. group-lifecycle
4. google-home
5. shabbat-mode
6. whatsapp-replies

### Group B — src/ipc.ts (5 skills):
1. ipc-handler-registry (merged)
2. reactions
3. group-lifecycle
4. shabbat-mode
5. whatsapp-replies

### Group C — src/container-runner.ts (5 skills):
1. google-home
2. container-hardening
3. whatsapp-search
4. perplexity-research
5. akiflow-sync

### Group D — src/channels/whatsapp.ts (4 skills):
1. reactions
2. voice-transcription-elevenlabs
3. voice-recognition
4. whatsapp-replies

### Group E — remaining files (independent):
- src/db.ts: reactions → group-lifecycle → whatsapp-replies
- src/types.ts: reactions → whatsapp-replies
- src/task-scheduler.ts: task-scheduler-fixes → shabbat-mode
- container/Dockerfile: google-home → akiflow-sync
- container/agent-runner/src/ipc-mcp-stdio.ts: reactions → whatsapp-replies
- src/group-queue.ts: container-hardening
- src/router.ts: whatsapp-replies
- src/config.ts: voice-recognition
- src/formatting.test.ts: whatsapp-replies
- src/db.test.ts: reactions → whatsapp-replies
- src/task-scheduler.test.ts: (shabbat drops it, task-scheduler-fixes doesn't touch it)
- Test files for whatsapp: reactions → voice-transcription-elevenlabs → voice-recognition → whatsapp-replies
