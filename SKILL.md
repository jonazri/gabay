# Google Home
Smart home control via Google Assistant with Unix socket bridge.

## Prerequisites
- skill/lifecycle-hooks
- skill/ipc-handler-registry

## Installation
1. `git fetch origin skill/google-home`
2. `git merge origin/skill/google-home`
3. `npm install`
4. Run `python3 scripts/google-assistant-setup.py` to configure Google credentials

## Verification
- `npm run build && npm test`

## Environment Variables
None (credentials stored locally by setup script)
