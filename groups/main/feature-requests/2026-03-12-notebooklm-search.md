# Feature Request: NotebookLM Search (Query Only)

**Date:** 2026-03-12
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

The existing NotebookLM integration PRD (2026-03-04) covers full lifecycle management — create, add sources, query, audio overviews. That's a large surface area, dependent on `notebooklm-py` (web scraping, fragile).

The most immediate and practical need is simpler: Andy should be able to **query existing NotebookLM notebooks** that the user has already created and populated in the NotebookLM UI. No notebook creation, no source management — just ask a question, get an answer.

## Proposed Solution

A single command:

```bash
notebooklm-search <notebook_id> "question"
```

Returns the answer text and source citations. That's it.

### Implementation

Use `notebooklm-py` for the query call only:

```python
#!/usr/bin/env python3
from notebooklm_py import NotebookLM
import sys, json, os

client = NotebookLM(auth_token=os.getenv('NOTEBOOKLM_TOKEN'))
notebook_id = sys.argv[1]
question = sys.argv[2]
answer = client.query(notebook_id, question)
print(json.dumps({"answer": answer.text, "sources": answer.citations}))
```

Andy stores a small registry of notebook IDs in memory (`/workspace/group/memory/notebooks.md`) so she doesn't need the ID every time:

```
# Notebooks
- shluchim-knowledge: <id>
- chabad-history: <id>
```

### Auth

`NOTEBOOKLM_TOKEN` env var injected into the container by the host (same pattern as other API keys).

## Alternatives Considered

- **Full NotebookLM skill (2026-03-04 PRD):** Too heavy for now — audio overviews, source management, etc. all add complexity. Start with search only; expand later if needed.
- **Official Enterprise API:** Only supports CRUD, not querying. Useless for this.
- **agent-browser to scrape NotebookLM UI:** Could work but slow (~10s) and brittle. `notebooklm-py` already handles this.

## Acceptance Criteria

- [ ] `notebooklm-search <notebook_id> "question"` returns an answer from the notebook
- [ ] `NOTEBOOKLM_TOKEN` injected into container via host env
- [ ] Andy maintains a notebook name→ID registry in memory
- [ ] Works on notebooks created manually in the NotebookLM UI (no creation step needed)
- [ ] Returns source citations alongside the answer

## Technical Notes

- Depends on `notebooklm-py` (pip install) — web scraping based, may break on Google UI changes
- Only the `client.query()` call needed — no create/add-source/delete
- Notebook IDs visible in NotebookLM URL: `notebooklm.google.com/notebooklm/notebook/<id>`
- See 2026-03-04-notebooklm-integration.md for full context and expanded scope if needed later
