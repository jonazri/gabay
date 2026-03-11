---
name: whatsapp-summary
description: 3-stage multi-agent pipeline for generating daily and weekly WhatsApp group summaries. Dynamically discovers active groups, extracts updates per-group, ranks by importance, and synthesizes a final WhatsApp message.
---

# WhatsApp Summary Pipeline

Generate consolidated summaries of WhatsApp group activity using a 3-stage pipeline:
1. **Stage 1** — Per-group extraction (parallel, one agent per group)
2. **Stage 2** — Cross-group ranking and deduplication
3. **Stage 3** — Final synthesis and WhatsApp delivery

## Modes

| Parameter | Daily | Weekly |
|-----------|-------|--------|
| Time window | 24 hours | 7 days |
| Min messages per group | 5 | 10 |
| Target summary length | 1,500–2,000 chars | 2,500–3,500 chars |
| Top developments | 3 | 5 |
| Cron | `0 20 * * *` (8 PM ET) | `0 9 * * 0` (Sun 9 AM ET) |

Use `{MODE}` throughout — either `daily` or `weekly`. Derive all parameters from the table above.

---

## Pipeline Coordinator

You are the coordinator. Run stages sequentially, spawning sub-agents for the work.

### Step 1: Discover Active Groups

```python
python3 << 'PYTHON'
import sqlite3, json

conn = sqlite3.connect('/workspace/project/store/messages.db')
cursor = conn.cursor()

# {TIME_WINDOW} = '-24 hours' for daily, '-7 days' for weekly
# {MIN_MESSAGES} = 5 for daily, 10 for weekly
cursor.execute("""
    SELECT
        m.chat_jid,
        MAX(rg.name) as name,
        COUNT(*) as msg_count
    FROM messages m
    INNER JOIN registered_groups rg ON m.chat_jid = rg.jid
    WHERE m.timestamp >= datetime('now', '{TIME_WINDOW}')
    AND m.is_bot_message = 0
    AND rg.jid LIKE '%@g.us'
    GROUP BY m.chat_jid
    HAVING msg_count >= {MIN_MESSAGES}
    ORDER BY msg_count DESC
""")

groups = []
for jid, name, count in cursor.fetchall():
    groups.append({"jid": jid, "name": name, "count": count})
    print(f"{name}: {count} messages")

with open('/workspace/group/active-groups.json', 'w') as f:
    json.dump({"groups": groups, "total_groups": len(groups)}, f, indent=2)

print(f"\nTotal active groups: {len(groups)}")
conn.close()
PYTHON
```

**If no active groups:** output `<internal>No groups with {MIN_MESSAGES}+ messages. Exiting.</internal>` and stop. Do NOT send any message.

### Step 2: Run Stage 1 (Parallel)

Create `/workspace/group/summaries/` directory. For each active group, spawn a sub-agent **in parallel** using the Stage 1 prompt below, substituting `{GROUP_NAME}`, `{GROUP_JID}`, `{MESSAGE_COUNT}`, and `{TIME_WINDOW}`.

```
Task(
  subagent_type="general-purpose",
  model="haiku",
  description="Analyze {GROUP_NAME}",
  prompt="[Stage 1 prompt with substitutions]"
)
```

Wait for all Stage 1 agents to complete.

### Step 3: Run Stage 2 (Sequential)

Spawn ONE ranking agent with the Stage 2 prompt.

```
Task(
  subagent_type="general-purpose",
  model="sonnet",
  description="Rank all updates",
  prompt="[Stage 2 prompt]"
)
```

Wait for `ranked-updates.json`.

### Step 4: Run Stage 3 (Sequential)

Spawn ONE synthesis agent with the Stage 3 prompt, substituting `{MODE}`, `{DATE}`, and `{TARGET_LENGTH}`.

```
Task(
  subagent_type="general-purpose",
  model="sonnet",
  description="Create final summary",
  prompt="[Stage 3 prompt with substitutions]"
)
```

This agent sends the final WhatsApp message.

### Step 5: Cleanup

```bash
rm -rf /workspace/group/summaries /workspace/group/ranked-updates.json /workspace/group/active-groups.json
```

### Coordinator Rules

