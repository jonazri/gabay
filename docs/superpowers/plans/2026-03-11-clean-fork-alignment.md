# Clean Fork Alignment — Main Tracks Upstream

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure our fork so `main` is upstream + merged skill branches + custom changes, giving us zero-conflict upstream merges and clean skill branch management.

**Architecture:** Reset `main` to `upstream/main`, extract each of our 17 features into clean `skill/*` branches (branched from the appropriate parent), then merge them back into `main` in dependency order. The result: `main` is our deployment target, skill branches are maintained independently, merge-forward CI keeps everything in sync.

**Tech Stack:** Git (branching, cherry-pick, merge), TypeScript, systemd

**Upstream spec:** `docs/skills-as-branches.md` on `qwibitai/nanoclaw` — our approach aligns with the upstream model where forks merge skill branches into their `main`.

---

## Context

### Current state

- `main` has ALL 17 skills baked directly into `src/` (202 commits ahead of upstream)
- 17 `origin/skill/*` branches exist but are stale — they don't share merge history with main
- Upstream has only 3 skill branches so far: `apple-container`, `compact`, `ollama-tool`
- None of our skills overlap with upstream's current branches
- The merge-forward CI exists but doesn't help since skill branches diverged

### Target state

```
upstream/main ──→ our main
                    ├── git merge origin/skill/whatsapp
                    ├── git merge origin/skill/reactions
                    ├── git merge origin/skill/shabbat-mode
                    ├── ... (all 17 skills)
                    └── custom non-skill commits (CLAUDE.md, CI, .env.example)
```

- `git merge upstream/main` — trivial, no conflicts
- `git merge origin/skill/foo` — updates a single skill
- Each skill branch: based on its parent (main or another skill), contains only that skill's changes
- Merge-forward CI: auto-merges `main` into all `origin/skill/*` branches

### Upstream alignment

The upstream spec (`skills-as-branches.md`) says:
- **Fork's `main` IS the customized version** — upstream main + skills + custom changes
- **Skills are branches**, applied via `git merge`
- **Dependent skills branch from parent**, not from `main` (e.g., `skill/voice-recognition` branches from `skill/voice-transcription-elevenlabs`)
- **Merge-forward CI** keeps skill branches current with main
- **No separate deploy branch needed** — main IS deploy

**Multi-repo topology (actual implementation):** Upstream splits channel-specific skills into separate repos:
- `qwibitai/nanoclaw` — core + channel-agnostic skills (`apple-container`, `compact`, `ollama-tool`)
- `qwibitai/nanoclaw-whatsapp` — WhatsApp channel + WhatsApp skills (`reactions`, `voice-transcription`, `image-vision`, `pdf-reader`, `local-whisper`)
- `qwibitai/nanoclaw-telegram`, `nanoclaw-discord`, `nanoclaw-slack`, `nanoclaw-gmail` — channel-specific repos (main branch only for now)

This means upstream's WhatsApp skills are NOT at `upstream/skill/whatsapp` but at a separate remote (`whatsapp/skill/reactions`). Our plan keeps all skills on `origin` (our fork), which is correct for our workflow. When adopting upstream skills, we add the channel fork as a remote.

**Fork-specific artifacts:** We use `skill-metadata.json` on each branch for dependency tracking. Upstream says dependencies are implicit in git history. Our metadata is not harmful (upstream ignores it) but is non-standard — may need renaming if upstream introduces their own format.

### Skill inventory

| Our skill | Tier | Depends on | Files touched | Upstream equivalent |
|-----------|------|------------|---------------|-------------------|
| whatsapp | 0 | main | 9 new + 5 modified | `nanoclaw-whatsapp` repo (separate remote) |
| ipc-handler-registry | 0 | main | 3 new + 1 modified | None |
| lifecycle-hooks | 0 | main | 4 new + 1 modified | None |
| container-hardening | 0 | main | 1 modified | None |
| perplexity-research | 0 | main | 2 new (container) | None |
| feature-request | 0 | main | 1 new (container) | None |
| task-scheduler-fixes | 0 | main | 1 modified | None |
| message-search | 0 | main | RAG system files | None (renamed from whatsapp-search; code is fully channel-agnostic) |
| reactions | 1 | whatsapp | 3 new + 3 modified | `nanoclaw-whatsapp/skill/reactions` |
| shabbat-mode | 1 | lifecycle-hooks | 3 new + 1 modified | None |
| akiflow-sync | 1 | container-hardening | 48 files (standalone service) | None |
| whatsapp-summary | 1 | whatsapp | Container skill | None (tightly coupled to WhatsApp JID format + formatting) |
| voice-transcription-elevenlabs | 1 | whatsapp | 1 new + 2 modified | `nanoclaw-whatsapp/skill/voice-transcription` |
| google-home | 2 | lifecycle-hooks, ipc-handler-registry | 4 new + 2 modified | None |
| group-lifecycle | 2 | lifecycle-hooks, ipc-handler-registry | 1 new + 1 modified | None |
| whatsapp-replies | 2 | whatsapp, message-search | 3 new + 2 modified | None |
| voice-recognition | 2 | voice-transcription-elevenlabs | 2 new + 2 modified | None |

