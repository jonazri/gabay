# Postmortem: OAuth Auth Loop — March 7, 2026

## Incident Summary

Starting at 18:52 EST (post-Shabbat recovery), every container agent spawn fails with `401 OAuth token has expired`. The system enters a retry loop, sending repeated "Auth token expired — refreshing and retrying" and "Task crashed — retrying" messages to WhatsApp. The refresh mechanism itself fails because `scripts/oauth/refresh.sh` is missing from the filesystem (ENOENT).

**Duration**: 18:52 onwards (ongoing at time of analysis, ~19:45)
**Impact**: All container agent operations blocked. Scheduled tasks and message-triggered tasks all fail.
**Single instance**: Only one NanoClaw process (PID 4018643) — no duplicate instances.

---

## Timeline

| Time (EST) | Event |
|---|---|
| **Mar 6 ~12:46pm** | Last successful token refresh by old process (PID 3919896). Token expires_at = 7:47pm EST. |
| **Mar 6 ~17:40** | `npm run build` runs. dist/ files compiled. Service restarts (PID 4018643). |
| **Mar 6 ~18:00** | Shabbat begins. Service pauses all container activity. |
| **Mar 6 ~7:47pm** | Short-lived token expires. No one notices — Shabbat mode, no containers running. |
| **Mar 7 ~18:52** | Shabbat ends. Post-Shabbat recovery triggers. 22 groups with 3500+ pending messages. |
| **18:52:42** | 2 scheduled tasks fire simultaneously. Containers spawn → 401 auth error. |
| **18:52:48** | `activateFallback()` called → `refreshOAuthToken()` → `refresh.sh` ENOENT. |
| **18:52:48** | OAuth refresh script failed: `spawn scripts/oauth/refresh.sh ENOENT`. Sends notification to WhatsApp. |
| **18:52:48–18:53:04** | Second task also fails identically. Two `Container exited with error` (code 137). |
| **19:00–19:32** | Periodic recovery scanner keeps finding unprocessed messages every 60s. More container spawns, all fail. |
| **19:32:01** | System transitions to `usingFallback: true` (`.oauth-state.json` created). Every pre-spawn check now actively checks credentials.json expiry → expired → tries refresh.sh → ENOENT. |
| **19:32–19:43** | Retry loop with exponential backoff: retryCount 1→5, delay 5s→80s. Each attempt: spawn container → 401 → refresh.sh ENOENT → "Task crashed" notification. |

---

## Root Cause Analysis

### Three compounding failures

#### 1. `scripts/oauth/refresh.sh` missing (ENOENT)

The refresh-oauth skill's manifest declares `scripts/oauth/refresh.sh` as an added file. It exists in the skill's `add/` directory (`.claude/skills/add-refresh-oauth/add/scripts/oauth/refresh.sh`). The build pipeline should restore it:

```
npm run build = apply-skills → tsc → clean-skills --force → apply-skills --deps-only
```

`clean-skills` deletes skill-added files (including `scripts/oauth/refresh.sh`). `apply-skills --deps-only` calls `restoreRuntimeFiles()` which should copy it back. But the file is missing, meaning the `--deps-only` step either failed silently, was interrupted, or was never run.

The `scripts/oauth/` directory is gitignored, so there's no git safety net.

**Evidence**: `ls scripts/oauth/` → "No such file or directory". The file IS present at `.claude/skills/add-refresh-oauth/add/scripts/oauth/refresh.sh`.

#### 2. Short-lived token expired during Shabbat

The token in `.env` and `~/.claude/.credentials.json` is a short-lived (~7 hour) Claude OAuth token. It expired at `2026-03-07T00:47:06 UTC` (Mar 6, 7:47pm EST). Shabbat lasts ~25 hours, so the token expired long before Shabbat ended.

**Evidence**: `credentials.json` shows `expiresAt: 1772844426111` → `2026-03-07T00:47:06 UTC`. Both `.env` and `credentials.json` have the same expired token prefix (`sk-ant-oat01-bOgJ4x...`).

#### 3. The long-term bashrc token is never used (architectural flaw)

**This is the deeper issue.** The user has a long-term token in `~/.bashrc`:
```bash
export CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-rVaeFD...  # long-term
```

The oauth.ts design has two modes:
- **Primary mode**: Uses "long-term" token from `process.env.CLAUDE_CODE_OAUTH_TOKEN`. Trusts it without checking expiry.
- **Fallback mode**: Uses short-lived tokens from `credentials.json`, refreshed by `refresh.sh` every ~7 hours.

**The design assumes** `process.env.CLAUDE_CODE_OAUTH_TOKEN` contains the long-term bashrc token. But systemd doesn't source `.bashrc`:

```ini
# nanoclaw.service — only sets HOME and PATH
Environment=HOME=/home/yaz
Environment=PATH=/usr/local/bin:/usr/bin:/bin:/home/yaz/.local/bin
# NO CLAUDE_CODE_OAUTH_TOKEN
```

So `process.env.CLAUDE_CODE_OAUTH_TOKEN` is **undefined** at service startup. `getPrimaryToken()` falls through to `readEnvToken()` → reads `.env` → gets the short-lived token. The system thinks it has a "primary long-term" token but it's actually using a short-lived one.

### The accidental fallback cycle

Because the system never has the long-term token, it's been running in an accidental cycle:

```
1. Service starts → "primary mode" but actually using short-lived .env token
2. Token works for ~7 hours
3. Token expires → auth error → activateFallback()
4. refresh.sh runs → gets new short-lived token → writes to .env
5. Fallback refresh scheduler keeps tokens fresh
6. Primary probe checks getPrimaryToken() → reads .env → same short-lived token
7. Probe succeeds (token is fresh) → "restores primary mode"
8. Back to step 1 — cycle repeats every ~7 hours
```

