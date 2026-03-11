# WhatsApp
WhatsApp channel via Baileys (Multi-Device Web API).

## Prerequisites
None (base channel)

## Installation
1. `git fetch origin skill/whatsapp`
2. `git merge origin/skill/whatsapp`
3. `npm install`
4. Run `npm run auth` to authenticate with WhatsApp

## Verification
- `npm run build && npm test`

## Environment Variables
- `ASSISTANT_HAS_OWN_NUMBER` — Set to "true" if the assistant has its own dedicated WhatsApp number