**Changes from initial audit:**
- `whatsapp-search` renamed to `message-search` (Tier 0) — RAG code is fully channel-agnostic, only naming was WhatsApp-specific
- `whatsapp-summary` moved from Tier 0 to Tier 1 (depends on whatsapp) — hardcoded `@g.us` JID filter and WhatsApp formatting
- `voice-transcription-elevenlabs` moved from Tier 2 to Tier 1 (depends on whatsapp, NOT reactions) — no code dependency on reactions; the old Tier 2 classification was a merge-conflict workaround
- `voice-recognition` moves from Tier 3 to Tier 2 accordingly

### Non-skill custom changes

These go directly on `main` after all skills are merged:
- `CLAUDE.md` — fork-specific instructions
- `.github/workflows/` — merge-forward CI, bump-version, update-tokens
- `.github/CODEOWNERS`
- `.env.example` — additional env vars
- `.gitignore`, `.prettierignore`, `.husky/pre-commit`
- `setup/` modifications (whatsapp-auth.ts, container tweaks)
- `docs/` — plans, requirements
- `.pr_agent.toml`

---

## Chunk 1: Preparation and Safety

### Task 1: Create safety backup and disable CI

**Files:** None (git operations only)

- [ ] **Step 1: Tag current state**

```bash
cd ~/code/yonibot/gabay
git tag backup/pre-fork-alignment-$(date +%Y%m%d-%H%M%S) main
git push origin --tags
```

- [ ] **Step 2: Verify backup tag exists**

```bash
git tag -l 'backup/pre-fork-alignment-*'
```

Expected: One tag listed

- [ ] **Step 3: Disable merge-forward CI**

The merge-forward CI triggers on push to `main`. If it fires mid-migration (when old skill branches are still on origin), it will try to merge the new main into stale branches, causing chaos.

```bash
# Disable via GitHub API
gh workflow disable merge-forward-skills.yml
```

Re-enable after Task 15 (cutover) is complete.

- [ ] **Step 4: Document rollback procedure**

Rollback at any point:
```bash
git checkout main
git reset --hard backup/pre-fork-alignment-<timestamp>
git push --force origin main
gh workflow enable merge-forward-skills.yml
npm ci && npm run build
systemctl --user restart nanoclaw
```

### Task 2: Create the extraction worktree

**Files:** None (git operations only)

- [ ] **Step 1: Create worktree for extraction work**

```bash
cd ~/code/yonibot/gabay
git worktree add ../gabay-extraction main
cd ../gabay-extraction
```

All extraction work happens here. The live service continues running from `~/code/yonibot/gabay`.

- [ ] **Step 2: Verify upstream remote**

```bash
git remote -v | grep upstream
git fetch upstream
```

Expected: upstream = `qwibitai/nanoclaw`

### Task 3: Create clean baseline branch

**Files:** None (git operations only)

- [ ] **Step 1: Create `fresh-main` from upstream/main**

```bash
git checkout -b fresh-main upstream/main
```

This is the starting point. We'll merge skills into this branch one at a time.

- [ ] **Step 2: Verify it matches upstream exactly**

```bash
git diff upstream/main
```

Expected: No diff

- [ ] **Step 3: Install upstream dependencies**

```bash
npm ci
npm run build
npx vitest run
```

Expected: All pass. This confirms the upstream baseline is healthy.

---

## Chunk 2: Extract Tier 0 Skills (Independent)

These skills have no dependencies — they branch from `fresh-main` (which is `upstream/main`).

**Strategy for each skill:**
1. Create `skill/<name>` branch from `fresh-main`
2. Cherry-pick or manually apply ONLY that skill's changes from current `main`
3. Verify build + tests pass on the skill branch
4. Commit on the skill branch (do NOT merge into fresh-main yet)

