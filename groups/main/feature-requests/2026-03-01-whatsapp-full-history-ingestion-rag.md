# Feature Request: Full WhatsApp History Ingestion with RAG Search

**Date:** 2026-03-01
**Status:** new
**Requested by:** Yonatan
**Priority:** critical

## Problem

Currently, Andy only has access to WhatsApp messages that come through the live Baileys connection. This means:

**Missing historical data:**
- No access to messages before Andy was connected
- Cannot search conversations from months/years ago
- Historical context is lost for ongoing discussions
- No visibility into archived or old chats

**Limited channel coverage:**
- Only registered groups are monitored
- Personal 1:1 chats may not be included
- WhatsApp Channels (broadcast channels) not ingested
- Community groups may be missed
- Muted/archived conversations invisible

**Search limitations:**
- Existing WhatsApp search only works on ingested messages
- Cannot find information from before ingestion started
- No full-history semantic search capability

**User impact:**
- "What did I discuss with X last year?" - Cannot answer
- "Find the message where Y shared that link" - Miss if before ingestion
- "Search all my WhatsApp history" - Only has recent subset

## Proposed Solution

Build a comprehensive WhatsApp data ingestion system that:
1. **One-time import** of complete historical WhatsApp database
2. **Live ingestion** of ALL channels (groups, 1:1s, broadcasts, communities)
3. **RAG-powered search** over entire history
4. **Incremental updates** to keep database current

### Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Historical WhatsApp Data Sources                         │
├──────────────────────────────────────────────────────────┤
│  1. WhatsApp Desktop/Phone backup                        │
│  2. WhatsApp Export (JSON/text)                          │
│  3. Direct DB access (msgstore.db on Android)            │
│  4. iCloud/Google Drive backup                           │
└─────────────────┬────────────────────────────────────────┘
                  │
                  │ One-time import
                  ▼
┌──────────────────────────────────────────────────────────┐
│  Ingestion Pipeline                                      │
│                                                          │
│  - Parse message formats (JSON, DB, text)                │
│  - Extract: sender, content, media, timestamp, chat      │
│  - Deduplicate (handle overlaps with live data)          │
│  - Normalize & validate                                  │
└─────────────────┬────────────────────────────────────────┘
                  │
                  ▼
┌──────────────────────────────────────────────────────────┐
│  Vector Database (Qdrant/Weaviate)                      │
│                                                          │
│  - Store message embeddings (semantic search)            │
│  - Metadata: sender, chat, timestamp, media_type         │
│  - Hybrid search: vector (semantic) + keyword (BM25)     │
│  - Supports: similarity search, filters, aggregations    │
└─────────────────┬────────────────────────────────────────┘
                  │
                  │ Query
                  ▼
┌──────────────────────────────────────────────────────────┐
│  Andy (RAG Search Interface)                             │
│                                                          │
│  User: "Find when John mentioned that restaurant"        │
│  Andy: → Semantic search + filters                       │
│  Andy: → Returns: messages, context, dates               │
└──────────────────────────────────────────────────────────┘
                  ▲
                  │
                  │ Live updates
                  │
┌──────────────────────────────────────────────────────────┐
│  Live WhatsApp Ingestion (Baileys)                       │
│                                                          │
│  - Monitor ALL chats (not just registered groups)        │
│  - Include: groups, 1:1s, channels, communities          │
│  - Real-time embedding & storage                         │
│  - Auto-discover new chats                               │
└──────────────────────────────────────────────────────────┘
```

### Component 1: One-Time Historical Import

**Data sources:**

1. **WhatsApp Chat Export** (easiest)
   - Export via WhatsApp: Chat → Export → Without Media
   - Format: Plain text with timestamps
   - Pros: Official, easy to get, works on all platforms
   - Cons: Manual per-chat, loses some metadata

2. **WhatsApp Database Direct Access** (most complete)
   - Android: `msgstore.db` (SQLite)
   - iOS: ChatStorage.sqlite (via iCloud backup)
   - Pros: Complete history, all metadata, media references
   - Cons: Requires phone access or backup extraction

3. **WhatsApp Backup Files** (comprehensive)
   - Google Drive backup (Android)
   - iCloud backup (iOS)
   - Format: Encrypted backup file
   - Pros: Complete, includes media
   - Cons: Encryption, requires credentials

4. **WhatsApp Web/Desktop Cache** (partial)
   - IndexedDB in browser
   - Desktop app local storage
   - Pros: Recent messages, easy access
   - Cons: Limited history (few months max)

**Import workflow:**

```
1. User initiates historical import
   ├─ Option A: Upload WhatsApp backup file
   ├─ Option B: Export individual chats (multi-file)
   └─ Option C: Direct database access (advanced)

