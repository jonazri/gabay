# Skill Overlay Cleanup & Upstream Sync — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Merge upstream (new replay engine, credential proxy, clean reactions), then rebuild all 18 remaining skill overlays as pure upstream deltas with no `modify_base` or `_accumulated`.

**Architecture:** Phase 1 merges upstream. Phase 2 dispatches parallel forensic subagents per skill. Phase 3 restructures skills (merge ipc-handler-registry+self-heal, remove refresh-oauth). Phase 4 rebuilds overlays. Phase 5 verifies.

**Tech Stack:** git merge-file (three-way merge), npm run build (skill engine), vitest (tests)

---

## Dependency Graph

```
Phase 1: Upstream Merge (sequential)
  Task 1.1: git merge upstream/main
  Task 1.2: resolve conflicts
  Task 1.3: verify compile

Phase 2: Forensic Analysis (parallel subagents)
  ┌─ Task 2.1:  lifecycle-hooks ──────────────────┐
  ├─ Task 2.2:  whatsapp-types ───────────────────┤
  ├─ Task 2.3:  whatsapp ────────────────────────┤
  ├─ Task 2.4:  ipc-handler-registry + self-heal ─┤
  ├─ Task 2.5:  reactions ────────────────────────┤
  ├─ Task 2.6:  refresh-oauth (removal audit) ────┤
  ├─ Task 2.7:  group-lifecycle ──────────────────┤
  ├─ Task 2.8:  google-home ─────────────────────┤
  ├─ Task 2.9:  shabbat-mode ────────────────────┤
  ├─ Task 2.10: container-hardening ──────────────┤
  ├─ Task 2.11: task-scheduler-fixes ─────────────┤
  ├─ Task 2.12: voice-transcription-elevenlabs ───┤
  ├─ Task 2.13: voice-recognition ────────────────┤
  ├─ Task 2.14: whatsapp-search ──────────────────┤
  ├─ Task 2.15: perplexity-research ──────────────┤
  ├─ Task 2.16: feature-request ──────────────────┤
  ├─ Task 2.17: whatsapp-summary ─────────────────┤
  ├─ Task 2.18: whatsapp-replies ─────────────────┤
  └─ Task 2.19: akiflow-sync ────────────────────┘
  All depend on: Task 1.3

Phase 3: Structural Changes (sequential, after ALL Phase 2)
  Task 3.1: merge ipc-handler-registry + self-heal
    Depends on: Task 2.4
  Task 3.2: remove refresh-oauth skill
    Depends on: Task 2.6
  Task 3.3: strip modify_base/accumulated from all manifests
    Depends on: all Phase 2 tasks
  Task 3.4: fix stale depends, update installed-skills.yaml
    Depends on: Task 3.1, 3.2

Phase 4: Overlay Rebuild (sequential per hot-file group, parallelizable across groups)
  Group A — src/index.ts modifiers:
    Task 4.A1: rebuild lifecycle-hooks overlay
    Task 4.A2: rebuild reactions overlay (index.ts portion)
    Task 4.A3: rebuild group-lifecycle overlay (index.ts portion)
    Task 4.A4: rebuild google-home overlay (index.ts portion)
    Task 4.A5: rebuild shabbat-mode overlay (index.ts portion)
    Task 4.A6: rebuild whatsapp-replies overlay (index.ts portion)
    Each depends on previous in group; apply + verify after each

  Group B — src/ipc.ts modifiers:
    Task 4.B1: rebuild ipc-handler-registry+self-heal overlay
    Task 4.B2: rebuild reactions overlay (ipc.ts portion)
    Task 4.B3: rebuild group-lifecycle overlay (ipc.ts portion)
    Task 4.B4: rebuild shabbat-mode overlay (ipc.ts portion)
    Task 4.B5: rebuild whatsapp-replies overlay (ipc.ts portion)
    Each depends on previous in group

  Group C — src/container-runner.ts modifiers:
    Task 4.C1: rebuild google-home overlay (container-runner.ts portion)
    Task 4.C2: rebuild container-hardening overlay
    Task 4.C3: rebuild whatsapp-search overlay
    Task 4.C4: rebuild perplexity-research overlay
    Task 4.C5: rebuild akiflow-sync overlay (container-runner.ts portion)
    Each depends on previous in group

  Group D — src/channels/whatsapp.ts modifiers:
    Task 4.D1: rebuild reactions overlay (whatsapp.ts portion)
    Task 4.D2: rebuild voice-transcription-elevenlabs overlay
    Task 4.D3: rebuild voice-recognition overlay
    Task 4.D4: rebuild whatsapp-replies overlay (whatsapp.ts portion)
    Each depends on previous in group

  Group E — remaining files:
    Task 4.E1: rebuild src/db.ts chain (reactions → group-lifecycle → whatsapp-replies)
    Task 4.E2: rebuild src/types.ts chain (reactions → whatsapp-replies)
    Task 4.E3: rebuild src/task-scheduler.ts chain (shabbat-mode → task-scheduler-fixes)
    Task 4.E4: rebuild container/Dockerfile chain (google-home → akiflow-sync)
    Task 4.E5: rebuild container/agent-runner/src/ipc-mcp-stdio.ts (reactions → whatsapp-replies)
    Task 4.E6: rebuild src/group-queue.ts (container-hardening only)
    Task 4.E7: rebuild src/router.ts (whatsapp-replies only)
    Task 4.E8: rebuild test file overlays (db.test, whatsapp.test, etc.)
    Groups E1-E8 are independent of each other

  Groups A-E are parallelizable across groups.
  Within each group, tasks are sequential.

Phase 5: Verification (sequential, after ALL Phase 4)
  Task 5.1: full build (npm run build)
    Depends on: all Phase 4 tasks
  Task 5.2: full test suite (npx vitest run)
    Depends on: Task 5.1
  Task 5.3: smoke test (restart service, send WhatsApp message, verify reactions)
    Depends on: Task 5.2
  Task 5.4: commit
    Depends on: Task 5.3
```

