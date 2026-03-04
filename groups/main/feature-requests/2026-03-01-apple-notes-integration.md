# Feature Request: Apple Notes Integration

**Date:** 2026-03-01
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

Andy cannot access or search Apple Notes, which often contains important personal information like:
- Addresses and contact details
- Personal notes and reminders
- Meeting notes and ideas
- Saved links and references
- Historical information (e.g., old addresses)

**Current workaround:**
User must manually check Apple Notes and relay information to Andy, or Andy cannot answer questions about information stored in Notes.

**Example scenario:**
- User asks: "What was my old address on 38th street?"
- Information is in Apple Notes
- Andy cannot access it, so cannot answer

## Proposed Solution

Integrate Apple Notes access via AppleScript/macOS RPC to enable:
1. **Search Notes** - semantic search across all notes
2. **List Notes** - browse by folder, date, or tag
3. **Read Note** - retrieve full note content
4. **Create Note** - save information from conversations
5. **Append to Note** - add to existing notes
6. **Tag/Organize** - manage note organization

### Architecture

Build on the proposed macOS RPC channel (see `2026-03-01-macos-rpc-remote-control.md`):

```
┌─────────────────────┐
│  Andy (Container)   │
│                     │
│  "What's my old     │
│   38th st address?" │
└──────────┬──────────┘
           │
           │ IPC request
           ▼
┌─────────────────────┐
│   Host (Node.js)    │
│                     │
│  - AppleScript      │
│  - Notes API        │
└──────────┬──────────┘
           │
           │ AppleScript
           ▼
┌─────────────────────┐
│   Apple Notes       │
│                     │
│  - Search           │
│  - Read/Write       │
└─────────────────────┘
```

### Implementation Approaches

**Option A: AppleScript (Recommended for MVP)**
```applescript
-- Search notes
tell application "Notes"
    set searchResults to every note whose body contains "38th street"
    repeat with aNote in searchResults
        get name of aNote
        get body of aNote
        get creation date of aNote
    end repeat
end tell

-- Get all notes
tell application "Notes"
    set allNotes to every note
    repeat with aNote in allNotes
        {name:name of aNote, body:body of aNote, folder:name of container of aNote}
    end repeat
end tell

-- Create note
tell application "Notes"
    make new note at folder "Quick Notes" with properties {name:"Note Title", body:"Note content"}
end tell
```

**Option B: Direct database access (Advanced)**
- Notes stored in SQLite database: `~/Library/Group Containers/group.com.apple.notes/NoteStore.sqlite`
- Pros: Faster, more control, no AppleScript overhead
- Cons: Database schema may change, requires reverse engineering
- Recommendation: Use for future optimization if AppleScript is too slow

**Option C: CloudKit API (Cloud sync)**
- Access notes via iCloud/CloudKit API
- Pros: Works from any device, includes shared notes
- Cons: Requires authentication, API complexity, privacy concerns
- Recommendation: Consider for future if remote access needed

## Use Cases

### 1. Retrieve Historical Information
```
User: "What was my old Manhattan address?"
Andy: → searches Notes for "Manhattan address"
Andy: → finds note "Old Addresses"
Andy: "Your old address was 250 W 38th Street, Apt 12B, New York, NY 10018"
```

### 2. Save Information from Conversations
```
User: "Remember this for later: call dentist on Monday at 2pm"
Andy: → creates note in "Reminders" folder
Andy: "Saved to your Notes: 'call dentist on Monday at 2pm'"
```

### 3. Knowledge Base Search
```
User: "What were my notes from the meeting with John?"
Andy: → searches Notes for "meeting John"
Andy: → returns relevant notes with dates
Andy: "Found 3 notes: [summaries]"
```

### 4. Quick Capture
```
User: "Add this to my grocery list: milk, eggs, bread"
Andy: → appends to "Grocery List" note
Andy: "Added to your grocery list"
```

### 5. Reference Lookup
```
User: "What's my passport number?"
Andy: → searches Notes for "passport"
Andy: → finds note "Important Documents"
Andy: "Your passport number is [redacted - sent privately]"
```

## Alternatives Considered

### 1. Manual copy-paste
- **Pros:** Simple, no code needed
- **Cons:** Inconvenient, defeats purpose of AI assistant
- **Rejected:** Poor UX

### 2. Export notes to plain text files
- **Pros:** Easy to search with grep/ripgrep
- **Cons:** Loses formatting, requires manual sync, no bidirectional editing
- **Rejected:** Too manual, loses structure

### 3. Third-party notes app with API
- **Pros:** Better API support (e.g., Notion, Evernote)
- **Cons:** Requires migration, user already uses Apple Notes
- **Rejected:** Don't force user to change workflow