**Important:** Do not merge skills into `fresh-main` during this chunk. Create all skill branches first, then merge in dependency order in Chunk 4. This prevents extraction errors from being masked by other skills' code.

### Task 4: Extract `skill/ipc-handler-registry`

**Files on skill branch:**
- Create: `src/ipc-handlers.ts`
- Create: `src/ipc-handlers.test.ts`
- Modify: `src/ipc.ts` (import and use registry)

- [ ] **Step 1: Create skill branch**

```bash
git checkout fresh-main
git checkout -b skill/ipc-handler-registry
```

- [ ] **Step 2: Extract changes from current main**

Use `git show main:<path>` for new files. For modified files, diff current main against upstream to isolate just this skill's changes.

```bash
# New files
git show main:src/ipc-handlers.ts > src/ipc-handlers.ts
git show main:src/ipc-handlers.test.ts > src/ipc-handlers.test.ts
# Modified files: manually apply only ipc-handler-registry changes to src/ipc.ts
```

- [ ] **Step 3: Add skill-metadata.json**

```json
{
  "name": "ipc-handler-registry",
  "description": "Modular IPC handler registration system",
  "tier": 0,
  "dependencies": []
}
```

- [ ] **Step 4: Build and test**

```bash
npm run build
npx vitest run
```

Expected: All pass

- [ ] **Step 5: Commit (explicit file adds, not -A)**

```bash
git add src/ipc-handlers.ts src/ipc-handlers.test.ts src/ipc.ts skill-metadata.json
git status  # verify staging area — no unexpected files
git commit -m "feat: create skill/ipc-handler-registry branch"
```

### Task 5: Extract `skill/lifecycle-hooks`

**Files on skill branch:**
- Create: `src/lifecycle.ts`, `src/lifecycle.test.ts`
- Create: `src/message-events.ts`, `src/message-events.test.ts`
- Modify: `src/index.ts` (import and call lifecycle hooks)

- [ ] **Steps 1-5: Branch from `fresh-main`, extract, build+test, commit**

### Task 6: Extract `skill/whatsapp`

**Files on skill branch:**
- Create: `src/channels/whatsapp.ts`, `src/channels/whatsapp.test.ts`
- Create: `src/whatsapp-auth.ts`, `src/qrcode-terminal.d.ts`
- Modify: `src/channels/index.ts` (register whatsapp)
- Modify: `src/types.ts` (WhatsApp-specific types)
- Modify: `package.json` (baileys dependency)
- Modify: `setup/index.ts`, `setup/whatsapp-auth.ts`

This is the largest tier-0 skill. Extract carefully.

- [ ] **Steps 1-5: Branch from `fresh-main`, extract, build+test, commit**

### Task 7: Extract remaining Tier 0 skills

Follow the same pattern for each (branch from `fresh-main`, extract, build+test, commit):

- [ ] **`skill/container-hardening`** — Modifications to `src/container-runner.ts` and container `Dockerfile`
- [ ] **`skill/perplexity-research`** — Container skill files + `container/skills/perplexity-research/`
- [ ] **`skill/feature-request`** — Container skill files + `container/skills/feature-request/`
- [ ] **`skill/task-scheduler-fixes`** — Modifications to `src/task-scheduler.ts`
- [ ] **`skill/message-search`** — RAG system files (`rag-system/`). Renamed from whatsapp-search — code is fully channel-agnostic; rename package name in `rag-system/package.json`, SKILL.md title, and tool name in container skill.

---

## Chunk 3: Extract Tier 1+ Skills (Dependent)

**Critical rule per upstream spec:** Dependent skills branch from their **parent skill branch**, NOT from `fresh-main`. This way merging a dependent skill automatically includes its parent. E.g., merging `skill/reactions` gives you whatsapp + reactions.

**Multi-parent skills:** Git doesn't support branching from two parents. For skills with two dependencies (google-home, group-lifecycle, whatsapp-replies), pick the primary parent to branch from. The other dependency must be merged separately by the user. Document this in the skill-metadata.json.

### Task 8: Extract `skill/reactions`

**Depends on:** `skill/whatsapp`

- [ ] **Step 1: Branch from parent skill (whatsapp), NOT fresh-main**

```bash
git checkout skill/whatsapp
git checkout -b skill/reactions
```

This skill branch now contains upstream/main + whatsapp + reactions.

