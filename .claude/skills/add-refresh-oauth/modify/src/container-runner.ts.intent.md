# container-runner.ts Overlay Intent

## Overview
Implements OAuth token and secret management for container injection, plus auth error detection during streaming.

## Changes
- **Line 26**: Import `readOAuthState` to check fallback mode and token state
- **Lines 214-244**: Implement `readSecrets()` function with token precedence logic:
  - Fallback mode: .env wins (freshly-refreshed short-lived token)
  - Primary mode: process.env wins (long-lived primary token)
- **Lines 340**: Pass `readSecrets()` result as `input.secrets` to container stdin
- **Lines 396-414**: Streaming auth error detection in `container.stdout.on('data')` — detect API 401 errors and abort container early with `stopContainer()` to avoid retry loops

## Key Sections to Look For
- `buildVolumeMounts()` function: no changes, context for understanding mounts
- `readSecrets()` function: new function, implements token precedence
- `runContainerAgent()` return statement: where `input.secrets` is populated
- Streaming output parser: `parseBuffer` loop looking for `OUTPUT_START_MARKER`
- Auth error detection: `AUTH_ERROR_PATTERN.test(parsed.error)` check

## Invariants
- Secrets **never** written to disk or mounted as files
- Token precedence: fallback mode favors .env, primary mode favors process.env
- `AUTH_ERROR_PATTERN` detection must be checked on `parsed.error`, NOT `parsed.result` (avoid false positives)
- Auth errors in streaming abort container via `exec(stopContainer())` with 15s timeout
- Secrets removed from `input` object after stdin write to prevent accidental logging (line 344)
