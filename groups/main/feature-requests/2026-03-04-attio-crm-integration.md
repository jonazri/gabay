# Feature Request: Attio CRM Integration

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** critical

## Problem

JLI (Jewish Learning Institute) uses Attio as their CRM, but currently there's no integration between Andy (the WhatsApp assistant) and Attio. This creates several issues:

1. **Duplicate data entry** - Information collected via WhatsApp must be manually entered into Attio
2. **Context loss** - Andy doesn't have access to student/contact information stored in Attio
3. **Communication fragmentation** - WhatsApp conversations aren't visible in Attio's communication timeline
4. **Inconsistent records** - Updates made in one system don't reflect in the other
5. **Manual workflow** - No automated triggers or actions based on CRM data

**Real-world impact:** JLI instructors and coordinators spend significant time manually syncing data between WhatsApp and Attio, leading to errors, missed follow-ups, and incomplete communication history.

## Proposed Solution

Create a **two-way Attio CRM integration** that:
1. **Syncs contacts bidirectionally** between Andy and Attio
2. **Logs WhatsApp messages as a communication channel** in Attio
3. **Enables CRM-driven actions** - Andy can read/update Attio records
4. **Provides real-time updates** - Changes in either system sync automatically
5. **Maintains conversation context** - Andy has full access to student/contact history

### Core Capabilities

#### 1. Two-Way Contact Sync

**Attio → Andy:**
- Pull all contacts from Attio on initial setup
- Sync new contacts created in Attio to Andy's local database
- Update contact details when changed in Attio (phone, email, tags, custom fields)
- Sync enrollment status, course history, payment status
- Pull custom fields (JLI-specific: preferred learning style, language preference, etc.)

**Andy → Attio:**
- Create new contacts in Attio when someone messages Andy for the first time
- Update existing contacts with information gathered via WhatsApp
- Add tags based on conversation topics ("interested_in_course_X", "requested_callback")
- Update custom fields (preferred_contact_time, topics_of_interest)
- Log conversation insights as notes

**Sync Frequency:**
- Real-time webhooks (if Attio supports)
- Polling every 5 minutes for updates
- On-demand sync triggered by user action

**Conflict Resolution:**
- Timestamp-based: Most recent change wins
- Field-level merging: Merge non-conflicting fields
- Manual review queue for major conflicts
- User-defined priority (Attio or Andy as source of truth per field)

#### 2. WhatsApp Messages as Attio Communication Channel

**Message Logging:**
Every WhatsApp message exchanged with Andy is logged in Attio as a "Communication" record:

```json
{
  "contact_id": "adio_contact_12345",
  "channel": "WhatsApp",
  "direction": "inbound" | "outbound",
  "timestamp": "2026-03-04T15:30:00Z",
  "message_body": "Hi, I'm interested in the Talmud course",
  "message_id": "whatsapp_msg_abc123",
  "handled_by": "Andy (AI Assistant)",
  "tags": ["course_inquiry", "talmud", "new_lead"],
  "sentiment": "positive",
  "intent": "course_enrollment",
  "follow_up_required": true
}
```

**Communication Timeline:**
In Attio, view complete conversation history:
- WhatsApp messages (via Andy)
- Email communications
- Phone calls
- In-person interactions
- All in one unified timeline

**Rich Message Metadata:**
- Intent detection (inquiry, complaint, enrollment, support)
- Sentiment analysis (positive, neutral, negative)
- Topics discussed (courses, scheduling, payment)
- Action items extracted ("Schedule callback for Tuesday")
- Engagement score (responsiveness, interest level)

#### 3. CRM-Driven Actions & Automation

**Read Operations (Attio → Andy):**

```javascript
// Get contact details
const contact = await adio.getContact({ phone: "+1234567890" });
// Returns: name, email, tags, enrollment status, custom fields, notes

// Check enrollment status
const enrollments = await adio.getEnrollments({ contact_id: "12345" });
// Returns: courses enrolled, completion status, payment status

// Get interaction history
const history = await adio.getInteractionHistory({ contact_id: "12345" });
// Returns: past communications, events attended, purchases made
```

**Write Operations (Andy → Attio):**

