# task-scheduler.ts Overlay Intent

## Overview
Adds OAuth token refresh to scheduled task execution pipeline.

## Changes
- **Line 22**: Import `ensureTokenFresh` and `attemptAuthRecovery` from oauth module
- **Line 180**: Call `ensureTokenFresh()` before task container invocation (pre-flight)
- **Lines 217-255**: Wrap task `runContainerAgent()` error with `attemptAuthRecovery()` — detects auth errors and retries after token refresh

## Key Sections to Look For
- `runTask()` function: task execution entry point
- First `runContainerAgent()` call (~line 182): pre-flight token refresh point
- Error handling block after first container run: auth recovery wrapper

## Invariants
- `ensureTokenFresh()` must precede `runContainerAgent()`
- Auth recovery must attempt retry only if `attemptAuthRecovery()` returns true
- Retry uses same task parameters as initial attempt but may get refreshed secrets
- `notifyMain()` callback provided to auth recovery for user notification
- Task lifecycle preserved: error status, result logging unchanged
