# container/agent-runner/src/index.ts Overlay Intent

## Overview
Adds auth error detection in container-side result parsing to surface OAuth failures early.

## Changes
- **Lines 560-563**: Detect API auth errors in result text (401 responses) — mark as error status instead of success
- **Lines 559-577**: Bifurcate result output: if auth error detected in text, emit `status: 'error'` with error string; otherwise emit `status: 'success'` with result text

## Key Sections to Look For
- `runQuery()` function: async generator loop consuming SDK messages
- Message type `'result'` handler: where results are emitted via `writeOutput()`
- `textResult` extraction: parsing agent text output
- Auth error regex: `/Failed to authenticate\. API Error: 401/`

## Invariants
- Auth error regex must match SDK's actual 401 error message format
- Only check `textResult` (agent's text output), not other result fields
- Detected auth errors immediately emit `status: 'error'` to trigger host-side refresh + retry
- Error message passed to host preserves original error text for debugging
- `newSessionId` included in error output so host can continue with same session after token refresh
