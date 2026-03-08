# Intent: router.ts

## Changes
Updates `formatMessages` function to include reply context in the XML sent to the agent. Adds `replied_to_id` and `replied_to_sender` as attributes on the `<message>` tag, and optionally includes a nested `<reply_to>` tag with the quoted message content.

## Key Sections
- `formatMessages` function (line 13-29): Construct reply attributes and tag based on `NewMessage` fields
- Reply attributes construction (line 16-18): Check for `replied_to_id` and build attribute string
- Reply tag construction (line 19-21): Check for `replied_to_content` and build nested XML
- Message element assembly (line 24-26): Conditional formatting based on presence of reply tag

## Invariants
- Both reply attributes and tag must use `escapeXml` for safety
- Reply attributes only present if `replied_to_id` is truthy
- `<reply_to>` tag only present if `replied_to_content` is truthy
- Message content still escaped regardless of reply presence
- Timezone parameter must still be passed through and used in output
