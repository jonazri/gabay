# Skills-as-Branches Migration Design

**Date:** 2026-03-11
**Status:** Draft
**Scope:** Migrate from patch-queue overlay model to upstream's skills-as-branches model

## Context

Upstream NanoClaw switched to a "skills as branches, channels as forks" architecture. Skills are git branches (`skill/<name>`), installed via `git merge`. The old overlay engine (manifests, three-way merge, `.nanoclaw/` state) was removed from main.

Our fork has 18 installed skills using the old patch-queue model, but `whatsapp-types` is redundant (whatsapp already declares `@types/qrcode-terminal`), so the migration consolidates to **17 skill branches**. All are fork-specific — none have upstream skill branch equivalents. Upstream only has 3 skill branches (apple-container, compact, ollama-tool), and channels (whatsapp, telegram, etc.) are separate repos ("channel forks").

## Goals

1. Align with upstream's architecture so future `git merge upstream/main` is trivial
2. Preserve all installed skills' functionality (17 branches after folding whatsapp-types into whatsapp)
3. Each skill gets its own branch on origin, matching upstream conventions
4. Remove the old overlay engine (skills-engine/, `.nanoclaw/`, manifests)
5. Detect and fix any regressions via per-skill review agents

## Non-Goals

- Migrating to upstream's channel forks (we keep whatsapp as a skill branch — our 17 skills heavily cross-cut WhatsApp files, making a separate channel repo impractical)
- Adding new skills as part of this migration

## Future: Private Marketplace

After migration, we plan to adopt Claude Code's marketplace plugin system to build a **private marketplace for Shluchim** — publishing select fork skills and accepting community contributions. This is a separate spec (not part of this migration) but informs our architecture.

**Marketplace-readiness baked into this migration:**
1. Each skill branch includes a `SKILL.md` (installation instructions) and `skill-metadata.json` (structured catalog metadata) — ready to publish as-is
2. Merge-forward CI keeps skill branches current — consumers always get compatible code
3. Branch naming convention (`skill/<name>`) matches upstream's marketplace expectations

## Architecture

### Before (Patch-Queue)

```
main branch (git-tracked):
  .nanoclaw/installed-skills.yaml    # Skill install order (only .nanoclaw file in git)
  .claude/skills/add-*/              # Overlay files (add/, modify/, manifest.yaml)
  skills-engine/                     # Three-way merge engine
  src/                               # Upstream-clean at rest, skills applied at build time

local working tree (generated, gitignored):
  .nanoclaw/base/                    # Clean upstream snapshot
  .nanoclaw/state.yaml               # Applied skill state + hashes
```

Build: `npm run apply-skills` → three-way merge overlays onto src/ → compile → restore src/

### After (Skills-as-Branches)

```
main branch:
  src/                               # Upstream-clean, no skill code
  .claude/skills/*/SKILL.md          # Operational skill instructions only
  .github/workflows/merge-forward-skills.yml  # Keeps skill branches current

skill/<name> branch (×17):           # Each skill branch contains:
  SKILL.md                           # Installation instructions (marketplace-publishable)
  skill-metadata.json                # Structured metadata for catalog generation
  src/                               # Skill's code changes merged into upstream src/
  package.json                       # Updated with skill-specific dependencies
```

Install: `git merge skill/whatsapp` → resolve conflicts (including `package.json`/`package-lock.json`) → `npm install` → done.
Update: `git merge upstream/main` → merge-forward skill branches → `npm install`.

### Dependency Model

Dependencies are determined by what files a skill modifies, not just manifest declarations. If a skill modifies a file that only exists on another skill's branch (e.g., `src/channels/whatsapp.ts` is added by the whatsapp skill), it must branch from that skill.

