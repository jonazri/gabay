# Skills-as-Branches Migration Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Migrate from patch-queue overlay model to upstream's skills-as-branches model

## Context

Upstream NanoClaw switched to a "skills as branches, channels as forks" architecture. Skills are git branches (`skill/<name>`), installed via `git merge`. The old overlay engine (manifests, three-way merge, `.nanoclaw/` state) was removed from main.

Our fork has 18 installed skills using the old patch-queue model. All 18 are fork-specific — none have upstream skill branch equivalents. Upstream only has 3 skill branches (apple-container, compact, ollama-tool), and channels (whatsapp, telegram, etc.) are separate repos ("channel forks").

## Goals

1. Align with upstream's architecture so future `git merge upstream/main` is trivial
2. Preserve all 18 installed skills' functionality
3. Each skill gets its own branch on origin, matching upstream conventions
4. Remove the old overlay engine (skills-engine/, `.nanoclaw/`, manifests)
5. Detect and fix any regressions via per-skill review agents

## Non-Goals

- Migrating to upstream's channel forks (we keep whatsapp as a skill branch)
- Adopting upstream's marketplace plugin system (we install skills via git merge)
- Adding new skills as part of this migration

## Architecture

### Before (Patch-Queue)

```
main branch:
  .nanoclaw/installed-skills.yaml    # Skill install order
  .nanoclaw/base/                    # Clean upstream snapshot
  .nanoclaw/state.json               # Applied skill state + hashes
  .claude/skills/add-*/              # Overlay files (add/, modify/, manifest.yaml)
  skills-engine/                     # Three-way merge engine
  src/                               # Upstream-clean at rest, skills applied at build time
```

Build: `npm run apply-skills` → three-way merge overlays onto src/ → compile → restore src/

### After (Skills-as-Branches)

```
main branch:
  src/                               # Upstream-clean, no skill code
  .claude/skills/*/SKILL.md          # Operational skill instructions only

skill/lifecycle-hooks branch:        # Fork-specific skill
skill/whatsapp branch:               # Fork-specific skill (channel)
skill/reactions branch:              # Fork-specific skill
... (18 branches total)
```

Install: `git merge skill/whatsapp` → standard git merge → done.
Update: `git merge upstream/main` → then merge-forward skill branches.

### Dependency Model

Dependencies are determined by what files a skill modifies, not just manifest declarations. If a skill modifies a file that only exists on another skill's branch (e.g., `src/channels/whatsapp.ts` is added by the whatsapp skill), it must branch from that skill.

```
main
├── skill/lifecycle-hooks
│   └── skill/shabbat-mode           (depends: lifecycle-hooks)
├── skill/ipc-handler-registry
├── skill/whatsapp-types
│   └── skill/whatsapp               (depends: whatsapp-types)
│       ├── skill/reactions           (modifies whatsapp.ts — file added by whatsapp)
│       │   └── skill/voice-transcription-elevenlabs  (depends: reactions, modifies whatsapp.ts)
│       │       └── skill/voice-recognition           (depends: voice-transcription-elevenlabs)
│       └── skill/whatsapp-replies    (modifies whatsapp.ts + depends: whatsapp-search)
├── skill/container-hardening
│   └── skill/akiflow-sync           (depends: container-hardening)
├── skill/task-scheduler-fixes
├── skill/whatsapp-search             (modifies only core files — no whatsapp dependency)
├── skill/whatsapp-summary            (adds container skill only — no dependencies)
├── skill/perplexity-research
└── skill/feature-request
```

**Multi-parent dependencies:** Some skills depend on two parents:
- `group-lifecycle` depends on lifecycle-hooks + ipc-handler-registry
- `google-home` depends on lifecycle-hooks + ipc-handler-registry
- `whatsapp-replies` depends on whatsapp (modifies whatsapp.ts) + whatsapp-search (modifies rag-system/)

For these: branch from the primary parent, then merge the secondary parent into the skill branch before adding the skill's own changes. This creates a clean merge base.

```
main
├── ...
├── skill/group-lifecycle             (branch from lifecycle-hooks, merge ipc-handler-registry)
├── skill/google-home                 (branch from lifecycle-hooks, merge ipc-handler-registry)
```

When merging a child branch into main, git automatically includes the parent's changes (since the child branched from the parent).

## Migration Phases

### Phase 1: Pre-merge Preparation

**Purpose:** Capture per-skill metadata before any destructive changes.

**Prerequisite:** Verify backup tag exists: `pre-update-75032fd-20260311-103448` (created by the update-nanoclaw skill before this migration started). This is the rollback point for all phases.

For each of the 18 skills, record from the manifest:
- Files added (`add/` entries)
- Files modified (`modify/` entries)
- npm dependencies
- Environment variables
- Test commands
- Dependencies on other skills

Store this as a structured reference (JSON or markdown) so review agents can use it.

**Also:** Apply all skills to get the fully-applied src/ state. Archive this as a reference for what the final merged result should look like.

