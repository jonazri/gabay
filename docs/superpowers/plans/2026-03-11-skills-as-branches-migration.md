# Skills-as-Branches Migration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate from patch-queue overlay model to upstream's skills-as-branches architecture, converting 18 installed skills into 17 git branches.

**Architecture:** Each skill becomes a git branch (`skill/<name>`) branched from main or a parent skill. Composition is via standard `git merge`. The old overlay engine (skills-engine/, `.nanoclaw/`, manifests) is removed after all branches are created and merged.

**Tech Stack:** Git (branching, merging), Node.js/TypeScript, npm

**Spec:** `docs/superpowers/specs/2026-03-11-skills-as-branches-migration-design.md`

**Backup tag:** `pre-update-75032fd-20260311-103448` (rollback point for all phases)

---

## Task Dependency Graph & Parallelization

```
Tasks 1→2→3→4  (sequential — foundation, must complete before any skill branches)
         │
         ▼
   ┌─────────────────────────────────────────────────┐
   │  Task 5: Tier 1 branches (9 skills, parallel)   │
   │  lifecycle-hooks, whatsapp, ipc-handler-registry,│
   │  container-hardening, task-scheduler-fixes,      │
   │  whatsapp-search, perplexity-research,           │
   │  feature-request, whatsapp-summary               │
   └──────┬──────────────────────────┬────────────────┘
          │                          │
          ▼                          ▼
   Task 6: Tier 2 (4 skills)   Task 7: Tier 3 (2 skills)
   group-lifecycle              reactions
   google-home                  whatsapp-replies
   shabbat-mode                 ┌──────┐
   akiflow-sync                 │      ▼
          │                     │ Task 8: Tier 4 (1 skill)
          │                     │ voice-transcription-elevenlabs
          │                     │      │
          │                     │      ▼
          │                     │ Task 9: Tier 5 (1 skill)
          │                     │ voice-recognition
          │                     └──────┘
          ▼                          │
   ┌─────────────────────────────────┘
   ▼
Tasks 10→11→12→13→14→15  (sequential — validate, compose, cleanup)
```

**Key insight:** Tasks 6 and 7 can run in parallel (Tier 3 depends on Tier 1, not Tier 2). Tasks 8-9 are sequential and depend only on Task 7.

### Parallelization Strategy (5 agents)

With 5 available agents, distribute work as follows:

**Phase A — Foundation (sequential, 1 agent):**
Tasks 1-4 run on the main orchestrator. No parallelism needed.

**Phase B — Skill Branch Creation (5 agents):**

Tier 1 has 9 skills. With 5 agents, dispatch in two waves:

| Agent | Wave 1 (from Task 5) | Wave 2 (from Task 5) | Wave 3 (Tasks 6-9) |
|-------|----------------------|----------------------|---------------------|
| A | lifecycle-hooks | — | group-lifecycle (after lifecycle-hooks) |
| B | whatsapp | — | reactions → voice-trans → voice-recog (serial chain) |
| C | ipc-handler-registry | whatsapp-summary | google-home (after lifecycle-hooks + ipc) |
| D | container-hardening | feature-request | akiflow-sync (after container-hardening) |
| E | whatsapp-search | perplexity-research | shabbat-mode (after lifecycle-hooks) + whatsapp-replies (after whatsapp + whatsapp-search) |

**Wave 1:** 5 agents dispatch the 5 most complex Tier 1 skills (lifecycle-hooks, whatsapp, ipc-handler-registry, container-hardening, whatsapp-search).

**Wave 2:** As agents finish Wave 1, they pick up remaining Tier 1 skills (task-scheduler-fixes, perplexity-research, feature-request, whatsapp-summary). These are simpler and should complete fast.

**Wave 3:** As agents finish Wave 2, they start Tier 2-5 skills based on which prerequisites they already built:
- Agent A built lifecycle-hooks → picks up group-lifecycle
- Agent B built whatsapp → picks up reactions → voice-transcription-elevenlabs → voice-recognition (serial chain, all depend on prior)
- Agent C built ipc-handler-registry → picks up google-home (after lifecycle-hooks is also done)
- Agent D built container-hardening → picks up akiflow-sync
- Agent E built whatsapp-search → picks up whatsapp-replies (after whatsapp is also done) and shabbat-mode (after lifecycle-hooks is done)

**Constraints for Wave 3:**
- group-lifecycle and google-home need BOTH lifecycle-hooks AND ipc-handler-registry pushed
- whatsapp-replies needs BOTH whatsapp AND whatsapp-search pushed
- reactions needs whatsapp pushed
- shabbat-mode needs lifecycle-hooks pushed
- akiflow-sync needs container-hardening pushed
- voice-transcription-elevenlabs needs reactions pushed
- voice-recognition needs voice-transcription-elevenlabs pushed

