# Intent: src/container-runner.ts

## What changed
Enables containers to reach host services (RAG API, local search backends) by adding the Docker-standard host gateway alias. Containers can now reach `host.docker.internal` to call services running on the host machine.

## Key sections

### buildContainerArgs function (lines 244-246)
- Added: `args.push('--add-host', 'host.docker.internal:host-gateway')`
- Location: After user ID setup, before mount configuration
- Enables: `curl http://host.docker.internal:<port>` from within the container

## Invariants (must-keep)
- All volume mount configuration unchanged
- Secrets handling via stdin unchanged
- Container name and image setup unchanged
- Timeout and idle logic unchanged
- Output parsing and streaming mode unchanged
- Process lifecycle and error handling unchanged
- User/UID mapping logic unchanged
- TZ environment variable setup unchanged