### Phase 2: Merge upstream/main

Merge `upstream/main` into our main branch.

**Conflict resolution strategy:**

The upstream diff touches ~150+ files outside of `.claude/skills/` and `skills-engine/`. Conflicts fall into these categories:

| Conflict Type | Count | Resolution |
|--------------|-------|------------|
| modify/delete: `.claude/skills/*/modify/`, `add/`, `tests/`, `manifest.yaml` | ~35 | Accept deletion — overlay files are being replaced by skill branches |
| modify/delete: `skills-engine/constants.ts`, `skills-engine/init.ts` | 2 | Accept deletion — engine is being removed |
| modify/delete: `scripts/apply-skill.ts`, `scripts/uninstall-skill.ts` | 2 | Accept deletion — replaced by git operations |
| modify/delete: `.github/workflows/skill-drift.yml`, `skill-pr.yml` | 2 | Accept deletion — replaced by merge-forward workflow |
| add/add: `.claude/skills/add-compact/SKILL.md`, `add-reactions/SKILL.md` | 2 | Take upstream's version (ours will be in skill branches) |
| content: `package.json` | 1 | Merge: keep upstream's scripts, strip skill-specific deps (those move to skill branches) |
| content: `package-lock.json` | 1 | Regenerate via `npm install` after resolving package.json |
| content: `setup/register.ts` | 1 | Merge both changes (upstream refactored setup into multiple files; adopt upstream structure) |
| content: `repo-tokens/badge.svg` | 1 | Take upstream's version |
| auto-merge: `src/*.ts`, `container/`, `vitest.config.ts`, etc. | many | Git auto-merges cleanly (no conflict markers). Review after merge for correctness. |

**Non-conflicting but notable changes:** Upstream updated `src/config.ts`, `src/container-runner.ts`, `src/container-runtime.ts`, `src/credential-proxy.ts` (new), `src/index.ts`, `src/task-scheduler.ts`, `container/Dockerfile`, `container/agent-runner/src/index.ts`, and many skills-engine files (which we accept as-is since upstream rewrote the engine).

**Fork-specific directories that survive the merge:**
- `akiflow-sync/` — top-level directory with its own package.json (part of akiflow-sync skill, added by us)
- `groups/` — per-group memory and configuration
- `scripts/scratch/` — gitignored scratch scripts

After merge, main has upstream's clean src/ with no skills applied.

### Phase 3: Create Skill Branches

For each of the 18 skills, a review agent:

1. **Creates branch** `skill/<name>` from the appropriate base:
   - Independent skills: branch from post-merge main
   - Dependent skills: branch from their parent skill's branch

2. **Reads old overlay files** from the backup tag (`pre-update-75032fd-20260311-103448`):
   - `manifest.yaml` for file inventory
   - `add/` files for new code
   - `modify/` files for delta overlays
   - `tests/` for skill-specific tests

3. **Applies changes** to the new upstream src/:
   - For `add/` files: copy directly (these are new files, no conflict possible)
   - For `modify/` overlays: understand the intent, apply equivalent changes to new upstream src/
   - For `package.json`: add skill-specific dependencies
   - For `.env.example`: add skill-specific env vars

4. **Reviews for compatibility:**
   - Does the new upstream API still support this change?
   - Did upstream refactor any functions this skill hooks into?
   - Are there new upstream patterns we should adopt?
   - Is any of our code now redundant (upstream added it)?

5. **Commits and pushes** the skill branch to origin

### Phase 3 Skill Processing Order

Process in dependency order (parents before children). Dependencies are based on actual file modifications, not just manifest declarations.

**Tier 1 (no dependencies, branch from main, can run in parallel):**
- lifecycle-hooks
- whatsapp-types
- ipc-handler-registry
- container-hardening
- task-scheduler-fixes
- whatsapp-search (modifies only `src/container-runner.ts` — a core file)
- whatsapp-summary (adds container skill only — no file dependencies)
- perplexity-research
- feature-request

**Tier 2 (depends on Tier 1, can run in parallel after Tier 1):**
- whatsapp (branch from: whatsapp-types)
- group-lifecycle (branch from: lifecycle-hooks, merge: ipc-handler-registry)
- google-home (branch from: lifecycle-hooks, merge: ipc-handler-registry)
- shabbat-mode (branch from: lifecycle-hooks)
- akiflow-sync (branch from: container-hardening)

**Tier 3 (depends on Tier 2):**
- reactions (branch from: whatsapp — modifies `src/channels/whatsapp.ts`)
- whatsapp-replies (branch from: whatsapp, merge: whatsapp-search — modifies both `whatsapp.ts` and `rag-system/`)

**Tier 4 (depends on Tier 3):**
- voice-transcription-elevenlabs (branch from: reactions — depends on reactions, modifies `whatsapp.ts`)