**Phase C — Validation & Cleanup (sequential, 1 agent):**
Tasks 10-15 run on the main orchestrator after all skill branches are pushed. Task 10 (per-branch validation) can optionally fan out to 5 agents, each validating ~3-4 branches.

---

## Chunk 1: Foundation (Phase 1-2)

### Task 1: Verify Prerequisites & Capture Skill Metadata

**Files:**
- Create: `docs/migration/skill-inventory.json`
- Read: `.nanoclaw/installed-skills.yaml`
- Read: `.claude/skills/*/manifest.yaml` (18 manifests)

- [ ] **Step 1: Verify backup tag exists**

```bash
git tag -l 'pre-update-*'
```

Expected: `pre-update-75032fd-20260311-103448` in output.

- [ ] **Step 2: Verify upstream remote**

```bash
git remote -v | grep upstream
```

Expected: `upstream https://github.com/qwibitai/nanoclaw.git`

If missing: `git remote add upstream https://github.com/qwibitai/nanoclaw.git && git fetch upstream --prune`

- [ ] **Step 3: Generate skill inventory JSON**

Read each manifest and produce a single JSON file at `docs/migration/skill-inventory.json`. This file is the source of truth for all Phase 3 agents.

```json
{
  "skills": [
    {
      "name": "lifecycle-hooks",
      "skill_dir": "add-lifecycle-hooks",
      "adds": ["src/lifecycle.ts", "src/lifecycle.test.ts", "src/cursor-manager.ts", "src/cursor-manager.test.ts", "src/message-events.ts", "src/message-events.test.ts"],
      "modifies": ["src/index.ts"],
      "npm_dependencies": {},
      "env_vars": [],
      "depends": [],
      "test": "npx vitest run src/lifecycle.test.ts src/cursor-manager.test.ts src/message-events.test.ts",
      "tier": 1,
      "branch_from": "main",
      "merge_parents": []
    }
  ]
}
```

Include all 18 skills with the following tier/branch assignments:

| Skill | Tier | Branch From | Merge Parents | Adds | Modifies | NPM Deps | Env Vars |
|-------|------|-------------|---------------|------|----------|----------|----------|
| lifecycle-hooks | 1 | main | — | `src/lifecycle.ts`, `src/lifecycle.test.ts`, `src/cursor-manager.ts`, `src/cursor-manager.test.ts`, `src/message-events.ts`, `src/message-events.test.ts` | `src/index.ts` | — | — |
| whatsapp-types | — | (folded into whatsapp) | — | `src/qrcode-terminal.d.ts` | — | `@whiskeysockets/baileys`, `qrcode-terminal` | — |
| whatsapp | 1 | main | — | `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`, `src/whatsapp-auth.ts`, `setup/whatsapp-auth.ts`, `src/qrcode-terminal.d.ts` (from whatsapp-types) | `src/channels/index.ts`, `setup/index.ts` | `@whiskeysockets/baileys`, `qrcode`, `qrcode-terminal`, `@types/qrcode-terminal` | `ASSISTANT_HAS_OWN_NUMBER` |
| ipc-handler-registry | 1 | main | — | `src/ipc-handlers.ts`, `src/ipc-handlers.test.ts`, `src/ipc-self-heal.ts`, `src/ipc-self-heal.test.ts`, `container/skills/self-heal/SKILL.md` | `src/ipc.ts` | — | — |
| container-hardening | 1 | main | — | — | `src/group-queue.ts`, `src/container-runner.ts`, `container/Dockerfile` | — | — |
| task-scheduler-fixes | 1 | main | — | — | `src/task-scheduler.ts` | — | — |
| whatsapp-search | 1 | main | — | `rag-system/` (12+ files), `container/skills/whatsapp-search/SKILL.md` | `src/container-runner.ts` | — | — |
| perplexity-research | 1 | main | — | `container/skills/perplexity-research/SKILL.md`, `container/skills/perplexity-research/perplexity` | `src/container-runner.ts`, `container/Dockerfile` | — | `PERPLEXITY_API_KEY` |
| feature-request | 1 | main | — | `container/skills/feature-request/SKILL.md` | — | — | — |
| whatsapp-summary | 1 | main | — | `container/skills/whatsapp-summary/SKILL.md` | — | — | — |
| group-lifecycle | 2 | skill/lifecycle-hooks | skill/ipc-handler-registry | `src/ipc-handlers/group-lifecycle.ts` | `src/db.ts`, `src/index.ts`, `src/ipc.ts` | — | — |
| google-home | 2 | skill/lifecycle-hooks | skill/ipc-handler-registry | `src/google-assistant.ts`, `src/ipc-handlers/google-home.ts`, `scripts/google-assistant-daemon.py`, `scripts/google-assistant-setup.py`, `container/skills/google-home/SKILL.md`, `container/skills/google-home/google-home`, `container/.dockerignore` | `src/index.ts`, `src/container-runner.ts`, `container/Dockerfile` | — | — |
| shabbat-mode | 2 | skill/lifecycle-hooks | — | `src/shabbat.ts`, `src/shabbat.test.ts`, `scripts/generate-zmanim.ts` | `src/index.ts`, `src/task-scheduler.ts`, `src/ipc.ts` | `@hebcal/core` | — |
| akiflow-sync | 2 | skill/container-hardening | — | `container/skills/akiflow/SKILL.md`, `container/skills/akiflow/akiflow-functions.sh`, `container/skills/akiflow/akiflow` | `src/container-runner.ts`, `container/Dockerfile` | — | `AKIFLOW_REFRESH_TOKEN`, `AKIFLOW_DB_PATH` |
| reactions | 3 | skill/whatsapp | — | `scripts/migrate-reactions.ts`, `container/skills/reactions/SKILL.md`, `src/status-tracker.ts`, `src/status-tracker.test.ts` | `src/db.ts`, `src/db.test.ts`, `src/channels/whatsapp.ts`, `src/types.ts`, `src/ipc.ts`, `src/index.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`, `src/channels/whatsapp.test.ts`, `src/group-queue.test.ts`, `src/ipc-auth.test.ts` | — | — |
| whatsapp-replies | 3 | skill/whatsapp | skill/whatsapp-search | `container/skills/whatsapp-replies/SKILL.md` | `container/agent-runner/src/ipc-mcp-stdio.ts`, `rag-system/src/ingestion.ts`, `src/channels/whatsapp.test.ts`, `src/channels/whatsapp.ts`, `src/db.test.ts`, `src/db.ts`, `src/formatting.test.ts`, `src/index.ts`, `src/ipc.ts`, `src/router.ts`, `src/types.ts` | — | — |
| voice-transcription-elevenlabs | 4 | skill/reactions | — | `src/transcription.ts` | `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts` | `@elevenlabs/elevenlabs-js` | `ELEVENLABS_API_KEY` |
| voice-recognition | 5 | skill/voice-transcription-elevenlabs | — | `src/voice-recognition.ts`, `scripts/voice-recognition-service.py`, `scripts/enroll-voice.ts` | `src/config.ts`, `src/transcription.ts` | — | — |

