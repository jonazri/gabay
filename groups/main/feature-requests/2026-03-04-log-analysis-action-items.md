# Log Analysis Action Items (March 1-4, 2026)

72-hour log analysis of NanoClaw. OAuth refresh spam already fixed.

## Critical (Fixed)

- [x] **OAuth token refresh log spam** — 88.6% of 316MB log was noise from PID 1458316's tight refresh loop. Fixed: disabled proactive scheduler when external token present. Log pruned to 34MB.

## High

- [ ] **44 service restarts in 72 hours** (~1.6h average uptime). March 2 09:00-15:00 worst with 8 restarts. Appear to be external SIGTERMs, not crashes. Investigate: systemd OOM kills? Memory pressure? Manual restarts?
- [ ] **Container SIGKILL (code 137)** — 10 containers killed mid-session, some after already sending output. System retries, potentially causing duplicate responses. Related to service restarts (container outlives parent process, gets SIGKILL after TimeoutStopSec).

## Medium

- [ ] **Baileys JSON parse error in notifications** — 30 occurrences. `SyntaxError: Unexpected non-whitespace character after JSON at position 15` in `process-message.js:365`. Upstream Baileys bug or malformed WhatsApp server data. May cause missed notifications.
- [ ] **WhatsApp decryption failures** — 63 occurrences. E2E encryption key sync failures. Known Baileys limitation. Error object is empty (`error: {}`) — no diagnostic info.
- [x] **Missing `@elevenlabs/elevenlabs-js` package** — 4 failures. Fixed: package installed during March 4 rebuild. Was missing from earlier builds.
- [x] **Google Home daemon timeout** — 4 failures. Verified working now: daemon starts, connects to gRPC, emits `ready`. Failures were from older sessions (likely OAuth token or credential issues at the time).
- [ ] **Recovery scan noise** — 86K log lines from "found unprocessed messages" for groups that are never processed (e.g. "Mivtza Kashrus" grew from 491→929 pending). Scanned every restart but never acted on.

## Low

- [ ] **`google_home_command` IPC type unrecognized** — 2 occurrences. Container agent sends this type but host doesn't handle it. Related to broken Google Home daemon.
- [ ] **Voice recognition daemon timeout** — 4 occurrences. Daemon exits code 2 before loading model. Transcription still works via fallback, but speaker identification is non-functional.
- [ ] **Blocked scheduled task output to group chat** — 1 occurrence. Task misconfigured with wrong target JID.
- [ ] **No log rotation** — 316MB single file (now 34MB after prune). Should set up logrotate.

## Operational Metrics (72 Hours)

| Metric | Value |
|--------|-------|
| Service restarts | 44 |
| Container spawns | 126 |
| Container completions | 98 (77.8%) |
| Container errors | 13 (10.3%) |
| Scheduled tasks run | 81 |
| Scheduled tasks completed | 80 (98.8%) |
| Messages processed | 45 |
| Messages sent | 189 |
| Reactions added | 743 |
| ERROR log entries | 237 |
| WARN log entries | 213 |
