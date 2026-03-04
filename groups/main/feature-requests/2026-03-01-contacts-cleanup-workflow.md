# Feature Request: Multi-Account Contacts Cleanup Workflow

**Date:** 2026-03-01
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

Users with multiple Gmail and Apple accounts accumulate duplicate, outdated, and inconsistent contact information across accounts. Managing contacts becomes a nightmare:

**Common issues:**
- **Duplicates** - Same person entered multiple times across accounts
- **Outdated info** - Old phone numbers, emails, addresses
- **Inconsistent formatting** - "John Smith" vs "Smith, John" vs "Johnny Smith"
- **Missing data** - Some contacts have phone but no email, others vice versa
- **Sync conflicts** - Different versions of same contact across Google/Apple
- **Incomplete merges** - Partial duplicates with some fields matching

**Manual cleanup is painful:**
- Must switch between multiple Gmail accounts
- Must check Apple Contacts separately
- No unified view of all contacts
- Hard to identify duplicates across accounts
- Time-consuming to merge and deduplicate
- Risk of data loss when deleting

## Proposed Solution

Build an AI-powered contacts cleanup workflow that:
1. **Discovers** contacts across all Gmail and Apple accounts
2. **Analyzes** contacts to find duplicates and issues
3. **Proposes** cleanup actions (merge, update, delete)
4. **Executes** approved changes across all accounts
5. **Reports** on cleanup results

### Architecture

```
┌─────────────────────────────────────────────────┐
│  Andy (Orchestrator)                            │
│                                                 │
│  1. Fetch contacts from all accounts            │
│  2. Analyze for duplicates/issues               │
│  3. Generate cleanup plan                       │
│  4. Get user approval                           │
│  5. Execute changes                             │
│  6. Generate report                             │
└────────────┬────────────────────────────────────┘
             │
             ├──────────────┬──────────────┬───────────────┐
             │              │              │               │
             ▼              ▼              ▼               ▼
    ┌────────────┐  ┌────────────┐  ┌──────────┐  ┌──────────┐
    │  Gmail #1  │  │  Gmail #2  │  │  Apple   │  │  Gmail   │
    │            │  │            │  │ Contacts │  │   API    │
    │ Contacts   │  │ Contacts   │  │  (macOS) │  │          │
    │   API      │  │   API      │  │          │  │          │
    └────────────┘  └────────────┘  └──────────┘  └──────────┘
```

### Workflow Steps

#### 1. Account Discovery & Connection

**Gmail accounts:**
- Use OAuth to authenticate multiple Google accounts
- Store credentials securely (similar to existing OAuth flow)
- List all contacts via Google People API

**Apple Contacts:**
- Use macOS RPC (see `2026-03-01-macos-rpc-remote-control.md`)
- Export via Contacts.app AppleScript
- Option: Direct CardDAV access for programmatic sync

#### 2. Contact Ingestion

Fetch all contacts into unified format:
```json
{
  "id": "unique-id",
  "source": "gmail-1|gmail-2|apple",
  "sourceId": "original-contact-id",
  "name": {
    "firstName": "John",
    "lastName": "Smith",
    "displayName": "John Smith",
    "nickname": "Johnny"
  },
  "emails": ["john@example.com", "jsmith@work.com"],
  "phones": ["+1-555-0123", "(917) 555-0456"],
  "addresses": [{
    "type": "home",
    "street": "123 Main St",
    "city": "New York",
    "state": "NY",
    "zip": "10001"
  }],
  "organization": "Acme Corp",
  "title": "CEO",
  "notes": "Met at conference 2024",
  "birthday": "1980-05-15",
  "groups": ["Friends", "Work"],
  "lastModified": "2025-10-20T14:30:00Z"
}
```

#### 3. Duplicate Detection

**Exact matches:**
- Same email address
- Same phone number (normalized)
- Same full name + organization

**Fuzzy matches:**
- Similar names (Levenshtein distance)
- Name variations (Jonathan vs Jon, Robert vs Bob)
- Partial phone matches (missing country code)
- Similar emails (john.smith@ vs jsmith@)

**Confidence scoring:**
```javascript
{
  "duplicates": [
    {
      "contacts": ["contact-id-1", "contact-id-2"],
      "confidence": 0.95,  // 0-1 scale
      "matchedFields": ["email", "name"],
      "reason": "Same email and similar name"
    }
  ]
}
```

#### 4. Issue Detection

**Identify problems:**
- Missing critical info (no email, no phone)
- Outdated formats (old-style phone numbers)
- Incomplete names (first name only)
- Empty contacts (no useful data)
- Suspicious entries (test contacts, placeholders)
- Formatting inconsistencies

