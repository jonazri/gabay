# WhatsApp Search
Semantic search over WhatsApp message history using Qdrant and OpenAI embeddings.

## Prerequisites
None (standalone system)

## Installation
1. `git fetch origin skill/whatsapp-search`
2. `git merge origin/skill/whatsapp-search`
3. `npm install`
4. Start Qdrant: `cd rag-system && docker compose up -d`
5. Configure OpenAI API key for embeddings

## Verification
- `npm run build && npm test`

## Environment Variables
None (Qdrant and OpenAI keys configured in rag-system/)
