# Intent: types.ts

## Changes
Extends the `Channel` interface with two optional reaction methods:
- `sendReaction()`: React to a specific message by ID with an emoji
- `reactToLatestMessage()`: React to the most recent message in a chat with an emoji

Adds `Reaction` interface export to define the shape of stored reaction data.

## Key Sections to Find
- `Channel` interface (around line 82)
- Channel optional methods section (setTyping, syncGroups)

## Invariants
- `Channel` interface must remain exported
- `sendReaction` and `reactToLatestMessage` must be optional (?) to not break existing channel implementations
- Method signatures match those used in db.ts and ipc.ts for reactions
