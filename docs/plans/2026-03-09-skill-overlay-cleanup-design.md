# Skill Overlay Cleanup & Upstream Sync

**Date:** 2026-03-09
**Status:** Approved

## Problem

The fork has accumulated 17 `_accumulated` overlay references, 11 missing `modify_base` declarations, and 3 incorrect dependency chains. This creates cascading merge conflicts on every build. Meanwhile, upstream has **removed** `modify_base` and `_accumulated` from the skill replay engine entirely, making all this infrastructure dead code after merge.

## Decisions

1. **Approach A:** Merge upstream first, then rebuild all overlays as pure upstream deltas
2. **Adopt upstream's reactions skill** as the base, layer fork-specific improvements on top
3. **Merge `ipc-handler-registry` + `self-heal`** into one skill (both modify the default case in `processTaskIpc`)
4. **Remove `refresh-oauth` skill** entirely (superseded by upstream's credential proxy)
5. **No `modify_base`, no `_accumulated`** — every overlay is upstream + only that skill's changes

## Overlay Rebuild Rules

1. **Pure upstream delta:** overlay = upstream base + ONLY that skill's unique additions
2. **Non-overlapping regions:** imports (different lines), interface fields (end, with comment), function body (early-return guards or append blocks), switch cases (unique strings)
3. **No `modify_base`/`_accumulated`** in any manifest
4. **Manifest hygiene:** fix stale `depends:` (e.g., akiflow-sync's `auth-recovery`)
5. **Test each skill in isolation** then verify full stack

## Hot Files & Mitigation

| File | Skills | Strategy |
|------|--------|----------|
| `src/index.ts` | 7 skills | Each touches different functions/regions |
| `src/ipc.ts` | 5 skills (after merge) | handler-registry+self-heal combined; shabbat guard at top; reactions at end |
| `src/container-runner.ts` | 7 skills (after removing refresh-oauth) | Independent mount blocks; credential proxy handled by upstream |
| `src/channels/whatsapp.ts` | up to 8 skills | Voice/vision/PDF add to different processing stages |

## Phases

### Phase 1: Upstream merge
- `git merge upstream/main`
- Accept upstream for `src/`, `skills-engine/`
- Verify clean compile

### Phase 2: Forensic analysis (parallel subagents)
Per-skill subagent performs:
- Three-way diff: upstream overlay vs our overlay vs upstream base
- Git blame on each fork-specific hunk
- Classify hunks: upstreamed / fork-unique-keep / fork-unique-superseded / stale
- Output: keep/drop/reconcile manifest

### Phase 3: Structural changes
- Merge ipc-handler-registry + self-heal into one skill
- Remove refresh-oauth
- Strip all `modify_base`/`_accumulated` from manifests
- Fix stale `depends:` references
- Update `installed-skills.yaml`

### Phase 4: Overlay rebuild
- Rebuild each overlay as pure upstream delta (guided by forensic manifests)
- Apply one-at-a-time to verify clean merge
- Apply full stack — no conflicts

### Phase 5: Verification
- `npm run build` — all skills apply cleanly
- `npx vitest run` — all tests pass
- Smoke test: WhatsApp message → eyes → thinking → checkbox
- Restart service