```
main
├── skill/lifecycle-hooks
│   └── skill/shabbat-mode           (depends: lifecycle-hooks)
├── skill/ipc-handler-registry
├── skill/whatsapp                    (includes whatsapp-types content — qrcode-terminal types)
│   ├── skill/reactions               (modifies whatsapp.ts — file added by whatsapp)
│   │   └── skill/voice-transcription-elevenlabs  (depends: reactions, modifies whatsapp.ts)
│   │       └── skill/voice-recognition           (depends: voice-transcription-elevenlabs)
│   └── skill/whatsapp-replies        (modifies whatsapp.ts + depends: whatsapp-search)
├── skill/container-hardening
│   └── skill/akiflow-sync           (depends: container-hardening)
├── skill/group-lifecycle             (branch from lifecycle-hooks, merge ipc-handler-registry)
├── skill/google-home                 (branch from lifecycle-hooks, merge ipc-handler-registry)
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

**Voice chain rationale:** `voice-transcription-elevenlabs` declares `depends: [reactions]` because its overlay to `whatsapp.ts` was built on top of reactions' changes to the same file. In the branch model, it branches from reactions (which already includes whatsapp's code) and adds its own `whatsapp.ts` modifications on top.

**Directory ownership:** Some skills create entire directories that other skills then modify. `whatsapp-search` creates `rag-system/` (12+ files), and `whatsapp-replies` modifies `rag-system/src/ingestion.ts`. Similarly, `whatsapp` creates `src/channels/whatsapp.ts` which multiple skills modify. Any skill modifying files in an "owned" directory must branch from or merge the owning skill.

**Upstream divergence:** Upstream's reactions skill branches from `main` (via a channel fork), not from `skill/whatsapp`. Our fork's reactions modifies `whatsapp.ts` directly, requiring the whatsapp → reactions dependency. This is a deliberate fork-specific choice.

When merging a child branch into main, git automatically includes the parent's changes (since the child branched from the parent).

## Migration Phases

### Phase 1: Pre-merge Preparation

**Purpose:** Capture per-skill metadata before any destructive changes.

**Prerequisite:** Verify backup tag exists: `pre-update-75032fd-20260311-103448` (created by the update-nanoclaw skill before this migration started). This is the rollback point for all phases.

For each of the 18 installed skills (17 after folding whatsapp-types into whatsapp), record from the manifest:
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

For each of the 17 skill branches, a review agent:

1. **Creates branch** `skill/<name>` from the appropriate base:
   - Independent skills: branch from post-merge main
   - Dependent skills: branch from their parent skill's branch

2. **Reads old overlay files** from the backup tag (`pre-update-75032fd-20260311-103448`):
   - `manifest.yaml` for file inventory — **only files listed in the manifest are applied by the current engine**; extra files in `add/`/`modify/` directories that aren't in the manifest should be ignored unless they're clearly part of the skill (e.g., unlisted top-level directories)
   - `add/` files listed in `manifest.adds`
   - `modify/` files listed in `manifest.modifies`
   - `tests/` for skill-specific tests

3. **Applies changes** to the new upstream src/:
   - For manifest-listed `add/` files: copy directly (these are new files, no conflict possible)
   - For manifest-listed `modify/` overlays: understand the intent, apply equivalent changes to new upstream src/
   - For `package.json`: add skill-specific dependencies
   - For `.env.example`: add skill-specific env vars
   - For directories not in manifest but belonging to the skill (e.g., `akiflow-sync/` top-level dir with its own package.json — not in akiflow-sync manifest but clearly part of the skill): include them in the skill branch

4. **Reviews for compatibility:**
   - Does the new upstream API still support this change?
   - Did upstream refactor any functions this skill hooks into?
   - Are there new upstream patterns we should adopt?
   - Is any of our code now redundant (upstream added it)?

5. **Creates marketplace-ready artifacts** on the skill branch:
   - **`SKILL.md`** — Installation instructions that a marketplace can publish as-is. Format:
     ```markdown
     # <Skill Name>
     <One-line description>
     ## Prerequisites
     - <other skills that must be installed first>
     ## Installation
     1. `git fetch origin skill/<name>`
     2. `git merge origin/skill/<name>`
     3. `npm install`
     4. <any credential/config steps>
     ## Verification
     - `npm run build && npm test`
     ## Environment Variables
     - `VAR_NAME` — description
     ```
   - **`skill-metadata.json`** — Structured metadata for catalog generation:
     ```json
     {
       "name": "<name>",
       "description": "<one-line>",
       "version": "1.0.0",
       "author": "jonazri",
       "depends": ["<parent-skill>"],
       "env": ["VAR_NAME"],
       "tags": ["whatsapp", "voice", etc.]
     }
     ```
   These files live on the skill branch root (not in `.claude/skills/`). They cost nothing to create now and save a full pass when building the marketplace later.

6. **Commits and pushes** the skill branch to origin

### Phase 3 Skill Processing Order

Process in dependency order (parents before children). Dependencies are based on actual file modifications, not just manifest declarations.

**Tier 1 (no dependencies, branch from main, can run in parallel):**

Within each tier, process in `installed-skills.yaml` order to minimize unexpected interactions when skills modify the same files (e.g., multiple skills modify `container/Dockerfile` in non-overlapping locations).

- lifecycle-hooks
- whatsapp (includes whatsapp-types content — no parent dependency)
- ipc-handler-registry
- container-hardening
- task-scheduler-fixes
- whatsapp-search (modifies only `src/container-runner.ts` — a core file)
- whatsapp-summary (adds container skill only — no file dependencies)
- perplexity-research
- feature-request

**Tier 2 (depends on Tier 1, can run in parallel after Tier 1):**
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

### Phase 3.5: Per-Branch Validation

Before composing, validate each skill branch independently:

```bash
for branch in $(git branch --list 'skill/*'); do
  git checkout "$branch"
  npm run build && npm test
