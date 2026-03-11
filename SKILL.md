# Reactions
WhatsApp emoji reaction support with status tracking.

## Prerequisites
- skill/whatsapp

## Installation
1. `git fetch origin skill/reactions`
2. `git merge origin/skill/reactions`
3. `npm install`
4. Run `npx tsx scripts/migrate-reactions.ts` to add reaction columns to existing DB

## Verification
- `npm run build && npm test`

## Environment Variables
None
