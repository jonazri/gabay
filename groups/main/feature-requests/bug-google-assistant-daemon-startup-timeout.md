# bug: Google Assistant daemon times out during startup

## Summary

All Google Home commands are failing because the Google Assistant daemon times out during startup. Both the socket CLI method and the IPC task file method fail with the same error.

## Error Message

```
{"status":"error","error":"Google Assistant daemon timed out during startup"}
```

## What Was Being Attempted

User requested: "Set the office lights to candlelight"

## Diagnosis

- The socket file `/workspace/sockets/google-assistant.sock` **exists** and **accepts connections**
- However, after connecting, no response is returned (times out after 60s)
- IPC task file method (`google_assistant_command` type) also fails with the same error
- `google-home status` returns the same daemon startup timeout

## Steps to Reproduce

1. Run `google-home command "turn on the office lights"` from any agent container
2. OR write an IPC task: `{"type":"google_assistant_command","requestId":"...","text":"turn on the lights"}`
3. Both fail with: `Google Assistant daemon timed out during startup`

## Expected Behavior

Google Assistant daemon starts successfully and responds to commands.

## Likely Cause

The Google Assistant daemon process on the host is either:
- Crashed and not restarting
- Hanging during initialization (possible auth/token issue)
- The underlying `google-oauthlib` or assistant SDK credentials have expired

## Action Needed

Restart the Google Assistant daemon process on the host. Check its logs for startup errors (likely an expired OAuth token or credential issue).