**Note:** whatsapp-types is NOT a separate branch — its content (the `src/qrcode-terminal.d.ts` file and npm deps `@whiskeysockets/baileys`, `qrcode-terminal`) is included in the whatsapp branch.

**Note:** akiflow-sync also has a top-level `akiflow-sync/` directory (with its own `package.json`) that is NOT listed in its manifest but belongs to the skill. Include it in the skill branch.

**`skill_dir` mapping:** Most skills use `add-<name>` as their directory under `.claude/skills/`. Exceptions:
- `ipc-handler-registry` → `.claude/skills/ipc-handler-registry/`
- `whatsapp-replies` → `.claude/skills/whatsapp-replies/`
- `whatsapp` → `.claude/skills/add-whatsapp/` (plus files from `.claude/skills/add-whatsapp-types/` for the folded whatsapp-types content)

- [ ] **Step 4: Commit the inventory**

```bash
git add docs/migration/skill-inventory.json
git commit -m "docs: capture skill inventory for migration"
```

### Task 2: Archive Fully-Applied State

**Purpose:** Create a reference snapshot of the fully-applied codebase. This is used in Phase 4 to verify the composed result is behaviorally equivalent.

- [ ] **Step 1: Apply all skills**

```bash
npm run apply-skills
```

- [ ] **Step 2: Archive the applied state on a temporary branch**

`git stash push` does not capture untracked files (skill-added files like `src/lifecycle.ts`, `src/channels/whatsapp.ts`, etc.). Use a temporary branch instead:

```bash
git checkout -b temp/fully-applied-archive
git add -A
git commit -m "archive: fully-applied state (all 18 skills)"
ARCHIVE_REF=$(git rev-parse HEAD)
echo "Archive ref: $ARCHIVE_REF"
git checkout main
```

Retrieve later with `git diff main..$ARCHIVE_REF` or `git show $ARCHIVE_REF -- <file>`.

- [ ] **Step 3: Clean skills**

```bash
npm run clean-skills -- --force
```

- [ ] **Step 4: Verify clean state**

```bash
git status --porcelain
```

Expected: clean working tree (no changes).

### Task 3: Merge upstream/main

**Files:**
- Modify: many (upstream changes ~150+ files)
- Resolve: `package.json`, `setup/register.ts`, `repo-tokens/badge.svg`, and ~45 modify/delete conflicts

- [ ] **Step 1: Fetch upstream**

```bash
git fetch upstream --prune
```

- [ ] **Step 2: Dry-run merge to preview conflicts**

