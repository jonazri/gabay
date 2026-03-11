# bug: AKIFLOW_DB not mounted/injected into container

## Summary
The `AKIFLOW_DB` environment variable is not set in Andy's container, and the Akiflow SQLite database is not mounted. As a result, all `akiflow` skill commands silently fail or return errors like "no such table: events_view".

## IPC Type / Component
Container startup / environment injection

## Symptoms
```
$ printenv AKIFLOW_DB
(empty)

$ akiflow list-today
Error: in prepare, no such table: tasks_display
```

## Root Cause
The `akiflow-functions.sh` skill expects `AKIFLOW_DB` to be set to a path of a valid SQLite database file, injected at container startup. The daemon (`akiflow-sync`) uses `AKIFLOW_DB_PATH` env var (defaulting to `./akiflow/akiflow.db` relative to project root).

Neither the env var nor the DB file are present in the container.

## Fix Needed
1. Mount the Akiflow database file into the container (e.g., at `/workspace/akiflow/akiflow.db`)
2. Inject `AKIFLOW_DB=/workspace/akiflow/akiflow.db` into the container environment at startup

Or alternatively:
- Set `AKIFLOW_DB` in the `.env` file that gets sourced on container start

## Impact
- Cannot check today's/tomorrow's tasks or calendar
- Cannot create/update/complete tasks
- `akiflow` skill completely non-functional

## Date
2026-03-10
