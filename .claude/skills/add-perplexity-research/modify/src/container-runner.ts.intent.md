# container-runner.ts Overlay Intent

## Changes

Adds host plugin configuration sync to container mount setup. Enables Claude SDK plugins to work across agent containers by copying host `~/.claude/plugins/installed_plugins.json` into each group's isolated `.claude/plugins/` directory and rewriting path references for container execution.

## Key Sections to Match

1. **Import statement** (line 7): Adds `import os from 'os';` for `os.homedir()` to resolve home directory
2. **Plugin sync block** (lines 161-195): Inserted after skills sync and before group sessions directory mount
   - Reads host plugins config from `~/.claude/plugins/installed_plugins.json`
   - Rewrites `installPath` values to map host home dir → container home (`/home/node`)
   - Writes normalized config to group's `.claude/plugins/installed_plugins.json`
3. **Plugin cache mount** (lines 203-211): Added after group sessions mount, mounts `~/.claude/plugins/cache` (read-only)

## Invariants to Preserve

- Plugin sync must occur **after** skills sync but **before** group IPC mount setup
- Must use `os.homedir()` to resolve actual home directory (not hardcoded paths)
- Path rewriting must replace `homeDir` with container home `/home/node` in `installPath` fields only
- Group plugin cache directory creation must follow group sessions directory pattern
- Read-only mount of plugin cache must use `readonlyMountArgs()` for consistency with other mounted resources
- Error handling must not block container startup (wrap in try-catch, log warning)
- Plugins config is optional — graceful degradation if file doesn't exist or parsing fails
