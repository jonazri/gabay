# Upstream OAuth Refresh Skill — Design

**Date**: 2026-03-08
**Target**: PR to qwibitai/nanoclaw (upstream)

## Goal

Package the oauth-refresh skill (and its lifecycle-hooks dependency) as an upstream-quality contribution. Both skills must meet the quality bar of existing upstream skills like add-image-vision and add-pdf-reader.

## Scope

Two skills in one PR:

1. **lifecycle-hooks** — Startup/shutdown hooks, message event emitters, cursor management
2. **refresh-oauth** — OAuth token lifecycle: proactive refresh, fallback mode, auth error recovery

## Key Decisions

- **Approach A**: Rewrite all modify/ overlays as minimal deltas against upstream base
- **Inline ipc-handler-registry** into refresh-oauth's ipc.ts overlay (~26 lines)
- **Bundle lifecycle-hooks** in the same PR (not available upstream yet)
- **Work in a git worktree** for isolation

## Overlay Strategy

Each overlay = upstream base + only this skill's additions. Target single-digit percent growth.

### lifecycle-hooks overlays

| File | Changes |
|------|---------|
| `src/index.ts` | +imports, +hook calls at startup/shutdown/channel-ready, +guard check in message loop, +event emits |

### refresh-oauth overlays

| File | Base | Changes |
|------|------|---------|
| `src/index.ts` | lifecycle-hooks | +oauth imports + IPC handler import, +pre-flight, +auth recovery wrapper, +shutdown cleanup, +startup init |
| `src/task-scheduler.ts` | upstream | +oauth imports, +pre-flight, +auth recovery wrapper |
| `src/container-runner.ts` | upstream | +oauth state import, +readSecrets() with token precedence, +secrets to container, +streaming auth error detection |
| `src/ipc.ts` | upstream | +inlined handler registry (~26 lines), +handler lookup in default case |
| `container/agent-runner/src/index.ts` | upstream | +auth error regex, +bifurcate success/error output |

## Documentation

- **SKILL.md**: Descriptive + prescriptive, no code diffs. Multi-phase setup guide.
- **Intent.md**: Concise per-overlay intent files documenting what changed and invariants.

## Testing

Each skill gets `tests/skill.test.ts` with:
- Manifest validation (all declared files exist)
- Intent file coverage (every modify/ has .intent.md)
- Structure preservation (overlays preserve key upstream structures)
- Existing oauth.test.ts unit tests stay in add/

## File Structure

```
.claude/skills/add-lifecycle-hooks/
├── SKILL.md, manifest.yaml
├── add/src/{lifecycle,message-events,cursor-manager}.ts + tests
├── modify/src/index.ts + .intent.md
└── tests/skill.test.ts

.claude/skills/add-refresh-oauth/
├── SKILL.md, manifest.yaml
├── add/src/{oauth,ipc-handlers/refresh-oauth}.ts + tests + scripts/
├── modify/src/{index,task-scheduler,container-runner,ipc}.ts + .intent.md
├── modify/container/agent-runner/src/index.ts + .intent.md
└── tests/skill.test.ts
```

## Quality Checklist

- [ ] All overlays are minimal deltas (single-digit % growth)
- [ ] Every modify/ file has a concise .intent.md
- [ ] SKILL.md is descriptive + prescriptive, no code diffs
- [ ] manifest.yaml declares all adds/modifies/dependencies
- [ ] tests/ validate manifest, file presence, structure preservation
- [ ] `npm run build` succeeds with both skills applied
- [ ] Existing oauth.test.ts passes
