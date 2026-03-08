# Feature Request: Mass Messaging Guardrails & Education

**Date:** 2026-03-06
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

When users build or request mass messaging features using Gabbi AI's Baileys WhatsApp implementation, they may unknowingly use their primary personal phone number as the Baileys endpoint. Sending bulk/mass messages through a personal number carries significant risk:

- WhatsApp actively detects and penalizes mass messaging behavior
- Users can be temporarily suspended or permanently banned
- A banned primary number means losing access to all personal WhatsApp conversations and contacts
- This violates WhatsApp Terms of Service
- Users typically don't realize this risk until it's too late

This is a real and common failure mode — in the AIFS community this week, Rabbi Moshe Adler mentioned being "blocked for 24 hours a number of times (usually after around 200 messages)" when using a third-party mass messaging tool. The same risk applies when users build mass messaging directly into Gabbi via Baileys.

## Proposed Solution

Add soft guardrails — education and advisories, not hard blocks — that activate whenever a user is building or requesting a feature that involves mass or bulk WhatsApp messaging via the Baileys implementation.

### What "mass messaging" means in this context

Detect when a user's request involves:
- Sending the same or templated message to many recipients
- Iterating over a contact list and sending individual messages
- Broadcast-style messaging to groups or individuals
- Automated outreach campaigns
- "Blast" or "bulk" message functionality

### Guardrail Behavior

When mass messaging intent is detected, before proceeding with implementation:

1. **Display an advisory message** explaining the risks
2. **Ask a clarifying question** about their Baileys setup
3. **Proceed with implementation** only after the user has been informed

### Advisory Message (example)

> ⚠️ *Mass Messaging Advisory*
>
> You're building a feature that sends messages to many recipients via WhatsApp. Before we continue, a quick heads up:
>
> If your Gabbi instance is connected via your *personal phone number*, sending bulk messages puts that number at risk of being flagged, temporarily suspended, or permanently banned by WhatsApp — which could cut off your primary WhatsApp account entirely.
>
> *Recommendation:* Use a dedicated phone number (e.g., a cheap SIM or a virtual number like Google Voice) as your Baileys endpoint for any mass messaging feature. Keep your personal number separate.
>
> Are you currently connected via a personal number or a dedicated line? If you're on a personal number and want to proceed, just confirm you understand the risk and we'll continue.

### Detection Approach

This should be a **soft advisory**, not a hard block. The goal is education, not prevention. Users who understand the risk and choose to proceed should be able to.

Detection triggers (any of these in the user's request):
- Keywords: "mass message", "bulk send", "blast", "broadcast", "send to all contacts", "send to everyone", "mailing list", "outreach", "campaign"
- Patterns: loops over contact lists and sends messages, CSV upload → send to each row, "send this to X number of people"
- Context: user has asked for a marketing or outreach automation feature

### Integration Points

This guardrail should live in:
- **The Gabbi AI skills marketplace** — as a skill or middleware that wraps Baileys message-sending
- **The AI assistant context** — so the AI building the feature knows to surface this advisory before writing code
- **Documentation** — a clear warning in any mass messaging skill/template

### User Flow

```
User requests mass messaging feature
  ↓
System detects mass messaging intent
  ↓
Advisory displayed before any code is written
  ↓
User confirms they understand / confirms their setup
  ↓
Implementation proceeds
  ↓
[Optional] Implementation includes inline comments
  about WhatsApp TOS compliance
```

## Alternatives Considered

### 1. Hard block — refuse to implement mass messaging
- **Pros:** Fully prevents the risk
- **Cons:** Overly restrictive; legitimate use cases exist (using a dedicated number is fine); frustrates users who know what they're doing
- **Rejected:** Not aligned with the goal — educate, don't block

### 2. No guardrail — just document it somewhere
- **Pros:** Least friction
- **Cons:** Users won't read documentation before building; they'll hit the problem in production
- **Rejected:** Too passive; doesn't protect users who would benefit most

### 3. Detect at runtime (when messages are actually sent)
- **Pros:** Catches edge cases
- **Cons:** Too late — code is already written and deployed; user is mid-campaign
- **Rejected:** Guardrail needs to fire at design/build time, not at send time

### 4. Require dedicated number verification before enabling Baileys
- **Pros:** Proactively enforces best practice
- **Cons:** Heavy-handed; imposes friction on all users regardless of use case; not all users have dedicated numbers at setup time
- **Considered as future enhancement:** Could be a config-time flag ("is this a dedicated number?") that informs the guardrail without blocking

## Acceptance Criteria

- [ ] When a user requests a mass/bulk messaging feature, the AI assistant surfaces an advisory before writing any code
- [ ] Advisory clearly explains the risk of using a personal number for mass messaging
- [ ] Advisory asks the user to confirm their Baileys endpoint is a dedicated number or that they accept the risk
- [ ] Implementation is NOT blocked — user can proceed after acknowledgment
- [ ] Advisory is concise and not alarmist — educational, not scary
- [ ] Guardrail fires in the design/planning phase, not at runtime
- [ ] Inline code comments are added to generated mass messaging code noting WhatsApp TOS compliance considerations
- [ ] Guardrail covers at minimum: contact list iteration sends, broadcast sends, bulk outreach automation
- [ ] Does NOT fire for: normal single-message features, group chat posting, standard notification sends

## Technical Notes

### Detection in AI Context

The most practical implementation is a prompt-level guardrail — a system instruction that tells the AI assistant:

```
When the user requests functionality that sends WhatsApp messages to multiple
recipients in bulk or iterates over a contact list to send messages, surface
the following advisory BEFORE writing any code: [advisory text].

Do not block the user from proceeding. After they acknowledge or confirm,
proceed with implementation normally.
```

This can live in:
- A Gabbi skills marketplace system prompt addendum
- A dedicated "mass-messaging" skill that wraps the advisory + Baileys implementation
- The Gabbi AI Core CLAUDE.md / base system context

### Runtime Metadata (Optional Enhancement)

Add a config flag to the Baileys connection setup:

```json
{
  "baileys": {
    "phoneNumber": "...",
    "isPersonalNumber": true  // or false for dedicated lines
  }
}
```

If `isPersonalNumber: true`, the advisory fires with stronger language ("you are currently on a personal number"). If `false` or unset, the advisory is softer ("confirm your setup").

### WhatsApp TOS Reference

WhatsApp's Business Policy prohibits:
- Unsolicited mass messaging
- Automated or bulk messages not initiated by users
- Using the platform for spam

Users with dedicated numbers are still subject to TOS, but WhatsApp is less likely to ban a number that doesn't have personal conversation history attached to it.

### Related Skills / Features

- Baileys integration layer (core)
- Any "mass outreach", "contact list", or "campaign" skill templates in the marketplace
- Future: "WhatsApp Business API" skill as a safer alternative for high-volume senders

## Related

- WhatsApp Special Message Types (2026-03-05) — related to Baileys integration