```bash
git merge --no-commit --no-ff upstream/main
git diff --name-only --diff-filter=U
git merge --abort
```

Record the list of conflicted files.

- [ ] **Step 3: Merge upstream/main**

```bash
git merge upstream/main --no-edit
```

**Expected:** Exits non-zero due to conflicts. This is normal — proceed to Step 4 to resolve them.

- [ ] **Step 4: Resolve conflicts by category**

For each conflicted file, resolve per the spec's conflict resolution table:

| Pattern | Action |
|---------|--------|
| `.claude/skills/*/modify/`, `add/`, `tests/`, `manifest.yaml` | `git rm <file>` (accept upstream deletion — these are modify/delete conflicts) |
| `skills-engine/*` | `git rm <file>` (accept upstream deletion) |
| `scripts/apply-skill.ts`, `scripts/uninstall-skill.ts` | `git rm <file>` (accept upstream deletion) |
| `.github/workflows/skill-drift.yml`, `skill-pr.yml` | `git rm <file>` (accept upstream deletion) |
| `.claude/skills/add-compact/SKILL.md`, `add-reactions/SKILL.md` | `git checkout --theirs <file>` (take upstream version) |
| `package.json` | Manual merge: keep upstream scripts, strip skill-specific deps |
| `package-lock.json` | Delete, regenerate via `npm install` after package.json resolved |
| `setup/register.ts` | Manual merge: adopt upstream's refactored structure |
| `repo-tokens/badge.svg` | `git checkout --theirs <file>` (take upstream version) |

**Note:** For modify/delete conflicts (first 4 rows), `git checkout --theirs` will fail because the file doesn't exist on upstream's side. Use `git rm` instead.

After resolving all conflicts (including deleting and regenerating `package-lock.json` via `npm install`):

```bash
npm install  # regenerates package-lock.json
git add -A
git commit --no-edit  # completes the merge commit
```

**Note:** This single `git commit --no-edit` finalizes the interrupted merge. Do NOT create additional commits — the merge commit message is auto-generated by git.

### Task 4: Post-Merge Validation

- [ ] **Step 1: Verify main builds**

```bash
npm run build
```

Expected: TypeScript compilation succeeds (exit 0). Note: if upstream removed the overlay engine but the `build` script still references `apply-skills`, temporarily change the `build` script to just `tsc` for this validation step.

- [ ] **Step 2: Run tests**

```bash
npm test
```

Expected: all tests pass. Some skill-specific tests may fail if their overlay files were deleted — that's expected and acceptable at this stage.

- [ ] **Step 3: Commit any fixes**

If build or tests required fixes, commit them:

```bash
git add -A && git commit -m "fix: post-merge build/test fixes"
```

---

## Chunk 2: Skill Branch Creation (Phase 3)

### Skill Branch Creation Template

Every skill branch follows this procedure. Phase 3 tasks dispatch subagents, one per skill, each following this template with skill-specific parameters from the inventory table in Task 1.

**Inputs for each skill:**
- `SKILL_NAME`: the skill name (e.g., `lifecycle-hooks`)
- `SKILL_DIR`: the `.claude/skills/` directory name (defaults to `add-$SKILL_NAME`; exceptions: `ipc-handler-registry`, `whatsapp-replies` use the skill name without the `add-` prefix)
- `BRANCH_FROM`: parent branch (e.g., `main` or `skill/whatsapp`)
- `MERGE_PARENTS`: secondary parents to merge before adding changes (e.g., `skill/ipc-handler-registry`)
- `ADDS`: files from backup tag's `add/` directory
- `MODIFIES`: files from backup tag's `modify/` directory
- `NPM_DEPS`: npm dependencies to add to package.json
- `ENV_VARS`: environment variables
- `DEPENDS`: skill dependencies (for SKILL.md prerequisites)
- `TEST_CMD`: test command from manifest (run this instead of `npm test` for faster validation)
- `EXTRA_DIRS`: directories not in manifest but belonging to the skill (e.g., `akiflow-sync/`)

**Procedure:**