**Categorize issues:**
```javascript
{
  "issues": [
    {
      "contactId": "contact-123",
      "type": "missing_email",
      "severity": "medium",
      "suggestion": "Add email or delete if obsolete"
    },
    {
      "contactId": "contact-456",
      "type": "duplicate",
      "severity": "high",
      "suggestion": "Merge with contact-789"
    }
  ]
}
```

#### 5. Generate Cleanup Plan

**Automated actions:**
- **Merge duplicates** - Combine all fields, keep most recent
- **Delete empty contacts** - No useful information
- **Normalize phone numbers** - Convert to E.164 format
- **Standardize names** - Consistent First Last format
- **Remove test entries** - "Test Contact", "asdf", etc.
- **Update groups** - Consolidate inconsistent group names

**Example plan:**
```
Contacts Cleanup Plan
=====================

MERGE (45 duplicates found):
  1. "John Smith" (Gmail #1) + "Smith, John" (Apple) → Keep Gmail version
     Confidence: 95% (same email, similar name)
     Action: Merge phone from Apple, delete Apple version

  2. "Jane Doe" (Gmail #1) + "Jane D." (Gmail #2) → Keep Gmail #1
     Confidence: 87% (same phone, partial name match)
     Action: Merge email from Gmail #2, delete Gmail #2 version

DELETE (12 empty/test contacts):
  - "Test" (Gmail #1) - No useful data
  - "asdf" (Apple) - Placeholder entry
  - "New Contact" (Gmail #2) - Empty

UPDATE (23 contacts need normalization):
  - Fix phone format: "(555) 123-4567" → "+1-555-123-4567"
  - Standardize names: "doe, jane" → "Jane Doe"
  - Add missing groups: Move orphaned contacts to "Uncategorized"

TOTAL: 80 actions proposed
  - 45 merges (90 contacts → 45)
  - 12 deletions
  - 23 updates

Estimated cleanup time: 2-3 minutes
```

#### 6. User Approval

**Interactive review:**
- Show summary statistics
- Let user review each action
- Bulk approve/reject by category
- Manual override for edge cases

**Options:**
```
Choose approval mode:
1. Auto-approve high confidence (>90%)
2. Review all actions one-by-one
3. Approve by category (all merges, all deletions, etc.)
4. Preview only (no changes)
```

#### 7. Execute Changes

**Safely apply changes:**
- Backup all contacts before starting
- Process in batches (avoid API rate limits)
- Log all actions for rollback
- Handle errors gracefully (skip failed, continue)
- Progress updates as it runs

**Execution order:**
1. Backup all contacts (export to JSON/VCF)
2. Process merges (create combined contacts)
3. Process updates (normalize data)
4. Process deletions (remove duplicates/empty)
5. Verify sync across accounts

#### 8. Generate Report

**Summary report:**
```
Contacts Cleanup Complete! ✓
=============================

Before: 450 contacts across 3 accounts
After:  312 contacts (138 removed)

Actions Taken:
  ✓ 42 duplicates merged (saved 42 contacts)
  ✓ 12 empty contacts deleted
  ✓ 23 contacts normalized
  ✓ 185 phone numbers standardized
  ✓ 89 names reformatted

Issues Remaining:
  ⚠ 5 low-confidence duplicates (review manually)
  ⚠ 8 contacts missing email (consider adding)

Backup saved to: /contacts-backup-2026-03-01.json

Estimated time saved: 4-6 hours of manual work
```

## Use Cases

### 1. Initial Cleanup (First Time)
```
User: "Clean up my contacts across all my accounts"
Andy: "Found 3 Gmail accounts and Apple Contacts. Analyzing..."
Andy: "Found 450 total contacts with 45 duplicates and 12 empty entries"
Andy: [Presents cleanup plan]
User: "Auto-approve high confidence matches"
Andy: [Executes cleanup]
Andy: "Done! Reduced 450 → 312 contacts. Saved backup."
```

### 2. Scheduled Maintenance
```
Schedule: Weekly on Sunday 9am
Andy: [Analyzes contacts]
Andy: "Found 3 new duplicates this week"
Andy: [Auto-merges high confidence, notifies user of low confidence]
```

### 3. Pre-Migration Cleanup
```
User: "I'm switching to a new phone, clean up contacts first"
Andy: [Full cleanup workflow]
Andy: "Contacts cleaned. Export as VCF for import to new device?"
```

