# Manual Fixes — 2026-03-10

Fixes applied during post-PR-50 stabilization. Need to be packaged back into skills.

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

## 1. UFW firewall rule for credential proxy (port 3001)

**Problem:** Containers couldn't reach the credential proxy at `host.docker.internal:3001`. UFW INPUT policy is DROP, no rule for port 3001 (new in PR 50, which moved from inline secrets to credential proxy).

**Fix:** `sudo ufw allow from 172.17.0.0/16 to any port 3001 proto tcp`

**Packaging:** Add to `/setup` or `/debug` skill documentation. Not a skill overlay — it's a one-time system config.

## 2. Self-chat emoji reactions fix

**Problem:** In self-chat (main group `17732662600@s.whatsapp.net`), all messages have `is_from_me=true`. The `!msg.is_from_me` filter in `processGroupMessages` and the piping path blocked markReceived/markThinking/markWorking for all self-chat messages.

**Fix:** Changed filter to `!msg.is_bot_message && (isMainGroup || !msg.is_from_me)` in 3 locations in `.claude/skills/add-reactions/modify/src/index.ts`:
- Line ~256: `processGroupMessages` userMessages filter
- Line ~531: piping path `markReceived`
- Line ~548: piping path `markThinking`

**Packaging:** Already in the reactions skill overlay. Needs to be committed.

## 3. Stale base snapshot causing overlay failures

**Problem:** Running `apply-skills` after a previous partial apply left `container/agent-runner/src/ipc-mcp-stdio.ts` dirty (13,901 bytes with react_to_message already applied). Base snapshot captured this dirty state, so the reactions overlay's react_to_message addition was treated as a no-op.

**Fix:** Full clean before re-snapshot: `git checkout -- src/ container/ && git clean -fd src/ container/ && rm -rf .nanoclaw/base`

**Packaging:** Not a skill change. Document in CLAUDE.md or build system docs. Consider adding a dirty-check to `apply-skills` init that warns if files differ from git HEAD.

## 4. NODE_EXTRA_CA_CERTS for container SSL

**Problem:** Node.js in the container uses its own bundled CA store, not the system one. `curl` works (uses `/etc/ssl/certs/ca-certificates.crt`) but Node.js `fetch`/WebFetch fails with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.

**Fix:** Added `ENV NODE_EXTRA_CA_CERTS=/etc/ssl/certs/ca-certificates.crt` to the google-home Dockerfile overlay.

**Packaging:** Already in `.claude/skills/add-google-home/modify/container/Dockerfile`. Needs to be committed. Consider moving to a more general location (container-hardening?) since it's not google-home-specific.

## 5. sqlite3 missing from container

**Problem:** The akiflow-sync Dockerfile overlay adds `sqlite3` to apt-get, but the container was built from a partially-applied Dockerfile state (only google-home overlay applied, not akiflow-sync).

**Fix:** Same root cause as #3 — stale base snapshot. Properly cleaning and re-applying fixed it. No overlay change needed.

**Packaging:** No change needed. The overlay is correct; the issue was the build process.

## 6. Duplicate `await runStartupHooks()` in applied index.ts

**Problem:** After applying skills, `src/index.ts` had `await runStartupHooks()` called twice in succession. Likely from overlapping skill overlays both adding the call.

**Fix:** Removed the duplicate during conflict resolution. Need to check which overlay is causing the duplication.

**Packaging:** Investigate which skill overlay adds the redundant call and fix its delta.

## 7. EnvironmentFile for systemd unit