**Files (reactions-only, on top of whatsapp):**
- Create: `src/status-tracker.ts`
- Create: `src/status-tracker.test.ts`
- Create: `container/skills/reactions/SKILL.md`
- Modify: `src/index.ts` (StatusTracker integration, markReceived/Thinking/Working/Done)
- Modify: `src/db.ts` (reactions table)
- Modify: `src/ipc.ts` (reaction IPC handling)
- Modify: `src/channels/whatsapp.ts` (sendReaction, reaction events)

- [ ] **Steps 2-5: Extract reactions-only changes, build+test, commit**

`skill-metadata.json`:
```json
{
  "name": "reactions",
  "description": "Emoji status reactions for message lifecycle",
  "tier": 1,
  "dependencies": ["whatsapp"]
}
```

### Task 9: Extract `skill/shabbat-mode`

**Depends on:** `skill/lifecycle-hooks`

- [ ] **Branch from `skill/lifecycle-hooks`, extract shabbat-only changes**

```bash
git checkout skill/lifecycle-hooks
git checkout -b skill/shabbat-mode
```

**Files:**
- Create: `src/shabbat.ts`, `src/shabbat.test.ts`
- Create: `data/shabbat-schedule.json`
- Modify: `src/index.ts` (shabbat guard)

### Task 10: Extract `skill/akiflow-sync`

**Depends on:** `skill/container-hardening`

- [ ] **Branch from `skill/container-hardening`, extract akiflow-only changes**

```bash
git checkout skill/container-hardening
git checkout -b skill/akiflow-sync
```

**Files:**
- Create: `akiflow-sync/` (entire directory — 48 files)
- Create: `container/skills/akiflow/`
- Modify: `src/container-runner.ts` (akiflow mount)
- Modify: `.env.example` (AKIFLOW_* vars)

### Task 11: Extract `skill/whatsapp-summary`

**Depends on:** `skill/whatsapp` (uses `@g.us` JID filter, WhatsApp formatting)

- [ ] **Branch from `skill/whatsapp`, extract summary-only changes**

```bash
git checkout skill/whatsapp
git checkout -b skill/whatsapp-summary
```

**Files:**
- Create: `container/skills/whatsapp-summary/SKILL.md`
- Any scheduled task configuration in `src/task-scheduler.ts` related to summaries

### Task 12: Extract `skill/voice-transcription-elevenlabs`

**Depends on:** `skill/whatsapp` (NOT reactions — verified: no code dependency on StatusTracker)

- [ ] **Branch from `skill/whatsapp`, extract transcription-only changes**

```bash
git checkout skill/whatsapp
git checkout -b skill/voice-transcription-elevenlabs
```

**Files:**
- Create: `src/transcription.ts`
- Modify: `src/channels/whatsapp.ts` (voice message handling in `messages.upsert`)

### Task 13: Extract Tier 2 skills

- [ ] **`skill/google-home`** (depends on lifecycle-hooks + ipc-handler-registry)

  **Multi-parent strategy:** Branch from `skill/lifecycle-hooks` (primary — more substantial). Users must also merge `skill/ipc-handler-registry` separately.

  ```bash
  git checkout skill/lifecycle-hooks
  git checkout -b skill/google-home
  ```

  Files:
  - Create: `src/google-assistant.ts`, `src/ipc-handlers/google-home.ts`
  - Create: `scripts/google-assistant-daemon.py`, `scripts/google-assistant-setup.py`
  - Create: `container/skills/google-home/`
  - Modify: `src/index.ts` (socket startup/shutdown)

  `skill-metadata.json`:
  ```json
  {
    "name": "google-home",
    "tier": 2,
    "dependencies": ["lifecycle-hooks"],
    "also_requires": ["ipc-handler-registry"]
  }
  ```

- [ ] **`skill/group-lifecycle`** (depends on lifecycle-hooks + ipc-handler-registry)

  Same multi-parent strategy: branch from `skill/lifecycle-hooks`, document `also_requires`.

  ```bash
  git checkout skill/lifecycle-hooks
  git checkout -b skill/group-lifecycle
  ```

  Files:
  - Create: `src/ipc-handlers/group-lifecycle.ts`

- [ ] **`skill/whatsapp-replies`** (depends on whatsapp + message-search)

  Multi-parent: branch from `skill/whatsapp`, document `also_requires: message-search`.

  ```bash
  git checkout skill/whatsapp
  git checkout -b skill/whatsapp-replies
  ```

  Files:
  - Modify: `src/channels/whatsapp.ts` (reply context)
  - Modify: `src/db.ts` (reply storage)

