# Feature Request: WhatsApp Special Message Types Support

**Date:** 2026-03-05
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Currently, the WhatsApp message ingestion system only handles basic text messages. Baileys (the WhatsApp library) supports many special message types that are being silently ignored or not properly ingested into the database:

**Missing message types:**
- **Polls** - Questions with voting options, vote counts, voter lists
- **Events** - Calendar events with date/time, location, RSVP tracking
- **Contact cards** - Shared contacts with vCard data
- **Location messages** - GPS coordinates, place names, map data
- **Live location** - Real-time location sharing
- **Product messages** - WhatsApp Business catalog items
- **Order messages** - WhatsApp Business orders
- **Payment messages** - Payment transaction records
- **Stickers** - Sticker packs and individual stickers
- **Link previews** - Rich metadata for URLs
- **Quoted messages** - Reply context (may be partially supported)
- **Forwarded messages** - Forward metadata and counts
- **Deleted messages** - Deletion events and revoked content
- **Edited messages** - Edit history and timestamps
- **Reactions** - Emoji reactions to messages (may be supported)
- **View-once media** - Ephemeral photos/videos

**Current impact:**
- Andy cannot see or respond to polls in groups
- Event invitations are invisible or show as blank messages
- Shared locations appear as empty messages
- Business transactions are not tracked
- Rich message context is lost
- Search cannot find poll questions, event titles, or location names
- Summaries miss important group activities (polls, events, shared contacts)

