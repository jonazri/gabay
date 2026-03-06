# Self-Heal Skill Design

## Problem

When an IPC task type has no registered handler (unknown type, missing import, broken skill packaging), the host silently discards the file. The container agent polls for a response that never comes and times out after 60 seconds. The agent has no way to know what went wrong or take corrective action.

This also applies to other IPC failures: handler exceptions, malformed JSON, and missing required fields.

## Solution

A new `self-heal` skill that:
1. **Host side:** Catches all IPC failures and writes error responses + notification messages back to the container agent
2. **Container side:** Instructs the agent to triage errors, retry when appropriate, and file bug reports for host-side issues

## Approach: Error responses + agent-runner notification pipe

### Host-side changes (ipc.ts overlay)

Modify the IPC task processing to catch all failure modes and respond:

**Error response file:** Write `{status: "error", error: "...", ipc_type: "..."}` to `ipc/{group}/responses/{requestId}.json` when `requestId` exists in the IPC data. This gives immediate feedback to agents that poll for responses (e.g., google-home CLI tool).

**Notification file:** Write a `{type: "message", text: "..."}` file to `ipc/{group}/input/{timestamp}.json`. The agent-runner's `drainIpcInput()` picks this up and pipes it into the running conversation, so the agent always sees the error — even for fire-and-forget IPC calls like `schedule_task`.

#### Error categories

| Failure | Error code | Agent action |
|---------|-----------|--------------|
| Unknown IPC type | `unknown_ipc_type` | Check for typo → retry or file bug report |
| Handler exception | `handler_error` | Likely host-side bug → file bug report |
| Malformed JSON | `malformed_request` | Agent's fault → fix and retry |
| Missing required fields | `invalid_request` | Agent's fault → fix and retry |

#### Notification message format

```
[IPC Error] Type "{type}" failed: {error}. If this is your mistake, correct and retry. If this looks like a host-side bug (missing handler, broken skill), write a bug report to /workspace/group/feature-requests/.
```

### Container-side behavior (SKILL.md)

A container skill that instructs the agent on error triage:

1. **On `unknown_ipc_type`:** Check if the command format is wrong (typo, wrong type name). If so, correct and retry. If the type matches a known CLI tool or skill, it's a host-side bug — the handler registration is broken.

2. **On `handler_error`:** The host handler crashed. File a bug report.

3. **On `malformed_request` / `invalid_request`:** Agent's fault. Fix the request and retry.

4. **Bug report flow:** Write to `/workspace/group/feature-requests/` with:
   - Title: `bug: <description>`
   - IPC type that failed
   - Error message
   - Steps to reproduce
   - Inform user via `send_message`

## Skill structure

```
.claude/skills/add-self-heal/
├── manifest.yaml
├── modify/
│   └── src/
│       └── ipc.ts          # Wrap error paths with response + notification
└── add/
    └── container/
        └── skills/
            └── self-heal/
                └── SKILL.md  # Agent error triage + bug reporting instructions
```

**Dependencies:** `ipc-handler-registry`
**modify_base:** `src/ipc.ts: group-lifecycle` (last skill to modify ipc.ts)

## Data flow

```
Agent writes IPC task file
    → Host IPC watcher picks it up
    → Dispatches to handler registry
    → On failure:
        ├── Writes error response to ipc/{group}/responses/{requestId}.json
        └── Writes notification to ipc/{group}/input/{timestamp}.json
            → Agent-runner pipes notification into running conversation
            → Agent triages: retry (own mistake) or file bug report (host bug)
```

## Non-goals

- Automatic host-side retry/backoff (the failures we've seen are build-time bugs, not race conditions)
- WhatsApp notification to user on every error (agent decides whether to notify)
- Modifying agent-runner code (reuses existing `drainIpcInput` polling)
