# Shabbat Mode
Pause all activity during Shabbat and Yom Tov.

## Prerequisites
- skill/lifecycle-hooks

## Installation
1. `git fetch origin skill/shabbat-mode`
2. `git merge origin/skill/shabbat-mode`
3. `npm install`
4. Run `npx tsx scripts/generate-zmanim.ts` to generate zmanim data

## Verification
- `npm run build && npm test`

## Environment Variables
None (uses hardcoded location; edit src/shabbat.ts to change)