done
```

This catches issues in isolation before they compound during the merge sequence.

### Phase 4: Compose by Merging Skill Branches

Merge all skill branches into main in dependency order:

```bash
# Tier 1 (independent — branch from main, in installed-skills.yaml order)
git merge skill/lifecycle-hooks
git merge skill/whatsapp
git merge skill/ipc-handler-registry
git merge skill/container-hardening
git merge skill/task-scheduler-fixes
git merge skill/whatsapp-search
git merge skill/whatsapp-summary
git merge skill/perplexity-research
git merge skill/feature-request

# Tier 2 (children of Tier 1)
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
- Delete `.nanoclaw/installed-skills.yaml` from git; delete generated state (`state.yaml`, `base/`) from working tree (`.nanoclaw/` is gitignored except `installed-skills.yaml`)
- Delete `skills-engine/` directory (entire engine, if not already removed by upstream merge)
- Delete overlay-specific artifacts from `.claude/skills/*/`: `add/`, `modify/`, `tests/`, `manifest.yaml`. Keep non-overlay code/assets (e.g., `x-integration/` has `agent.ts`, `host.ts`, `lib/`, `scripts/` that are not overlays)
- Remove old npm scripts from package.json: `apply-skills`, `clean-skills`, `package-skill`, `build:quick`, `build:container`
- Update `build` script: currently `tsx scripts/apply-skills.ts && tsc && ...`; should become just `tsc`
- Update `build:container` or remove: currently wraps apply-skills + container build; should become just `./container/build.sh`
- Update `dev` script — currently runs apply-skills; should become `tsx watch src/index.ts` or equivalent
- Delete fork-specific script files no longer needed: `scripts/apply-skills.ts`, `scripts/clean-skills.ts`, `scripts/package-skill.ts` (note: `scripts/apply-skill.ts` singular and `scripts/uninstall-skill.ts` are handled in Phase 2 upstream merge)

**Non-installed skill overlay files:** `.claude/skills/` contains 41 directories total (including operational skills like `setup/`, `debug/`, `x-integration/` that have no overlays). Non-installed skills with overlay artifacts (`add/`, `modify/`, `manifest.yaml`) to clean up: add-discord, add-gmail, add-image-vision, add-ollama-tool, add-pdf-reader, add-slack, add-telegram, add-compact, add-voice-transcription (original, pre-elevenlabs), convert-to-apple-container, use-local-whisper, add-whatsapp-resilience, add-regular-high-watcher. Note: `add-telegram-swarm` and `add-parallel` are already SKILL.md-only (no overlay artifacts) — no cleanup needed. Remove their overlay artifacts during cleanup — they're replaced by upstream's SKILL.md-only versions or can be installed from upstream skill branches/channel forks later. Operational skill directories (SKILL.md-only, no overlays) are kept as-is.

**Skill directory naming:** Some skill directories don't follow the `add-` prefix convention (e.g., `ipc-handler-registry/`, `whatsapp-replies/`). The new skill branch names (`skill/<name>`) don't need prefixes, so this is a non-issue post-migration.

**Enable merge-forward CI:**
- Upstream's `.github/workflows/merge-forward-skills.yml` (arriving via the Phase 2 merge) automatically merges main into every `skill/*` branch on each push to main, runs build + test, and opens an issue if any fail. Verify this workflow is present and functional after the merge. This is critical for marketplace readiness — other Shluchim consuming our skill branches need them to stay current with main.

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
| Dependency ordering wrong | Tree derived from file-modification analysis + manifest `depends:` (manifests alone are incomplete) |
| Upstream API changes break skill code | Review agents check function signatures |
| Large scope (17 skill branches) | Parallel agents, tiered processing, per-branch validation |
| Skills-engine removal breaks build | Phase 5 cleanup only after Phase 4 validation |
| Multi-parent skill branches create merge diamonds | Branch from primary parent, merge secondary; test before committing |
| Non-installed skill overlay files left behind | Explicit cleanup step in Phase 5 |

## Success Criteria

1. `npm run build` passes
2. `npm test` passes
3. All 17 skill branches' functionality preserved (verified by review agents)
4. `git merge upstream/main` on a future upstream update is conflict-free for core files
5. No `.nanoclaw/` or `skills-engine/` artifacts remain
6. Each skill has its own branch on origin with `SKILL.md` and `skill-metadata.json`
7. Merge-forward CI workflow runs successfully on all skill branches