---

## Task Details

### Task 1.1: Merge upstream

```bash
git fetch upstream
git merge upstream/main
```

Expected conflicts in: `skills-engine/replay.ts` (our modify_base additions vs upstream removal), `.claude/skills/add-reactions/` (our version vs upstream's cleaner version).

**Resolution:** Accept upstream for `skills-engine/`. For reactions, accept upstream's overlays as the new base — our fork-specific additions get layered back in Phase 4.

### Task 1.2: Resolve conflicts

For each conflicted file:
1. `git checkout --theirs skills-engine/` — accept upstream engine
2. For `.claude/skills/add-reactions/`: accept upstream's version, note our unique hunks for Phase 2
3. For any `src/` conflicts: accept upstream (our changes live in overlays)

```bash
git add <resolved files>
git commit -m "merge: upstream/main (new replay engine, credential proxy, clean reactions)"
```

### Task 1.3: Verify compile

```bash
npm run build:quick  # compile only, no skills
npx vitest run       # upstream tests pass
```

If build:quick doesn't exist, use `npx tsc` directly. This verifies the upstream merge is clean before we touch overlays.

---

### Tasks 2.1–2.19: Forensic Analysis (Parallel Subagents)

Each subagent receives identical instructions, parameterized by skill name.

**Subagent prompt template:**

```
Forensic analysis for skill: {SKILL_NAME}

For each file in this skill's modifies list:

1. Show the UPSTREAM version of this file (git show upstream/main:{path})
2. Show OUR overlay version (.claude/skills/{skill_dir}/modify/{path})
3. Compute the diff between them
4. For each hunk in the diff, run git log --all -S "{unique string from hunk}" to trace when/why it was added
5. Classify each hunk:
   - UPSTREAMED: change exists in upstream base → drop from overlay
   - FORK-UNIQUE-KEEP: feature not in upstream, still needed → preserve
   - FORK-UNIQUE-SUPERSEDED: upstream solved same problem differently → evaluate
   - STALE: references removed code or dead features → drop

Output format per file:
  File: {path}
  Upstream lines: {N}
  Overlay lines: {N}
  Delta: {+N added, -M removed}
  Hunks:
    Line XX-YY: {classification} — {reason}
    Line ZZ-WW: {classification} — {reason}
  Recommendation: {keep as-is | rebuild with hunks A,B | drop overlay entirely}
```

**Special cases:**
- **Task 2.4 (ipc-handler-registry + self-heal):** Analyze BOTH skills together since they'll be merged. Identify which hunks from each need to coexist in the combined overlay.
- **Task 2.5 (reactions):** Compare OUR overlay against UPSTREAM's new overlay. Identify fork-unique additions (is_from_me fix, heartbeat, recovery, RECOVERY_INTERVAL_MS).
- **Task 2.6 (refresh-oauth):** This is a REMOVAL audit. Verify no other skill depends on refresh-oauth's added files (`src/oauth.ts`, `src/ipc-handlers/refresh-oauth.ts`, etc.) or IpcDeps changes. Check if google-home's `modify_base: refresh-oauth` for container-runner.ts needs updating.

---

### Task 3.1: Merge ipc-handler-registry + self-heal

**Files:**
- Modify: `.claude/skills/ipc-handler-registry/manifest.yaml`
- Modify: `.claude/skills/ipc-handler-registry/modify/src/ipc.ts`
- Move: `.claude/skills/add-self-heal/add/src/ipc-self-heal.ts` → `.claude/skills/ipc-handler-registry/add/src/ipc-self-heal.ts`
- Move: `.claude/skills/add-self-heal/add/src/ipc-self-heal.test.ts` → `.claude/skills/ipc-handler-registry/add/src/ipc-self-heal.test.ts`
- Move: `.claude/skills/add-self-heal/add/container/skills/self-heal/` → `.claude/skills/ipc-handler-registry/add/container/skills/self-heal/`
- Delete: `.claude/skills/add-self-heal/` directory

**Step 1:** Update ipc-handler-registry manifest to include self-heal's adds and modifies.

**Step 2:** Rebuild ipc.ts overlay: upstream base + getIpcHandler import + ipc-self-heal imports + handler dispatch default case wrapped in try-catch with error notifications + requestId in data type.

**Step 3:** Update installed-skills.yaml: remove `self-heal` entry.

**Step 4:** Verify: `git checkout -- src/ && rm -rf .nanoclaw/base && npm run apply-skills` with only ipc-handler-registry enabled.

### Task 3.2: Remove refresh-oauth skill

**Step 1:** Remove from installed-skills.yaml.

**Step 2:** Update google-home manifest: change `src/container-runner.ts` modify_base from `refresh-oauth` to nothing (pure upstream delta). Also remove `refresh-oauth` from depends.

**Step 3:** Update google-home's container-runner.ts overlay: rebuild against the NEW upstream base (which has credential proxy, not readSecrets).

**Step 4:** Check if any other manifest references refresh-oauth in depends or modify_base. If so, update.

**Step 5:** Do NOT delete `.claude/skills/add-refresh-oauth/` directory — it's still a valid skill for installs without credential proxy. Just remove from installed list.

### Task 3.3: Strip modify_base/accumulated from all manifests

For every manifest.yaml in `.claude/skills/*/manifest.yaml`:
- Remove the entire `modify_base:` section
- These fields are ignored by the new upstream engine

```bash
for f in .claude/skills/*/manifest.yaml; do
  # Check if file has modify_base
  if grep -q 'modify_base:' "$f"; then
    echo "Stripping modify_base from: $f"
  fi
done
```

Manually edit each file to remove the `modify_base:` block and all its entries.

### Task 3.4: Fix depends, update installed-skills.yaml

**Step 1:** akiflow-sync: remove `auth-recovery` from depends (doesn't exist).

**Step 2:** installed-skills.yaml final state (18 skills):
```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry    # now includes self-heal
  - reactions
  # refresh-oauth removed
  - group-lifecycle
  # self-heal merged into ipc-handler-registry
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
  - akiflow-sync
```

**Step 3:** Commit structural changes.

---

### Tasks 4.A–4.E: Overlay Rebuild

For each overlay file, the process is:

**Step 1:** Get the upstream base:
```bash
git show upstream/main:{path} > /tmp/upstream-base.ts
```

**Step 2:** Identify fork-unique hunks from Phase 2 forensic manifest.

**Step 3:** Apply ONLY the fork-unique-keep hunks to the upstream base to create the new overlay.

**Step 4:** Verify it applies cleanly:
```bash
git checkout -- src/
rm -rf .nanoclaw/base
# Enable only skills up to and including this one in installed-skills.yaml
npm run apply-skills
# Check for conflict markers
grep -r '<<<<<<' src/ && echo "CONFLICT" || echo "CLEAN"
```

**Step 5:** Re-enable all skills and verify full stack.

**Key constraint for each group:** Within a group (e.g., all skills modifying src/index.ts), each overlay must add in a DIFFERENT region of the file. If two skills add adjacent to each other, insert a blank line or comment to separate them and provide distinct merge context.

---

### Task 5.1: Full build

```bash
git checkout -- src/
rm -rf .nanoclaw/base
npm run build
```

Expected: "Successfully applied 18 skills." No conflicts.

### Task 5.2: Full test suite

```bash
npx vitest run
```

Expected: All tests pass (355+ tests).

### Task 5.3: Smoke test

```bash
systemctl --user restart nanoclaw
sleep 5
tail -20 ~/code/yonibot/gabay/logs/nanoclaw.log
```

Expected: Service starts cleanly. Send a WhatsApp message → verify eyes reaction appears → thinking → checkbox.

### Task 5.4: Commit

```bash
git add -A
git commit -m "refactor: rebuild all skill overlays as pure upstream deltas

- Merge upstream/main (credential proxy, clean reactions, new replay engine)
- Merge ipc-handler-registry + self-heal into single skill
- Remove refresh-oauth (superseded by credential proxy)
- Eliminate all modify_base and _accumulated references (17 instances)
- Rebuild every overlay as minimal delta from upstream base
- Fix stale depends (akiflow-sync auth-recovery)

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```