- [ ] **`skill/voice-recognition`** (depends on voice-transcription-elevenlabs)

  ```bash
  git checkout skill/voice-transcription-elevenlabs
  git checkout -b skill/voice-recognition
  ```

  Files:
  - Create: `src/voice-recognition.ts`
  - Modify: `src/config.ts`
  - Modify: `src/channels/whatsapp.ts`

---

## Chunk 4: Merge Skills into fresh-main, Custom Changes, and Cutover

### Task 13: Merge all skill branches into fresh-main

Now that all skill branches are created and individually validated, merge them into `fresh-main` in dependency order.

- [ ] **Step 1: Merge Tier 0 skills (any order)**

```bash
git checkout fresh-main
git merge skill/ipc-handler-registry --no-edit
git merge skill/lifecycle-hooks --no-edit
git merge skill/whatsapp --no-edit
git merge skill/container-hardening --no-edit
git merge skill/perplexity-research --no-edit
git merge skill/feature-request --no-edit
git merge skill/task-scheduler-fixes --no-edit
git merge skill/message-search --no-edit
npm run build && npx vitest run
```

- [ ] **Step 2: Merge Tier 1 skills**

```bash
git merge skill/reactions --no-edit                        # parent: whatsapp
git merge skill/shabbat-mode --no-edit                     # parent: lifecycle-hooks
git merge skill/akiflow-sync --no-edit                     # parent: container-hardening
git merge skill/whatsapp-summary --no-edit                 # parent: whatsapp
git merge skill/voice-transcription-elevenlabs --no-edit   # parent: whatsapp (NOT reactions)
npm run build && npx vitest run
```

- [ ] **Step 3: Merge Tier 2 skills**

```bash
git merge skill/google-home --no-edit         # parent: lifecycle-hooks; also_requires: ipc-handler-registry
git merge skill/group-lifecycle --no-edit     # parent: lifecycle-hooks; also_requires: ipc-handler-registry
git merge skill/whatsapp-replies --no-edit    # parent: whatsapp; also_requires: message-search
git merge skill/voice-recognition --no-edit   # parent: voice-transcription-elevenlabs
npm run build && npx vitest run
```

If any merge conflicts arise, resolve them — this is expected when multiple skills modify the same files (especially `src/index.ts`, `src/db.ts`, `src/ipc.ts`).

### Task 14: Apply non-skill custom changes

These are fork-specific changes that aren't part of any skill.

- [ ] **Step 1: Identify non-skill changes**

```bash
# Diff current main vs fresh-main to find remaining differences
git diff fresh-main..main --name-only | sort
```

Review each file — anything not covered by a skill branch is a custom change.

- [ ] **Step 2: Apply custom changes to fresh-main**

```bash
git checkout fresh-main
# Cherry-pick or manually apply:
# - CLAUDE.md
# - .github/workflows/ (merge-forward, CI, bump-version)
# - .github/CODEOWNERS
# - .env.example additions
# - .gitignore, .prettierignore, .husky/pre-commit
# - setup/ modifications (non-whatsapp changes)
# - .pr_agent.toml
```

- [ ] **Step 3: Build and test**

```bash
npm run build
npx vitest run
```

- [ ] **Step 4: Commit with explicit file adds**

```bash
git add CLAUDE.md .github/ .env.example .gitignore .prettierignore .husky/ .pr_agent.toml
git status  # verify — no secrets, no build artifacts
git commit -m "chore: apply fork-specific custom changes"
```

### Task 15: Verify fresh-main matches current functionality

- [ ] **Step 1: Count remaining differences against current main**

```bash
# Count remaining diffs by file — don't truncate
git diff --stat fresh-main..main -- src/
```

Review every remaining diff. Each one should be either:
- Intentional (we decided not to include something)
- Bug (we missed extracting something — fix before proceeding)

- [ ] **Step 2: Verify no functionality was lost**

```bash
# Check that all source files from main exist on fresh-main
git diff --name-status fresh-main..main -- src/ | grep '^A'  # files on main but not fresh-main
```

Expected: Empty (all files extracted). If any remain, go back and add them to the appropriate skill branch.

- [ ] **Step 3: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 4: Test container build**

```bash
./container/build.sh
```

### Task 16: Cutover

- [ ] **Step 1: Stop the live service**

```bash
cd ~/code/yonibot/gabay
systemctl --user stop nanoclaw
```

This prevents the service from pulling stale state during the swap.

- [ ] **Step 2: Push all skill branches**

```bash
cd ../gabay-extraction
for branch in $(git branch | grep 'skill/' | sed 's/^..//'); do
  git push origin "$branch" --force-with-lease
done
```