**Example scenarios that don't work:**
- User: "What was the result of yesterday's poll in the dev-team group?"
  - Andy: "I don't see any poll" (it's not ingested)
- User: "When is the event that was shared in family-chat?"
  - Andy: "I don't have that information" (event not parsed)
- User: "Who shared a location recently?"
  - Andy: Cannot search location messages

## Proposed Solution

Extend the message ingestion pipeline to detect, parse, and store all Baileys-supported message types with their full metadata.

### Architecture

```
WhatsApp Message (Baileys)
  ↓
Message Type Detection
  ↓
Type-Specific Parser
  ↓
Structured Storage (Database)
  ↓
Searchable Index (RAG)
  ↓
Andy has full access via queries
```

### Database Schema Extension

Extend the `messages` table or create type-specific tables:

#### Option 1: JSON column for metadata (simpler)

```sql
ALTER TABLE messages
ADD COLUMN message_type TEXT DEFAULT 'text',
ADD COLUMN metadata JSON;
```

Examples:
```json
// Poll message
{
  "message_type": "poll",
  "metadata": {
    "question": "What time should we meet?",
    "options": ["2 PM", "3 PM", "4 PM"],
    "votes": {
      "2 PM": ["user1@s.whatsapp.net", "user2@s.whatsapp.net"],
      "3 PM": ["user3@s.whatsapp.net"],
      "4 PM": []
    },
    "allow_multiple": false,
    "created_at": "2026-03-05T12:00:00Z"
  }
}

// Event message
{
  "message_type": "event",
  "metadata": {
    "title": "Team Meeting",
    "start_time": "2026-03-10T14:00:00Z",
    "end_time": "2026-03-10T15:00:00Z",
    "location": "Conference Room A",
    "description": "Monthly sync",
    "attending": ["user1@s.whatsapp.net"],
    "not_attending": ["user2@s.whatsapp.net"],
    "maybe": []
  }
}

// Location message
{
  "message_type": "location",
  "metadata": {
    "latitude": 40.7128,
    "longitude": -74.0060,
    "name": "770 Eastern Parkway",
    "address": "Brooklyn, NY 11213",
    "url": "https://maps.google.com/?q=40.7128,-74.0060"
  }
}

// Contact card
{
  "message_type": "contact",
  "metadata": {
    "display_name": "Rabbi Menachem Mendel Schneerson",
    "vcard": "BEGIN:VCARD...",
    "phone_numbers": ["+1234567890"],
    "emails": ["example@email.com"]
  }
}
```

#### Option 2: Dedicated tables per type (more structured)

```sql
CREATE TABLE poll_messages (
  message_id TEXT PRIMARY KEY,
  question TEXT,
  options JSON,
  votes JSON,
  allow_multiple BOOLEAN,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE event_messages (
  message_id TEXT PRIMARY KEY,
  title TEXT,
  start_time TIMESTAMP,
  end_time TIMESTAMP,
  location TEXT,
  description TEXT,
  rsvp JSON,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);

CREATE TABLE location_messages (
  message_id TEXT PRIMARY KEY,
  latitude REAL,
  longitude REAL,
  name TEXT,
  address TEXT,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
```

### Baileys Message Type Detection

Reference Baileys documentation for message types:

```javascript
const { proto } = require('@whiskeysockets/baileys');

function detectMessageType(message) {
  const content = message.message;

  if (content.pollCreationMessage) return 'poll';
  if (content.pollUpdateMessage) return 'poll_vote';
  if (content.eventMessage) return 'event';
  if (content.eventResponseMessage) return 'event_rsvp';
  if (content.contactMessage) return 'contact';
  if (content.contactsArrayMessage) return 'contacts';
  if (content.locationMessage) return 'location';
  if (content.liveLocationMessage) return 'live_location';
  if (content.productMessage) return 'product';
  if (content.orderMessage) return 'order';
  if (content.paymentInviteMessage) return 'payment';
  if (content.stickerMessage) return 'sticker';
  if (content.extendedTextMessage?.contextInfo?.quotedMessage) return 'reply';
  if (content.extendedTextMessage?.contextInfo?.isForwarded) return 'forwarded';
  if (content.protocolMessage?.type === proto.Message.ProtocolMessage.Type.REVOKE) return 'deleted';
  if (content.editedMessage) return 'edited';
  if (content.reactionMessage) return 'reaction';
  if (content.viewOnceMessage) return 'view_once';

  return 'text';
}
```

### Parsing Examples

#### Poll Messages

```javascript
function parsePoll(message) {
  const poll = message.message.pollCreationMessage;

  return {
    question: poll.name,
    options: poll.options.map(opt => opt.optionName),
    allow_multiple: poll.selectableOptionsCount > 1,
    created_at: message.messageTimestamp
  };
}

function parsePollVote(message) {
  const vote = message.message.pollUpdateMessage;

  return {
    poll_message_id: vote.pollCreationMessageKey.id,
    selected_options: vote.votes,
    voter: message.key.participant || message.key.remoteJid
  };
}
```

#### Event Messages

```javascript
function parseEvent(message) {
  const event = message.message.eventMessage;

  return {
    title: event.name,
    start_time: new Date(event.startTime * 1000).toISOString(),
    end_time: event.endTime ? new Date(event.endTime * 1000).toISOString() : null,
    location: event.location?.name,
    description: event.description
  };
}

function parseEventRsvp(message) {
  const rsvp = message.message.eventResponseMessage;

  return {
    event_message_id: rsvp.eventCreationMessageKey.id,
    response: rsvp.response, // GOING, NOT_GOING, MAYBE
    responder: message.key.participant || message.key.remoteJid
  };
}
```

#### Location Messages

```javascript
function parseLocation(message) {
  const loc = message.message.locationMessage;

  return {
    latitude: loc.degreesLatitude,
    longitude: loc.degreesLongitude,
    name: loc.name,
    address: loc.address,
    url: loc.url
  };
}
```

### RAG Search Integration

Extend the RAG indexing to include metadata in the searchable text:

```javascript
function generateSearchableText(message) {
  let text = message.body || '';

  if (message.message_type === 'poll') {
    const meta = message.metadata;
    text = `Poll: ${meta.question}\nOptions: ${meta.options.join(', ')}`;
  }

  if (message.message_type === 'event') {
    const meta = message.metadata;
    text = `Event: ${meta.title}\n${meta.description}\nLocation: ${meta.location}`;
  }

  if (message.message_type === 'location') {
    const meta = message.metadata;
    text = `Location: ${meta.name}\nAddress: ${meta.address}`;
  }

  if (message.message_type === 'contact') {
    const meta = message.metadata;
    text = `Contact: ${meta.display_name}\nPhone: ${meta.phone_numbers.join(', ')}`;
  }

  return text;
}
```

### Andy Query Examples

After implementation, Andy can answer:

```
User: "What polls were posted in dev-team this week?"
Andy: Uses whatsapp-search with filters:
  - message_type: poll
  - group: dev-team
  - dateRange: last 7 days

User: "When is the next event in family-chat?"
Andy: Queries event_messages where start_time > NOW()

User: "Who shared their location yesterday?"
Andy: Searches location_messages from past 24 hours

User: "Show me all the contacts shared in this chat"
Andy: Filters by message_type: contact
```

## Alternatives Considered

### 1. Ignore special message types (current behavior)
- **Pros:** Simple, no code changes
- **Cons:** Missing critical information, poor user experience
- **Rejected:** Too much valuable data is lost

### 2. Store as plain text only
- **Pros:** Minimal schema changes
- **Cons:** Cannot query structured data (poll results, event times, GPS coordinates)
- **Rejected:** Loses the value of structured metadata

### 3. Store metadata in separate files
- **Pros:** Keeps database simple
- **Cons:** Difficult to query, search, or join with other messages
- **Rejected:** Not practical for querying

### 4. Only support polls and events (subset)
- **Pros:** Faster to implement
- **Cons:** Still missing location, contacts, reactions, etc.
- **Considered:** Could be a Phase 1, but full support is better

## Acceptance Criteria

- [ ] All Baileys-supported message types are detected and parsed
- [ ] Poll messages stored with question, options, and vote data
- [ ] Poll votes update the poll record with voter information
- [ ] Event messages stored with title, time, location, description
- [ ] Event RSVPs update the event record with attendee status
- [ ] Location messages stored with coordinates, name, address
- [ ] Contact cards stored with vCard data and contact info
- [ ] Stickers stored with sticker pack ID and metadata
- [ ] Reactions linked to the original message
- [ ] Deleted messages marked with deletion timestamp
- [ ] Edited messages preserve edit history
- [ ] Forwarded messages track forward count
- [ ] WhatsApp search can find messages by poll question text
- [ ] WhatsApp search can find messages by event title or location
- [ ] WhatsApp search can find messages by contact name
- [ ] Andy can query "polls in group X this week"
- [ ] Andy can query "upcoming events"
- [ ] Andy can query "who voted for option Y in poll Z"
- [ ] Summaries include poll results and event mentions
- [ ] Message rendering shows special types appropriately (not as blank)

## Technical Notes

### Relevant Files
- Message ingestion handler (likely `src/whatsapp/message-handler.ts`)
- Database schema (`src/database/schema.sql` or migration files)
- RAG indexing pipeline
- WhatsApp search API

### Baileys Documentation
- Polls: `pollCreationMessage`, `pollUpdateMessage`
- Events: `eventMessage`, `eventResponseMessage`
- See: https://github.com/WhiskeySockets/Baileys

### Implementation Phases

**Phase 1: Core types (high value, common)**
- Polls + votes
- Events + RSVPs
- Location messages
- Contact cards

**Phase 2: Media metadata**
- Stickers
- Link previews
- View-once media markers

**Phase 3: Message states**
- Reactions
- Deleted messages
- Edited messages
- Forwarded message metadata

**Phase 4: Business features**
- Product messages
- Order messages
- Payment invites

### Performance Considerations

- Use indexed `message_type` column for fast filtering
- JSON metadata column is flexible but slower to query specific fields
- Consider materialized views for common queries (upcoming events, active polls)
- Batch update poll votes instead of individual updates per vote

### Testing Strategy

1. Create test polls in WhatsApp → verify ingestion
2. Create test events with RSVPs → verify RSVP tracking
3. Share locations → verify coordinate storage
4. Send contacts → verify vCard parsing
5. Search for poll questions → verify RAG indexing
6. Query event times → verify timestamp queries

## Use Cases Unlocked

1. **Poll Analysis** - "What polls did we run in Q1? What were the results?"
2. **Event Tracking** - "What events are scheduled this month? Who's attending?"
3. **Location History** - "Where did we meet last time? Who shared the address?"
4. **Contact Discovery** - "Find the contact card for Rabbi X that was shared last year"
5. **Engagement Metrics** - "How many people voted in the poll? Who voted?"
6. **Meeting Planning** - "When is everyone available based on event RSVPs?"
7. **Business Tracking** - "What products were shared? What orders were placed?"
8. **Complete Summaries** - Daily summaries include poll results, upcoming events, shared locations

## Related

- WhatsApp Full History Ingestion with RAG Search (2026-03-01) - complements by ingesting historical special messages
- WhatsApp Media Sending (2026-03-03) - orthogonal feature (sending vs receiving)