2. Parse & extract messages
   ├─ Detect format (text export, SQLite, backup)
   ├─ Extract: sender, content, timestamp, chat ID
   ├─ Handle media references (photos, videos, docs)
   └─ Preserve reply context & forwards

3. Deduplicate
   ├─ Check against existing messages (message ID)
   ├─ Handle overlaps with live ingestion
   └─ Mark source (historical vs live)

4. Generate embeddings
   ├─ Use OpenAI text-embedding-3-small
   ├─ Batch process (1000 messages/batch)
   └─ Store vectors in Qdrant

5. Index in vector DB
   ├─ Store message + embedding
   ├─ Add metadata (sender, chat, timestamp)
   └─ Create indexes for fast filtering

6. Verify & report
   ├─ Count messages imported
   ├─ Check for errors/skipped
   └─ Generate summary report
```

### Component 2: Live ALL-Channel Ingestion

**IMPORTANT: Separation of Concerns**

This feature adds a **parallel indexing layer** that does NOT interfere with NanoClaw's targeted group monitoring:

```
┌──────────────────────────────────────────────────┐
│  Baileys WhatsApp Connection                     │
│  (receives ALL messages)                         │
└───────────────┬──────────────────────────────────┘
                │
                ├─────────────────┬────────────────┐
                │                 │                │
                ▼                 ▼                ▼
    ┌───────────────────┐  ┌──────────┐  ┌──────────────┐
    │  NanoClaw Logic   │  │   RAG    │  │  SQLite DB   │
    │  (unchanged!)     │  │ Indexer  │  │  (existing)  │
    │                   │  │  (NEW)   │  │              │
    │ - Registered      │  │          │  │ - All msgs   │
    │   groups only     │  │ - Index  │  │   stored     │
    │ - Trigger @Andy   │  │   ALL    │  │              │
    │ - Group context   │  │   msgs   │  │              │
    │ - Reply handling  │  │ - Vector │  │              │
    │                   │  │   search │  │              │
    └───────────────────┘  └──────────┘  └──────────────┘
          │                      │               │
          │                      │               │
          ▼                      ▼               ▼
    Targeted Andy          Search API      Message logs
     responses            (new endpoint)
```

**Key principle: Non-invasive indexing**

```javascript
// NanoClaw message handler (UNCHANGED)
async function handleIncomingMessage(message) {
  const chatId = message.key.remoteJid;

  // 1. Store in SQLite (existing - no change)
  await storeInSQLite(message);

  // 2. NEW: Index in RAG database (parallel, async, doesn't block)
  //    This runs AFTER NanoClaw logic, in background
  setImmediate(() => {
    ragIndexer.indexMessage(message).catch(err => {
      console.error('RAG indexing failed (non-blocking):', err);
    });
  });

  // 3. NanoClaw logic (UNCHANGED - still only processes registered groups)
  const registeredGroups = getRegisteredGroups();
  if (!registeredGroups[chatId]) {
    return; // Don't trigger Andy for unregistered groups
  }

  // Continue with existing NanoClaw flow...
  if (shouldTriggerAndy(chatId, message)) {
    await processWithAndy(message);
  }
}
```

**RAG indexer as separate service:**

```javascript
// RAG indexer runs independently, doesn't block NanoClaw
class RAGIndexer {
  constructor() {
    this.queue = []; // Buffer messages for batch indexing
    this.batchSize = 100;
    this.flushInterval = 5000; // Flush every 5 seconds

    setInterval(() => this.flush(), this.flushInterval);
  }

  async indexMessage(message) {
    this.queue.push(message);

    if (this.queue.length >= this.batchSize) {
      await this.flush();
    }
  }