- [ ] **Step 3: Push fresh-main as new main**

```bash
git push origin fresh-main:main --force-with-lease
```

**IMPORTANT: Confirm with user before this step.** This replaces main on origin.

- [ ] **Step 4: Update live directory and restart**

```bash
cd ~/code/yonibot/gabay
git fetch origin
git reset --hard origin/main
npm ci
npm run build
./container/build.sh
systemctl --user start nanoclaw
```

- [ ] **Step 5: Smoke test**

Send a test message to Andy on WhatsApp. Verify:
- Message received and processed
- Emoji reactions fire (👀→💭→🔄→✅)
- Reply comes back
- Google Home socket exists (`data/sockets/google-assistant.sock`)
- Akiflow DB mounted in container

- [ ] **Step 6: Re-enable merge-forward CI**

```bash
gh workflow enable merge-forward-skills.yml
```

Push a trivial commit to main and verify the CI successfully merges into all skill branches.

- [ ] **Step 7: Clean up**

```bash
cd ~/code/yonibot/gabay
git worktree remove ../gabay-extraction
```

### Task 17: Update CI and documentation

- [ ] **Step 1: Verify merge-forward CI works**

The workflow should already be correct. After re-enabling it (Task 16, Step 6), verify it:
- Lists all `skill/*` branches
- Merges `main` into each
- Builds + tests
- Pushes or opens issue on failure

- [ ] **Step 2: Update CLAUDE.md**

Update the build model section to reflect:
- Main = upstream + skills merged + custom changes
- `git merge upstream/main` for core updates
- Each skill is a clean branch based on its parent (not main)
- Multi-parent skills use `also_requires` in metadata
- Merge-forward CI keeps skills current

- [ ] **Step 3: Update MEMORY.md**

Update with the new pattern and remove obsolete overlay references.

---

## Chunk 5: Future Upstream Skill Adoption

This chunk is documentation, not immediate work.

### Task 17: Plan for upstream skill branch adoption

When upstream creates `skill/whatsapp` (currently planned but not yet created):

- [ ] **Step 1: Compare upstream vs ours**

```bash
git diff upstream/skill/whatsapp..origin/skill/whatsapp -- src/
```

- [ ] **Step 2: If compatible, switch to upstream's**

```bash
# On a test branch:
git checkout -b test/upstream-whatsapp fresh-main-without-our-whatsapp
git merge upstream/skill/whatsapp
# Test, verify, then update our main
```

- [ ] **Step 3: If we have extras upstream doesn't**

Create `skill/whatsapp-extras` that branches from `upstream/skill/whatsapp` and adds our additional functionality. Merge both:

```bash
git merge upstream/skill/whatsapp
git merge origin/skill/whatsapp-extras
```

This keeps us aligned with upstream while preserving our customizations.

---

## Risk Assessment

| Risk | Mitigation |
|------|------------|
| Extraction misses functionality | Full `git diff --stat` (not truncated) vs main before cutover |
| Skill boundaries wrong (file in wrong skill) | Build+test each branch independently, then after each merge |
| Service downtime during cutover | Stop service, swap, rebuild, start — ~2 min window |
| Can't roll back | Backup tag created in Task 1; `git reset --hard` to restore |
| Merge-forward CI fires mid-migration | Disabled in Task 1, re-enabled after cutover |
| Multi-parent skills can't branch from 2 parents | Pick primary parent, document `also_requires` in metadata |
| Upstream creates skill branches we already have | Switch to theirs when available — git merge handles it |
| Force-push destroys concurrent changes | Use `--force-with-lease`; CI disabled during migration |

## Estimated effort

- **Chunk 1** (Preparation): 10 minutes
- **Chunk 2** (Tier 0 extraction): 2-3 hours (9 skills, ~15-20 min each)
- **Chunk 3** (Tier 1+ extraction): 1-2 hours (8 skills with dependencies)
- **Chunk 4** (Custom changes + cutover): 30-60 minutes
- **Chunk 5** (Future planning): Documentation only

Total: ~4-6 hours of focused work, suitable for subagent-driven parallelization of independent tier-0 skills.

## Parallelization opportunities

Tier 0 skills are independent and can be extracted in parallel by subagents:
- Each subagent creates one skill branch from `fresh-main`
- Subagents work in isolated worktrees
- After all finish, merge them into `fresh-main` sequentially (order doesn't matter for tier-0)
- Tier 1+ must be sequential (dependency order)