```
1. Create branch:
   git checkout -b skill/$SKILL_NAME $BRANCH_FROM

2. If MERGE_PARENTS is non-empty:
   for parent in $MERGE_PARENTS; do
     git merge $parent --no-edit
   done

3. For each file in ADDS:
   - Read from backup tag: git show pre-update-75032fd-20260311-103448:.claude/skills/$SKILL_DIR/add/$FILE
   - Copy to the same path in the working tree
   - git add $FILE

4. For each file in MODIFIES:
   - Read the modify/ overlay from backup tag:
     git show pre-update-75032fd-20260311-103448:.claude/skills/$SKILL_DIR/modify/$FILE
   - Read the current version of the target file in the working tree
   - Check for an intent companion file:
     git show pre-update-75032fd-20260311-103448:.claude/skills/$SKILL_DIR/modify/$FILE.intent.md
   - If it exists, use it as the authoritative description of the overlay's intent
   - Otherwise, understand the INTENT from the overlay diff (what the skill adds/changes)
   - Apply equivalent changes to the current upstream version
   - git add $FILE

5. If NPM_DEPS is non-empty:
   - Edit package.json to add dependencies
   - Run: npm install
   - git add package.json package-lock.json

6. If EXTRA_DIRS is non-empty:
   - Copy from backup tag: git checkout pre-update-75032fd-20260311-103448 -- $DIR
   - git add $DIR

7. Create SKILL.md at repo root (NOT in .claude/skills/):
   # <Skill Name>
   <description from manifest>
   ## Prerequisites
   - <each item in DEPENDS>
   ## Installation
   1. `git fetch origin skill/<name>`
   2. `git merge origin/skill/<name>`
   3. `npm install`
   ## Verification
   - `npm run build && npm test`
   ## Environment Variables
   - <each item in ENV_VARS>

8. Create skill-metadata.json at repo root:
   {
     "name": "$SKILL_NAME",
     "description": "<from manifest>",
     "version": "1.0.0",
     "author": "jonazri",
     "depends": $DEPENDS,
     "env": $ENV_VARS,
     "tags": [<derived from skill's domain>]
   }

9. Run: npm install && npx tsc && $TEST_CMD
   - Use `npx tsc` directly — do NOT use `npm run build` (it still triggers the overlay engine at this stage)
   - Use the skill's specific $TEST_CMD instead of `npm test` for faster validation
   - Fix any build/test failures caused by upstream API changes

10. Commit and push:
    git add -A
    git commit -m "feat: create skill/$SKILL_NAME branch"
    git push -u origin skill/$SKILL_NAME
```

**Critical notes for modify/ overlay translation:**
- The modify/ files are **delta overlays**, not full files. They contain the three-way merge input (the "overlay" side).
- The review agent must understand the INTENT of each overlay: what code was added, what was changed, what was removed.
- Apply the intent to the NEW upstream version of the file, not the old one. Upstream may have refactored, renamed functions, or changed signatures.
- If the overlay's intent is now REDUNDANT (upstream added the same feature), skip it and document why.
- If the overlay CONFLICTS fundamentally with upstream, flag for human decision.
- Some manifests have a `modify_base` field. Ignore it in the branch model — apply only this skill's unique changes to the current branch state (which already includes parent changes via branching/merging).

### Task 5: Create Tier 1 Skill Branches (9 parallel agents)

Dispatch 9 subagents in parallel, one per Tier 1 skill. Each follows the template above.

**Within Tier 1, process in installed-skills.yaml order:** lifecycle-hooks, whatsapp, ipc-handler-registry, container-hardening, task-scheduler-fixes, whatsapp-search, perplexity-research, feature-request, whatsapp-summary.

Since Tier 1 skills all branch from main and are independent, they can run in parallel without conflicts.

- [ ] **Step 1: Dispatch 9 parallel agents**

Each agent receives:
- The skill branch creation template (above)
- The skill's row from the inventory table (Task 1)
- Access to the backup tag for reading overlay files

Skills to dispatch:

1. **lifecycle-hooks** — Branch from main. Adds 6 files (lifecycle, cursor-manager, message-events + tests). Modifies `src/index.ts`.
2. **whatsapp** — Branch from main. Adds 5 files (whatsapp channel + auth + `qrcode-terminal.d.ts` from whatsapp-types). Modifies `src/channels/index.ts`, `setup/index.ts`. NPM deps: baileys, qrcode, qrcode-terminal, @types/qrcode-terminal.
3. **ipc-handler-registry** — Branch from main. Adds 5 files (ipc-handlers, self-heal + tests + container skill). Modifies `src/ipc.ts`.
4. **container-hardening** — Branch from main. No adds. Modifies `src/group-queue.ts`, `src/container-runner.ts`, `container/Dockerfile`.
5. **task-scheduler-fixes** — Branch from main. No adds. Modifies `src/task-scheduler.ts`.
6. **whatsapp-search** — Branch from main. Adds entire `rag-system/` directory (12+ files) + container skill. Modifies `src/container-runner.ts`.
7. **perplexity-research** — Branch from main. Adds container skill + perplexity script. Modifies `src/container-runner.ts`, `container/Dockerfile`. Env: `PERPLEXITY_API_KEY`.
8. **feature-request** — Branch from main. Adds `container/skills/feature-request/SKILL.md` only. No modifies.
9. **whatsapp-summary** — Branch from main. Adds `container/skills/whatsapp-summary/SKILL.md` only. No modifies.

- [ ] **Step 2: Verify all 9 branches pushed**

```bash
git branch -r | grep 'origin/skill/' | sort
```

Expected: 9 branches listed.