**Problem:** `.env` file has `PERPLEXITY_API_KEY`, `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, etc. but the systemd unit didn't load them. The host process didn't have these env vars, so they weren't passed to containers via `-e`.

**Fix:** Added `EnvironmentFile=/home/yaz/code/yonibot/gabay/.env` to `~/.config/systemd/user/nanoclaw.service`. Removed the redundant `Environment=AKIFLOW_DB_PATH=...` line (already in .env). Ran `systemctl --user daemon-reload`.

**Packaging:** Add to `/setup` skill — the systemd unit template should include `EnvironmentFile`.

## 8. Perplexity CLI wrapper

**Problem:** The perplexity-research skill defined bash functions in SKILL.md as examples but never installed an actual CLI command. Andy couldn't use Perplexity because there was no `perplexity` command — he'd have to write raw `curl` calls, and the lack of a proper tool meant Claude Code might not invoke it correctly.

**Fix:** Created `perplexity` CLI wrapper (bash script) with subcommands: `search` (sonar), `pro` (sonar-pro), `deep` (sonar-deep-research). Added to the perplexity-research skill:
- New file: `.claude/skills/add-perplexity-research/add/container/skills/perplexity-research/perplexity`
- New Dockerfile overlay: `.claude/skills/add-perplexity-research/modify/container/Dockerfile` (COPY + chmod)
- Updated manifest to include the new files
- Updated SKILL.md to reference CLI commands instead of raw curl functions
- Changed `allowed-tools` from `Bash(perplexity:*)` to `Bash(perplexity *)`

**Packaging:** Already in the perplexity-research skill files. Needs to be committed.

## 9. Emoji reactions stuck at 🔄 after agent responds

**Problem:** `markAllDone` only fires in `handleProcessingOutcome` after the container exits. IDLE_TIMEOUT is 30 minutes, so the container stays alive long after sending its response. Messages stay at 🔄 (or 💭 for piped messages) for up to 30 minutes until the container finally exits.

**Root cause:** Architectural — terminal emoji (✅) was tied to container lifecycle instead of agent response lifecycle.

**Fix:** Added `statusTracker.markAllDone(chatJid)` to the streaming callback on `result.status === 'success'` in `.claude/skills/add-reactions/modify/src/index.ts`. Messages now get ✅ immediately when the agent reports success, while `handleProcessingOutcome` acts as a safety net at container exit.

**Packaging:** Already in the reactions skill overlay. Needs to be committed.

## 10. Reactions overlay conflicting with lifecycle-hooks overlay

**Problem:** The reactions skill overlay and the lifecycle-hooks skill overlay both modified the `result.status === 'success'` block in `src/index.ts`. Lifecycle-hooks added `await emitAgentSuccess(chatJid)` before `queue.notifyIdle(chatJid)`, and reactions added `statusTracker.markAllDone(chatJid)` at the same location. The three-way merge couldn't handle both insertions in the same 3-line block, causing `npm run build` to fail with merge conflicts. This blocked ALL later skills (including akiflow-sync) from being applied — which is why the akiflow DB was never mounted into containers.

**Fix:** Moved the `statusTracker.markAllDone(chatJid)` call into a separate `if (result.status === 'success')` block placed AFTER the `if (result.status === 'error')` block. This puts it far enough from the lifecycle-hooks insertion point that the context lines don't overlap, and the three-way merge succeeds.

**Packaging:** Already in the reactions skill overlay. Needs to be committed.

## 11. Akiflow CLI timestamps shown as raw UTC

**Problem:** All akiflow CLI commands (`daily-brief`, `weekly-plan`, `list-events`, `list-today`, etc.) displayed event `start`/`end` and task `datetime` columns as raw UTC ISO strings like `2026-03-11T14:30:00.000Z`. Unreadable for humans.

**Fix:** Added `_local_time()` bash helper that generates a SQLite expression converting UTC timestamps to local `M/D h:MM AM/PM` format using SQLite's `strftime` with `'localtime'` modifier (reads the container's `TZ` env var). Updated 12 SQL queries across 8 commands. Fixed `ORDER BY` clauses to use table-qualified column names so sorting remains chronological. Added `--utc` flag to all 8 commands to opt back into raw UTC output (sets `_AKIFLOW_UTC=1` which makes `_local_time` pass through the raw column). `scheduled_date` left as-is (date-only, no timezone issue).

**Packaging:** Already in the akiflow-sync skill files (`akiflow-functions.sh` and `SKILL.md`). Needs to be committed.

## 12. Container built without Dockerfile overlays (sqlite3 missing again)

**Problem:** After rebuilding the container with `./container/build.sh`, the image didn't have `sqlite3` because the build ran after `npm run build` had already restored `container/Dockerfile` to its base state. The akiflow-sync Dockerfile overlay (which adds `sqlite3` to `apt-get`) was not applied. Same root cause as #5 but triggered by the build ordering: `npm run build` restores files, then a separate `./container/build.sh` builds from the restored (un-overlaid) Dockerfile.

**Fix:** Applied skills first (`npm run apply-skills`), then ran `./container/build.sh`, then restored (`npm run clean-skills --force`). Killed lingering old container and restarted the service.

**Packaging:** The container build should always run while skills are applied. Consider adding a wrapper script or documenting the correct sequence: `npm run apply-skills && ./container/build.sh && npm run clean-skills -- --force`.

## 13. Google Assistant daemon exit code 2 on startup

**Problem:** The Google Assistant Python daemon (`scripts/google-assistant-daemon.py`) exits with code 2 immediately at service startup. Python exit code 2 = "can't open file" — the script was deleted by `clean-skills` because it's in the skill's `adds` list. The `npm run build` pipeline has a `--deps-only` step that restores runtime files, but running `clean-skills` directly skips this step.

**Secondary problem:** Daemon stderr output was invisible in logs. The Node.js code logged `{ msg: data.toString().trim() }` but pino uses `msg` as the log message field, so the daemon's actual error message was overwritten by the static string `'google-assistant-daemon'`.

**Fix:**
1. Modified `scripts/clean-skills.ts` to automatically run `apply-skills --deps-only` after cleaning, which calls `restoreRuntimeFiles()` to copy back non-src/ runtime files (Python scripts, container skill files, shell wrappers, etc.)
2. Changed `{ msg: ... }` to `{ stderr: ... }` in the daemon stderr handler in `src/google-assistant.ts` (and its skill overlay) so daemon error output is visible in logs.

**Packaging:** `scripts/clean-skills.ts` change is in the base codebase (not a skill overlay). The `{ stderr: ... }` fix is in `.claude/skills/add-google-home/add/src/google-assistant.ts`.

## Not Fixed (Deferred)

### refresh-oauth skill is obsolete
The `add-refresh-oauth` skill was for Claude API OAuth token refresh, replaced by long-term Claude token. Google Assistant has its own independent refresh mechanism (`src/google-assistant.ts` + `scripts/google-assistant-daemon.py`). No action needed — can be deleted from the skills directory.
