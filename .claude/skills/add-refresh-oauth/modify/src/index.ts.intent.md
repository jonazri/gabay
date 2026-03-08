# index.ts Overlay Intent

## Overview
Adds OAuth token refresh infrastructure and error recovery to the main orchestrator.

## Changes
- **Line 5**: Import `refresh-oauth.js` IPC handler (self-registering)
- **Lines 7-14**: Import OAuth functions: `initOAuthState`, `readOAuthState`, token refresh scheduler, primary probe (fallback mode detection)
- **Line 351**: Call `ensureTokenFresh()` before running agent (pre-flight token validation)
- **Lines 374-402**: Wrap agent errors with `attemptAuthRecovery()` — detects 401/auth errors and triggers token refresh cycle with retry
- **Lines 569-571**: Shutdown: stop refresh scheduler and primary probe (cleanup)
- **Lines 633-642**: Main startup: initialize OAuth state, ensure token fresh, conditionally start refresh scheduler and primary probe if fallback mode detected

## Key Sections to Look For
- `runAgent()` function: needs token pre-flight and auth recovery wrapper
- `main()` function: startup and shutdown signal handlers
- Shutdown handler: must stop refresh scheduler/probe before queue shutdown for skill combination compatibility

## Invariants
- `ensureTokenFresh()` must be called **before** every `runContainerAgent()` invocation
- Auth recovery must wrap `runContainerAgent()` in message/task processing paths
- Refresh scheduler/probe only run when `readOAuthState().usingFallback === true`
- Scheduler/probe must be stopped **before** queue shutdown to prevent stale intervals
- OAuth state lifecycle: init → ensure fresh → (conditional) start schedulers
