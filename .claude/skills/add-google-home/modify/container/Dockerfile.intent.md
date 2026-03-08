# Overlay Intent: container/Dockerfile

## Summary
Installs and configures the Google Home CLI wrapper tool in the container image for voice assistant integration. The overlay file is identical to the base, indicating it's a full-file delta containing Google Home setup steps.

## Changes

### Google Home CLI Installation (Lines 49-51)
**What:** Copies and installs the `google-home` CLI tool from skill assets
**Lines:**
```dockerfile
# Install google-home CLI wrapper
COPY skills/google-home/google-home /usr/local/bin/google-home
RUN chmod +x /usr/local/bin/google-home
```
**Location:** After `COPY agent-runner/ ./` (line 47), before `RUN npm run build` (line 54)
**Purpose:** Makes the Google Home voice control CLI available globally in container PATH at `/usr/local/bin/google-home`

## Invariants to Preserve

1. **Source path:** Must be `skills/google-home/google-home` (relative to Dockerfile context, which is project root)
2. **Destination path:** Must be `/usr/local/bin/google-home` (standard system binary location)
3. **Executable permission:** File must be made executable with `chmod +x` immediately after copy
4. **Placement order:** Must come after agent-runner copy but before TypeScript build (so build can reference it if needed)
5. **No USER changes:** Must remain before `USER node` switch; copying to `/usr/local/bin` requires root
6. **Image layer efficiency:** Both copy and chmod should be in same RUN command if possible, or accept as separate lines

## Key Sections in Base File

- Line 40-47: Existing COPY commands for agent-runner and package files
- Line 54: TypeScript build (`RUN npm run build`)
- Line 64-68: User and working directory setup
- Import section: Lines 1-35 (unchanged; only docker system dependencies)

## Dependencies

- **Source file:** `.claude/skills/add-google-home/add/src/google-assistant.ts` likely generates or references the `container/skills/google-home/google-home` binary
- **Skill structure:** Assumes skill has packaged the CLI tool at `container/skills/google-home/google-home` in the build context
- **No new base image dependencies:** No additional system packages needed; uses existing Node.js and system tools

## Notes

- The overlay is a delta (full-file copy of base with this addition), not a `_accumulated` full-file overlay
- The google-home tool must be executable and findable in PATH for agent processes
- No environment variables need to be set for this binary (it's self-contained)