### 4. Spotlight search integration
- **Pros:** Fast, system-level search
- **Cons:** Limited metadata, can't modify notes, less control
- **Rejected:** Read-only, insufficient functionality

## Acceptance Criteria

**Core Functionality:**
- [ ] Search notes by keyword (case-insensitive)
- [ ] Retrieve full note content by ID or title
- [ ] List all notes with metadata (title, folder, date)
- [ ] Create new notes in specified folder
- [ ] Append content to existing notes
- [ ] Search by folder (e.g., all notes in "Personal")

**Performance:**
- [ ] Search completes in < 2 seconds for < 1000 notes
- [ ] Note retrieval completes in < 500ms
- [ ] Create/append operations complete in < 1 second

**Security:**
- [ ] Notes access requires user approval on first use
- [ ] Sensitive notes can be excluded via folder (e.g., "Private" folder blocked)
- [ ] Audit log of all notes accessed/modified
- [ ] Option to disable notes access entirely

**Error Handling:**
- [ ] Handles Notes app not running (launches if needed)
- [ ] Handles corrupted or missing notes gracefully
- [ ] Clear error messages when notes not found
- [ ] Timeout protection for large note collections

## Technical Notes

### AppleScript Examples

**Search notes:**
```javascript
const searchScript = `
tell application "Notes"
    set matches to {}
    repeat with aNote in every note
        if body of aNote contains "${searchTerm}" then
            set end of matches to {title:name of aNote, body:body of aNote, id:id of aNote}
        end if
    end repeat
    return matches
end tell
`;
```

**Get note by title:**
```javascript
const getScript = `
tell application "Notes"
    set theNote to first note whose name is "${noteTitle}"
    return {title:name of theNote, body:body of theNote, folder:name of container of theNote, created:creation date of theNote}
end tell
`;
```

**Create note:**
```javascript
const createScript = `
tell application "Notes"
    tell folder "${folderName}"
        make new note with properties {name:"${title}", body:"${content}"}
    end tell
end tell
`;
```

**Append to note:**
```javascript
const appendScript = `
tell application "Notes"
    set theNote to first note whose name is "${noteTitle}"
    set body of theNote to (body of theNote) & "${newContent}"
end tell
`;
```

### Integration with Andy

Add skill commands:

```bash
# Search notes
notes:search "38th street address"

# List all notes
notes:list

# List notes in folder
notes:list "Personal"

# Get specific note
notes:get "Important Addresses"

# Create new note
notes:create "Note Title" "Note content here" --folder "Personal"

# Append to existing note
notes:append "Shopping List" "- Milk\n- Eggs"

# Search and display best match
notes:find "passport number"
```

### Response Format

```json
{
  "status": "ok",
  "results": [
    {
      "id": "x-coredata://...",
      "title": "Old Addresses",
      "body": "Manhattan: 250 W 38th St, Apt 12B\nBrooklyn: 1234 Carroll St...",
      "folder": "Personal",
      "created": "2024-05-12T10:30:00Z",
      "modified": "2025-08-15T14:22:00Z"
    }
  ],
  "totalResults": 1
}
```

### Security Considerations

**Sensitive data protection:**
- Exclude folders: "Private", "Passwords", "Secrets"
- Option to require approval for each note access
- Never log full note content (only titles/metadata)
- Redact sensitive patterns in responses (SSN, credit cards, etc.)

**Access control:**
- First access requires explicit user approval
- User can revoke access anytime
- List all notes accessed in audit log
- Option to make notes read-only (no create/append)

### Performance Optimization

For large note collections (>500 notes):
1. Build search index on first run
2. Cache note metadata (title, folder, dates)
3. Only load full content when needed
4. Use incremental search (filter as you type)

### Future Enhancements

- **Semantic search:** Use embeddings for better search (like WhatsApp search)
- **Shared notes:** Access notes shared via iCloud collaboration
- **Attachments:** Handle images, PDFs, and other attachments
- **Rich formatting:** Preserve markdown, links, checkboxes
- **Sync with other sources:** Combine notes with calendar, reminders, contacts
- **Smart extraction:** Auto-extract addresses, phone numbers, dates from notes
- **Cross-reference:** Link WhatsApp messages to related notes

## Related

This builds on the macOS RPC foundation from `2026-03-01-macos-rpc-remote-control.md`:
- Reuses IPC infrastructure
- Uses same security/approval model
- Complements other macOS integrations (Music, Safari, etc.)

Together with WhatsApp search, this gives Andy access to multiple knowledge sources:
- WhatsApp messages (conversations, shared info)
- Apple Notes (personal knowledge base)
- Web search (current information)