  async flush() {
    if (this.queue.length === 0) return;

    const batch = this.queue.splice(0, this.batchSize);

    try {
      // Generate embeddings in batch
      const embeddings = await this.embedBatch(batch);

      // Store in Qdrant
      await this.storeBatch(batch, embeddings);

      console.log(`RAG: Indexed ${batch.length} messages`);
    } catch (err) {
      console.error('RAG batch indexing failed:', err);
      // Don't re-throw - indexing failures shouldn't affect NanoClaw
    }
  }
}

// Global RAG indexer instance
const ragIndexer = new RAGIndexer();
```

**Why this approach is safe:**

1. **Non-blocking:** RAG indexing happens in background (`setImmediate`)
2. **Isolated errors:** RAG failures don't crash NanoClaw
3. **Independent:** NanoClaw's trigger logic unchanged
4. **Parallel:** Both systems coexist peacefully
5. **Optional:** Can disable RAG indexing without affecting NanoClaw

**Configuration:**

```javascript
// config.json
{
  "nanoclaw": {
    "registeredGroups": { /* existing */ },
    "triggerWord": "@Andy"
    // NanoClaw settings unchanged
  },
  "rag": {
    "enabled": true,  // Can disable without affecting NanoClaw
    "indexAllMessages": true,  // Index everything, even unregistered
    "batchSize": 100,
    "flushInterval": 5000,
    "vectorDB": {
      "type": "qdrant",
      "url": "http://localhost:6333"
    }
  }
}
```

**Auto-discovery of new chats:**
- RAG indexer sees all messages (registered or not)
- Automatically creates chat entries in vector DB
- NanoClaw still only responds to registered groups
- User can search all chats via RAG, but Andy only active in registered ones

### Component 3: RAG Search System

**Vector database setup:**

```javascript
// Using Qdrant (recommended)
const { QdrantClient } = require('@qdrant/js-client-rest');

const qdrant = new QdrantClient({
  url: 'http://localhost:6333'
});

// Create collection for WhatsApp messages
await qdrant.createCollection('whatsapp_messages', {
  vectors: {
    size: 1536, // OpenAI text-embedding-3-small dimension
    distance: 'Cosine'
  }
});
```

**Message embedding:**

```javascript
const OpenAI = require('openai');
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function embedMessage(message) {
  const text = `${message.senderName}: ${message.content}`;
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: text
  });
  return response.data[0].embedding;
}
```

**Storage:**

```javascript
async function storeMessage(message) {
  const embedding = await embedMessage(message);

  await qdrant.upsert('whatsapp_messages', {
    points: [{
      id: message.messageId,
      vector: embedding,
      payload: {
        chatId: message.chatId,
        chatName: message.chatName,
        sender: message.sender,
        senderName: message.senderName,
        content: message.content,
        timestamp: message.timestamp,
        messageType: message.messageType,
        hasMedia: message.hasMedia,
        source: 'live' // or 'historical'
      }
    }]
  });
}
```

**Hybrid search (semantic + keyword):**

```javascript
async function searchMessages(query, filters = {}) {
  // Generate query embedding
  const queryEmbedding = await embedMessage({ content: query, senderName: '' });

  // Build filter conditions
  const filter = {};
  if (filters.chatId) filter.chatId = filters.chatId;
  if (filters.sender) filter.sender = filters.sender;
  if (filters.dateRange) {
    filter.timestamp = {
      gte: filters.dateRange.start,
      lte: filters.dateRange.end
    };
  }

  // Semantic search
  const results = await qdrant.search('whatsapp_messages', {
    vector: queryEmbedding,
    filter: filter,
    limit: filters.limit || 20,
    with_payload: true
  });

  return results.map(r => ({
    message: r.payload,
    similarity: r.score
  }));
}
```

### Component 4: Enhanced Search API

**New endpoint:** `/api/rag-search`

```javascript
app.post('/api/rag-search', async (req, res) => {
  const { query, filters, options } = req.body;

  // Semantic search
  const results = await searchMessages(query, filters);

  // Optional: Re-rank with cross-encoder for better accuracy
  if (options.rerank) {
    results = await rerankResults(query, results);
  }

  // Optional: Fetch surrounding context (messages before/after)
  if (options.includeContext) {
    for (let result of results) {
      result.context = await getContextMessages(result.message.messageId, 3);
    }
  }

  res.json({
    query,
    results,
    totalResults: results.length
  });
});
```

**Advanced filters:**

```javascript
// Search by chat
await searchMessages('restaurant recommendation', {
  chatId: '1234567890@g.us'
});

