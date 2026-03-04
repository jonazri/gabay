# Feature Request: NotebookLM Integration Skill

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Andy can research topics and gather information, but cannot persist or organize knowledge into structured notebooks for long-term reference. Users often ask Andy to research complex topics that would benefit from:

1. **Persistent knowledge bases** - Information stored in notebooks that can be queried later
2. **Source management** - Adding documents, URLs, and text as sources to build comprehensive knowledge
3. **Multi-source synthesis** - Asking questions across multiple documents and getting AI-generated answers
4. **Audio overviews** - Generating podcast-style summaries of notebook content

Currently, Andy's research is ephemeral - once the conversation ends, the knowledge is lost or buried in chat history. NotebookLM provides a perfect interface for building persistent, queryable knowledge bases.

## Proposed Solution

Create a **notebooklm** skill that wraps the `notebooklm-py` Python library to enable programmatic notebook creation, source management, and querying.

### Core Capabilities

The skill should provide these functions:

#### 1. Notebook Management
```bash
notebooklm create "Topic Name"  # Creates new notebook, returns ID
notebooklm list                  # Lists all notebooks
notebooklm delete <notebook_id>  # Deletes notebook
```

#### 2. Source Management
```bash
notebooklm add-url <notebook_id> <url>           # Add website as source
notebooklm add-text <notebook_id> "content"      # Add text content
notebooklm add-file <notebook_id> <filepath>     # Upload document (PDF, etc.)
notebooklm list-sources <notebook_id>            # List all sources in notebook
```

#### 3. Querying & Generation
```bash
notebooklm query <notebook_id> "question"        # Ask question, get AI answer
notebooklm generate-overview <notebook_id>       # Generate audio overview (podcast)
notebooklm chat <notebook_id> "message"          # Interactive chat with notebook
```

### Example Workflow

**User:** "Research the history of Chabad and create a notebook about it"

**Andy:**
1. Creates notebook: `notebooklm create "Chabad History"`
2. Adds sources:
   - `notebooklm add-url <id> "https://chabad.org/library/article_cdo/aid/112492"`
   - `notebooklm add-url <id> "https://en.wikipedia.org/wiki/Chabad"`
3. Queries notebook: `notebooklm query <id> "When was Chabad founded?"`
4. Returns synthesized answer from all sources
5. Saves notebook ID to memory for future queries

**Later:**
**User:** "What did we learn about Chabad's founder?"

**Andy:** Retrieves notebook ID from memory, queries: `notebooklm query <id> "Who founded Chabad?"`

### Implementation Details

**Backend (Host-side):**

Use the `notebooklm-py` Python library:
```bash
pip install notebooklm-py
```

**Authentication:**
- Requires Google account credentials
- Store auth tokens securely in host environment
- Pass credentials via environment variables to container

**Skill Interface:**

Create `/skills/notebooklm/notebooklm` bash script that:
1. Calls Python wrapper around `notebooklm-py`
2. Handles authentication
3. Returns JSON responses for easy parsing

**Example Implementation:**

```python
#!/usr/bin/env python3
from notebooklm_py import NotebookLM
import sys
import json

client = NotebookLM(auth_token=os.getenv('NOTEBOOKLM_TOKEN'))

command = sys.argv[1]

if command == "create":
    title = sys.argv[2]
    notebook = client.create_notebook(title)
    print(json.dumps({"id": notebook.id, "title": title}))

elif command == "add-url":
    notebook_id = sys.argv[2]
    url = sys.argv[3]
    source = client.add_source(notebook_id, url)
    print(json.dumps({"source_id": source.id, "url": url}))

elif command == "query":
    notebook_id = sys.argv[2]
    question = sys.argv[3]
    answer = client.query(notebook_id, question)
    print(json.dumps({"answer": answer.text, "sources": answer.citations}))
```

### Memory Integration

Andy should maintain a notebook registry in `/workspace/group/notebooks.json`:

```json
{
  "chabad-history": {
    "notebook_id": "abc123",
    "title": "Chabad History",
    "created": "2026-03-04T14:45:00Z",
    "sources": 3,
    "last_queried": "2026-03-04T15:30:00Z"
  }
}
```

This allows Andy to:
- Remember which notebooks exist
- Resume conversations about specific topics
- Suggest relevant notebooks when similar questions arise

## Alternatives Considered

### 1. Official NotebookLM Enterprise API
- **Pros:** Officially supported, stable
- **Cons:** Only provides notebook CRUD operations, NOT querying capabilities
- **Rejected:** Doesn't solve the core problem (querying notebooks)

### 2. Build custom knowledge base with local vector DB
- **Pros:** Full control, no external dependencies
- **Cons:** Reinventing the wheel, significant development effort, no audio overviews
- **Rejected:** NotebookLM already provides superior UX

### 3. Use native NotebookLM web UI manually
- **Pros:** No development needed
- **Cons:** Manual process, breaks automation, Andy can't interact programmatically
- **Rejected:** Doesn't enable automation or integration

