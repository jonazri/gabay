# Repackaging Manual Fixes Into Skills — Design

Repackages the 13 manual fixes from `docs/plans/2026-03-10-manual-fixes-to-package.md` back into skill overlays and build tooling. Uses **Approach A: Minimal Targeted Fixes** — commit what's already in place, make small edits for the rest.

## Work Items

### Group 1: Commit Already-Done Overlay Changes

These fixes are already in skill overlay files and just need to be committed:

| Fix | Skill | Files |
|-----|-------|-------|
| #2 Self-chat reactions | reactions | `modify/src/index.ts` |
| #8 Perplexity CLI wrapper | perplexity-research | `add/container/skills/perplexity-research/perplexity`, `modify/container/Dockerfile` |
| #9 markAllDone timing | reactions | `modify/src/index.ts` |
| #10 Reactions/lifecycle conflict | reactions | `modify/src/index.ts` |
| #11 Akiflow local-time | akiflow-sync | `add/container/skills/akiflow/akiflow-functions.sh`, `add/container/skills/akiflow/SKILL.md` |
| #13 Daemon logging fix | google-home | `add/src/google-assistant.ts` |
| #13 clean-skills runtime restore | base | `scripts/clean-skills.ts` |

### Group 2: NODE_EXTRA_CA_CERTS Migration (#4)

Move `ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` from google-home to container-hardening.

**Steps:**
1. Reorder `installed-skills.yaml`: move `container-hardening` before `reactions` (position ~5, after `ipc-handler-registry`)
2. Add `container/Dockerfile` to container-hardening's `modifies` list
3. Create `container-hardening/modify/container/Dockerfile` with only the NODE_EXTRA_CA_CERTS addition
4. Remove NODE_EXTRA_CA_CERTS from google-home's Dockerfile overlay
5. Rebuild both overlays as minimal-diff deltas against their new bases

### Group 3: Duplicate runStartupHooks (#6)

**Investigate** which overlay(s) add `await runStartupHooks()`. The lifecycle-hooks overlay adds it once. If another overlay also adds it, fix that overlay's delta to not include it.

### Group 4: Dirty-Check Guard (#3, #5, #12)

Add to `scripts/apply-skills.ts` init path:
- Check `git diff --quiet HEAD -- src/ container/` and `git ls-files --others --exclude-standard src/ container/`
- If dirty: error with file list, suggest `git checkout -- src/ container/ && git clean -fd src/ container/ && rm -rf .nanoclaw/base`
- `--force` flag to bypass

Add `build:container` npm script:
```json
"build:container": "tsx scripts/apply-skills.ts && ./container/build.sh && tsx scripts/clean-skills.ts --force"
```

### Group 5: Documentation (#1, #7)

- **UFW rule (#1):** Add to `/debug` skill troubleshooting section: `sudo ufw allow from 172.17.0.0/16 to any port 3001 proto tcp`
- **EnvironmentFile (#7):** Add to `/setup` skill: systemd unit template should include `EnvironmentFile=/path/to/.env`

### Group 6: Cleanup

- Delete obsolete `add-refresh-oauth` skill directory

## Skill Install Order (Updated)

```yaml
skills:
  - lifecycle-hooks
  - whatsapp-types
  - whatsapp
  - ipc-handler-registry
  - container-hardening      # moved up: infra before features
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

## Merge Conflict Strategy

The `result.status === 'success'` zone in `src/index.ts` is the only known conflict point (lifecycle-hooks + reactions). The current resolution — reactions places its insertion in a structurally separate `if` block with a comment explaining the separation — is sufficient. No handler skill or abstraction needed since only two skills touch this zone.

All overlays must be minimal-diff (delta against the accumulated state at their position in the install order). Never use accumulated/full-file overlays.

## Regression Test Plan

### Phase 1: Build Verification
1. `rm -rf .nanoclaw/base` — fresh base snapshot
2. `npm run build` — all 18 skills apply cleanly
3. `npm run build` again — idempotent
4. `npx vitest run` — unit tests pass

### Phase 2: Skill Isolation
For each modified skill (container-hardening, google-home, reactions):
1. Clean and remove base: `npm run clean-skills -- --force && rm -rf .nanoclaw/base`
2. Set `installed-skills.yaml` to skill + deps only
3. `npm run apply-skills && npx tsc --noEmit` — compiles

### Phase 3: Full Integration
1. `npm run build` with all 18 skills
2. `npm run build:container` — container builds with all overlays
3. `systemctl --user restart nanoclaw`
4. Verify in logs:
   - Google Assistant daemon initializes (stderr visible)
   - No duplicate `runStartupHooks`
5. Functional checks:
   - Google Home command via Andy
   - Emoji reactions in self-chat
   - Akiflow local-time formatting
   - Container has `sqlite3`, NODE_EXTRA_CA_CERTS

### Phase 4: Clean-Skills Safety
1. `npm run clean-skills -- --force`
2. Verify runtime files restored: `scripts/google-assistant-daemon.py`, `container/skills/*`
3. Restart service — daemon starts
