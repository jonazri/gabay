# Intent: formatting.test.ts

## Changes
Adds tests for reply context formatting in the XML message format sent to the agent. Tests verify:
- Reply attributes (`replied_to_id`, `replied_to_sender`) are included in message XML
- Nested `<reply_to>` tag contains the original message text
- Proper XML escaping of special characters in reply fields

## Key Sections
- Test suite in `describe('formatMessages')` around line 123-150: Tests for reply context formatting
- Assertions for presence of reply attributes and nested XML structure
- Escaping tests: Verify `&`, `<`, `>`, `"` are escaped in reply content

## Invariants
- Reply attributes only present if `replied_to_id` is set
- `<reply_to>` tag only present if `replied_to_content` is set
- Both attributes and content must be XML-escaped
- Format must match the XML structure expected by the agent