```javascript
// Create/update contact
await adio.upsertContact({
  phone: "+1234567890",
  name: "Sarah Cohen",
  email: "sarah@example.com",
  tags: ["interested_in_talmud", "prefers_whatsapp"],
  custom_fields: {
    preferred_learning_time: "Evenings",
    topics_of_interest: ["Talmud", "Jewish Philosophy"]
  }
});

// Log communication
await adio.logCommunication({
  contact_id: "12345",
  channel: "WhatsApp",
  direction: "inbound",
  body: "Message content...",
  tags: ["course_inquiry"],
  intent: "enrollment",
  follow_up_required: true
});

// Update enrollment
await adio.updateEnrollment({
  contact_id: "12345",
  course_id: "talmud_101",
  status: "interested",
  notes: "Expressed interest during WhatsApp conversation"
});

// Add note
await adio.addNote({
  contact_id: "12345",
  note: "Prefers evening classes due to work schedule. Interested in beginner Talmud course.",
  source: "WhatsApp conversation with Andy"
});

// Add tag
await adio.addTag({
  contact_id: "12345",
  tag: "high_engagement"
});
```

**Automated Workflows:**

**Example 1: Course Inquiry Follow-up**
```
Trigger: Student asks about a course via WhatsApp
1. Andy logs inquiry in Attio with tag "course_inquiry_talmud"
2. Attio automation: Add to nurture campaign
3. Attio sends follow-up email with course details
4. If no response in 3 days, Attio creates task for JLI coordinator
5. Task appears in Andy's daily digest: "Follow up with Sarah Cohen about Talmud course"
```

**Example 2: Enrollment Confirmation**
```
Trigger: Student enrolls via website/phone
1. Attio creates enrollment record
2. Webhook notifies Andy
3. Andy sends WhatsApp message: "Mazal tov on enrolling in Talmud 101! First class is Tuesday at 7 PM. Reply with any questions."
4. Student response logged back in Attio
```

**Example 3: Payment Reminder**
```
Trigger: Payment due date approaching (Attio)
1. Attio flags account with "payment_due" tag
2. Andy sends gentle WhatsApp reminder: "Hi Sarah, just a reminder that the course payment is due this Friday. Reply if you need an extension or have questions."
3. Response logged in Attio
4. If student confirms payment, Andy updates status in Attio
```

#### 4. Real-Time Sync & Webhooks

**Attio Webhooks (if supported):**
Listen for events from Attio:
- `contact.created` - New contact added
- `contact.updated` - Contact details changed
- `enrollment.created` - Student enrolled in course
- `enrollment.updated` - Enrollment status changed
- `payment.received` - Payment processed
- `task.assigned` - Task assigned to instructor
- `note.added` - New note added to contact

**Andy Webhooks (outbound to Attio):**
Push events to Attio:
- `message.received` - New WhatsApp message from student
- `message.sent` - Andy sent WhatsApp message to student
- `contact.enriched` - Andy gathered new information about contact
- `intent.detected` - Andy identified student intent (inquiry, complaint, etc.)
- `action_item.created` - Follow-up action needed

**Polling Fallback:**
If webhooks not available, poll Attio API every 5 minutes:
- Get updated contacts (modified since last sync)
- Get new enrollments
- Get assigned tasks
- Update local database

#### 5. Conversation Context from Attio

**Before responding to a student, Andy checks Attio:**

```javascript
async function handleIncomingMessage(message) {
  const contact = await adio.getContact({ phone: message.from });

  if (contact) {
    // Load context from Attio
    const enrollments = await adio.getEnrollments({ contact_id: contact.id });
    const recentInteractions = await adio.getInteractionHistory({
      contact_id: contact.id,
      limit: 10
    });

    // Build context for Andy
    const context = `
    Contact: ${contact.name}
    Enrolled courses: ${enrollments.map(e => e.course_name).join(', ')}
    Last interaction: ${recentInteractions[0].summary}
    Tags: ${contact.tags.join(', ')}
    Notes: ${contact.notes}
    `;

    // Andy responds with full context
    const response = await generateResponse(message.body, context);
    await sendWhatsAppMessage(response);

    // Log conversation back to Attio
    await adio.logCommunication({
      contact_id: contact.id,
      channel: "WhatsApp",
      body: message.body,
      response: response
    });
  }
}
```

**Example Context-Aware Response:**

**Without Attio integration:**
```
User: "When does my class start?"
Andy: "Which class are you referring to?"
```