- [ ] **Step 3: Commit progress**

No commit needed on main — all work is on skill branches.

### Task 6: Create Tier 2 Skill Branches (4 parallel agents)

**Prerequisite:** All Tier 1 branches must be pushed.

Dispatch 4 subagents in parallel:

- [ ] **Step 1: Dispatch 4 parallel agents**

1. **group-lifecycle** — Branch from `skill/lifecycle-hooks`. Merge `skill/ipc-handler-registry` before adding changes. Adds `src/ipc-handlers/group-lifecycle.ts`. Modifies `src/db.ts`, `src/index.ts`, `src/ipc.ts`.
2. **google-home** — Branch from `skill/lifecycle-hooks`. Merge `skill/ipc-handler-registry` before adding changes. Adds 7 files (google-assistant + IPC handler + Python scripts + container skill). Modifies `src/index.ts`, `src/container-runner.ts`, `container/Dockerfile`.
3. **shabbat-mode** — Branch from `skill/lifecycle-hooks`. Adds `src/shabbat.ts`, `src/shabbat.test.ts`, `scripts/generate-zmanim.ts`. Modifies `src/index.ts`, `src/task-scheduler.ts`, `src/ipc.ts`. NPM dep: `@hebcal/core`.
4. **akiflow-sync** — Branch from `skill/container-hardening`. Adds container skill files. Modifies `src/container-runner.ts`, `container/Dockerfile`. Env: `AKIFLOW_REFRESH_TOKEN`, `AKIFLOW_DB_PATH`. **Extra:** include top-level `akiflow-sync/` directory from backup tag.

- [ ] **Step 2: Verify all 4 branches pushed**

```bash
git branch -r | grep 'origin/skill/' | wc -l
```

Expected: 13 branches.

### Task 7: Create Tier 3 Skill Branches (2 parallel agents)

**Prerequisite:** All Tier 1 branches must be pushed (reactions depends on `skill/whatsapp`, whatsapp-replies depends on `skill/whatsapp` + `skill/whatsapp-search` — all Tier 1). Tier 3 has no Tier 2 dependencies, so it can start as soon as Tier 1 completes.

- [ ] **Step 1: Dispatch 2 parallel agents**

1. **reactions** — Branch from `skill/whatsapp`. Adds 4 files (migrate-reactions script, container skill, status-tracker + test). Modifies 10 files (`src/db.ts`, `src/channels/whatsapp.ts`, `src/types.ts`, `src/ipc.ts`, `src/index.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`, and 4 test files).
2. **whatsapp-replies** — Branch from `skill/whatsapp`. Merge `skill/whatsapp-search` before adding changes. Adds container skill. Modifies 11 files (`src/channels/whatsapp.ts`, `src/db.ts`, `src/index.ts`, `src/ipc.ts`, `src/router.ts`, `src/types.ts`, `rag-system/src/ingestion.ts`, `container/agent-runner/src/ipc-mcp-stdio.ts`, and 3 test files).

- [ ] **Step 2: Verify branches**

Expected: 15 branches total.

### Task 8: Create Tier 4 Skill Branch

**Prerequisite:** `skill/reactions` pushed.

- [ ] **Step 1: Create voice-transcription-elevenlabs branch**

Branch from `skill/reactions`. Adds `src/transcription.ts`. Modifies `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`. NPM dep: `@elevenlabs/elevenlabs-js`. Env: `ELEVENLABS_API_KEY`.

- [ ] **Step 2: Verify branch pushed**

Expected: 16 branches total.

### Task 9: Create Tier 5 Skill Branch

**Prerequisite:** `skill/voice-transcription-elevenlabs` pushed.

- [ ] **Step 1: Create voice-recognition branch**

Branch from `skill/voice-transcription-elevenlabs`. Adds `src/voice-recognition.ts`, `scripts/voice-recognition-service.py`, `scripts/enroll-voice.ts`. Modifies `src/config.ts`, `src/transcription.ts`.

- [ ] **Step 2: Verify all 17 branches pushed**

```bash
git branch -r | grep 'origin/skill/' | wc -l
```

Expected: 17.

---

## Chunk 3: Validation, Composition & Cleanup (Phase 3.5-5)

### Task 10: Per-Branch Validation

**Purpose:** Validate each skill branch builds and passes tests independently, before composing.

- [ ] **Step 1: Run validation loop**

```bash
failures=()
while read -r branch; do
  git checkout "$branch"
  npm install && npx tsc && npm test || failures+=("$branch")
done < <(git branch --format='%(refname:short)' --list 'skill/*')
if [ ${#failures[@]} -gt 0 ]; then
  echo "FAILED branches: ${failures[*]}"
  exit 1
fi
```

**Note:** Uses process substitution (`< <(...)`) instead of a pipe so that `failures+=()` runs in the current shell, not a subshell.

