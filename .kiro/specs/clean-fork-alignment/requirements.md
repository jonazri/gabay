# Requirements Document

## Introduction

This feature restructures a NanoClaw fork so that `main` equals `upstream/main` plus merged skill branches plus custom changes. The goal is zero-conflict upstream merges, clean skill branch management, and alignment with the upstream `skills-as-branches` model. The fork currently has 17 skills baked directly into `src/` (202 commits ahead of upstream) with stale `origin/skill/*` branches that share no merge history with `main`. The migration extracts each skill into a clean branch with proper dependency hierarchy, merges them back in dependency order, applies non-skill custom changes, and cuts over to the new `main`.

## Glossary

- **Fork**: The user's GitHub fork of `qwibitai/nanoclaw`, with `origin` pointing to the fork and `upstream` pointing to the upstream repo
- **Upstream**: The `qwibitai/nanoclaw` repository, the canonical source of NanoClaw core code
- **Skill_Branch**: A git branch named `skill/<name>` containing `upstream/main` plus exactly one skill's code changes, branched from the appropriate parent per the dependency hierarchy
- **Tier**: A dependency level classification for skills. Tier 0 skills depend only on `main`. Tier 1 skills depend on one Tier 0 skill. Tier 2 skills depend on one or more Tier 0/1 skills
- **Fresh_Main**: A temporary branch created from `upstream/main` that serves as the assembly target for the new clean `main`
- **Merge_Forward_CI**: A GitHub Actions workflow that merges `upstream/main` (not `origin/main`) into all `skill/*` branches, keeping skill branches clean (upstream core + just that skill's changes) without cross-contamination from other skills on the fork's `main`
- **Skill_Metadata**: A `skill-metadata.json` file on each skill branch documenting the skill name, tier, dependencies, and optional `also_requires` field for multi-parent skills
- **Primary_Parent**: For multi-parent skills, the skill branch chosen as the git branching parent (the more substantial dependency)
- **Also_Requires**: A metadata field listing additional skill dependencies that are not the git branching parent and must be merged separately
- **Extraction_Worktree**: A separate git worktree used for all extraction work, keeping the live service directory untouched
- **Backup_Tag**: A git tag of the form `backup/pre-fork-alignment-<timestamp>` preserving the pre-migration state of `main`
- **Cutover**: The operation of replacing `origin/main` with the new `fresh-main` via force-push
- **Non_Skill_Custom_Changes**: Fork-specific files not belonging to any skill (CLAUDE.md, CI workflows, .env.example additions, .gitignore, etc.)
- **Core_Fix**: A bug fix or improvement to upstream core files (files that exist on `upstream/main`) committed on the fork's `main` and typically PR'd upstream. Core fixes live on `main` for immediate deployment but do not propagate to Skill_Branches until upstream merges the corresponding PR

## Requirements

### Requirement 1: Safety Backup Before Migration

**User Story:** As a fork maintainer, I want a backup of the current `main` state before migration begins, so that I can roll back to the pre-migration state at any point if something goes wrong.

#### Acceptance Criteria

1. WHEN the migration begins, THE Fork SHALL create a Backup_Tag on the current `main` commit with the naming pattern `backup/pre-fork-alignment-<timestamp>`
2. WHEN the Backup_Tag is created locally, THE Fork SHALL push the Backup_Tag to `origin`
3. THE Fork SHALL verify the Backup_Tag exists on `origin` before proceeding with any destructive operations

### Requirement 2: Disable Merge-Forward CI During Migration

**User Story:** As a fork maintainer, I want the Merge_Forward_CI disabled during migration, so that it does not attempt to merge the new `main` into stale skill branches mid-migration.

#### Acceptance Criteria

1. WHEN the migration begins, THE Fork SHALL disable the `merge-forward-skills.yml` GitHub Actions workflow before any branch operations
2. WHILE the migration is in progress, THE Merge_Forward_CI SHALL remain disabled
3. WHEN the Cutover is complete and all Skill_Branches are pushed to `origin`, THE Fork SHALL re-enable the Merge_Forward_CI

### Requirement 3: Rollback Procedure

**User Story:** As a fork maintainer, I want a documented rollback procedure, so that I can restore the previous state of `main` if the migration fails at any point.

#### Acceptance Criteria

1. THE Fork SHALL support rollback by resetting `main` to the Backup_Tag and force-pushing to `origin`
2. WHEN a rollback is performed, THE Fork SHALL re-enable the Merge_Forward_CI
3. WHEN a rollback is performed, THE Fork SHALL rebuild dependencies (`npm ci && npm run build`) and restart the service

### Requirement 4: Extraction Worktree Isolation

**User Story:** As a fork maintainer, I want all extraction work to happen in a separate git worktree, so that the live service continues running undisturbed during migration.

#### Acceptance Criteria

1. WHEN extraction begins, THE Fork SHALL create an Extraction_Worktree from `main` in a directory separate from the live service
2. WHILE the migration is in progress, THE Fork SHALL perform all branch creation, cherry-picking, and merging operations in the Extraction_Worktree
3. THE Fork SHALL verify the `upstream` remote is configured and fetched in the Extraction_Worktree before proceeding

### Requirement 5: Create Clean Baseline from Upstream

**User Story:** As a fork maintainer, I want a Fresh_Main branch that exactly matches `upstream/main`, so that the new `main` starts from a clean upstream baseline.

#### Acceptance Criteria

1. THE Fork SHALL create a Fresh_Main branch from `upstream/main`
2. WHEN Fresh_Main is created, THE Fork SHALL verify it produces zero diff against `upstream/main`
3. WHEN Fresh_Main is created, THE Fork SHALL verify the upstream baseline builds successfully (`npm ci`, `npm run build`) as a hard gate before proceeding
4. WHEN Fresh_Main is created, THE Fork SHALL run the upstream test suite (`npx vitest run`) and note any failures as informational; pre-existing upstream test failures SHALL NOT block the migration

### Requirement 6: Tier 0 Skill Branch Extraction

**User Story:** As a fork maintainer, I want each Tier 0 skill extracted into its own Skill_Branch from Fresh_Main, so that each skill is independently mergeable and contains only its own changes on top of upstream.

#### Acceptance Criteria

1. THE Fork SHALL create each Tier 0 Skill_Branch by branching from Fresh_Main
2. WHEN a Tier 0 Skill_Branch is created, THE Fork SHALL include only the files belonging to that skill (cherry-picked or manually applied from the current `main`)
3. WHEN a Tier 0 Skill_Branch is created, THE Fork SHALL add a Skill_Metadata file with `name`, `description`, `tier: 0`, and `dependencies: []`
4. WHEN a Tier 0 Skill_Branch is created, THE Fork SHALL verify the branch builds and passes tests independently
5. THE Fork SHALL use explicit file staging (not `git add -A`) when committing to Skill_Branches to prevent accidental inclusion of unrelated files
6. THE Fork SHALL extract the following 8 Tier 0 skills: `ipc-handler-registry`, `lifecycle-hooks`, `whatsapp`, `container-hardening`, `perplexity-research`, `feature-request`, `task-scheduler-fixes`, `message-search`
7. WHEN extracting `skill/message-search`, THE Fork SHALL rename all WhatsApp-specific naming (package name, SKILL.md title, tool name) to channel-agnostic equivalents since the RAG code is fully channel-agnostic

### Requirement 7: Tier 1 Skill Branch Extraction with Parent Branching

**User Story:** As a fork maintainer, I want each Tier 1 skill extracted into a Skill_Branch that branches from its parent skill (not Fresh_Main), so that merging a dependent skill automatically includes its parent per the upstream spec.

#### Acceptance Criteria

1. THE Fork SHALL create each Tier 1 Skill_Branch by branching from its parent Skill_Branch (not from Fresh_Main)
2. WHEN a Tier 1 Skill_Branch is created, THE Fork SHALL include only the changes specific to that skill on top of the parent branch
3. WHEN a Tier 1 Skill_Branch is created, THE Fork SHALL add a Skill_Metadata file with the correct `tier: 1` and `dependencies` listing the parent skill
4. WHEN a Tier 1 Skill_Branch is created, THE Fork SHALL verify the branch builds and passes tests independently
5. THE Fork SHALL extract the following Tier 1 skills with their parent dependencies: `reactions` (parent: `whatsapp`), `shabbat-mode` (parent: `lifecycle-hooks`), `akiflow-sync` (parent: `container-hardening`), `whatsapp-summary` (parent: `whatsapp`), `voice-transcription-elevenlabs` (parent: `whatsapp`)

### Requirement 8: Tier 2 Skill Branch Extraction with Multi-Parent Handling

**User Story:** As a fork maintainer, I want Tier 2 skills with multiple dependencies to branch from their Primary_Parent and document additional dependencies via Also_Requires, so that the git history is clean and users know which additional skills to merge.

#### Acceptance Criteria

1. THE Fork SHALL create each Tier 2 Skill_Branch by branching from its Primary_Parent Skill_Branch
2. WHEN a Tier 2 skill has multiple dependencies, THE Fork SHALL select the more substantial dependency as the Primary_Parent for git branching
3. WHEN a Tier 2 skill has multiple dependencies, THE Fork SHALL document the non-primary dependencies in the Skill_Metadata `also_requires` field
4. WHEN a Tier 2 Skill_Branch is created, THE Fork SHALL verify the branch builds and passes tests independently
5. THE Fork SHALL extract the following Tier 2 skills: `google-home` (primary: `lifecycle-hooks`, also_requires: `ipc-handler-registry`), `group-lifecycle` (primary: `lifecycle-hooks`, also_requires: `ipc-handler-registry`), `whatsapp-replies` (primary: `whatsapp`, also_requires: `message-search`), `voice-recognition` (parent: `voice-transcription-elevenlabs`)

### Requirement 9: Dependency-Ordered Merge into Fresh_Main

**User Story:** As a fork maintainer, I want all Skill_Branches merged into Fresh_Main in dependency order (Tier 0 first, then Tier 1, then Tier 2), so that parent skills are present before their dependents and merge conflicts are minimized.

#### Acceptance Criteria

1. THE Fork SHALL merge all Tier 0 Skill_Branches into Fresh_Main before merging any Tier 1 Skill_Branches
2. THE Fork SHALL merge all Tier 1 Skill_Branches into Fresh_Main before merging any Tier 2 Skill_Branches
3. WHEN each tier of merges is complete, THE Fork SHALL verify the build and tests pass before proceeding to the next tier
4. IF a merge conflict arises during Skill_Branch merging, THEN THE Fork SHALL resolve the conflict before proceeding to the next merge
5. THE Fork SHALL merge all 17 Skill_Branches using `git merge --no-edit` to suppress the merge commit message editor and preserve default merge commit messages

### Requirement 10: Apply Non-Skill Custom Changes

**User Story:** As a fork maintainer, I want fork-specific non-skill changes applied to Fresh_Main after all skills are merged, so that custom configuration and CI workflows are preserved in the new `main`.

#### Acceptance Criteria

1. WHEN all Skill_Branches are merged into Fresh_Main, THE Fork SHALL identify remaining differences between Fresh_Main and the current `main` using `git diff`
2. THE Fork SHALL apply Non_Skill_Custom_Changes to Fresh_Main including: CLAUDE.md, `.github/workflows/` (merge-forward CI, bump-version, update-tokens), `.github/CODEOWNERS`, `.env.example` additions, `.gitignore`, `.prettierignore`, `.husky/pre-commit`, `setup/` modifications, `docs/`, `.pr_agent.toml`
3. THE Fork SHALL use explicit file staging when committing Non_Skill_Custom_Changes to prevent inclusion of secrets or build artifacts
4. WHEN Non_Skill_Custom_Changes are applied, THE Fork SHALL verify the build and tests pass

### Requirement 11: Verify No Functionality Lost

**User Story:** As a fork maintainer, I want to verify that Fresh_Main contains all functionality from the current `main`, so that no skill code or custom changes are accidentally dropped during migration.

#### Acceptance Criteria

1. WHEN all merges and custom changes are applied, THE Fork SHALL compare Fresh_Main against the current `main` using `git diff --stat` (untruncated) for the `src/` directory
2. WHEN comparing Fresh_Main to the current `main`, THE Fork SHALL verify that no source files present on `main` are missing from Fresh_Main (using `git diff --name-status` to check for files only on `main`)
3. THE Fork SHALL run the full test suite on Fresh_Main
4. THE Fork SHALL verify the container builds successfully on Fresh_Main
5. WHEN remaining differences are found, THE Fork SHALL classify each as intentional (decided not to include) or a bug (missed extraction) and fix bugs before proceeding

### Requirement 12: Cutover to New Main

**User Story:** As a fork maintainer, I want to replace `origin/main` with Fresh_Main and push all Skill_Branches, so that the fork is fully restructured and the live service runs on the new clean `main`.

#### Acceptance Criteria

1. WHEN the Cutover begins, THE Fork SHALL stop the live service before any push operations
2. BEFORE pushing new Skill_Branches, THE Fork SHALL delete the existing stale `origin/skill/*` branches that share no merge history with the new branches, OR rely on `--force-with-lease` to overwrite them; in either case the stale refs SHALL NOT remain on `origin` after cutover
3. THE Fork SHALL push all Skill_Branches to `origin` using `--force-with-lease`
4. THE Fork SHALL push Fresh_Main as the new `main` to `origin` using `--force-with-lease`
5. WHEN the new `main` is pushed, THE Fork SHALL update the live service directory (`git fetch origin`, `git reset --hard origin/main`), rebuild dependencies, rebuild the container, and restart the service
6. WHEN the service is restarted, THE Fork SHALL perform a smoke test verifying: message receipt and processing, emoji reaction lifecycle (receive → thinking → working → done), reply delivery, Google Home socket existence, and Akiflow DB container mount

### Requirement 13: Re-enable and Verify Merge-Forward CI

**User Story:** As a fork maintainer, I want the Merge_Forward_CI re-enabled and verified after cutover, so that Skill_Branches stay current with upstream core going forward without being polluted by other skills on the fork's `main`.

#### Acceptance Criteria

1. WHEN the Cutover smoke test passes, THE Fork SHALL re-enable the `merge-forward-skills.yml` workflow
2. THE Merge_Forward_CI SHALL merge `upstream/main` (not `origin/main`) into each Skill_Branch, so that skill branches remain clean: upstream core + only that skill's changes, without cross-contamination from other skills merged on the fork's `main`
3. WHEN the Merge_Forward_CI is re-enabled, THE Fork SHALL trigger it and verify it successfully merges `upstream/main` into all Skill_Branches
4. IF the Merge_Forward_CI fails for any Skill_Branch, THEN THE Fork SHALL open a GitHub issue for manual resolution of that branch
5. NOTE: Fork-specific core fixes (bug fixes to upstream files committed on `origin/main` and PR'd upstream) will NOT propagate to Skill_Branches via merge-forward until upstream merges the PR. This is intentional — skill branches stay contribution-ready. See Requirement 18 for the core-fix workflow.

### Requirement 14: Skill Dependency Hierarchy Correctness

**User Story:** As a fork maintainer, I want each Skill_Branch to have the correct git ancestry reflecting its dependency hierarchy, so that merging a skill automatically includes all its transitive dependencies.

#### Acceptance Criteria

1. THE Fork SHALL ensure every Tier 1 Skill_Branch has its parent Tier 0 Skill_Branch as a git ancestor (verifiable via `git merge-base --is-ancestor`)
2. THE Fork SHALL ensure every Tier 2 Skill_Branch has its Primary_Parent Skill_Branch as a git ancestor
3. THE Fork SHALL ensure every Skill_Branch has `upstream/main` as a git ancestor (since Fresh_Main is based on `upstream/main`)
4. WHEN a Skill_Branch is merged into Fresh_Main, THE Fork SHALL verify that the merge does not introduce changes belonging to a different skill

### Requirement 15: Skill Metadata Consistency

**User Story:** As a fork maintainer, I want each Skill_Branch to carry a Skill_Metadata file documenting its name, tier, dependencies, and multi-parent requirements, so that tooling and humans can understand the dependency graph.

#### Acceptance Criteria

1. THE Fork SHALL include a `skill-metadata.json` file on every Skill_Branch
2. THE Skill_Metadata SHALL contain the fields: `name` (string), `description` (string), `tier` (integer: 0, 1, or 2), `dependencies` (array of parent skill names)
3. WHEN a skill has non-primary dependencies, THE Skill_Metadata SHALL include an `also_requires` field (array of skill names) listing dependencies not captured by git ancestry
4. THE Skill_Metadata `dependencies` field SHALL list only the direct git branching parent (empty array for Tier 0 skills)

### Requirement 16: Upstream Merge Compatibility

**User Story:** As a fork maintainer, I want the restructured `main` to support trivial `git merge upstream/main` operations, so that future upstream updates can be applied without conflicts.

#### Acceptance Criteria

1. WHEN the migration is complete, THE Fork SHALL support `git merge upstream/main` with zero conflicts when upstream has not modified files touched by skills
2. THE Fork SHALL maintain proper git merge-base ancestry between `main` and `upstream/main` so that three-way merges function correctly
3. WHEN upstream creates Skill_Branches that overlap with the fork's skills, THE Fork SHALL support switching to the upstream Skill_Branch by comparing, testing, and optionally creating a `skill/<name>-extras` branch for fork-specific additions

### Requirement 17: Post-Cutover Cleanup

**User Story:** As a fork maintainer, I want the Extraction_Worktree and temporary branches removed after successful cutover, so that no stale working directories or refs remain.

#### Acceptance Criteria

1. WHEN the Cutover is complete and the smoke test passes, THE Fork SHALL remove the Extraction_Worktree using `git worktree remove`
2. WHEN the Cutover is complete, THE Fork SHALL delete the local `fresh-main` branch ref since its contents have been pushed as the new `main`

### Requirement 18: Core Fix Workflow

**User Story:** As a fork maintainer who frequently fixes bugs in upstream core files, I want a clear workflow for how core fixes interact with the merge-forward CI and skill branches, so that fixes are deployed immediately on `main` while skill branches remain clean and contribution-ready.

#### Acceptance Criteria

1. THE Fork SHALL commit Core_Fixes directly on `main` and open corresponding PRs upstream
2. Core_Fixes on `main` SHALL be deployed immediately via the live service (since `main` is the deployment target)
3. THE Merge_Forward_CI SHALL NOT propagate Core_Fixes to Skill_Branches — skill branches receive core fixes only when upstream merges the PR and the next merge-forward cycle picks up the updated `upstream/main`
4. IF a Skill_Branch fails to build or test in the Merge_Forward_CI due to a missing Core_Fix that is pending upstream, THEN THE Fork SHALL treat this as an expected transient failure and open a GitHub issue (per standard merge-forward failure handling)
5. IF a Core_Fix is urgently needed on a specific Skill_Branch (e.g., for active skill development), THEN THE Fork MAY manually cherry-pick the fix onto that Skill_Branch as a temporary measure; the cherry-pick SHALL merge cleanly once upstream includes the fix via merge-forward
6. IF upstream does not merge the Core_Fix PR (rejected or abandoned), THEN the cherry-pick from criterion 5 becomes the permanent resolution for affected Skill_Branches
7. THE Fork SHALL NOT package Core_Fixes as skills — core fixes are patches to upstream files, not feature additions, and belong on `main` as regular commits