This cycle breaks during extended pauses (Shabbat, system sleep, etc.) because:
- No containers run → no auth errors detected
- Proactive refresh scheduler only runs in fallback mode
- Token expires during pause → post-pause recovery hits expired token
- refresh.sh must work to recover → if missing, permanent failure

### Additionally: refresh.sh always overwrites .env

Even when `refresh.sh` works, it ALWAYS writes the short-lived credentials.json token to `.env` (line 82: `echo "CLAUDE_CODE_OAUTH_TOKEN=${access_token}" >> "$DOTENV.tmp"`). It never checks for or preserves a long-term token. So even if `.env` originally had the long-term token, refresh.sh would overwrite it.

---

## Current State (at time of analysis)

| Component | State |
|---|---|
| NanoClaw process | Running (PID 4018643, since Mar 6). Single instance. |
| `.oauth-state.json` | `{ usingFallback: true, fallbackSince: "2026-03-08T00:32:01.746Z" }` |
| `~/.claude/.credentials.json` | Expired (expiresAt: 2026-03-07T00:47:06 UTC). Has refreshToken. |
| `.env` CLAUDE_CODE_OAUTH_TOKEN | Expired short-lived token (`sk-ant-oat01-bOgJ4x...`) |
| `~/.bashrc` CLAUDE_CODE_OAUTH_TOKEN | Long-term token (`sk-ant-oat01-rVaeFD...`) — never used by service |
| `scripts/oauth/refresh.sh` | **Missing** (ENOENT) |
| Retry state | retryCount=5, delayMs=80s, exponential backoff |
| Recovery scanner | Firing every 60s, finding same unprocessed messages |

---

## Remediation Plan

### Immediate Recovery (stop the bleeding)

**Step 1**: Deploy missing `refresh.sh`
```bash
mkdir -p scripts/oauth
cp .claude/skills/add-refresh-oauth/add/scripts/oauth/refresh.sh scripts/oauth/
chmod +x scripts/oauth/refresh.sh
```

**Step 2**: Refresh the expired credentials.json token
```bash
~/.claude/local/claude -p "ok" --no-session-persistence
```
This uses the stored `refreshToken` to get a new `accessToken` + `expiresAt`.

**Step 3**: Sync fresh token to .env
```bash
./scripts/oauth/refresh.sh
```

**Step 4**: Reset OAuth state to primary mode
```bash
echo '{"usingFallback": false, "fallbackSince": null}' > .oauth-state.json
```

**Step 5**: Verify — the next retry (~80s) should succeed. No restart needed because `readSecrets()` reads `.env` fresh at each container spawn.

### Architectural Fix (prevent recurrence)

#### A. Make the long-term bashrc token available to systemd

Add to `~/.config/systemd/user/nanoclaw.service`:
```ini
Environment=CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-rVaeFD...
```
Or use `EnvironmentFile`:
```ini
EnvironmentFile=/home/yaz/.config/nanoclaw/env
```
where that file contains just `CLAUDE_CODE_OAUTH_TOKEN=<long-term-token>`.

#### B. Make `.env` use the long-term token as default

When `.env` contains the long-term token and the system is in primary mode, containers will use the long-term token. This token doesn't expire (or has very long expiry), eliminating the 7-hour refresh cycle entirely.

#### C. Fix refresh.sh to NOT overwrite long-term tokens

`refresh.sh` should check whether `.env` already has a working long-term token before overwriting it with a short-lived one. The refresh should only write to `.env` when in fallback mode and the long-term token has actually failed.

#### D. Make the primary probe actually work

`probePrimaryToken()` calls `getPrimaryToken()` which (with fix A) would return the long-term token from `process.env`. The probe would then test if the long-term token still works, and if yes, write it back to `.env`, replacing the short-lived fallback token.

#### E. Build pipeline: verify runtime files exist

Add a post-build check or service startup check that verifies `scripts/oauth/refresh.sh` exists. Log a loud warning if missing.

---

## Why "multiple instances" appeared

There is only ONE NanoClaw process. The appearance of multiple instances comes from:
1. **Exponential backoff retries** — each retry sends WhatsApp notifications ("Auth token expired", "Task crashed — retrying")
2. **Recovery scanner** — fires every 60s, finds the same unprocessed messages, logs them all
3. **Parallel scheduled tasks** — at 18:52, two scheduled tasks ran simultaneously, each spawning and failing independently
4. **Container lifecycle** — each failed container takes ~15s to fully exit (docker stop timeout), so old containers overlap with new spawn attempts

---

## Lessons

1. **Long-term vs short-lived token handling must be explicit**: The system silently degraded from "long-term primary" to "short-lived cycle" because systemd doesn't source bashrc. This went unnoticed because the cycle worked... until it didn't.

2. **gitignored runtime files are fragile**: `scripts/oauth/refresh.sh` is gitignored and only exists via `restoreRuntimeFiles()` in the build pipeline. If the build pipeline hiccups, the file vanishes with no git safety net.

3. **Shabbat mode is a 25-hour pause**: Any token with <25h expiry will expire during Shabbat. The refresh scheduler only runs in fallback mode, and Shabbat mode prevents the auth error that would trigger fallback. This is a predictable failure window.

4. **Cascading notification spam**: Each retry sends multiple WhatsApp messages (auth error notification + "task crashed" notification + reaction). At retryCount=5 with 80s delay, this is manageable but earlier retries (5s, 10s) produced rapid message bursts.
