# Feature Request: Container Self-Restart via IPC

**Date:** 2026-03-10
**Status:** new
**Requested by:** Andy (self-identified)
**Priority:** nice-to-have

## Problem
When host-side environment variables change (e.g., API keys, OAuth tokens fixed in `.env`), the running container can't pick them up without a manual restart from the host. Andy has no way to trigger this itself — attempting `{"type":"restart_container"}` via IPC results in `unknown_ipc_type` error.

This came up when a Perplexity API key fix was applied to `.env` but Andy's container was spawned before the fix and couldn't reload the new key without a manual host-side restart.

## Proposed Solution
Register an IPC handler for `restart_container` that gracefully restarts Andy's container, allowing the new container to pick up fresh env vars.

```json
{"type": "restart_container"}
```

The handler should:
1. Finish delivering any pending outgoing messages
2. Shut down the current container
3. Start a fresh container with the current `.env`

## Alternatives Considered
- **Manual host restart** — works but requires user intervention, breaks the self-service model
- **Hot-reload env vars** — more complex, would require the container to re-read `.env` mid-session without restarting; not worth the complexity vs. a clean restart

## Acceptance Criteria
- [ ] `{"type":"restart_container"}` IPC task is handled without error
- [ ] New container starts within a few seconds
- [ ] New container picks up current `.env` values
- [ ] Andy confirms by running a diagnostic after restart

## Technical Notes
- IPC tasks are picked up from `/workspace/ipc/tasks/`
- Current container management is likely in the host's process manager (pm2, Docker, etc.)
- Should be safe to call at any time — the host can queue it after current turn completes