// Search by sender
await searchMessages('project deadline', {
  sender: '1234567890@s.whatsapp.net'
});

// Search by date range
await searchMessages('vacation plans', {
  dateRange: {
    start: '2025-06-01T00:00:00Z',
    end: '2025-08-31T23:59:59Z'
  }
});

// Search with media
await searchMessages('photo from birthday party', {
  hasMedia: true,
  messageType: 'image'
});

// Combined filters
await searchMessages('John mentioned restaurant', {
  senderName: 'John',
  chatName: 'Family',
  dateRange: { start: '2025-01-01T00:00:00Z' }
});
```

### Component 5: Integration with Andy

**Updated WhatsApp search skill:**

```bash
# Current semantic search (existing)
whatsapp-search:search "restaurant recommendation"

# New RAG search with full history
whatsapp-search:rag "when did John mention that restaurant"

# Search with filters
whatsapp-search:rag "vacation plans" --chat "Family" --after "2025-06-01"

# Search with context
whatsapp-search:rag "project deadline" --context 5

# Search media
whatsapp-search:rag "photos from birthday" --media-only
```

**Conversational queries:**

```
User: "Find when Sarah mentioned moving to Brooklyn"
Andy: → RAG search: "Sarah moving Brooklyn"
Andy: → Filters: sender contains "Sarah"
Andy: → Returns: 3 messages from 2024-08-15, 2024-09-20, 2025-01-10

User: "What about the one from last summer?"
Andy: → Refines search with date filter: June-August 2024
Andy: → Returns: Message from 2024-08-15 with context
```

## Use Cases

### 1. Historical Information Retrieval
```
User: "When did I last talk to David about the conference?"
Andy: → RAG search across full history
Andy: "Last discussed 8 months ago on June 15, 2025. He mentioned he's speaking at the AI Summit."
```

### 2. Research Past Decisions
```
User: "Why did we choose vendor X over vendor Y?"
Andy: → Searches group chat history
Andy: "Found the discussion from March 2025. Key reasons: better pricing ($500/mo vs $800/mo), faster support, and integration with your existing tools."
```

### 3. Find Shared Resources
```
User: "Find that PDF John sent about marketing strategies"
Andy: → Searches messages with media filters
Andy: "Found it! John shared 'Marketing_Strategy_2025.pdf' on Feb 10, 2025 in the Work group."
```

### 4. Trace Conversation Evolution
```
User: "Show me the history of discussions about the new product launch"
Andy: → Semantic search + timeline sorting
Andy: "Found 15 conversations spanning 6 months:
  - Dec 2024: Initial idea discussion
  - Jan 2025: Feature brainstorming
  - Feb 2025: Budget approval
  - Mar 2025: Launch date set
  - Apr 2025: Marketing plans
  - May 2025: Final preparations"
```

### 5. Cross-Chat Search
```
User: "Did anyone mention 'React' in any of my chats?"
Andy: → Searches across ALL chats (groups + 1:1s)
Andy: "Found 47 mentions across 8 chats:
  - Dev Team (23 messages)
  - John (1:1) (12 messages)
  - Tech Meetup (8 messages)
  ..."