1. Wrap ALL working output in `<internal>` tags
2. Spawn Stage 1 agents **in parallel** (multiple Task calls in one message)
3. Wait for each stage to complete before starting the next
4. Only Stage 3 sends the final WhatsApp message
5. Use haiku for Stage 1 (fast extraction), sonnet for Stages 2–3 (ranking/synthesis)
6. NO status messages to user — only the final summary from Stage 3
7. If an agent fails, log internally and continue with remaining agents

---

## Stage 1: Per-Group Extraction

> Substitute `{GROUP_NAME}`, `{GROUP_JID}`, `{MESSAGE_COUNT}`, `{TIME_WINDOW}` before spawning.

You are a Group Summary Agent analyzing a single WhatsApp group.

**Mission:** Extract ALL notable updates from this group. Don't filter or rank — just extract everything substantive.

**Parameters:**
- GROUP_NAME: {GROUP_NAME}
- GROUP_JID: {GROUP_JID}
- MESSAGE_COUNT: {MESSAGE_COUNT}
- TIME_WINDOW: {TIME_WINDOW}

### Retrieve Messages

```python
python3 << 'PYTHON'
import sqlite3

conn = sqlite3.connect('/workspace/project/store/messages.db')
cursor = conn.cursor()
cursor.execute("""
    SELECT sender_name, content, timestamp
    FROM messages
    WHERE chat_jid = '{GROUP_JID}'
    AND timestamp >= datetime('now', '{TIME_WINDOW}')
    AND is_bot_message = 0
    ORDER BY timestamp DESC
""")
for sender, content, ts in cursor.fetchall():
    if content:
        print(f"[{ts}] {sender}: {content[:200]}")
conn.close()
PYTHON
```

### Extract Updates

For each message thread or topic, create a bullet with:
- **WHAT** happened (specific details, names, tools, numbers)
- **WHO** was involved (names, not "someone")
- **WHEN** (if time-sensitive)
- **WHY** it matters

**Include:** Product launches, policy changes, technical discussions with substance, collaborations, alerts, decisions, questions that sparked meaningful discussion, milestones, kashrus rulings, financial updates.

**Exclude:** Single emoji responses, "Thanks"/"Got it"/"OK", scheduling, generic greetings, off-topic chitchat.

### Output

Write to `/workspace/group/summaries/{GROUP_JID}.json`:

```json
{
  "group_name": "{GROUP_NAME}",
  "group_jid": "{GROUP_JID}",
  "message_count": {MESSAGE_COUNT},
  "analysis_date": "<ISO timestamp>",
  "updates": [
    {
      "bullet": "Specific description of what happened",
      "participants": ["Name1", "Name2"],
      "category": "product_launch",
      "timestamp": "<ISO timestamp>"
    }
  ]
}
```

**Categories:** `product_launch`, `announcement`, `policy_change`, `technical_discussion`, `collaboration`, `alert`, `decision`, `question`, `milestone`, `kashrus_ruling`, `financial`

### Stage 1 Rules

1. Extract EVERYTHING substantive — don't pre-filter for importance
2. Use SPECIFIC details: names, numbers, tools, exact wording
3. Each bullet must be standalone (reader has no context)
4. Empty `updates` array if zero substantive content
5. Wrap working output in `<internal>` tags
6. NO status messages to user

---

## Stage 2: Ranking

You are a Content Ranking Agent for WhatsApp summary curation.

**Mission:** Score each update bullet from all groups on a 0–100 scale.

### Input

Read all per-group summary files from `/workspace/group/summaries/*.json`.

### Scoring Criteria

| Range | Level | Examples |
|-------|-------|---------|
| 90–100 | CRITICAL | Service outages, security alerts, major policy changes, product launches, financial milestones >$10k, first-time achievements |
| 70–89 | HIGH | New tools announced, architectural decisions, cross-group collaborations, substantive kashrus rulings, $1k–$10k financial updates |
| 50–69 | MEDIUM | Ongoing project progress, questions sparking discussion, technical challenges, minor policy clarifications |
| 30–49 | LOW | Standard Q&A, known project progress, logistics, routine updates |
| 0–29 | NOISE | Operational chatter, trivial updates, redundant information |