### 4. Web scraping approach (manual Selenium/Playwright)
- **Pros:** Direct control
- **Cons:** `notebooklm-py` already does this better, fragile
- **Rejected:** Library exists and is maintained

## Acceptance Criteria

### Core Functionality
- [ ] Create notebooks programmatically
- [ ] Add sources (URLs, text, files) to notebooks
- [ ] Query notebooks and receive AI-generated answers
- [ ] List all notebooks
- [ ] Delete notebooks
- [ ] List sources within a notebook

### Advanced Features
- [ ] Generate audio overviews (podcast-style summaries)
- [ ] Interactive chat with notebooks (multi-turn conversations)
- [ ] Citation tracking (which sources answered which questions)

### Integration
- [ ] Skill available in Andy's container
- [ ] Authentication handled securely
- [ ] Notebook registry persisted in `/workspace/group/`
- [ ] Error handling for network/auth failures
- [ ] Memory integration for topic-to-notebook mapping

### UX
- [ ] Clear error messages when NotebookLM API fails
- [ ] Graceful degradation if service unavailable
- [ ] Progress updates for long operations (audio generation)

## Technical Notes

### Relevant Files
- New skill: `/skills/notebooklm/`
- Registry: `/workspace/group/notebooks.json`
- Memory: `/workspace/group/memory/research-topics.md`

### Dependencies
- `notebooklm-py` - Python library (https://github.com/teng-lin/notebooklm-py)
- Google account with NotebookLM access
- Authentication tokens (stored in host environment)

### API Limitations (from notebooklm-py)
- **Web scraping-based** - May break if Google changes UI
- **Rate limits** - Unknown, but likely conservative to avoid detection
- **Session management** - Needs periodic re-authentication
- **No official API** - Unofficial, use at own risk

### Error Handling

```bash
# Handle auth failures
if [[ $? -eq 401 ]]; then
  echo '{"error": "Authentication failed. Run: notebooklm auth-refresh"}' >&2
  exit 1
fi

# Handle network failures
if [[ $? -eq 503 ]]; then
  echo '{"error": "NotebookLM service unavailable. Try again later."}' >&2
  exit 1
fi
```

### Security Considerations
- **Credentials storage:** Store Google auth tokens in host environment variables, not in container
- **Notebook privacy:** All notebooks are private to the authenticated Google account
- **Data persistence:** Notebooks persist in Google's cloud, not locally
- **Access control:** Only Andy (via host credentials) can access notebooks

### Performance Considerations
- **Query latency:** 2-5 seconds per query (web automation overhead)
- **Audio generation:** 30-60 seconds for podcast creation
- **Source upload:** 5-10 seconds per document depending on size
- **Caching:** Consider caching recent queries in memory

### Maintenance & Reliability
- **Fragility:** Web scraping is fragile - expect breakage when Google updates UI
- **Monitoring:** Log all API calls to detect failures early
- **Fallback:** If NotebookLM unavailable, fall back to regular research + save to file
- **Updates:** Monitor `notebooklm-py` repo for updates and breaking changes

## Use Cases Unlocked

### 1. Research Projects
**User:** "Research quantum computing and create a notebook"

**Andy:**
1. Creates "Quantum Computing" notebook
2. Adds authoritative sources (arXiv papers, Wikipedia, university sites)
3. User can ask follow-up questions weeks later: "What did we learn about quantum entanglement?"
4. Andy queries saved notebook instantly

### 2. Meeting Notes & Knowledge Base
**User:** "Add this meeting transcript to our product roadmap notebook"

**Andy:**
1. Finds or creates "Product Roadmap" notebook
2. Adds transcript as text source
3. User asks: "What features did we discuss for Q2?"
4. Andy synthesizes answer from all meeting notes

### 3. Document Analysis
**User:** "Upload these 5 PDFs about tax law and answer questions"

**Andy:**
1. Creates "Tax Law Research" notebook
2. Uploads all PDFs as sources
3. User asks complex questions spanning multiple documents
4. Andy provides synthesized answers with citations

### 4. Podcast Generation
**User:** "Create a 10-minute podcast explaining our research on climate change"

**Andy:**
1. Finds "Climate Change Research" notebook
2. Generates audio overview
3. Returns download link for podcast

### 5. Incremental Knowledge Building
**User:** "Add this article about Chabad history to our existing notebook"

**Andy:**
1. Retrieves notebook ID from memory
2. Adds new source
3. Previous knowledge + new source = richer answers

## Related

- Feature request: Apple Notes Integration (2026-03-01) - Complementary for local note-taking
- Feature request: WhatsApp Full History Ingestion (2026-03-01) - Could feed into NotebookLM for searchable knowledge base

---

## Notes

This feature transforms Andy from an ephemeral conversational assistant into a persistent knowledge management system. By integrating NotebookLM, users can build long-term knowledge bases that grow over time and remain queryable indefinitely.

The `notebooklm-py` library is unofficial and fragile, but it's the best available option until Google adds query capabilities to the official Enterprise API.