```

## Alternatives Considered

### 1. Use existing WhatsApp search only
- **Pros:** Already implemented
- **Cons:** Only searches currently-ingested messages, no historical data
- **Rejected:** Doesn't solve core problem of accessing history

### 2. Export chats manually when needed
- **Pros:** Simple, no infrastructure
- **Cons:** Manual, slow, can't search across all chats at once
- **Rejected:** Poor UX, not scalable

### 3. Index with Elasticsearch instead of vector DB
- **Pros:** Excellent keyword search, mature
- **Cons:** Weak semantic search, requires separate embedding layer
- **Rejected:** Hybrid approach (Qdrant) is better for both semantic + keyword

### 4. Store in SQL with embeddings column
- **Pros:** Familiar, integrates with existing DB
- **Cons:** Slower vector search, less optimized for RAG
- **Rejected:** Vector DB is purpose-built for this use case

## Acceptance Criteria

**Non-Invasive Architecture:**
- [ ] RAG indexing runs in parallel to NanoClaw (non-blocking)
- [ ] NanoClaw's registered group logic completely unchanged
- [ ] RAG indexing failures don't crash or affect NanoClaw
- [ ] Can disable RAG indexing without breaking NanoClaw
- [ ] RAG indexer uses batching to minimize performance impact
- [ ] NanoClaw response times unaffected (<50ms overhead max)

**Historical Import:**
- [ ] Support WhatsApp chat export (text format)
- [ ] Support WhatsApp database import (msgstore.db, ChatStorage.sqlite)
- [ ] Support backup file import (Google Drive, iCloud)
- [ ] Deduplicate against existing messages
- [ ] Handle media references (store URLs/paths)
- [ ] Import 10,000+ messages in < 5 minutes
- [ ] Generate embeddings in batch (1000/batch)
- [ ] Report import statistics (total, skipped, errors)

**Live All-Channel Ingestion:**
- [ ] Index ALL messages in background (not blocking NanoClaw)
- [ ] Auto-discover new chats without registering them
- [ ] Store all messages in RAG DB (regardless of NanoClaw registration)
- [ ] NanoClaw still only responds to registered groups
- [ ] Handle message edits and deletes
- [ ] Process 100 messages/second (peak load)

**RAG Search:**
- [ ] Semantic search over full message history
- [ ] Keyword search fallback (BM25)
- [ ] Hybrid search (semantic + keyword combined)
- [ ] Filter by: chat, sender, date range, media type
- [ ] Return surrounding context (messages before/after)
- [ ] Search latency < 500ms for 100k messages
- [ ] Support pagination (offset/limit)

**Data Management:**
- [ ] Automatic embedding generation on new messages
- [ ] Incremental updates (no full re-index)
- [ ] Message retention policy (configurable)
- [ ] Backup and restore of vector DB
- [ ] Migration tool for schema changes

**Integration:**
- [ ] Update `whatsapp-search` skill with RAG mode
- [ ] API endpoint `/api/rag-search`
- [ ] Web UI for browsing search results (optional)
- [ ] Export search results to JSON/CSV

## Technical Notes

### Vector Database Options

**Qdrant (Recommended):**
- Open source, Rust-based
- Excellent performance (100k+ vectors)
- Supports hybrid search (vector + keyword)
- Easy Docker deployment
- Good Python/JS SDKs

**Weaviate:**
- Open source, Go-based
- Built-in vectorization (can use OpenAI)
- GraphQL API
- Slightly heavier than Qdrant

**Pinecone:**
- Managed service (no self-hosting)
- Very fast, scalable
- Costs $70+/month
- Vendor lock-in

**Recommendation:** Start with Qdrant (self-hosted), migrate to Pinecone if scaling beyond 1M messages.

### Historical Import - WhatsApp DB Schema

**Android msgstore.db structure:**
```sql
-- Messages table
CREATE TABLE messages (
  _id INTEGER PRIMARY KEY,
  key_remote_jid TEXT,     -- Chat ID
  key_from_me INTEGER,      -- 1 if sent by user, 0 if received
  key_id TEXT,              -- Message ID
  status INTEGER,
  needs_push INTEGER,
  data TEXT,                -- Message content
  timestamp INTEGER,        -- Unix timestamp
  media_url TEXT,
  media_mime_type TEXT,
  media_wa_type INTEGER,
  media_size INTEGER,
  media_name TEXT,
  latitude REAL,
  longitude REAL,
  thumb_image TEXT
);

-- Chats table
CREATE TABLE chat (
  _id INTEGER PRIMARY KEY,
  jid TEXT UNIQUE,          -- Chat ID
  created_timestamp INTEGER,
  subject TEXT,             -- Group name
  display_message TEXT
);
```

**Import query:**
```sql
SELECT
  m.key_id as message_id,
  m.key_remote_jid as chat_id,
  c.subject as chat_name,
  m.key_from_me as is_from_me,
  m.data as content,
  m.timestamp as timestamp,
  m.media_wa_type as media_type,
  m.media_url as media_url
