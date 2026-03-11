---
name: whatsapp-replies
description: Understanding reply context on inbound messages and sending threaded replies.
---

# WhatsApp Reply Context

## Reading reply context

Every message in the XML includes an `id` attribute. The **last `<message>` element is the triggering message** — the one you are responding to.

```xml
<message id="MSG_ID_HERE" sender="Bob" time="2026-...">Bob's message text</message>
```

When a user replies to an earlier message, the message XML also includes reply metadata:

```xml
<message id="MSG_ID_HERE" sender="Bob" time="2026-..." replied_to_id="abc123" replied_to_sender="972501234567@s.whatsapp.net">
  <reply_to>Alice's original message text</reply_to>
  Bob's reply text here
</message>
```

- `id` — this message's own ID (use this to thread your reply to it)
- `replied_to_id` — the ID of the message Bob is replying to
- `replied_to_sender` — the **JID** (e.g. `972501234567@s.whatsapp.net`) of who sent the original message
- `<reply_to>` — the text of the original message

Use reply context to give contextually accurate responses. E.g. if Bob is replying to Alice's question, your response can acknowledge that clearly.

## Sending threaded replies

Pass `quoted_message_id` to `send_message` to thread your reply in WhatsApp:

```
send_message({
  text: "Here's my answer to that",
  quoted_message_id: "MSG_ID_HERE"
})
```

To reply to the triggering message: use the `id` from the **last** `<message>` element.

To continue a thread: use the `replied_to_id` from the triggering message.

### When to use threading

**Group chats**: Default to threading your reply. It keeps conversations readable when multiple people are talking simultaneously.

**Owner private chat**: Generally send plain messages — threading in a 1:1 conversation feels redundant and clutters the interface.

**Exception for private chat**: If the owner has sent several messages in quick succession and it would be ambiguous which one you're responding to, use `quoted_message_id` to make the reference explicit.