- [ ] **Step 2: Fix any failures**

For each failed branch, check out the branch, diagnose, fix, commit, and push. Re-run validation for that branch.

- [ ] **Step 3: Return to main**

```bash
git checkout main
```

### Task 11: Compose by Merging Skill Branches

**Purpose:** Merge all 17 skill branches into main in dependency order.

- [ ] **Step 1: Merge Tier 1 branches (in installed-skills.yaml order)**

```bash
for branch in skill/lifecycle-hooks skill/whatsapp skill/ipc-handler-registry \
              skill/container-hardening skill/task-scheduler-fixes skill/whatsapp-search \
              skill/perplexity-research skill/feature-request skill/whatsapp-summary; do
  git merge "$branch" --no-edit
  npm install  # ensure deps from merged skill are installed before next merge
done
```

Resolve any merge conflicts interactively. Non-overlapping changes auto-merge.

- [ ] **Step 2: Merge Tier 2 branches**

```bash
for branch in skill/group-lifecycle skill/google-home skill/shabbat-mode skill/akiflow-sync; do
  git merge "$branch" --no-edit
  npm install
done
```

- [ ] **Step 3: Merge Tier 3 branches**

```bash
for branch in skill/reactions skill/whatsapp-replies; do
  git merge "$branch" --no-edit
  npm install
done
```

- [ ] **Step 4: Merge Tier 4-5 branches**

```bash
for branch in skill/voice-transcription-elevenlabs skill/voice-recognition; do
  git merge "$branch" --no-edit
  npm install
done
```

- [ ] **Step 5: Compare against Phase 1 archive**

```bash
# Compare current composed state against the Phase 1 archive
# (ARCHIVE_REF was captured in Task 2 Step 2 — it's the temp/fully-applied-archive branch)
ARCHIVE_REF=$(git rev-parse temp/fully-applied-archive)
git diff HEAD..$ARCHIVE_REF -- src/ container/ setup/ scripts/ package.json
```

**What to look for in the diff:**
- **Expected differences:** upstream refactors, renamed functions, new upstream features — these are fine
- **Unexpected omissions:** skill functionality that's missing from the composed result — these need fixing
- **Key files to spot-check:** `src/index.ts` (all skill integrations present), `src/ipc.ts` (all IPC handlers registered), `container/Dockerfile` (all skill mounts), `package.json` (all skill deps)

- [ ] **Step 6: Build and test**

```bash
npm install && npm run build && npm test
```

Expected: all pass. Fix any issues and commit.

### Task 12: Cleanup Old Infrastructure

**Files:**
- Delete: `.nanoclaw/installed-skills.yaml`, `skills-engine/`, scripts, overlay artifacts
- Modify: `package.json` (scripts section)

- [ ] **Step 1: Delete .nanoclaw/installed-skills.yaml from git**

```bash
git rm .nanoclaw/installed-skills.yaml
rm -rf .nanoclaw/base .nanoclaw/state.yaml .nanoclaw/backup .nanoclaw/lock
```

- [ ] **Step 2: Delete skills-engine/ if still present**

```bash
git rm -rf skills-engine/ 2>/dev/null || echo "Already removed by upstream merge"
```

- [ ] **Step 3: Delete overlay artifacts from .claude/skills/**

For each skill directory, remove overlay-specific files (`add/`, `modify/`, `tests/`, `manifest.yaml`) but keep non-overlay assets.

```bash
# Installed skills — remove overlay artifacts
for skill_dir in .claude/skills/add-*/; do
  rm -rf "$skill_dir/add" "$skill_dir/modify" "$skill_dir/tests"
  rm -f "$skill_dir/manifest.yaml"
done

# Also handle non-add-prefixed skill dirs that have overlay artifacts
for skill_dir in .claude/skills/ipc-handler-registry .claude/skills/whatsapp-replies \
                 .claude/skills/convert-to-apple-container .claude/skills/use-local-whisper; do
  [ -d "$skill_dir" ] && {
    rm -rf "$skill_dir/add" "$skill_dir/modify" "$skill_dir/tests"
    rm -f "$skill_dir/manifest.yaml"
  }
done

git add -A
```

**Preserve:** Any `.claude/skills/` directories that contain non-overlay assets (like `x-integration/` with `agent.ts`, `host.ts`, `lib/`, `scripts/`). These are operational skills, not overlays.

- [ ] **Step 4: Delete fork-specific scripts**

```bash
git rm scripts/apply-skills.ts scripts/clean-skills.ts scripts/package-skill.ts 2>/dev/null
```

Note: `scripts/apply-skill.ts` (singular) and `scripts/uninstall-skill.ts` were already removed by the upstream merge.

- [ ] **Step 5: Update package.json scripts**

Remove old scripts and update build/dev:

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsx watch src/index.ts",
    "build:container": "./container/build.sh"
  }
}
```

