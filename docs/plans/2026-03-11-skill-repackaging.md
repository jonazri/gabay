# Skill Repackaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Commit all manual fixes from `docs/plans/2026-03-10-manual-fixes-to-package.md` into their proper skill overlays and build tooling.

**Architecture:** Minimal targeted fixes — commit overlay changes already in place, migrate NODE_EXTRA_CA_CERTS to container-hardening, add build guards, clean up obsolete skill. All overlays stay minimal-diff (delta, not accumulated).

**Tech Stack:** TypeScript (skills engine), bash (container build), YAML (manifests)

---

### Task 1: Commit Already-Done Skill Overlay Changes

These files already contain the fixes from manual stabilization. Stage and commit them as a single logical unit.

**Files:**
- Modified: `.claude/skills/add-reactions/modify/src/index.ts` (fixes #2, #9, #10)
- Modified: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md` (fix #11)
- Modified: `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/akiflow-functions.sh` (fix #11)
- Modified: `.claude/skills/add-perplexity-research/manifest.yaml` (fix #8)
- Modified: `.claude/skills/add-perplexity-research/add/container/skills/perplexity-research/SKILL.md` (fix #8)
- New: `.claude/skills/add-perplexity-research/add/container/skills/perplexity-research/perplexity` (fix #8)
- New: `.claude/skills/add-perplexity-research/modify/container/Dockerfile` (fix #8)
- Modified: `.claude/skills/add-google-home/add/src/google-assistant.ts` (fix #13 logging)
- Modified: `scripts/clean-skills.ts` (fix #13 runtime restore)
- Modified: `package-lock.json`

**Step 1: Verify changes are correct**

Run:
```bash
git diff --stat .claude/skills/ scripts/clean-skills.ts package-lock.json
```
Expected: ~8 modified files, ~2 new files, ~300 lines changed

**Step 2: Stage and commit**

```bash
git add \
  .claude/skills/add-reactions/modify/src/index.ts \
  .claude/skills/add-akiflow-sync/add/container/skills/akiflow/ \
  .claude/skills/add-perplexity-research/ \
  .claude/skills/add-google-home/add/src/google-assistant.ts \
  scripts/clean-skills.ts \
  package-lock.json

git commit -m "fix: package post-PR-50 manual fixes into skill overlays

- reactions: self-chat filter, markAllDone on success, conflict resolution (#2, #9, #10)
- akiflow-sync: local-time formatting with --utc flag (#11)
- perplexity-research: CLI wrapper with search/pro/deep subcommands (#8)
- google-home: daemon stderr logging fix (msg -> stderr field) (#13)
- clean-skills: auto-restore runtime files after cleaning (#13)"
```

**Step 3: Verify build**

```bash
rm -rf .nanoclaw/base && npm run build
```
Expected: All 18 skills apply, TypeScript compiles, runtime files restored.

---

### Task 2: Move NODE_EXTRA_CA_CERTS to Container-Hardening (#4)

**Files:**
- Modify: `.claude/skills/add-container-hardening/manifest.yaml` — add `container/Dockerfile` to modifies
- Create: `.claude/skills/add-container-hardening/modify/container/Dockerfile` — overlay with NODE_EXTRA_CA_CERTS
- Modify: `.claude/skills/add-google-home/modify/container/Dockerfile` — remove NODE_EXTRA_CA_CERTS lines
- Modify: `.nanoclaw/installed-skills.yaml` — reorder container-hardening before reactions

**Step 1: Update installed-skills.yaml**

Move `container-hardening` from position 9 to position 5 (after `ipc-handler-registry`, before `reactions`):

```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry
  - container-hardening      # moved: infra before features
  - reactions
  - group-lifecycle
  - google-home
  - shabbat-mode
  - task-scheduler-fixes
  - voice-transcription-elevenlabs
  - voice-recognition
  - whatsapp-search
  - perplexity-research
  - feature-request
  - whatsapp-summary
  - whatsapp-replies
  - akiflow-sync
```

**Step 2: Add Dockerfile to container-hardening manifest**

In `.claude/skills/add-container-hardening/manifest.yaml`, add `container/Dockerfile` to the `modifies` list:

```yaml
modifies:
  - src/group-queue.ts
  - src/container-runner.ts
  - container/Dockerfile
```

**Step 3: Create container-hardening Dockerfile overlay**

Create `.claude/skills/add-container-hardening/modify/container/Dockerfile`. This is a delta against the upstream base Dockerfile. The ONLY change is adding `NODE_EXTRA_CA_CERTS`:

Take the upstream base `container/Dockerfile` (from `git show HEAD:container/Dockerfile`) and add these two lines after the `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` line:

```dockerfile
# Use system CA certs so Node.js fetch/WebFetch works with HTTPS
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
```

The overlay file must be the FULL upstream Dockerfile with only this two-line addition. No other changes.

**Step 4: Remove NODE_EXTRA_CA_CERTS from google-home Dockerfile overlay**

In `.claude/skills/add-google-home/modify/container/Dockerfile`, remove lines 33-34:
```
# Use system CA certs so Node.js fetch/WebFetch works with HTTPS
ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt
```

The google-home overlay should now only add: `jq` to apt-get, google-home CLI COPY+chmod, `/workspace/ipc/responses` and `/workspace/sockets` to workspace dirs.

**Step 5: Clean, rebuild, verify**

```bash
rm -rf .nanoclaw/base && npm run build
```
Expected: All 18 skills apply cleanly. Verify the final Dockerfile includes NODE_EXTRA_CA_CERTS:
```bash
npm run apply-skills && grep NODE_EXTRA_CA_CERTS container/Dockerfile && npm run clean-skills -- --force
```

**Step 6: Commit**

```bash
git add \
  .nanoclaw/installed-skills.yaml \
  .claude/skills/add-container-hardening/manifest.yaml \
  .claude/skills/add-container-hardening/modify/container/Dockerfile \
  .claude/skills/add-google-home/modify/container/Dockerfile

git commit -m "refactor: move NODE_EXTRA_CA_CERTS from google-home to container-hardening

Not google-home-specific — all containers need system CA certs for
Node.js HTTPS. Also reorders container-hardening before feature skills
in install order."
```

---

### Task 3: Add Dirty-Check Guard to apply-skills Init (#3, #5, #12)

**Files:**
- Modify: `skills-engine/init.ts` — add dirty-check before snapshotting
- Modify: `package.json` — add `build:container` script

**Step 1: Add dirty-check to initNanoclawDir()**

In `skills-engine/init.ts`, at the top of `initNanoclawDir()` (before the "Create structure" comment on line 33), add:

```typescript
  // Guard: refuse to snapshot dirty src/ or container/ — the base would be wrong
  if (isGitRepo()) {
    try {
      execSync('git diff --quiet HEAD -- src/ container/', {
        cwd: projectRoot,
        stdio: 'pipe',
      });
    } catch {
      const dirty = execSync('git diff --name-only HEAD -- src/ container/', {
        cwd: projectRoot,
        encoding: 'utf-8',
      }).trim();
      console.error(
        `Error: src/ or container/ has uncommitted changes — base snapshot would be wrong.\n` +
        `Dirty files:\n${dirty}\n\n` +
        `Fix: git checkout -- src/ container/ && git clean -fd src/ container/ && rm -rf .nanoclaw/base`,
      );
      process.exit(1);
    }

    // Also check for untracked files in src/ and container/
    const untracked = execSync(
      'git ls-files --others --exclude-standard src/ container/',
      { cwd: projectRoot, encoding: 'utf-8' },
    ).trim();
    if (untracked) {
      console.error(
        `Error: Untracked files in src/ or container/ — base snapshot would be wrong.\n` +
        `Untracked:\n${untracked}\n\n` +
        `Fix: git clean -fd src/ container/ && rm -rf .nanoclaw/base`,
      );
      process.exit(1);
    }
  }
```

No `--force` flag needed here — the `apply-skills` caller already supports it and can skip `initNanoclawDir()` entirely if the base already exists.

**Step 2: Add build:container script to package.json**

In `package.json` scripts section, add:

```json
"build:container": "tsx scripts/apply-skills.ts && ./container/build.sh && tsx scripts/clean-skills.ts --force"
```

**Step 3: Verify guard works**

```bash
# Dirty the tree, then try to init:
echo "// test" >> src/index.ts
rm -rf .nanoclaw/base
npm run apply-skills 2>&1 | head -10
# Expected: Error about dirty files

# Clean up:
git checkout -- src/index.ts
```

**Step 4: Verify clean build works**

```bash
rm -rf .nanoclaw/base && npm run build
```
Expected: All skills apply cleanly.

**Step 5: Commit**

```bash
git add skills-engine/init.ts package.json
git commit -m "fix: add dirty-check guard to apply-skills init

Prevents stale base snapshots when src/ or container/ have leftover
changes from a previous partial apply. Also adds build:container
script for correct container rebuild sequence."
```

---

### Task 4: Delete Obsolete refresh-oauth Skill

**Files:**
- Delete: `.claude/skills/add-refresh-oauth/` (entire directory)

**Step 1: Verify it's not installed**

```bash
grep refresh-oauth .nanoclaw/installed-skills.yaml
```
Expected: No output (not in the install list).

**Step 2: Delete and commit**

```bash
git rm -r .claude/skills/add-refresh-oauth/
git commit -m "chore: remove obsolete refresh-oauth skill

Was for Claude API OAuth token refresh, replaced by long-term Claude
token. Google Assistant has its own independent refresh mechanism."
```

---

### Task 5: Document UFW and EnvironmentFile (#1, #7)

**Files:**
- Modify: `docs/plans/2026-03-10-manual-fixes-to-package.md` — mark items as packaged

**Step 1: Update tracking doc**

Mark all items in the tracking doc with their resolution status. Add to the header:

```markdown
## Status

| # | Fix | Status |
|---|-----|--------|
| 1 | UFW firewall rule | Documented in CLAUDE.md troubleshooting |
| 2 | Self-chat reactions | Committed in reactions overlay |
| 3 | Stale base snapshot | Dirty-check guard added |
| 4 | NODE_EXTRA_CA_CERTS | Moved to container-hardening |
| 5 | sqlite3 missing | Same root cause as #3 |
| 6 | Duplicate runStartupHooks | Caused by obsolete refresh-oauth skill (deleted) |
| 7 | EnvironmentFile | Documented in CLAUDE.md troubleshooting |
| 8 | Perplexity CLI | Committed in perplexity-research overlay |
| 9 | markAllDone timing | Committed in reactions overlay |
| 10 | Reactions/lifecycle conflict | Committed in reactions overlay |
| 11 | Akiflow local-time | Committed in akiflow-sync overlay |
| 12 | Container build ordering | build:container script added |
| 13 | Daemon exit code 2 | clean-skills runtime restore + logging fix |
```

**Step 2: Add troubleshooting notes to CLAUDE.md**

Add to the Troubleshooting section in `CLAUDE.md`:

```markdown
**Container can't reach credential proxy (ECONNREFUSED on port 3001):** UFW may be blocking Docker bridge traffic. Fix: `sudo ufw allow from 172.17.0.0/16 to any port 3001 proto tcp`

**Env vars missing in containers (API keys not passed):** The systemd unit needs `EnvironmentFile`. Add `EnvironmentFile=/path/to/project/.env` to the `[Service]` section of the systemd unit, then `systemctl --user daemon-reload`.
```

**Step 3: Commit**

```bash
git add docs/plans/2026-03-10-manual-fixes-to-package.md CLAUDE.md
git commit -m "docs: mark manual fixes as packaged, add troubleshooting notes"
```

---

### Task 6: Regression Testing — Build Verification (Phase 1)

**Step 1: Fresh full build**

```bash
rm -rf .nanoclaw/base
npm run build
```
Expected: All 18 skills apply cleanly, TypeScript compiles, no merge conflicts, runtime files restored.

**Step 2: Idempotent rebuild**

```bash
npm run build
```
Expected: "Skills already applied" message (no re-apply needed), compiles, cleans, restores.

**Step 3: Unit tests**

```bash
npx vitest run
```
Expected: All tests pass.

---

### Task 7: Regression Testing — Skill Isolation (Phase 2)

For each skill that was modified (container-hardening, google-home, reactions), verify it applies cleanly with only its dependencies.

**Step 1: Test container-hardening in isolation**

```bash
npm run clean-skills -- --force && rm -rf .nanoclaw/base
# Temporarily edit installed-skills.yaml to: [container-hardening]
npm run apply-skills && npx tsc --noEmit
# Restore installed-skills.yaml
npm run clean-skills -- --force && rm -rf .nanoclaw/base
```
Expected: Compiles without errors.

**Step 2: Test google-home in isolation**

```bash
# Temporarily edit installed-skills.yaml to:
# [lifecycle-hooks, ipc-handler-registry, container-hardening, google-home]
npm run apply-skills && npx tsc --noEmit
# Restore installed-skills.yaml
npm run clean-skills -- --force && rm -rf .nanoclaw/base
```
Expected: Compiles without errors.

**Step 3: Test reactions in isolation**

```bash
# Temporarily edit installed-skills.yaml to:
# [lifecycle-hooks, whatsapp-types, whatsapp, ipc-handler-registry, container-hardening, reactions]
npm run apply-skills && npx tsc --noEmit
# Restore installed-skills.yaml
npm run clean-skills -- --force && rm -rf .nanoclaw/base
```
Expected: Compiles without errors.

---

### Task 8: Regression Testing — Full Integration (Phase 3)

**Step 1: Full build with all 18 skills**

```bash
rm -rf .nanoclaw/base && npm run build
```

**Step 2: Container build**

```bash
npm run build:container
```
Expected: Container image builds successfully with all Dockerfile overlays (NODE_EXTRA_CA_CERTS, jq, sqlite3, google-home CLI, perplexity CLI, akiflow CLI).

**Step 3: Verify container contents**

```bash
npm run apply-skills
grep NODE_EXTRA_CA_CERTS container/Dockerfile
grep sqlite3 container/Dockerfile
grep google-home container/Dockerfile
grep perplexity container/Dockerfile
grep akiflow container/Dockerfile
npm run clean-skills -- --force
```
Expected: All five grep commands find matches.

**Step 4: Restart service and verify logs**

```bash
systemctl --user restart nanoclaw
# Wait for old container to exit, then:
sleep 10
grep "Google Assistant daemon initialized" logs/nanoclaw.log | tail -1
grep "stderr.*Starting Google" logs/nanoclaw.log | tail -1
```
Expected: Daemon initializes. Stderr content is visible (the `stderr:` field, not empty `msg:` field).

**Step 5: Functional checks**

- Send a Google Home command via Andy (e.g., "what time is it")
- Send a message to self-chat (main group) and verify emoji reactions appear
- Run akiflow CLI in a container and verify local-time formatting

---

### Task 9: Regression Testing — Clean-Skills Safety (Phase 4)

**Step 1: Clean and verify runtime files**

```bash
npm run clean-skills -- --force
ls scripts/google-assistant-daemon.py
ls container/skills/google-home/google-home
ls container/skills/akiflow/akiflow-functions.sh
ls container/skills/perplexity-research/perplexity
```
Expected: All four files exist (restored by `restoreRuntimeFiles`).

**Step 2: Restart service after clean**

```bash
systemctl --user restart nanoclaw
sleep 10
grep "Google Assistant daemon initialized" logs/nanoclaw.log | tail -1
```
Expected: Daemon starts successfully even after clean-skills.

---

### Task 10: CI Check and PR

**Step 1: Run CI checks locally**

```bash
npm run build
npx vitest run
npm run lint 2>/dev/null || true  # lint if configured
```
Expected: Build and tests pass.

**Step 2: Open PR**

Create a PR against `origin/main` (jonazri/gabay, NOT upstream) with all commits from Tasks 1-5.

```bash
git push origin main
```

Or if working in a feature branch:
```bash
git checkout -b fix/repackage-manual-fixes
git push -u origin fix/repackage-manual-fixes
gh pr create --title "fix: repackage post-PR-50 manual fixes into skills" --body "..."
```

**Step 3: Run /review-pr workflow**

After PR is created, run the `/review-pr` workflow (via Qodo or manually) and resolve any issues that surface.

**Step 4: Address review feedback**

Fix any issues found by the PR review. Re-run `npm run build && npx vitest run` after each fix. Push updates to the PR branch.
