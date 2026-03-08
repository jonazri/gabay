# Feature Request: whatsapp-replies skill — timezone support and DB query limits

**Date:** 2026-03-08
**Status:** new
**Requested by:** Host (upstream alignment audit)

## Summary

The `whatsapp-replies` skill needs two updates to align with upstream NanoClaw v1.2.10 patterns:

1. **Full timezone integration in `router.ts`** — The current fix adds the `timezone` parameter and `<context>` header, and uses `formatLocalTime()` for display times. However, the `formatting.test.ts` tests don't verify timezone behavior (all calls omit the second arg, defaulting to UTC). Tests should be updated to explicitly pass a timezone and verify localized output.

2. **LIMIT on DB queries in `db.ts`** — The `whatsapp-replies` overlay for `db.ts` still uses unbounded `SELECT` queries in `getNewMessages()` and `getMessagesSince()`. Upstream added a `limit: number = 200` parameter with a DESC LIMIT subquery to cap memory usage. The overlay's extra columns (`replied_to_id`, `replied_to_sender`, `replied_to_content`) need to be preserved inside the inner subquery.

## Files to modify

### `whatsapp-replies/modify/src/formatting.test.ts`
- Add test cases that pass a timezone string (e.g., `'America/New_York'`) and verify `formatLocalTime` output appears in the `time=` attribute
- Add test case verifying the `<context timezone="..." />` header is present

### `whatsapp-replies/modify/src/db.ts`
- Add `limit: number = 200` parameter to `getNewMessages()` and `getMessagesSince()`
- Wrap inner SELECT in `SELECT * FROM (...ORDER BY timestamp DESC LIMIT ?) ORDER BY timestamp`
- Keep `replied_to_id`, `replied_to_sender`, `replied_to_content` in the inner SELECT column list
- Add `limit` as the last bind parameter in `.all()`

### `whatsapp-replies/modify/src/db.test.ts` (if exists)
- Update test expectations for the new function signatures

## Important: LIMIT tradeoff

The LIMIT 200 default means messages beyond the 200 most recent are silently dropped when a group accumulates >200 messages between polls. Consider whether 200 is sufficient for high-volume groups, and whether dropped messages should be logged as a warning.

## Acceptance criteria

- `npm run build` succeeds
- `npm test` passes (355+ tests)
- `npx vitest run --config vitest.skills.config.ts` passes
- `formatMessages()` tests explicitly verify timezone output
- DB queries are bounded with LIMIT subquery pattern
