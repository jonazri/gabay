# Overlay Intent: container-runner.ts

## Summary
Adds infrastructure for Google Home support and socket-based inter-process communication by creating additional IPC directories and a shared sockets mount point.

## Changes

### 1. Responses Directory Creation (Line ~170)
**What:** Creates `/responses` subdirectory under the group IPC directory
**Line to find:** `fs.mkdirSync(path.join(groupIpcDir, 'input'), { recursive: true });`
**Action:** Insert after: `fs.mkdirSync(path.join(groupIpcDir, 'responses'), { recursive: true });`
**Purpose:** Allocates IPC namespace for agent responses back to CLI/host processes

### 2. Sockets Mount Addition (Line ~175)
**What:** Mounts shared host sockets directory into container at `/workspace/sockets`
**Line to find:** The existing IPC mount block that ends with `readonly: false,` followed by the agent-runner source copy comment
**Action:** Insert between IPC mount and agent-runner copy sections
**Code block:**
```typescript
// Shared sockets directory (for direct CLI-to-host communication)
const socketsDir = path.join(DATA_DIR, 'sockets');
fs.mkdirSync(socketsDir, { recursive: true });
mounts.push({
  hostPath: socketsDir,
  containerPath: '/workspace/sockets',
  readonly: false,
});
```
**Purpose:** Enables agent containers to communicate with host CLI tools (Google Home voice assistant) via socket files

## Invariants to Preserve

1. **Directory creation order:** Responses directory must be created before IPC mount push
2. **Socket directory isolation:** Sockets directory must use `DATA_DIR` constant, not group-specific paths (shared by all groups)
3. **Mount permissions:** Both directories must have `readonly: false` for bi-directional IPC
4. **Path integrity:** `groupIpcDir` must resolve correctly via `resolveGroupIpcPath()`; `DATA_DIR` must be imported from config
5. **No changes to agent-runner section:** The copy logic for agent-runner source (lines ~186-208) must remain unchanged

## Key Sections in Base File

- `buildVolumeMounts()` function: Entire function (lines 57-221)
- Import section: Verify `DATA_DIR` is imported from config (line 14)
- IPC mount setup: Lines 164-174 (existing groupIpcDir mounts)
- Agent-runner copy: Lines 176-208

## Dependencies

- Must appear after IPC path initialization (`resolveGroupIpcPath`)
- Must appear before agent-runner copy section
- Depends on `DATA_DIR` imported from `./config.js`
