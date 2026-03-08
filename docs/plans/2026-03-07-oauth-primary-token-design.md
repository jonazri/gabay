# Design: Use Long-Term Token as Primary OAuth Source

**Date**: 2026-03-07
**Context**: [Postmortem](../../groups/main/feature-requests/2026-03-07-oauth-auth-loop-postmortem.md)

## Problem

The oauth-refresh skill was designed for two-tier token handling:
- **Primary mode**: long-lived token (no expiry), no refresh needed
- **Fallback mode**: short-lived (~8h) credentials.json token, proactively refreshed by `refresh.sh`

But the long-term token in `~/.bashrc` was never reaching the service because systemd doesn't source bashrc. The system silently degraded to running on short-lived tokens full-time. This failed during Shabbat (25h pause > 8h token lifetime).

## Design

### 1. Write long-term token to `.env` (one-time)

Replace the current short-lived token with the long-term bashrc token. `.env` becomes the authoritative token source for containers (via `readSecrets()` → `readEnvFile()`).

### 2. Guard `.env` from overwrite in primary mode (`refresh.sh`)

Add early exit: if `.oauth-state.json` doesn't exist or `usingFallback` is not `true`, exit 0. The script only writes to `.env` when in fallback mode.

### 3. Stash primary token on fallback entry (`oauth.ts`)

When `activateFallback()` fires, read the current `.env` token (the long-term one) and save it as `primaryToken` in `.oauth-state.json` before `refresh.sh` overwrites `.env` with a short-lived token.

### 4. Primary probe uses stashed token (`oauth.ts`)

`startPrimaryProbe()` reads `state.primaryToken` instead of `getPrimaryToken()` (which would return the current short-lived `.env` token). When the probe succeeds, write `state.primaryToken` back to `.env` and clear fallback state.

### 5. No changes to `ensureTokenFresh()` or `initOAuthState()`

Primary mode: `getPrimaryToken()` reads `.env` → long-term token → returns `true` (no expiry check). Fallback mode on restart: existing logic resumes scheduler and probe.

## Files Changed

| File | Change |
|------|--------|
| `.env` | One-time: long-term token |
| `scripts/oauth/refresh.sh` | Guard: exit early if not in fallback |
| `src/oauth.ts` (skill overlay) | Stash `primaryToken` in state on fallback entry |
| `src/oauth.ts` (skill overlay) | Probe uses `state.primaryToken` |
| `src/oauth.ts` (skill overlay) | On probe success: restore `primaryToken` to `.env` |