**With Attio integration:**
```
User: "When does my class start?"
Andy: "Your Talmud 101 class starts this Tuesday, March 7th at 7:00 PM at the JLI Center. Looking forward to seeing you there! The instructor is Rabbi Goldstein."
```

#### 6. JLI-Specific Features

**Course Recommendations:**
- Based on previous enrollments and topics discussed
- "You enjoyed Talmud 101 - interested in Talmud 102?"

**Class Reminders:**
- Automated WhatsApp reminders before class (sync'd with Attio course schedule)
- "Reminder: Your Jewish History class is tonight at 7 PM"

**Homework Submission:**
- Students can submit homework via WhatsApp
- Andy logs submission in Attio
- Instructor notified

**Resource Sharing:**
- "Here's the study guide for this week's class" (pulled from Attio course materials)

**Feedback Collection:**
- Post-class survey via WhatsApp
- Responses logged in Attio
- Sentiment analysis for course improvement

### Implementation Details

#### Backend Architecture

**Components:**
1. **Attio API Client** - Handles all Attio API calls with authentication
2. **Sync Engine** - Two-way data synchronization with conflict resolution
3. **Webhook Listener** - Receives events from Attio
4. **Message Logger** - Logs WhatsApp messages to Attio
5. **Context Provider** - Enriches Andy's responses with Attio data
6. **Automation Engine** - Triggers workflows based on CRM events

**Database Schema:**

```sql
-- Map WhatsApp contacts to Attio contacts
CREATE TABLE adio_contact_mapping (
  id INTEGER PRIMARY KEY,
  whatsapp_jid TEXT UNIQUE,
  adio_contact_id TEXT UNIQUE,
  last_synced TIMESTAMP,
  sync_status TEXT, -- 'synced', 'pending', 'conflict'
  created_at TIMESTAMP
);

-- Track message sync status
CREATE TABLE adio_message_log (
  id INTEGER PRIMARY KEY,
  whatsapp_message_id TEXT UNIQUE,
  adio_communication_id TEXT UNIQUE,
  contact_id TEXT,
  direction TEXT, -- 'inbound', 'outbound'
  synced_at TIMESTAMP,
  sync_status TEXT, -- 'synced', 'pending', 'failed'
  retry_count INTEGER DEFAULT 0
);

-- Cache Attio data locally for performance
CREATE TABLE adio_contacts_cache (
  adio_contact_id TEXT PRIMARY KEY,
  data JSON, -- Full contact record from Attio
  last_fetched TIMESTAMP
);

-- Track sync conflicts for manual resolution
CREATE TABLE sync_conflicts (
  id INTEGER PRIMARY KEY,
  contact_id TEXT,
  field_name TEXT,
  adio_value TEXT,
  andy_value TEXT,
  detected_at TIMESTAMP,
  resolved_at TIMESTAMP,
  resolution TEXT -- 'adio_wins', 'andy_wins', 'manual_merge'
);
```

#### Attio API Integration

**Authentication:**
```javascript
const AttioClient = require('@adio/api-client'); // Hypothetical package

const adio = new AttioClient({
  apiKey: process.env.ADIO_API_KEY,
  apiSecret: process.env.ADIO_API_SECRET,
  baseUrl: 'https://api.adio.com/v1'
});

// Or OAuth 2.0 if Attio supports
const adio = new AttioClient({
  clientId: process.env.ADIO_CLIENT_ID,
  clientSecret: process.env.ADIO_CLIENT_SECRET,
  redirectUri: 'https://myapp.com/oauth/callback'
});
```

**API Operations:**

```javascript
// Get all contacts (initial sync)
const contacts = await adio.contacts.list({
  page: 1,
  per_page: 100,
  updated_since: '2026-03-01T00:00:00Z'
});

// Get single contact by phone
const contact = await adio.contacts.findByPhone('+1234567890');

// Create contact
const newContact = await adio.contacts.create({
  first_name: 'Sarah',
  last_name: 'Cohen',
  phone: '+1234567890',
  email: 'sarah@example.com',
  tags: ['whatsapp_user'],
  custom_fields: {
    communication_preference: 'WhatsApp'
  }
});

// Update contact
await adio.contacts.update('12345', {
  tags: ['interested_in_talmud', 'whatsapp_user'],
  custom_fields: {
    topics_of_interest: ['Talmud', 'Philosophy']
  }
});

// Log communication
await adio.communications.create({
  contact_id: '12345',
  channel: 'WhatsApp',
  direction: 'inbound',
  subject: 'Course inquiry',
  body: 'Hi, I\'m interested in the Talmud course',
  timestamp: '2026-03-04T15:30:00Z',
  metadata: {
    message_id: 'whatsapp_abc123',
    intent: 'course_inquiry',
    sentiment: 'positive'
  }
});

// Get enrollments
const enrollments = await adio.enrollments.list({
  contact_id: '12345'
});

// Get courses
const courses = await adio.courses.list();

// Add note
await adio.notes.create({
  contact_id: '12345',
  body: 'Prefers evening classes. Interested in Talmud course.',
  created_by: 'Andy (AI Assistant)'
});
```

#### Webhook Setup

**Register webhooks with Attio:**
```javascript
await adio.webhooks.create({
  url: 'https://myapp.com/webhooks/adio',
  events: [
    'contact.created',
    'contact.updated',
    'enrollment.created',
    'enrollment.updated',
    'payment.received',
    'task.assigned'
  ],
  secret: process.env.ADIO_WEBHOOK_SECRET // For signature verification
});
```

**Handle incoming webhooks:**
```javascript
app.post('/webhooks/adio', async (req, res) => {
  // Verify signature
  const signature = req.headers['x-adio-signature'];
  if (!verifySignature(req.body, signature, process.env.ADIO_WEBHOOK_SECRET)) {
    return res.status(401).send('Invalid signature');
  }

  const event = req.body;

  switch (event.type) {
    case 'contact.updated':
      await syncContactFromAttio(event.data.contact);
      break;

    case 'enrollment.created':
      await sendEnrollmentConfirmation(event.data.enrollment);
      break;

    case 'payment.received':
      await sendPaymentConfirmation(event.data.payment);
      break;

    case 'task.assigned':
      await notifyInstructor(event.data.task);
      break;
  }

  res.status(200).send('OK');
});
```

#### Sync Engine

**Two-way sync logic:**
```javascript
async function syncContacts() {
  // 1. Pull updates from Attio
  const lastSync = await getLastSyncTime();
  const updatedContacts = await adio.contacts.list({
    updated_since: lastSync
  });

  for (const contact of updatedContacts) {
    const localContact = await getLocalContact(contact.phone);

    if (!localContact) {
      // New contact from Attio - create locally
      await createLocalContact(contact);
    } else {
      // Update existing - check for conflicts
      const conflicts = detectConflicts(localContact, contact);

      if (conflicts.length === 0) {
        await updateLocalContact(contact);
      } else {
        await logConflicts(conflicts);
        // Apply resolution strategy or queue for manual review
      }
    }
  }

  // 2. Push updates to Attio
  const localUpdates = await getLocalContactsUpdatedSince(lastSync);

  for (const local of localUpdates) {
    const adioContact = await adio.contacts.findByPhone(local.phone);

    if (!adioContact) {
      // New local contact - create in Attio
      await adio.contacts.create(local);
    } else {
      // Update Attio with local changes
      await adio.contacts.update(adioContact.id, local);
    }
  }

  // 3. Update last sync time
  await setLastSyncTime(new Date());
}

// Run sync every 5 minutes
setInterval(syncContacts, 5 * 60 * 1000);
```

**Conflict resolution:**
```javascript
function detectConflicts(local, remote) {
  const conflicts = [];

  const fields = ['name', 'email', 'phone', 'tags'];

  for (const field of fields) {
    if (local[field] !== remote[field]) {
      // Both changed since last sync?
      if (local.updated_at > lastSync && remote.updated_at > lastSync) {
        conflicts.push({
          field,
          localValue: local[field],
          remoteValue: remote[field],
          localUpdatedAt: local.updated_at,
          remoteUpdatedAt: remote.updated_at
        });
      }
    }
  }

  return conflicts;
}

function resolveConflict(conflict) {
  // Strategy 1: Most recent wins
  if (conflict.remoteUpdatedAt > conflict.localUpdatedAt) {
    return conflict.remoteValue;
  } else {
    return conflict.localValue;
  }

  // Strategy 2: Field-specific rules
  // - Tags: Merge both sets
  // - Name: Manual review required
  // - Email/Phone: Most recent wins
}
```

#### Message Logging

**Log every WhatsApp message to Attio:**
```javascript
async function logMessageToAttio(message) {
  // Get Attio contact ID
  const mapping = await getAttioContactMapping(message.from);

  if (!mapping) {
    // Create new contact in Attio first
    const contact = await adio.contacts.create({
      phone: message.from,
      name: message.fromName || 'Unknown',
      tags: ['whatsapp_user'],
      source: 'WhatsApp'
    });

    await createContactMapping(message.from, contact.id);
    mapping = { adio_contact_id: contact.id };
  }

  // Log communication
  await adio.communications.create({
    contact_id: mapping.adio_contact_id,
    channel: 'WhatsApp',
    direction: 'inbound',
    body: message.body,
    timestamp: message.timestamp,
    metadata: {
      message_id: message.id,
      intent: detectIntent(message.body),
      sentiment: analyzeSentiment(message.body),
      topics: extractTopics(message.body)
    }
  });

  // Update message log
  await updateMessageLog(message.id, {
    adio_contact_id: mapping.adio_contact_id,
    synced_at: new Date(),
    sync_status: 'synced'
  });
}

// Hook into message handler
onWhatsAppMessage(async (message) => {
  await logMessageToAttio(message);
  // Then process message with Andy
});
```

### Privacy & Security Considerations

**Data Access:**
- Only sync contacts that have opted in to WhatsApp communication
- Respect GDPR/privacy regulations
- Encrypt sensitive data in transit (HTTPS/TLS)
- Secure API keys in environment variables

**Permissions:**
- Read access: Contacts, enrollments, courses, notes
- Write access: Communications, notes, tags
- No access to payment details (read-only if needed)

**Audit Trail:**
- Log all API calls to Attio
- Track who made changes (Andy vs. human)
- Maintain sync history for troubleshooting

**Rate Limiting:**
- Respect Attio API rate limits
- Implement exponential backoff for failures
- Batch operations when possible
- Cache frequently accessed data

### Error Handling

**Sync Failures:**
- Retry with exponential backoff
- Queue failed operations for manual review
- Alert admin if sync fails repeatedly
- Maintain local cache to continue operating during outages

**API Errors:**
```javascript
async function apiCallWithRetry(fn, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (error.status === 401) {
        // Authentication failed - refresh token
        await refreshAttioToken();
      } else if (error.status === 429) {
        // Rate limited - wait and retry
        await sleep(Math.pow(2, i) * 1000);
      } else if (error.status >= 500) {
        // Server error - retry
        await sleep(Math.pow(2, i) * 1000);
      } else {
        // Client error - don't retry
        throw error;
      }
    }
  }
  throw new Error('Max retries exceeded');
}
```

**Conflict Handling:**
- Queue conflicts for manual resolution
- Provide UI for reviewing and resolving
- Learn from resolutions to improve auto-resolution

## Alternatives Considered

### 1. Manual Data Entry
- **Pros:** No development needed, full human control
- **Cons:** Time-consuming, error-prone, doesn't scale, loses real-time benefits
- **Rejected:** Doesn't solve the problem

### 2. One-Way Sync (Attio → Andy only)
- **Pros:** Simpler to implement, no conflict resolution needed
- **Cons:** Information gathered via WhatsApp not stored in Attio, manual entry still required
- **Rejected:** User specifically requested two-way sync

### 3. Zapier/Integration Platform
- **Pros:** No custom code, pre-built connectors
- **Cons:** Limited customization, recurring costs, may not support WhatsApp channel in Attio
- **Rejected:** May not meet requirement for "WhatsApp as a channel in Attio"

### 4. Export/Import CSV
- **Pros:** Simple, no API needed
- **Cons:** Not real-time, very manual, no automation, no communication logging
- **Rejected:** Too manual, doesn't enable real-time workflows

### 5. Build Custom CRM Instead
- **Pros:** Full control, perfect integration
- **Cons:** Massive effort, JLI already invested in Attio, loses Attio features
- **Rejected:** User wants to keep using Attio

## Acceptance Criteria

### Contact Sync
- [ ] Two-way sync between Andy and Attio
- [ ] Initial bulk sync of all Attio contacts
- [ ] Real-time sync via webhooks (or 5-minute polling)
- [ ] Create new contacts in Attio when someone messages Andy
- [ ] Update existing contacts bidirectionally
- [ ] Sync custom fields (JLI-specific fields)
- [ ] Sync tags between systems
- [ ] Handle deleted contacts gracefully

### Conflict Resolution
- [ ] Detect conflicts when both systems modified same field
- [ ] Timestamp-based resolution (most recent wins)
- [ ] Field-specific merge strategies (e.g., merge tags)
- [ ] Manual review queue for major conflicts
- [ ] Admin UI to resolve conflicts

### Message Logging
- [ ] Log all WhatsApp messages to Attio as "Communications"
- [ ] Include direction (inbound/outbound)
- [ ] Include message metadata (intent, sentiment, topics)
- [ ] Link messages to correct Attio contact
- [ ] Display in Attio communication timeline
- [ ] Support for message attachments (if applicable)

### WhatsApp Channel in Attio
- [ ] "WhatsApp" appears as communication channel option in Attio
- [ ] WhatsApp messages visible in contact timeline
- [ ] Filter communications by channel
- [ ] Track engagement metrics (response rate, time to reply)
- [ ] Differentiate between Andy (AI) and human responses

### CRM-Driven Actions
- [ ] Andy can read contact details from Attio
- [ ] Andy can read enrollment status
- [ ] Andy can read interaction history
- [ ] Andy can create/update contacts in Attio
- [ ] Andy can add notes to Attio contacts
- [ ] Andy can add/remove tags
- [ ] Andy can log communications
- [ ] Andy responds with context from Attio (enrolled courses, past interactions)

### Automation & Workflows
- [ ] Webhook listener for Attio events
- [ ] Trigger WhatsApp messages based on Attio events (enrollment, payment, etc.)
- [ ] Automated course reminders (sync'd with Attio schedule)
- [ ] Post-class feedback collection via WhatsApp → logged in Attio
- [ ] Payment reminders via WhatsApp

### Performance & Reliability
- [ ] Initial sync completes in < 5 minutes for 10,000 contacts
- [ ] Real-time sync latency < 30 seconds
- [ ] Handle Attio API rate limits gracefully
- [ ] Retry failed operations with exponential backoff
- [ ] Cache frequently accessed data for performance
- [ ] Continue operating during Attio outages (read from cache)

### Security & Privacy
- [ ] Secure API authentication (API keys or OAuth)
- [ ] Encrypt sensitive data in transit (HTTPS)
- [ ] Store API credentials securely (env vars, not hardcoded)
- [ ] Audit trail for all sync operations
- [ ] Respect contact privacy preferences
- [ ] GDPR compliance

### User Experience
- [ ] Admin dashboard showing sync status
- [ ] View recent sync operations and errors
- [ ] Manual sync trigger button
- [ ] Conflict resolution UI
- [ ] Sync statistics (contacts synced, messages logged, etc.)

## Technical Notes

### Relevant Files
- New integration module: `/integrations/adio/`
- API client: `/integrations/adio/client.js`
- Sync engine: `/integrations/adio/sync.js`
- Webhook handler: `/integrations/adio/webhooks.js`
- Database migrations: `/migrations/add-adio-tables.sql`
- Config: `/workspace/group/config/adio-config.json`

### Dependencies
- Attio API client library (if exists) or custom HTTP client
- Webhook server (Express.js endpoint)
- SQLite for local caching and sync tracking
- Job queue for async sync operations (Bull/BullMQ)

### Attio API Documentation
**TODO: Research Attio API**
- API documentation URL
- Authentication method (API key, OAuth, etc.)
- Available endpoints (contacts, communications, enrollments, courses)
- Webhook support
- Rate limits
- Custom fields support

**Questions to answer:**
1. Does Attio have a public API?
2. Does Attio support webhooks?
3. Can we add custom communication channels (WhatsApp)?
4. What custom fields does JLI use in Attio?
5. What are the API rate limits?
6. Does Attio support OAuth or only API keys?

### Performance Considerations
- **Initial sync:** May take several minutes for large contact lists (10,000+)
- **Ongoing sync:** Real-time via webhooks (< 30 sec latency) or polling (5 min)
- **Message logging:** < 1 second to log each message to Attio
- **Caching:** Cache contact data locally to reduce API calls (invalidate every 5 min)
- **Batch operations:** Bulk sync contacts in batches of 100

### Maintenance & Reliability
- **API changes:** Monitor Attio API for breaking changes
- **Webhook reliability:** Implement retry logic for failed webhook deliveries
- **Conflict resolution:** Review manual conflicts weekly
- **Data integrity:** Run nightly sync validation to detect discrepancies
- **Monitoring:** Alert on sync failures, API errors, webhook failures

## Use Cases Unlocked

### 1. Context-Aware Responses
**Scenario:** Student asks "When is my class?"

**Without Attio integration:**
```
Andy: "Which class are you referring to?"
```

**With Attio integration:**
```
Andy: "Your Talmud 101 class is this Tuesday, March 7th at 7:00 PM. The instructor is Rabbi Goldstein. Need directions to the JLI Center?"
```

### 2. Automated Enrollment Follow-up
**Scenario:** Student enrolls online

**Flow:**
1. Student enrolls in Talmud 101 via JLI website
2. Attio creates enrollment record
3. Webhook notifies Andy
4. Andy sends WhatsApp welcome message: "Mazal tov on enrolling in Talmud 101! First class is Tuesday at 7 PM. Reply with any questions."
5. Student response logged back in Attio

### 3. Payment Reminders
**Scenario:** Course payment due

**Flow:**
1. Attio flags account with "payment_due" tag
2. Andy sends WhatsApp reminder: "Hi Sarah, friendly reminder that your course payment is due Friday. Reply if you need an extension."
3. Student responds: "Can I pay next week?"
4. Response logged in Attio with tag "payment_extension_requested"
5. JLI coordinator sees note and approves extension
6. Coordinator updates Attio → Andy sends confirmation

### 4. Class Reminders
**Scenario:** Class starting soon

**Flow:**
1. Attio knows class schedule for all enrolled students
2. 2 hours before class, Andy sends WhatsApp reminder to all students
3. "Reminder: Talmud 101 class tonight at 7 PM. See you there!"
4. Students reply "Thanks!" or "Can't make it today"
5. Attendance expectations logged in Attio

### 5. Feedback Collection
**Scenario:** Post-class survey

**Flow:**
1. Class ends
2. Next day, Andy sends WhatsApp survey: "How was yesterday's class? Rate 1-5 and share any feedback."
3. Student replies: "4/5 - Great class, but moved a bit fast"
4. Response logged in Attio with sentiment analysis
5. JLI coordinator reviews feedback to improve future classes

### 6. Course Recommendations
**Scenario:** Student completes a course

**Flow:**
1. Student completes Talmud 101
2. Attio updates enrollment status to "completed"
3. Andy sends congratulations: "Mazal tov on completing Talmud 101! Based on your interest, you might enjoy Talmud 102 or Jewish Philosophy. Interested?"
4. Student: "Tell me more about Talmud 102"
5. Andy provides details, student enrolls via WhatsApp
6. Enrollment logged in Attio

### 7. Unified Communication History
**Scenario:** Instructor checks student's background

**Flow:**
1. Instructor opens student profile in Attio
2. Communication timeline shows:
   - Initial inquiry via WhatsApp (handled by Andy)
   - Enrollment email confirmation
   - Pre-class WhatsApp reminders
   - Post-class feedback via WhatsApp
   - Follow-up phone call (logged by instructor)
3. Complete 360° view of all interactions across channels

## Related

- Feature request: ChabadOne Integration (TBD) - Similar CRM integration for Chabad Houses
- Feature request: Google Contacts API (TBD) - Another contact sync integration
- Feature request: Multi-channel Memory System (GabayAI marketplace) - Foundation for cross-channel context

---

## Notes

This integration transforms Andy from a standalone WhatsApp assistant into a fully integrated part of JLI's CRM workflow. The key innovation is treating WhatsApp as a first-class communication channel in Attio, not just a separate messaging app.

The two-way sync ensures that information flows seamlessly: insights gathered via WhatsApp enrich Attio records, while Attio's rich contact data enables Andy to provide contextual, personalized responses.

**User's exact request:** "PRD for an Attio integration. Uh, Attio is a CRM that we use at JLI, and I'd like the integration to be, uh, two-way. And also, uh, one of the integration points is that we're gonna add, uh, WhatsApp messages as a channel in Attio."

**Next steps:**
1. Research Attio API documentation
2. Determine webhook support
3. Identify required custom fields for JLI
4. Design admin UI for conflict resolution
5. Build proof-of-concept sync engine
