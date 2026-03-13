# Implementation Plan: Clean Fork Alignment

## Overview

Restructure the NanoClaw fork so `main` equals `upstream/main` + merged skill branches + non-skill custom changes. The migration extracts 17 skills from a monolithic `main` (202 commits ahead of upstream) into clean `skill/*` branches with proper dependency hierarchy, merges them back in tier order, and cuts over to the new `main`. All extraction work happens in `~/code/yonibot/gabay-extraction`; the live service at `~/code/yonibot/gabay` is untouched until cutover.

## Tasks

- [ ] 1. Phase 1: Safety and Preparation
  - [ ] 1.1 Create backup tag and disable merge-forward CI
    - Create a `backup/pre-fork-alignment-<timestamp>` tag on the current `main` commit
    - Push the backup tag to `origin`
    - Verify the backup tag exists on `origin` via `git tag -l`
    - Disable the `merge-forward-skills.yml` workflow via `gh workflow disable`
    - _Requirements: 1.1, 1.2, 1.3, 2.1_

  - [ ] 1.2 Create extraction worktree and verify upstream remote
    - Create worktree at `~/code/yonibot/gabay-extraction` from `main`
    - Verify `upstream` remote points to `qwibitai/nanoclaw` and fetch it
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 1.3 Create fresh-main from upstream/main
    - `git checkout -b fresh-main upstream/main`
    - Verify zero diff against `upstream/main`
    - Run `npm ci && npm run build` to verify upstream baseline builds
    - Run `npx vitest run` and note any pre-existing upstream test failures (informational, not blocking)
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

- [ ] 2. Checkpoint — Verify preparation complete
  - Ensure backup tag exists on origin, merge-forward CI is disabled, extraction worktree is ready, and fresh-main matches upstream/main exactly
  - Confirm rollback path is viable: backup tag is reachable, `git reset --hard backup/pre-fork-alignment-<timestamp>` would restore pre-migration state (Req 3.1)
  - Ask the user if questions arise.