### 4. Audit Mode
```
User: "Just show me what duplicates I have, don't change anything"
Andy: [Analysis only, no execution]
Andy: "Found 45 duplicates. Export list to review?"
```

## Alternatives Considered

### 1. Third-party contact management tools
- **Examples:** Contacts+, FullContact, Covve
- **Pros:** Dedicated apps, good UI
- **Cons:** Requires separate app, subscription fees, privacy concerns, not integrated with Andy
- **Rejected:** User wants integrated workflow within existing assistant

### 2. Manual Google Contacts merge tool
- **Pros:** Built-in, free
- **Cons:** Only works per-account, no cross-account, no Apple integration, slow
- **Rejected:** Doesn't solve multi-account problem

### 3. Apple Contacts duplicate detection
- **Pros:** Built-in to macOS
- **Cons:** Only works for Apple Contacts, basic detection, no cross-account
- **Rejected:** Doesn't solve multi-account problem

### 4. Export → Excel → Manual cleanup
- **Pros:** Complete control
- **Cons:** Extremely time-consuming, error-prone, hard to sync back
- **Rejected:** Defeats purpose of automation

## Acceptance Criteria

**Contact Discovery:**
- [ ] Authenticate with multiple Gmail accounts via OAuth
- [ ] Access Apple Contacts via macOS RPC
- [ ] Fetch all contacts from all sources
- [ ] Parse contacts into unified format
- [ ] Handle pagination for large contact lists (>1000)

**Duplicate Detection:**
- [ ] Detect exact matches (email, phone, name)
- [ ] Detect fuzzy matches (similar names, partial matches)
- [ ] Calculate confidence scores (0-100%)
- [ ] Group duplicates into merge candidates
- [ ] Handle edge cases (same name, different person)

**Cleanup Actions:**
- [ ] Merge duplicates (combine fields intelligently)
- [ ] Delete empty/test contacts
- [ ] Normalize phone numbers (E.164 format)
- [ ] Standardize name formats
- [ ] Update organization/title fields
- [ ] Consolidate groups/labels

**User Experience:**
- [ ] Present clear, readable cleanup plan
- [ ] Allow approval modes (auto, review, by-category)
- [ ] Show progress during execution
- [ ] Generate summary report
- [ ] Export backup before changes

**Safety:**
- [ ] Automatic backup before any changes
- [ ] Rollback capability (undo all changes)
- [ ] Dry-run mode (preview without executing)
- [ ] Audit log of all changes
- [ ] Handle API errors gracefully

**Performance:**
- [ ] Process 500 contacts in < 30 seconds (analysis)
- [ ] Execute 100 actions in < 2 minutes
- [ ] Respect API rate limits (batch operations)
- [ ] Resume if interrupted (stateful execution)

## Technical Notes

### Google People API

**Authentication:**
```javascript
// OAuth scopes needed
const SCOPES = [
  'https://www.googleapis.com/auth/contacts',
  'https://www.googleapis.com/auth/contacts.other.readonly'
];
```

**Fetch contacts:**
```javascript
const { google } = require('googleapis');

async function getGoogleContacts(auth) {
  const people = google.people({ version: 'v1', auth });
  const res = await people.people.connections.list({
    resourceName: 'people/me',
    pageSize: 1000,
    personFields: 'names,emailAddresses,phoneNumbers,addresses,organizations,biographies,birthdays'
  });
  return res.data.connections || [];
}
```

**Merge contacts:**
```javascript
async function mergeContacts(auth, contactId1, contactId2) {
  // 1. Get both contacts
  // 2. Combine fields intelligently
  // 3. Update primary contact
  // 4. Delete duplicate
}
```

### Apple Contacts (AppleScript)

**Export all contacts:**
```applescript
tell application "Contacts"
    set allPeople to every person
    set output to {}
    repeat with aPerson in allPeople
        set personData to {name:(name of aPerson), email:(value of email 1 of aPerson), phone:(value of phone 1 of aPerson)}
        set end of output to personData
    end repeat
    return output
end tell
```

**Merge contacts:**
```applescript
tell application "Contacts"
    -- Get duplicate persons
    set person1 to person 1
    set person2 to person 2

    -- Copy unique fields from person2 to person1
    if (count of emails of person2) > 0 then
        repeat with anEmail in emails of person2
            make new email at end of emails of person1 with properties {label:label of anEmail, value:value of anEmail}
        end repeat
    end if

    -- Delete person2
    delete person2
    save
end tell
```

### Duplicate Detection Algorithm