### Process

For each bullet:
1. Assess novelty, impact, urgency, specificity
2. Assign score with reasoning
3. Cross-check for duplicates — keep highest-scored version

### Output

Write to `/workspace/group/ranked-updates.json`:

```json
{
  "ranking_date": "<ISO timestamp>",
  "total_bullets_scored": 45,
  "ranked_updates": [
    {
      "score": 95,
      "group_name": "Group Name",
      "group_jid": "jid@g.us",
      "bullet": "Description",
      "category": "product_launch",
      "timestamp": "<ISO timestamp>",
      "participants": ["Name"],
      "reasoning": "Why this score"
    }
  ]
}
```

Sort by score descending.

### Stage 2 Rules

1. Be consistent — similar updates get similar scores
2. Favor specificity over vagueness
3. Remove true duplicates — keep best version only
4. Preserve at least ONE update per group (unless zero substance)
5. Write detailed reasoning for scores 70+
6. Wrap working output in `<internal>` tags
7. NO status messages to user

---

## Stage 3: Synthesis

> Substitute `{MODE}` (daily/weekly), `{DATE}` (formatted date or range), `{TARGET_LENGTH}` before spawning.

You are the Final Summary Orchestrator.

**Context:** Per-group agents and ranking agent have already run. You have pre-ranked updates.

**Mission:** Create a well-organized {TARGET_LENGTH}-character summary from pre-ranked updates, ensuring at least one update per active group.

### Load Data

Read `/workspace/group/ranked-updates.json`. Optionally load `/workspace/group/communities.json` for community grouping.

### Selection Strategy

1. **Guarantee coverage:** Include each group's highest-scored update
2. **Fill remaining space** with top-scored updates across all groups until approaching {TARGET_LENGTH}
3. **Balance communities:** Weight toward communities with higher-scored content

### Organize by Community

Group selected updates by community (from `communities.json`):
- AI for Shlichus
- Tefillin Connection & MezuzUS
- Shluchim groups
- Other groups

### Format for WhatsApp

Use `mcp__nanoclaw__send_message` EXACTLY ONCE.

**Format rules:**
- `*Bold*` (single asterisks, NEVER `**double**`)
- `_Italic_`
- `•` for bullets
- NO markdown headings (`##`)

**Structure:**

For **daily** mode:
```
📊 *Daily Summary — {DATE}*

*Executive Summary*
[2–3 sentences highlighting top 3 developments]

---

*AI for Shlichus*

• [Bullet with specific details]
• [Additional bullets...]

*Tefillin Connection & MezuzUS*

• [Bullet]

*Other Groups*

• [Bullet]

---

_Based on [X] groups with activity ([Y] messages) in last 24 hours._
```

For **weekly** mode:
```
📊 *Weekly Summary — {DATE}*

*Executive Summary*
[3–5 sentences highlighting top 5 developments]

---

*AI for Shlichus*

• [Bullets with context and significance]

*Tefillin Connection & MezuzUS*

• [Bullets]

*Other Groups*

• [Bullets]

*Cross-group Insights*

• [Patterns visible across communities]

---

_Based on [X] groups with activity ([Y] messages) over the past week._
```

Send:
```json
{
  "text": "[Full formatted summary]",
  "sender": "{MODE} Summary"
}
```

### Stage 3 Rules

1. Wrap ALL working output in `<internal>` tags
2. Send EXACTLY ONE message via `send_message`
3. Use SINGLE asterisks for bold
4. Stay within {TARGET_LENGTH} characters
5. Include at least one update per active group
6. Use specific details from ranked updates (names, tools, numbers)
7. Executive briefing tone — facts-based, no superlatives
8. Explain WHY things matter through context, not adjectives
9. NO status messages, NO acknowledgments

---

## Error Handling

- **Agent failure:** Log internally, continue with remaining agents. Synthesis works with whatever data is available.
- **No messages:** Exit silently (no "nothing to report" messages).
- **Database unavailable:** Check `/workspace/project/store/messages.db` exists; exit with internal error if not.
- **Missing ranked-updates.json:** If Stage 2 fails, concatenate Stage 1 outputs directly and send a simpler summary.
