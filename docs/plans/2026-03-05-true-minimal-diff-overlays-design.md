# True Minimal-Diff Overlays — Design

## Problem

Phase 5 converted `_accumulated` overlays to `modify_base`-chained overlays. Each overlay still contains the full file (628-859 lines) because `modify_base: previous-skill` forces each overlay to include all prior skills' changes plus its own. Total overlay lines for index.ts: 4,486. Only ~315 lines are unique across all 6 skills.

## Solution

**One full-file overlay, all others as true minimal diffs.**

`lifecycle-hooks` is the sole full-file overlay. It's the authoritative base that:
- Mutates upstream lines (renames `lastAgentTimestamp` → `agentCursors`, wires dispatch points)
- All 5 downstream skills declare `modify_base: lifecycle-hooks` for `src/index.ts`
- Each downstream overlay contains the lifecycle-hooks base + ONLY its unique additions
- `diff(lifecycle-hooks-overlay, downstream-overlay)` = only the downstream skill's unique lines
- The merge engine applies that diff to the current accumulated state

## Why this works

`git merge-file current base overlay` computes `diff(base, overlay)` and applies it to `current`. When all downstream overlays share the same base (lifecycle-hooks), each diff contains only that skill's unique additions. Independent insertions merge cleanly as long as they anchor to different context lines (experimentally confirmed: 1+ line apart is sufficient).

## Placement convention

### Imports

Each skill anchors its imports after a different upstream import line to avoid context collisions in `git merge-file`:

| Skill | Anchor after (upstream line) |
|---|---|
| lifecycle-hooks | `import { logger }` (L52) |
| reactions | `import { startSchedulerLoop }` (L50) |
| refresh-oauth | `import path from 'path'` (L2) |
| group-lifecycle | `import { resolveGroupFolderPath }` (L41) |
| google-home | `import { findChannel }` (L43) |
| shabbat-mode | `import { Channel, NewMessage }` (L51) |

### IPC watcher deps

Skills that add IPC deps anchor after different lines in the `startIpcWatcher({...})` block:

| Skill | Anchor |
|---|---|
| reactions | After `registerGroup,` |
| group-lifecycle | After `getAvailableGroups,` |

### Function definitions

New functions go in skill-specific locations with 3+ lines of unique surrounding context:

| Skill | Function | Location |
|---|---|---|
| refresh-oauth | `notifyMainGroup()` | Before `runAgent()` |
| group-lifecycle | `unregisterGroup()` | After `registerGroup()` |
| shabbat-mode | `sendPostShabbatSummary()` | Before `startMessageLoop()` |

### processGroupMessages insertions

| Skill | What | Anchor after |
|---|---|---|
| lifecycle-hooks | `shouldProcessMessages()` guard | After channel null check (`return true`) |
| shabbat-mode | `isShabbatOrYomTov()` guard | After `shouldProcessMessages()` guard |
| reactions | `markReceived`/`markThinking` | Before `await channel.setTyping` |

### startMessageLoop insertions

| Skill | What | Anchor after |
|---|---|---|
| lifecycle-hooks | `wasGuarded` + guard check + `runGuardLiftedHooks` | After `logger.info(NanoClaw running)` |
| shabbat-mode | `wasShabbat` + post-Shabbat summary | After lifecycle guard block (inside `try {`) |
| reactions | `markReceived` + pipe cursor save | Before/after `queue.sendMessage()` call |

### Shutdown handler

| Skill | What | Anchor after |
|---|---|---|
| refresh-oauth | `stopTokenRefreshScheduler()` / `stopPrimaryProbe()` | Before `await queue.shutdown()` |
| google-home | `stopGoogleTokenScheduler()` | After `await queue.shutdown()` |
| shabbat-mode | `stopCandleLightingNotifier()` | After google-home's stop |
| reactions | `await statusTracker.shutdown()` | After `ch.disconnect()` |
| lifecycle-hooks | `await runShutdownHooks()` | After statusTracker.shutdown() |

### main() startup sequence

| Skill | What | Anchor after |
|---|---|---|
| lifecycle-hooks | `await runStartupHooks()` | After `loadState()` |
| shabbat-mode | `initShabbatSchedule()` | After `runStartupHooks()` |
| reactions | StatusTracker init (20 lines) | After channel connect loop |
| lifecycle-hooks | `await runChannelsReadyHooks()` | After StatusTracker init |
| refresh-oauth | `initOAuthState()` + `ensureTokenFresh()` | After `runChannelsReadyHooks()` |
| google-home | `startGoogleTokenScheduler()` | After `statusTracker.recover()` |
| shabbat-mode | `startCandleLightingNotifier()` | After google-home scheduler |

## Overlay dependency graph

```
lifecycle-hooks (full-file base overlay)
  ├── reactions      (modify_base: lifecycle-hooks, ~150 unique lines)
  ├── refresh-oauth  (modify_base: lifecycle-hooks, ~60 unique lines)
  ├── group-lifecycle(modify_base: lifecycle-hooks, ~15 unique lines)
  ├── google-home    (modify_base: lifecycle-hooks, ~10 unique lines)
  └── shabbat-mode   (modify_base: lifecycle-hooks, ~80 unique lines)
```

All 5 downstream skills point to the SAME base. No chaining. Each overlay's diff is independent and merges cleanly due to the placement convention.

## Expected reduction

| Metric | Before (chained) | After (star topology) |
|---|---|---|
| lifecycle-hooks | 628 | 628 (unchanged — the base) |
| reactions | 758 | ~150 |
| refresh-oauth | 697 | ~60 |
| group-lifecycle | 768 | ~15 |
| google-home | 776 | ~10 |
| shabbat-mode | 859 | ~80 |
| **Total** | **4,486** | **~943** |
| **Reduction** | — | **79%** |

## ipc.ts overlays

Same pattern applies to `src/ipc.ts`. Currently 3 overlays (reactions: 448, ipc-handler-registry: 396, shabbat-mode: 163). The ipc-handler-registry overlay becomes the base; reactions and shabbat-mode become minimal diffs against it.

## Implementation notes

- Build each downstream overlay by: copying lifecycle-hooks overlay, adding ONLY the skill's unique lines at the designated anchor points
- Test each overlay independently: apply just lifecycle-hooks + that one skill, verify clean merge
- Test the full chain: apply all 18 skills, verify zero conflicts
- The placement convention is documented here so future skills know where to anchor
- If a new skill needs to insert at an occupied anchor point, pick the nearest unoccupied upstream line

## Risks

- **Upstream changes that modify anchor lines**: When upstream rearranges imports or function signatures, overlays may need anchor updates. Mitigated by the existing `/update-nanoclaw` workflow which handles conflicts per-file.
- **New skills that can't find a unique anchor**: The import section has ~15 lines, each usable as an anchor. For function bodies, any distinct line works. This scales to dozens of skills.
