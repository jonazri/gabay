# NanoClaw

> **WARNING:** This repo is a fork. Always push to and create PRs on `jonazri/gabay` (origin). NEVER push to or create PRs on `qwibitai/nanoclaw` (upstream).

Personal Claude assistant. See [README.md](README.md) for philosophy and setup. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for architecture decisions.

## Quick Context

Single Node.js process that connects to WhatsApp, routes messages to Claude Agent SDK running in containers (Linux VMs). Each group has isolated filesystem and memory.

## Key Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/ipc.ts` | IPC watcher and task processing |
| `src/router.ts` | Message formatting and outbound routing |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/task-scheduler.ts` | Runs scheduled tasks |
| `src/db.ts` | SQLite operations |
| `groups/{name}/CLAUDE.md` | Per-group memory (isolated) |
| `container/skills/agent-browser.md` | Browser automation tool (available to all agents via Bash) |

## Skills

| Skill | When to Use |
|-------|-------------|
| `/setup` | First-time installation, authentication, service configuration |
| `/customize` | Adding channels, integrations, changing behavior |
| `/debug` | Container issues, logs, troubleshooting |
| `/update-nanoclaw` | Bring upstream NanoClaw updates into a customized install |
| `/qodo-pr-resolver` | Fetch and fix Qodo PR review issues interactively or in batch |
| `/get-qodo-rules` | Load org- and repo-level coding rules from Qodo before code tasks |
| `/process-feature-request` | Review and implement PRDs written by the container agent |

## Build Model (Patch Queue)

This fork uses a **patch-queue model**. `src/` in git matches upstream/main exactly. All fork customizations live as skills in `.claude/skills/` and are applied at build time.

```bash
npm run build          # Apply skills -> compile -> restore src/
npm run build:quick    # Compile only (src/ must be pre-applied)
npm run dev            # Apply skills -> watch mode (src/ stays applied)
npm run apply-skills   # Apply all installed skills to src/
npm run clean-skills   # Restore src/ to upstream state
npm run package-skill  # Extract src/ changes into a new skill
```

### Development workflow

1. **Always work in a git worktree** to avoid breaking the live service:
   ```bash
   git worktree add ../gabay-feature feat/my-feature
   cd ../gabay-feature
   npm run dev
   ```
2. Edit src/ freely during development
3. When feature is ready: `npm run package-skill my-feature`
4. Add skill to `.nanoclaw/installed-skills.yaml`, run `npm run build`
5. Commit the skill files, not the src/ changes

### Upstream merges

```bash
git fetch upstream && git merge upstream/main   # trivial — src/ matches
npm run build                                    # re-applies skills
npx vitest run                                   # verify
```

## Development

Run commands directly—don't tell the user to run them.

```bash
npm run dev          # Apply skills + hot reload
npm run build        # Apply skills -> compile -> restore src/
./container/build.sh # Rebuild agent container
```

Service management:
```bash
# macOS (launchd)
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist
launchctl kickstart -k gui/$(id -u)/com.nanoclaw  # restart

# Linux (systemd)
systemctl --user start nanoclaw
systemctl --user stop nanoclaw
systemctl --user restart nanoclaw
```

## Logs

```bash
tail -f ~/code/yonibot/gabay/logs/nanoclaw.log
```

## Scratch Scripts

`scripts/scratch/` is gitignored — use it for throwaway queries, one-off database inspections, and temporary debugging scripts. Don't put reusable tools there.

## Container Build Cache

The container buildkit caches the build context aggressively. `--no-cache` alone does NOT invalidate COPY steps — the builder's volume retains stale files. To force a truly clean rebuild, prune the builder then re-run `./container/build.sh`.
