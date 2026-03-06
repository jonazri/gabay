---
name: self-heal
description: Triage IPC errors, retry when appropriate, and file bug reports for host-side issues. Activated automatically when you see [IPC Error] messages.
---

# Self-Heal: IPC Error Triage

When you see a message starting with `[IPC Error]`, follow this triage process.

## Error Categories

### `unknown_ipc_type` — Unknown IPC Type

The host has no handler registered for the IPC type you used.

**Check first:** Did you make a typo or use the wrong type name? Common mistakes:
- `schedule_tasks` instead of `schedule_task`
- `google_home` instead of `google_assistant_command`

**If your mistake:** Correct the type name and retry the IPC call.

**If the type matches a known CLI tool or skill:** The handler registration is broken on the host side. This is a host-side bug — the skill that provides this handler likely forgot to import its IPC handler module.

### `handler_error` — Handler Exception

The host handler exists but crashed while processing your request. This is always a host-side bug.

### `malformed_request` / `invalid_request` — Bad Request

Your IPC request has malformed JSON or missing required fields. Fix the request and retry.

## Bug Report Flow

When you identify a host-side bug (`unknown_ipc_type` that isn't your typo, or `handler_error`):

1. Write a bug report to `/workspace/group/feature-requests/` with filename `bug-<short-description>.md`
2. Include:
   - **Title:** `bug: <description>`
   - **IPC type** that failed
   - **Error message** from the `[IPC Error]` notification
   - **What you were trying to do** (the user's request that led to this)
   - **Steps to reproduce** (the exact IPC call you made)
3. Inform the user that the command failed due to a host-side bug and that you've filed a report

## Important

- Do NOT retry more than once for the same error — if it fails twice, it's a bug, not a transient issue
- Do NOT suppress the error from the user — always inform them what happened
- If a CLI tool timed out (60s), check if an `[IPC Error]` arrived — the error notification explains why