FROM messages m
LEFT JOIN chat c ON m.key_remote_jid = c.jid
ORDER BY m.timestamp ASC;
```

### Historical Import - Text Export Parser

**WhatsApp export format:**
```
2/15/25, 3:45 PM - John Smith: Hey, are we still meeting tomorrow?
2/15/25, 3:46 PM - You: Yes! 2pm at the usual spot
2/15/25, 4:12 PM - Sarah Jones: Can I join?
```

**Parser:**
```javascript
function parseWhatsAppExport(text) {
  const messages = [];
  const lines = text.split('\n');

  const messageRegex = /^(\d{1,2}\/\d{1,2}\/\d{2,4}),\s(\d{1,2}:\d{2}\s[AP]M)\s-\s([^:]+):\s(.+)$/;

  for (const line of lines) {
    const match = line.match(messageRegex);
    if (match) {
      const [_, date, time, sender, content] = match;
      messages.push({
        timestamp: parseDateTime(date, time),
        sender: sender.trim(),
        content: content.trim()
      });
    }
  }

  return messages;
}
```

### Embedding Strategy

**Batch processing:**
```javascript
async function embedMessagesBatch(messages, batchSize = 1000) {
  const embeddings = [];

  for (let i = 0; i < messages.length; i += batchSize) {
    const batch = messages.slice(i, i + batchSize);
    const texts = batch.map(m => `${m.senderName}: ${m.content}`);

    const response = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: texts
    });

    embeddings.push(...response.data.map(d => d.embedding));

    console.log(`Embedded ${Math.min(i + batchSize, messages.length)} / ${messages.length}`);
  }

  return embeddings;
}
```

**Cost estimation:**
- text-embedding-3-small: $0.02 per 1M tokens
- Average message: ~50 tokens
- 100k messages: ~5M tokens = $0.10
- Very affordable for historical import

### Deduplication Strategy

```javascript
async function deduplicateMessage(message) {
  // Check if message already exists
  const existing = await qdrant.retrieve('whatsapp_messages', {
    ids: [message.messageId]
  });

  if (existing.length > 0) {
    // Message already indexed
    console.log(`Skipping duplicate: ${message.messageId}`);
    return false;
  }

  // Also check by timestamp + sender + content (handles re-imports)
  const similar = await qdrant.search('whatsapp_messages', {
    vector: await embedMessage(message),
    filter: {
      sender: message.sender,
      timestamp: {
        gte: message.timestamp - 1000, // ±1 second
        lte: message.timestamp + 1000
      }
    },
    limit: 1,
    score_threshold: 0.99 // Very high similarity = likely duplicate
  });

  if (similar.length > 0) {
    console.log(`Skipping near-duplicate: ${message.messageId}`);
    return false;
  }

  return true; // Not a duplicate, safe to add
}
```

### Scaling Considerations

**Storage:**
- 1 message ≈ 6 KB (embedding + metadata)
- 100k messages ≈ 600 MB
- 1M messages ≈ 6 GB
- Use SSD for Qdrant data directory

**Memory:**
- Qdrant uses HNSW index (memory-efficient)
- ~1 GB RAM per 100k messages
- Recommended: 8 GB RAM for 500k messages

**Performance:**
- Qdrant can handle 1M+ vectors easily
- Search latency: < 100ms for exact search
- HNSW approximate search: < 20ms

### Monitoring & Maintenance

**Metrics to track:**
- Total messages indexed
- Embedding generation rate (msg/sec)
- Search query latency (p50, p95, p99)
- Vector DB disk usage
- Failed embeddings (errors)

**Dashboard:**
```javascript
app.get('/api/rag-stats', async (req, res) => {
  const collection = await qdrant.getCollection('whatsapp_messages');

  res.json({
    totalMessages: collection.points_count,
    vectorDimension: collection.config.params.vectors.size,
    diskUsage: collection.disk_usage,
    segments: collection.segments_count
  });
});
```

## Related Features

**Builds on:**
- WhatsApp Baileys integration (live message ingestion)
- Existing WhatsApp search (will be enhanced)
- Vector embeddings expertise (similar to OSINT research)

**Complements:**
- Apple Notes integration (`2026-03-01-apple-notes-integration.md`) - Search notes + WhatsApp together
- OSINT research (`2026-03-01-osint-people-research-agent.md`) - Cross-reference WhatsApp + public data
- Contacts cleanup (`2026-03-01-contacts-cleanup-workflow.md`) - Link WhatsApp contacts to address book

**Future possibilities:**
- Unified search across WhatsApp + Notes + Email + Calendar
- Automatic knowledge graph from message history
- Personal AI assistant trained on your message history
- Privacy-preserving local LLM fine-tuning
