---
name: feature-request
description: Write a feature request PRD for the host to review and implement. Use when you identify a capability gap, receive a user suggestion that requires host-side code changes, or have an idea for improving the system.
---

# Feature Requests

Write structured PRDs (Product Requirement Documents) to propose features for the host to build.

**This skill is for the main agent only.** If `/workspace/group/feature-requests/` does not exist, this skill does not apply to you.

## When to use

- You identify a missing capability that requires host-side code changes
- A user suggests a feature that you can't implement from inside the container
- You notice a recurring workaround that could be solved with a new feature
- You have an idea for improving the system architecture

Do NOT use for:
- Things you can do yourself (writing files, scheduling tasks, sending messages)
- Changes to your own CLAUDE.md or memory files
- Requests that only need container-side skill additions

## How to write a PRD

### 1. Check for duplicates first

Read existing PRDs to avoid duplicates:

```bash
ls /workspace/group/feature-requests/
ls /workspace/group/feature-requests/completed/
```

If a similar request exists, append to its `## Related` section instead of creating a new file.

### 2. Write the PRD

Create a new file at `/workspace/group/feature-requests/YYYY-MM-DD-{slug}.md`:

- Use today's date
- Slug should be lowercase, hyphenated, descriptive (e.g., `filesystem-watcher`, `voice-commands`)

Use this template exactly:

```
# Feature Request: {Title}

**Date:** YYYY-MM-DD
**Status:** new
**Requested by:** {who — user's name or "Andy (self-identified)"}
**Priority:** {critical | important | nice-to-have}

## Problem
What's broken or missing, and why it matters.

## Proposed Solution
Concrete description of what to build.

## Alternatives Considered
Other approaches and why they weren't chosen.

## Acceptance Criteria
- [ ] Checklist of what "done" looks like

## Technical Notes
Implementation hints, relevant files, constraints.
```

### 3. Notify the user

After writing the PRD, tell the user you've filed a feature request. Example:

> I've filed a feature request for {title}. You can review it by running `/process-feature-request` in Claude Code.

## Checking request status

Read your PRDs to check their status:
- `feature-requests/*.md` — pending or in-progress requests
- `feature-requests/completed/*.md` — implemented requests (check `## Implementation Notes` for details)

## Priority guidelines

| Priority | When to use |
|----------|-------------|
| critical | Blocks core functionality, causes errors or data loss |
| important | Significant UX improvement, frequently requested |
| nice-to-have | Quality-of-life improvement, optimization, nice but not urgent |