**Tier 5 (depends on Tier 4):**
- voice-recognition (branch from: voice-transcription-elevenlabs)

### Phase 4: Compose by Merging Skill Branches

Merge all skill branches into main in dependency order:

```bash
# Tier 1 (independent — branch from main)
git merge skill/lifecycle-hooks
git merge skill/whatsapp-types
git merge skill/ipc-handler-registry
git merge skill/container-hardening
git merge skill/task-scheduler-fixes
git merge skill/whatsapp-search
git merge skill/whatsapp-summary
git merge skill/perplexity-research
git merge skill/feature-request

# Tier 2 (children of Tier 1)
git merge skill/whatsapp
git merge skill/group-lifecycle
git merge skill/google-home
git merge skill/shabbat-mode
git merge skill/akiflow-sync

# Tier 3 (children of Tier 2)
git merge skill/reactions
git merge skill/whatsapp-replies

# Tier 4-5 (voice chain)
git merge skill/voice-transcription-elevenlabs
git merge skill/voice-recognition
```

Git handles composition. Conflicts (if any) are resolved interactively.

### Phase 5: Cleanup & Validation

**Remove old infrastructure:**
- Delete `.nanoclaw/` directory (installed-skills.yaml, base/, state.json)
- Delete `skills-engine/` directory (entire engine, if not already removed by upstream merge)
- Delete old overlay files from `.claude/skills/*/` (keep only SKILL.md files)
- Remove old npm scripts from package.json (apply-skills, clean-skills, package-skill, build:quick)
- Update `dev` script — currently runs apply-skills; should become `tsx watch src/index.ts` or equivalent

**Non-installed skill overlay files:** The repo has ~27 skill directories in `.claude/skills/`, but only 18 are installed. Non-installed skills with overlay files to remove during cleanup: add-discord, add-gmail, add-image-vision, add-ollama-tool, add-pdf-reader, add-slack, add-telegram, add-compact, add-voice-transcription (original, pre-elevenlabs), convert-to-apple-container, use-local-whisper, add-whatsapp-resilience, add-regular-high-watcher, add-telegram-swarm, add-parallel. These should be removed during cleanup — they're replaced by upstream's SKILL.md-only versions or can be installed from upstream skill branches/channel forks later.

**Skill directory naming:** Some skill directories don't follow the `add-` prefix convention (e.g., `ipc-handler-registry/`, `whatsapp-replies/`). The new skill branch names (`skill/<name>`) don't need prefixes, so this is a non-issue post-migration.

**Update documentation:**
- CLAUDE.md: replace "Build Model (Patch Queue)" with skills-as-branches instructions
- Update development workflow section
- Update `npm run dev` description

**Validate:**
- `npm run build` — TypeScript compilation succeeds
- `npm test` — all tests pass
- Manual smoke test: verify the service starts and responds to messages

## Review Agent Specification

Each review agent receives:
- The skill's manifest.yaml (from backup tag)
- The skill's overlay files (from backup tag)
- The new upstream src/ files that the skill touches
- Instructions to evaluate compatibility and produce a migration report

**Agent output format:**
```markdown
## Skill: <name>
### Files Added
- path/to/file.ts — status: OK / NEEDS_ADAPTATION / CONFLICT
### Files Modified
- path/to/file.ts — status: OK / NEEDS_ADAPTATION / REDUNDANT
  - Reason: <why>
### Dependencies
- package-name@version — status: OK / VERSION_BUMP_NEEDED
### Recommendations
- <actionable items>
```

**Decision criteria:**
- **OK:** Overlay applies cleanly to new upstream, no issues
- **NEEDS_ADAPTATION:** Upstream changed the target code; overlay intent is valid but needs rewriting
- **REDUNDANT:** Upstream now includes this functionality natively
- **CONFLICT:** Fundamental incompatibility, needs human decision

## Rollback

At any phase, rollback to the backup tag:
```bash
git reset --hard pre-update-75032fd-20260311-103448
```

Skill branches (once pushed) survive a main reset, so Phase 3 work is never lost.

## Risks

| Risk | Mitigation |
|------|------------|
| Overlay intent lost during translation | Review agents compare old overlay vs new code |
| Dependency ordering wrong | Skill manifests declare dependencies explicitly |
| Upstream API changes break skill code | Review agents check function signatures |
| Large scope (~18 skills) | Parallel agents, tiered processing |
| Skills-engine removal breaks build | Phase 5 cleanup only after Phase 4 validation |
| Multi-parent skill branches create merge diamonds | Branch from primary parent, merge secondary; test before committing |
| Non-installed skill overlay files left behind | Explicit cleanup step in Phase 5 |

## Success Criteria

1. `npm run build` passes
2. `npm test` passes
3. All 18 skills' functionality preserved (verified by review agents)
4. `git merge upstream/main` on a future upstream update is conflict-free for core files
5. No `.nanoclaw/` or `skills-engine/` artifacts remain
6. Each skill has its own branch on origin
