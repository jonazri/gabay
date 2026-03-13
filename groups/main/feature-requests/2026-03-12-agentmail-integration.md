# Feature Request: AgentMail Integration

**Date:** 2026-03-12
**Status:** new
**Requested by:** Yonatan
**Priority:** important

## Problem

Andy has no native email capability. For the Nanoclaw inter-agent collaboration protocol (`/workspace/group/nanoclaw-collaboration-protocol.md`), agents need a dedicated email address to exchange structured data, files, and multi-turn messages with other agents — without flooding the shared WhatsApp group. Without AgentMail, inter-agent collaboration is limited to WhatsApp (rate-limited, unstructured) or GitHub Gist alone (no push/notification).

AgentMail (agentmail.to) provides API-first email inboxes designed specifically for AI agents — programmatic inbox creation, two-way send/receive, webhooks, and thread management. It's Y Combinator-backed, raised $6M in March 2026, and already used by thousands of agents.

## Proposed Solution

### 1. Provision an AgentMail inbox for Andy

Create a persistent inbox for Andy via the AgentMail API:
- Address: `andy@<tenant>.agentmail.to` (or similar)
- Store the inbox ID and API key in host config (`~/.config/nanoclaw/agentmail.json` or `.env`)

### 2. Add an `agentmail` skill

A bash skill wrapper (`agentmail`) that Andy can call to:

```bash
agentmail send   --to <address> --subject <subject> --body <text>
agentmail list   [--inbox <id>] [--limit N]
agentmail read   --id <message-id>
agentmail reply  --id <message-id> --body <text>
agentmail search --query <text>
```

### 3. Expose inbound email as a trigger (optional but valuable)

When Andy receives an email, the host could optionally:
- Deliver it as an inbound message to the main chat (like WhatsApp messages)
- Or write it to an IPC task file for Andy to poll

This enables true async agent-to-agent communication — another agent emails Andy, Andy wakes up and responds.

### 4. Register Andy's address in the collaboration protocol

Once provisioned, Andy's AgentMail address gets posted to the shared WhatsApp group so collaborating agents (and owners) can verify it. See `nanoclaw-collaboration-protocol.md` for full context.

## Alternatives Considered

- **Gmail via existing google-home or future Gmail skill:** Gmail wasn't designed for programmatic agent use — OAuth flows, deliverability issues, spam filters, and no instant inbox provisioning. AgentMail is purpose-built.
- **WhatsApp only:** Rate-limited by ToS, unstructured, poor for multi-turn data exchange. WhatsApp stays as the human-visible summary channel; AgentMail handles the agent-to-agent data layer.
- **SMTP/IMAP self-hosted:** Significant infrastructure overhead. AgentMail handles deliverability, spam, and threading out of the box.
- **GitHub Gist only:** One-directional (no push), no threading, no inbox. Good for file sharing but not for back-and-forth conversation.

## Acceptance Criteria

- [ ] Andy has a persistent AgentMail inbox with a real email address
- [ ] `agentmail send` skill command works from inside the container
- [ ] `agentmail list` retrieves recent inbox messages
- [ ] `agentmail read` retrieves full message body by ID
- [ ] `agentmail reply` sends a threaded reply to an existing message
- [ ] AgentMail API key stored securely in host config, injected into container via env var
- [ ] Andy's email address documented in memory so it can be shared with collaborating agents
- [ ] (Optional) Inbound emails delivered as triggers or polled via IPC

## Technical Notes

### AgentMail API

- Docs: https://docs.agentmail.to
- REST API + typed SDKs (Node, Python)
- Auth: API key in `Authorization` header (no OAuth)
- Inbox creation: `POST /inboxes` — returns inbox ID and address
- Send: `POST /inboxes/{id}/messages`
- List: `GET /inboxes/{id}/messages`
- Read: `GET /inboxes/{id}/messages/{messageId}`
- Webhooks available for inbound delivery

### Skill implementation pattern

Follow the same pattern as other bash skills (e.g., `google-home`, `akiflow`):
1. Host-side script at a known path that wraps AgentMail API calls
2. Skill wrapper in container calls it via the standard bash skill mechanism
3. `AGENTMAIL_API_KEY` and `AGENTMAIL_INBOX_ID` injected as env vars

### Config

`~/.config/nanoclaw/agentmail.json`:
```json
{
  "inboxId": "...",
  "address": "andy@....agentmail.to",
  "apiKey": "..."
}
```

### Relevant files
- `/workspace/group/nanoclaw-collaboration-protocol.md` — the inter-agent protocol this enables
- Container env var injection: `src/container-runner.ts`
- Existing skill pattern reference: any skill in `.nanoclaw/base/skills/`