**Fuzzy name matching:**
```javascript
const stringSimilarity = require('string-similarity');

function areNamesSimilar(name1, name2, threshold = 0.85) {
  const similarity = stringSimilarity.compareTwoStrings(
    name1.toLowerCase(),
    name2.toLowerCase()
  );
  return similarity >= threshold;
}

// Handle common variations
const nameVariations = {
  'robert': ['rob', 'bob', 'bobby'],
  'william': ['will', 'bill', 'billy'],
  'jonathan': ['jon', 'john'],
  'michael': ['mike', 'mick']
};
```

**Phone number normalization:**
```javascript
const parsePhoneNumber = require('libphonenumber-js');

function normalizePhone(phone) {
  try {
    const parsed = parsePhoneNumber(phone, 'US'); // Default country
    return parsed.format('E.164'); // e.g., +15551234567
  } catch (err) {
    return null; // Invalid phone number
  }
}
```

**Merge strategy:**
```javascript
function mergeContacts(contact1, contact2) {
  return {
    // Keep most complete name
    name: contact1.name.firstName ? contact1.name : contact2.name,
    // Combine unique emails
    emails: [...new Set([...contact1.emails, ...contact2.emails])],
    // Combine unique phones
    phones: [...new Set([...contact1.phones, ...contact2.phones].map(normalizePhone))],
    // Keep most recent address
    addresses: contact1.lastModified > contact2.lastModified ? contact1.addresses : contact2.addresses,
    // Combine notes
    notes: [contact1.notes, contact2.notes].filter(Boolean).join('\n---\n'),
    // Keep most recent modification date
    lastModified: new Date(Math.max(contact1.lastModified, contact2.lastModified))
  };
}
```

### Integration with Andy

**Skill commands:**
```bash
# Full cleanup workflow
contacts:cleanup --auto-approve-threshold=90

# Analysis only (dry run)
contacts:analyze

# Merge specific duplicates
contacts:merge <contact-id-1> <contact-id-2>

# Delete contact
contacts:delete <contact-id>

# Export backup
contacts:backup

# Restore from backup
contacts:restore <backup-file>

# Schedule weekly cleanup
contacts:schedule weekly
```

**IPC Protocol:**

Request: `/workspace/ipc/tasks/contacts-cleanup-{timestamp}.json`
```json
{
  "type": "contacts_cleanup",
  "requestId": "unique-id",
  "action": "analyze|merge|delete|backup|restore",
  "accounts": ["gmail-1", "gmail-2", "apple"],
  "options": {
    "autoApproveThreshold": 90,
    "dryRun": false,
    "backupFirst": true
  }
}
```

Response: `/workspace/ipc/responses/contacts-cleanup-{requestId}.json`
```json
{
  "status": "ok",
  "summary": {
    "totalContacts": 450,
    "duplicatesFound": 45,
    "emptyContacts": 12,
    "actionsProposed": 80
  },
  "plan": [
    {
      "action": "merge",
      "contacts": ["id1", "id2"],
      "confidence": 0.95,
      "reason": "Same email and similar name"
    }
  ],
  "backupPath": "/path/to/backup.json"
}
```

### Privacy & Security

**Data handling:**
- All contact data processed locally (no external API calls)
- Backups encrypted if stored
- OAuth tokens stored securely (existing mechanism)
- User can revoke access anytime
- Audit log shows all actions (append-only)

**Permissions:**
- Explicit OAuth consent for each Gmail account
- macOS permission dialog for Contacts.app access
- User approves cleanup plan before execution
- Rollback available for 30 days

### Future Enhancements

- **AI-powered enrichment:** Add missing info from public sources (LinkedIn, email signatures)
- **Photo sync:** Sync contact photos across accounts
- **Social media integration:** Link contacts to LinkedIn, Twitter, Facebook profiles
- **Relationship graph:** Visualize contact connections (who knows who)
- **Smart groups:** Auto-create groups based on patterns (company, location, etc.)
- **Birthday reminders:** Integrate with calendar for contact birthdays
- **Email signature extraction:** Parse email signatures to update contacts automatically
- **Conflict resolution:** When same contact updated in multiple places, intelligently merge

## Related

Builds on existing infrastructure:
- **macOS RPC** (`2026-03-01-macos-rpc-remote-control.md`) - For Apple Contacts access
- **OAuth system** - Reuse for Google account authentication
- **IPC protocol** - Same pattern as Google Home, macOS RPC

Complements other features:
- **Apple Notes** (`2026-03-01-apple-notes-integration.md`) - Could reference contacts in notes
- **WhatsApp search** - Link WhatsApp contacts to address book
- **OSINT research** (`2026-03-01-osint-people-research-agent.md`) - Enrich contact info