Remove these keys entirely: `apply-skills`, `clean-skills`, `package-skill`, `build:quick`.

```bash
npm install  # regenerate lock file
git add package.json package-lock.json
```

- [ ] **Step 6: Build and test after cleanup**

```bash
npm run build && npm test
```

Expected: passes. The build is now just `tsc` — no overlay engine involved.

- [ ] **Step 7: Commit cleanup**

```bash
git add -A
git commit -m "chore: remove old overlay infrastructure (skills-engine, manifests, scripts)"
```

### Task 13: Update Documentation

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Update CLAUDE.md Build Model section**

Replace the "Build Model (Patch Queue)" section with:

```markdown
## Build Model (Skills as Branches)

This fork uses **skills as branches**. Each skill is a git branch (`skill/<name>`) that modifies `src/` directly. Skills are installed via `git merge` and composed via standard git operations.

```bash
npm run build          # Compile TypeScript (tsc)
npm run dev            # Watch mode (tsx watch src/index.ts)
npm test               # Run tests
./container/build.sh   # Rebuild agent container
```

### Development workflow

1. **Always work in a git worktree** to avoid breaking the live service:
   ```bash
   git worktree add ../gabay-feature feat/my-feature
   cd ../gabay-feature
   npm run dev
   ```
2. Edit src/ freely — changes are direct, no overlay system
3. When ready, commit and push

### Upstream merges

```bash
git fetch upstream && git merge upstream/main   # merge upstream
# Merge-forward CI automatically updates skill branches
npm install && npm run build && npm test         # verify
```

### Skill branches

Each skill lives on its own branch (`skill/<name>`). To install a skill:
```bash
git merge skill/<name>
npm install
```

To update all skill branches after an upstream merge:
```bash
# merge-forward CI handles this automatically
# or manually: git checkout skill/<name> && git merge main && git push
```
```

- [ ] **Step 2: Update Troubleshooting section**

Remove the "WhatsApp not connecting after upgrade" entry that references `/add-whatsapp` and `apply-skill.ts`.

- [ ] **Step 2b: Audit entire CLAUDE.md for stale overlay references**

Search the full file for any remaining references to the old overlay model: `apply-skills`, `clean-skills`, `package-skill`, `build:quick`, `overlay`, `manifest.yaml`, `.nanoclaw/`, `skills-engine/`, `patch-queue`. Remove or update each occurrence.

- [ ] **Step 3: Commit documentation**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for skills-as-branches model"
```

### Task 14: Verify Merge-Forward CI

- [ ] **Step 1: Check workflow exists**

```bash
ls .github/workflows/merge-forward-skills.yml
```

Expected: file exists (arrived via upstream merge in Task 3).

- [ ] **Step 2: Review workflow configuration**

Read the workflow file. Verify it:
- Triggers on push to main
- Iterates over `skill/*` branches
- Merges main into each skill branch
- Runs build + test
- Opens an issue if any fail

- [ ] **Step 3: Commit any necessary adjustments**

If the workflow needs adjustments for our fork (e.g., different test commands), fix and commit.

### Task 15: Final Validation & Smoke Test

- [ ] **Step 1: Full build**

```bash
npm run build
```

Expected: exit 0.

- [ ] **Step 2: Full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Container build**

```bash
./container/build.sh
```

Expected: container builds successfully.

- [ ] **Step 4: Smoke test**

Start the service and verify it responds to a message:

```bash
npm start
# Send a test message via WhatsApp and verify response
```

- [ ] **Step 5: Verify success criteria**

Check each criterion from the spec:

| # | Criterion | How to verify |
|---|-----------|---------------|
| 1 | `npm run build` passes | Task 15 Step 1 |
| 2 | `npm test` passes | Task 15 Step 2 |
| 3 | All 17 skill branches' functionality preserved | Review agent reports from Phase 3 |
| 4 | `git merge upstream/main` is conflict-free for core files | Already done in Task 3 |
| 5 | No `.nanoclaw/` or `skills-engine/` artifacts remain | `ls .nanoclaw/ skills-engine/ 2>&1` should show "No such file" |
| 6 | Each skill has its own branch with SKILL.md and skill-metadata.json | `git branch -r \| grep skill/ \| wc -l` = 17; for each: `git show origin/skill/<name>:SKILL.md > /dev/null && git show origin/skill/<name>:skill-metadata.json > /dev/null` |
| 7 | Merge-forward CI runs successfully | Check GitHub Actions after first push to main |

- [ ] **Step 6: Push to origin**

```bash
git push origin main
```

This triggers merge-forward CI, which validates all skill branches against the updated main.

- [ ] **Step 7: Commit plan completion**

The migration is complete. Tag the final state:

```bash
git tag post-migration-skills-as-branches
git push origin post-migration-skills-as-branches
```