- [ ] 3. Phase 2: Tier 0 Skill Extraction (8 skills, independent — can be parallelized)
  - [ ] 3.1 Extract `skill/ipc-handler-registry`
    - Branch from `fresh-main`
    - Extract files: `src/ipc-handlers.ts`, `src/ipc-handlers.test.ts` (new); `src/ipc.ts` (modified — only ipc-handler-registry hunks)
    - Add `skill-metadata.json`: `{ "name": "ipc-handler-registry", "tier": 0, "dependencies": [] }`
    - Build + test on branch (`npm run build && npx vitest run`)
    - Commit with explicit file staging (not `git add -A`)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.2 Extract `skill/lifecycle-hooks`
    - Branch from `fresh-main`
    - Extract files: `src/lifecycle.ts`, `src/lifecycle.test.ts`, `src/message-events.ts`, `src/message-events.test.ts` (new); `src/index.ts` (modified — lifecycle hook imports/calls only)
    - Add `skill-metadata.json`: `{ "name": "lifecycle-hooks", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.3 Extract `skill/whatsapp`
    - Branch from `fresh-main`
    - Extract files: `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`, `src/whatsapp-auth.ts`, `src/qrcode-terminal.d.ts` (new); `src/channels/index.ts`, `src/types.ts`, `package.json`, `setup/index.ts`, `setup/whatsapp-auth.ts` (modified — whatsapp-only hunks)
    - Add `skill-metadata.json`: `{ "name": "whatsapp", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.4 Extract `skill/container-hardening`
    - Branch from `fresh-main`
    - Extract modifications to `src/container-runner.ts` and container `Dockerfile`
    - Add `skill-metadata.json`: `{ "name": "container-hardening", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.5 Extract `skill/perplexity-research`
    - Branch from `fresh-main`
    - Extract container skill files: `container/skills/perplexity-research/`
    - Add `skill-metadata.json`: `{ "name": "perplexity-research", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.6 Extract `skill/feature-request`
    - Branch from `fresh-main`
    - Extract container skill files: `container/skills/feature-request/`
    - Add `skill-metadata.json`: `{ "name": "feature-request", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.7 Extract `skill/task-scheduler-fixes`
    - Branch from `fresh-main`
    - Extract modifications to `src/task-scheduler.ts` (only task-scheduler-fixes hunks)
    - Add `skill-metadata.json`: `{ "name": "task-scheduler-fixes", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [ ] 3.8 Extract `skill/message-search`
    - Branch from `fresh-main`
    - Extract RAG system files (`rag-system/` directory)
    - Rename all WhatsApp-specific naming to channel-agnostic equivalents: package name in `rag-system/package.json`, SKILL.md title, tool name in container skill
    - Add `skill-metadata.json`: `{ "name": "message-search", "tier": 0, "dependencies": [] }`
    - Build + test, commit with explicit staging
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [ ] 4. Checkpoint — Verify all 8 Tier 0 skill branches
  - Ensure all 8 Tier 0 branches exist, each builds and tests independently, each has correct `skill-metadata.json`, and no branch contains files from another skill. Ask the user if questions arise.

- [ ] 5. Phase 3: Tier 1 Skill Extraction (5 skills, sequential — must branch from parent)
  - [ ] 5.1 Extract `skill/reactions`
    - Branch from `skill/whatsapp` (NOT fresh-main)
    - Extract reactions-only changes: `src/status-tracker.ts`, `src/status-tracker.test.ts`, `container/skills/reactions/SKILL.md` (new); `src/index.ts`, `src/db.ts`, `src/ipc.ts`, `src/channels/whatsapp.ts` (modified — reactions-only hunks)
    - Add `skill-metadata.json`: `{ "name": "reactions", "tier": 1, "dependencies": ["whatsapp"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 5.2 Extract `skill/shabbat-mode`
    - Branch from `skill/lifecycle-hooks` (NOT fresh-main)
    - Extract shabbat-only changes: `src/shabbat.ts`, `src/shabbat.test.ts`, `data/shabbat-schedule.json` (new); `src/index.ts` (modified — shabbat guard only)
    - Add `skill-metadata.json`: `{ "name": "shabbat-mode", "tier": 1, "dependencies": ["lifecycle-hooks"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 5.3 Extract `skill/akiflow-sync`
    - Branch from `skill/container-hardening` (NOT fresh-main)
    - Extract akiflow-only changes: `akiflow-sync/` directory (48 files), `container/skills/akiflow/` (new); `src/container-runner.ts` (modified — akiflow mount), `.env.example` (modified — AKIFLOW_* vars)
    - Add `skill-metadata.json`: `{ "name": "akiflow-sync", "tier": 1, "dependencies": ["container-hardening"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 5.4 Extract `skill/whatsapp-summary`
    - Branch from `skill/whatsapp` (NOT fresh-main)
    - Extract summary-only changes: `container/skills/whatsapp-summary/SKILL.md` (new); any scheduled task configuration related to summaries
    - Add `skill-metadata.json`: `{ "name": "whatsapp-summary", "tier": 1, "dependencies": ["whatsapp"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ] 5.5 Extract `skill/voice-transcription-elevenlabs`
    - Branch from `skill/whatsapp` (NOT reactions — verified: no code dependency on StatusTracker)
    - Extract transcription-only changes: `src/transcription.ts` (new); `src/channels/whatsapp.ts` (modified — voice message handling in `messages.upsert`)
    - Add `skill-metadata.json`: `{ "name": "voice-transcription-elevenlabs", "tier": 1, "dependencies": ["whatsapp"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

- [ ] 6. Phase 3 continued: Tier 2 Skill Extraction (4 skills, sequential — multi-parent handling)
  - [ ] 6.1 Extract `skill/google-home`
    - Branch from `skill/lifecycle-hooks` (primary parent — more substantial dependency)
    - Extract google-home-only changes: `src/google-assistant.ts`, `src/ipc-handlers/google-home.ts`, `scripts/google-assistant-daemon.py`, `scripts/google-assistant-setup.py`, `container/skills/google-home/` (new); `src/index.ts` (modified — socket startup/shutdown)
    - Add `skill-metadata.json`: `{ "name": "google-home", "tier": 2, "dependencies": ["lifecycle-hooks"], "also_requires": ["ipc-handler-registry"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 6.2 Extract `skill/group-lifecycle`
    - Branch from `skill/lifecycle-hooks` (primary parent)
    - Extract group-lifecycle-only changes: `src/ipc-handlers/group-lifecycle.ts` (new); any modifications to shared files
    - Add `skill-metadata.json`: `{ "name": "group-lifecycle", "tier": 2, "dependencies": ["lifecycle-hooks"], "also_requires": ["ipc-handler-registry"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 6.3 Extract `skill/whatsapp-replies`
    - Branch from `skill/whatsapp` (primary parent)
    - Extract replies-only changes: modifications to `src/channels/whatsapp.ts` (reply context), `src/db.ts` (reply storage)
    - Add `skill-metadata.json`: `{ "name": "whatsapp-replies", "tier": 2, "dependencies": ["whatsapp"], "also_requires": ["message-search"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 6.4 Extract `skill/voice-recognition`
    - Branch from `skill/voice-transcription-elevenlabs` (single parent)
    - Extract voice-recognition-only changes: `src/voice-recognition.ts` (new); `src/config.ts`, `src/channels/whatsapp.ts` (modified)
    - Add `skill-metadata.json`: `{ "name": "voice-recognition", "tier": 2, "dependencies": ["voice-transcription-elevenlabs"] }`
    - Build + test, commit with explicit staging
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

- [ ] 7. Checkpoint — Verify all 17 skill branches created
  - Ensure all 17 skill branches exist with correct ancestry (Tier 1/2 branches have parent skill as git ancestor), each builds independently, each has valid `skill-metadata.json`, and no branch contains files from another skill. Ask the user if questions arise.

- [ ] 8. Phase 4: Assembly — Merge all skill branches into fresh-main
  - [ ] 8.1 Merge Tier 0 skills into fresh-main
    - Checkout `fresh-main`
    - Merge all 8 Tier 0 branches with `--no-edit`: `skill/ipc-handler-registry`, `skill/lifecycle-hooks`, `skill/whatsapp`, `skill/container-hardening`, `skill/perplexity-research`, `skill/feature-request`, `skill/task-scheduler-fixes`, `skill/message-search`
    - Resolve any merge conflicts (expected for shared files like `src/index.ts`, `src/db.ts`, `src/ipc.ts`)
    - Run `npm run build && npx vitest run` after all Tier 0 merges
    - _Requirements: 9.1, 9.3, 9.4, 9.5_

  - [ ] 8.2 Merge Tier 1 skills into fresh-main
    - Merge all 5 Tier 1 branches with `--no-edit`: `skill/reactions`, `skill/shabbat-mode`, `skill/akiflow-sync`, `skill/whatsapp-summary`, `skill/voice-transcription-elevenlabs`
    - Resolve any merge conflicts
    - Run `npm run build && npx vitest run` after all Tier 1 merges
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

  - [ ] 8.3 Merge Tier 2 skills into fresh-main
    - Merge all 4 Tier 2 branches with `--no-edit`: `skill/google-home`, `skill/group-lifecycle`, `skill/whatsapp-replies`, `skill/voice-recognition`
    - Resolve any merge conflicts
    - Run `npm run build && npx vitest run` after all Tier 2 merges
    - _Requirements: 9.2, 9.3, 9.4, 9.5_

  - [ ] 8.4 Apply non-skill custom changes
    - Diff `fresh-main..main` to identify remaining non-skill differences
    - Cherry-pick or manually apply: `CLAUDE.md`, `.github/workflows/`, `.github/CODEOWNERS`, `.env.example` additions, `.gitignore`, `.prettierignore`, `.husky/pre-commit`, `setup/` modifications, `docs/`, `.pr_agent.toml`
    - Use explicit file staging (not `git add -A`)
    - Build + test after applying
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ] 8.5 Verify no functionality lost
    - Run `git diff --stat fresh-main..main -- src/` (untruncated) and review every remaining diff
    - Run `git diff --name-status fresh-main..main -- src/ | grep '^A'` to find files on `main` missing from `fresh-main`
    - Classify each remaining diff as intentional or bug; fix bugs before proceeding
    - Run full test suite and verify container build (`./container/build.sh`)
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [ ] 9. Checkpoint — Assembly complete, ready for cutover
  - Ensure fresh-main contains all 17 skills merged in tier order, all non-skill custom changes applied, no source files lost, build + tests pass, container builds. Ask the user if questions arise.

- [ ] 10. Phase 4 continued: Cutover
  - [ ] 10.1 Stop live service and push branches
    - Stop the live service: `systemctl --user stop nanoclaw`
    - Push all 17 `skill/*` branches to `origin` with `--force-with-lease`
    - Push `fresh-main` as new `main` to `origin` with `--force-with-lease`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [ ] 10.2 Update live directory and restart service
    - In `~/code/yonibot/gabay`: `git fetch origin && git reset --hard origin/main`
    - Rebuild: `npm ci && npm run build && ./container/build.sh`
    - Restart: `systemctl --user start nanoclaw`
    - _Requirements: 12.5_

  - [ ] 10.3 Smoke test the live service
    - Send a test message on WhatsApp and verify: message receipt/processing, emoji reaction lifecycle (👀→💭→🔄→✅), reply delivery
    - Verify Google Home socket exists (`data/sockets/google-assistant.sock`)
    - Verify Akiflow DB mounted in container
    - _Requirements: 12.6_

- [ ] 11. Phase 5: Verification and CI
  - [ ] 11.1 Update merge-forward CI to use upstream/main
    - Modify `.github/workflows/merge-forward-skills.yml`: add `upstream` remote fetch, change merge source from `origin/main` to `upstream/main`
    - Verify the workflow YAML builds + tests each skill branch after merging
    - Commit and push the workflow change
    - _Requirements: 13.2, 18.3_

  - [ ] 11.2 Re-enable and verify merge-forward CI
    - Re-enable: `gh workflow enable merge-forward-skills.yml`
    - Trigger the workflow and verify it successfully merges `upstream/main` into all 17 skill branches
    - _Requirements: 2.3, 13.1, 13.3, 13.4_

  - [ ] 11.3 Post-cutover cleanup
    - Remove extraction worktree: `git worktree remove ../gabay-extraction`
    - Delete local `fresh-main` branch ref
    - _Requirements: 17.1, 17.2_

  - [ ] 11.4 Update CLAUDE.md and documentation
    - Update build model section: main = upstream + skills merged + custom changes
    - Document skill branch model, multi-parent `also_requires` pattern, merge-forward CI behavior
    - Document core-fix workflow: fixes on `main`, PR upstream, propagates via merge-forward when upstream merges; rejected PRs use permanent cherry-picks (Req 18.6)
    - Document rollback procedure: `git reset --hard` to backup tag, force-push, re-enable CI, rebuild, restart (Req 3.1, 3.2, 3.3)
    - _Requirements: 3.1, 3.2, 3.3, 18.1, 18.2, 18.6_

- [ ] 12. Write validation test file (`tests/fork-alignment-validation.test.ts`)
  - [ ] 12.1 Define skill inventory and test infrastructure
    - Create `tests/fork-alignment-validation.test.ts`
    - Define the 17-skill inventory array with name, tier, parent, expected files, and `also_requires` for each skill
    - Set up helper functions for running git commands (`execSync` wrappers for `git merge-base --is-ancestor`, `git diff`, `git show`, etc.)
    - _Requirements: 14.1, 14.2, 14.3, 15.1_

  - [ ]* 12.2 Write test for Property 1: Skill Branch Ancestry Chain
    - For each of the 17 skills, verify `upstream/main` is a git ancestor of the skill branch
    - For Tier 1/2 skills, verify the declared parent skill branch is a git ancestor
    - Use exhaustive `for (const skill of allSkills)` loop (not fast-check)
    - **Property 1: Skill Branch Ancestry Chain**
    - **Validates: Requirements 6.1, 7.1, 8.1, 14.1, 14.2, 14.3**

  - [ ]* 12.3 Write test for Property 2: Skill File Isolation
    - For each skill, diff against parent branch and verify files match expected set + `skill-metadata.json`
    - No files belonging to a different skill should appear in the diff
    - **Property 2: Skill File Isolation**
    - **Validates: Requirements 6.2, 7.2, 8.2, 14.4**

  - [ ]* 12.4 Write test for Property 3: Skill Metadata Schema and Consistency
    - For each skill, parse `skill-metadata.json` from the branch
    - Validate required fields: `name` matches branch suffix, `description` is string, `tier` is 0/1/2, `dependencies` is array
    - Verify Tier 0 has `dependencies: []`, Tier 1/2 has correct parent, multi-parent Tier 2 has `also_requires`
    - **Property 3: Skill Metadata Schema and Consistency**
    - **Validates: Requirements 6.3, 7.3, 8.3, 15.1, 15.2, 15.3, 15.4**

  - [ ]* 12.5 Write test for Property 4: Independent Buildability
    - For each skill, checkout the branch and run `npm ci && npm run build && npx vitest run`
    - This is expensive — run sequentially, one branch at a time
    - **Property 4: Independent Buildability**
    - **Validates: Requirements 6.4, 7.4, 8.4**

  - [ ]* 12.6 Write test for Property 5: Tier-Ordered Merge Sequence
    - For all pairs of merge commits on `fresh-main` with different tiers, verify lower-tier merge is an ancestor of higher-tier merge
    - **Property 5: Tier-Ordered Merge Sequence**
    - **Validates: Requirements 9.1, 9.2**

  - [ ]* 12.7 Write test for Property 6: Complete Skill Integration
    - For each of the 17 skills, verify `git merge-base --is-ancestor skill/<name> main` (all skills merged into main)
    - **Property 6: Complete Skill Integration**
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5**

  - [ ]* 12.8 Write test for Property 7: No Source File Loss
    - For each source file on the old `main` (backup tag) under `src/`, verify it exists on the new `main`
    - **Property 7: No Source File Loss**
    - **Validates: Requirements 11.2**

  - [ ]* 12.9 Write test for Property 8: Stale Branch Elimination
    - For each `skill/*` branch on `origin`, verify shared merge history with new `main`
    - **Property 8: Stale Branch Elimination**
    - **Validates: Requirements 12.2**

  - [ ]* 12.10 Write test for Property 9: Merge-Forward CI Source Correctness
    - Parse `.github/workflows/merge-forward-skills.yml` and verify merge source is `upstream/main` (not `origin/main`)
    - **Property 9: Merge-Forward CI Source Correctness**
    - **Validates: Requirements 13.2, 18.3**

  - [ ]* 12.11 Write test for Property 10: Upstream Merge Compatibility
    - Verify `git merge-base main upstream/main` returns a valid commit
    - Verify `upstream/main` is a git ancestor of `main`
    - **Property 10: Upstream Merge Compatibility**
    - **Validates: Requirements 16.1, 16.2**

- [ ] 13. Final checkpoint — Migration complete
  - Ensure all tests pass, all 17 skill branches are on origin with correct ancestry, merge-forward CI is operational with `upstream/main` as source, live service passes smoke test, documentation is updated. Ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Tier 0 skill extractions (tasks 3.1–3.8) are independent and can be parallelized
- Tier 1+ skill extractions must be sequential (dependency order)
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation between phases
- The validation test file (task 12) uses exhaustive iteration over all 17 skills, not fast-check
- Property tests validate the git state post-migration; they can be run at any point after the relevant phase completes
