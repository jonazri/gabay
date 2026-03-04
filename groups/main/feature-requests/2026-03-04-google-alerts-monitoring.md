# Feature Request: Google Alerts Monitoring & Pipeline for Community Members

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Shluchim need to stay informed about major life events and achievements in their community members' (balabatim) lives to:
- Reach out at meaningful moments (job changes, business milestones, awards)
- Offer congratulations and strengthen relationships
- Identify opportunities for engagement (simcha sponsorship, involvement)
- Show genuine care by being aware of what's happening in their lives

Currently, this requires:
- Manual Google searches for each person periodically
- Relying on word-of-mouth or social media scrolling
- Missing important moments because information isn't centralized
- No systematic way to track hundreds of community members

**Real-world impact:** A shaliach who congratulates a balabos on a business achievement or reaches out during a career transition creates a powerful touchpoint that strengthens the relationship and often leads to increased engagement.

## Proposed Solution

Create a **Google Alerts management and processing pipeline** that:
1. **Creates and manages Google Alerts** for all community members
2. **Consumes alerts** via RSS/email and processes them automatically
3. **Filters for noteworthy events** using AI to identify life events, achievements, business news
4. **Notifies the shaliach** when something important is detected
5. **Updates CRM** with the new information for future reference

### Core Capabilities

#### 1. Alert Creation & Management

```bash
google-alerts create "David Cohen" --location "Boston, MA"
google-alerts create-batch /path/to/contacts.csv
google-alerts list
google-alerts update <alert_id> --query "new search terms"
google-alerts delete <alert_id>
google-alerts pause <alert_id>
google-alerts resume <alert_id>
```

**Features:**
- Bulk creation from contact lists (CSV, Google Contacts, CRM export)
- Smart query generation: "FirstName LastName" + location + business/organization
- Deduplication: Don't create duplicates if alert already exists
- Status tracking: Active, paused, failed
- Rate limiting: Respect Google's alert creation limits

#### 2. Alert Consumption Pipeline

**Input Sources:**
- RSS feeds (Google Alerts provides RSS URLs for each alert)
- Email forwarding (alerts sent to dedicated inbox)
- Manual upload (copy/paste alert content)

**Processing Flow:**
```
1. Fetch new alerts (RSS polling every 6 hours)
2. Parse and extract: headline, URL, snippet, source, date
3. AI filtering: Is this noteworthy? (see criteria below)
4. Categorize: job_change, business_news, award, publication, life_event, other
5. Enrich: Fetch full article if needed for context
6. Store: Save to database with metadata
7. Notify: Send to shaliach if flagged as important
```

#### 3. AI-Powered Filtering

**Noteworthy Event Criteria:**
- ✅ **Job changes**: New role, promotion, career transition
- ✅ **Business milestones**: Funding, acquisition, expansion, major contract
- ✅ **Awards & recognition**: Industry awards, community honors, speaking engagements
- ✅ **Publications**: Op-eds, interviews, podcast appearances
- ✅ **Life events**: Marriage, birth, moving (if publicly announced)
- ✅ **Charitable work**: Philanthropy, board appointments, volunteering
- ❌ **Not noteworthy**: Routine LinkedIn updates, generic company news, spam

**AI Prompt for Filtering:**
```
You are filtering Google Alerts for a community leader who wants to stay informed about meaningful moments in people's lives.

Alert content: [headline + snippet + source]
Person: [name, relationship, last interaction date]

Is this alert noteworthy enough to notify the community leader? Consider:
1. Does it represent a significant life event or achievement?
2. Would reaching out about this strengthen the relationship?
3. Is it recent and actionable (not old news)?

Return JSON:
{
  "noteworthy": true/false,
  "category": "job_change" | "business_news" | "award" | "publication" | "life_event" | "other",
  "priority": "high" | "medium" | "low",
  "suggested_action": "Short text suggesting how to reach out",
  "reasoning": "Why this is/isn't noteworthy"
}
```

#### 4. Notification System

**Daily Digest (Default):**
- Sent every morning at 9 AM local time
- Summary of noteworthy alerts from past 24 hours
- Grouped by priority (high → low)
- Includes suggested actions

**Immediate Alerts (High Priority):**
- Major life events (marriage, birth announcement)
- Significant business news (funding, acquisition, IPO)
- Awards and major recognition
- Sent immediately via WhatsApp

**Weekly Summary:**
- All alerts (including filtered-out ones) for review
- Option to adjust filters based on feedback

**Format:**
```
🔔 *Daily Alerts Digest* (3 noteworthy items)

*HIGH PRIORITY*
• *David Cohen* - Promoted to VP of Engineering at TechCorp
  📰 TechCrunch - 2 hours ago
  💡 Suggested action: "Mazal tov! This is huge - coffee to celebrate?"
  🔗 [Read article](https://...)

*MEDIUM PRIORITY*
• *Sarah Goldstein* - Quoted in WSJ about healthcare policy
  📰 Wall Street Journal - Yesterday
  💡 Suggested action: "Saw your WSJ piece - insightful as always!"
  🔗 [Read article](https://...)

• *Michael Schwartz* - Company announced Series B ($20M)
  📰 VentureBeat - Yesterday
  💡 Suggested action: "Congrats on the funding! How's the growth going?"
  🔗 [Read article](https://...)

---
🔍 *17 other alerts filtered* (not flagged as noteworthy)
📊 View all alerts: /alerts today
```

#### 5. CRM Integration

**Auto-update contact records:**
- Add note: "Google Alert: [headline] - [date]"
- Update fields: current_job, company, last_news_date
- Tag with categories: "in_the_news", "recent_promotion", "business_milestone"
- Track engagement: Did shaliach reach out? What was response?

**Supported CRMs:**
- ChabadOne API
- Google Contacts (notes field)
- Local SQLite database (fallback)

### Example Workflow

**Setup (One-time):**
1. User exports contact list from Google Contacts or CRM
2. User runs: `google-alerts create-batch contacts.csv`
3. System creates alerts for all contacts (e.g., 200 people)
4. System subscribes to RSS feeds and sets up polling

**Daily Operation:**
1. Every 6 hours: Fetch new alerts from RSS feeds
2. AI processes alerts and filters for noteworthy items
3. Noteworthy alerts stored in database with categories
4. Every morning at 9 AM: Daily digest sent to shaliach via WhatsApp
5. High-priority alerts sent immediately
6. Shaliach reviews digest, clicks links, reaches out to people
7. System tracks engagement (opened, contacted, response received)

**User Interaction:**
- User receives daily digest: "3 noteworthy alerts today"
- User clicks alert link to read full article
- User sends message: "Reached out to David about promotion"
- System logs interaction in CRM

### Implementation Details

#### Backend Architecture

**Components:**
1. **Alert Manager** - Creates, updates, deletes Google Alerts
2. **RSS Poller** - Fetches new alerts every 6 hours
3. **AI Filter** - Uses LLM to determine if alert is noteworthy
4. **Storage** - SQLite database for alerts and metadata
5. **Notifier** - Sends digests and immediate alerts
6. **CRM Sync** - Updates contact records

**Database Schema:**
```sql
CREATE TABLE google_alerts (
  id INTEGER PRIMARY KEY,
  alert_id TEXT UNIQUE,
  person_name TEXT,
  person_contact_id TEXT, -- CRM ID
  query TEXT,
  rss_url TEXT,
  status TEXT, -- active, paused, failed
  created_at TIMESTAMP,
  last_checked TIMESTAMP
);

CREATE TABLE alert_items (
  id INTEGER PRIMARY KEY,
  alert_id TEXT,
  headline TEXT,
  url TEXT,
  snippet TEXT,
  source TEXT,
  published_at TIMESTAMP,
  fetched_at TIMESTAMP,
  is_noteworthy BOOLEAN,
  category TEXT, -- job_change, business_news, etc.
  priority TEXT, -- high, medium, low
  suggested_action TEXT,
  reasoning TEXT,
  notified_at TIMESTAMP,
  contacted_at TIMESTAMP,
  contact_response TEXT
);
```

#### Google Alerts API (Unofficial)

Google doesn't provide an official API for creating alerts. Use one of these approaches:

**Option 1: Web Scraping (Selenium/Playwright)**
- Automate browser to create alerts via web UI
- Fragile but works
- Can use existing Google account

**Option 2: Use existing library**
- Python: `google-alerts` (https://github.com/9b/google-alerts)
- Handles authentication and alert management
- Can create, list, update, delete alerts

**Option 3: RSS-only (No creation)**
- User creates alerts manually once
- System only consumes RSS feeds
- Less automated but more reliable

**Recommendation:** Start with Option 2 (google-alerts library), fall back to Option 3 if creation fails.

#### RSS Feed Polling

```python
import feedparser
import sqlite3
from datetime import datetime

def poll_alerts():
    alerts = get_active_alerts()
    for alert in alerts:
        feed = feedparser.parse(alert.rss_url)
        for entry in feed.entries:
            if not exists_in_db(entry.link):
                save_alert_item(
                    alert_id=alert.id,
                    headline=entry.title,
                    url=entry.link,
                    snippet=entry.summary,
                    source=extract_source(entry),
                    published_at=entry.published_parsed
                )
                # Process with AI filter
                process_new_alert_item(entry)
```

#### AI Filtering

Use GPT-4 or Claude to analyze alert content:

```python
def is_noteworthy(alert_item, person_context):
    prompt = f"""
    You are filtering Google Alerts for a community leader.

    Alert: {alert_item.headline}
    Snippet: {alert_item.snippet}
    Source: {alert_item.source}
    Person: {person_context.name}
    Last interaction: {person_context.last_contact_date}

    Is this noteworthy? Return JSON with:
    - noteworthy: true/false
    - category: job_change | business_news | award | publication | life_event | other
    - priority: high | medium | low
    - suggested_action: How to reach out
    - reasoning: Why noteworthy or not
    """

    response = call_llm(prompt)
    return parse_json(response)
```

#### Notification Delivery

**Daily Digest (Scheduled Task):**
```javascript
schedule_task({
  prompt: `
    Generate daily Google Alerts digest:
    1. Query database for noteworthy alerts from past 24 hours
    2. Group by priority (high, medium, low)
    3. Format as WhatsApp message with suggested actions
    4. Send via send_message
  `,
  schedule_type: "cron",
  schedule_value: "0 9 * * *", // 9 AM daily
  context_mode: "isolated"
})
```

**Immediate Alerts (High Priority):**
```python
def process_high_priority_alert(alert_item):
    message = format_immediate_alert(alert_item)
    send_whatsapp_message(message)
```

### Privacy & Ethical Considerations

**Consent:**
- Only create alerts for community members who have opted in
- Provide clear explanation of what data is being monitored
- Easy opt-out mechanism

**Data Storage:**
- Store only publicly available information (already published online)
- Don't scrape private social media profiles
- Respect privacy settings and GDPR/CCPA

**Transparency:**
- When reaching out, be honest: "I saw the news about your promotion - mazal tov!"
- Don't pretend to have learned through other means
- Make it clear you care enough to pay attention

**Security:**
- Encrypt database containing alert data
- Secure Google account credentials
- Rate limiting to avoid detection as bot
- Don't abuse Google's services

### Error Handling

**Alert Creation Failures:**
- Google may block automated alert creation
- Fallback: Provide manual creation instructions with pre-filled queries
- Retry with exponential backoff

**RSS Feed Failures:**
- Handle HTTP errors (404, 500, timeout)
- Skip failed feeds and log errors
- Retry on next polling cycle

**AI Filtering Failures:**
- If LLM call fails, default to "noteworthy" (don't miss important alerts)
- Log failures for manual review
- Fallback to keyword-based filtering

**Rate Limiting:**
- Google may rate-limit RSS fetching
- Implement exponential backoff
- Add jitter to polling schedule
- Consider rotating IP addresses if needed

## Alternatives Considered

### 1. Manual Google Searches
- **Pros:** No automation needed, user in full control
- **Cons:** Time-consuming, inconsistent, easy to forget people
- **Rejected:** Doesn't scale beyond 10-20 people

### 2. LinkedIn Premium Alerts
- **Pros:** Native platform, reliable, job-focused
- **Cons:** Limited to LinkedIn, misses other news, expensive ($100+/mo)
- **Rejected:** Too narrow (only professional updates, no community/personal news)

### 3. Social Media Monitoring Tools (Mention, Brand24)
- **Pros:** Professional tools, comprehensive monitoring
- **Cons:** Very expensive ($99-500/mo), overkill for personal use, designed for brands
- **Rejected:** Cost-prohibitive for individual shluchim

### 4. Build Custom Web Scraper
- **Pros:** Full control, no Google dependency
- **Cons:** Fragile, hard to maintain, legal gray area, misses content behind paywalls
- **Rejected:** Google Alerts already aggregates news sources effectively

### 5. RSS Reader + Manual Filtering
- **Pros:** Simple, reliable, no AI needed
- **Cons:** Still manual filtering of hundreds of alerts daily, no intelligence
- **Rejected:** Reduces the problem but doesn't solve alert overload

## Acceptance Criteria

### Alert Management
- [ ] Create Google Alerts programmatically via library or web automation
- [ ] Bulk creation from CSV/contact list (200+ contacts)
- [ ] List all active alerts with status
- [ ] Update alert queries
- [ ] Pause/resume alerts
- [ ] Delete alerts
- [ ] Handle duplicate prevention (don't create alert if already exists)
- [ ] Error handling for creation failures with fallback instructions

### Alert Consumption
- [ ] Poll RSS feeds every 6 hours
- [ ] Parse alert items (headline, URL, snippet, source, date)
- [ ] Store in SQLite database
- [ ] Detect and skip duplicate alerts
- [ ] Handle malformed RSS feeds gracefully

### AI Filtering
- [ ] Analyze alert content with LLM
- [ ] Categorize: job_change, business_news, award, publication, life_event, other
- [ ] Prioritize: high, medium, low
- [ ] Generate suggested action ("How to reach out")
- [ ] Filter out non-noteworthy items (routine LinkedIn posts, spam)
- [ ] Provide reasoning for filtering decisions

### Notification System
- [ ] Daily digest sent at 9 AM local time
- [ ] Immediate alerts for high-priority items
- [ ] Format messages for WhatsApp (no markdown headings)
- [ ] Include article links, suggested actions
- [ ] Group by priority
- [ ] Show count of filtered-out alerts
- [ ] Weekly summary with all alerts (including filtered)

### CRM Integration
- [ ] Update contact records with alert data
- [ ] Add notes: "Google Alert: [headline] - [date]"
- [ ] Update fields: current_job, company, last_news_date
- [ ] Tag contacts: "in_the_news", "recent_promotion", etc.
- [ ] Track engagement: contacted_at, contact_response
- [ ] Support ChabadOne API, Google Contacts, local SQLite

### Privacy & Security
- [ ] Opt-in mechanism (only monitor consenting community members)
- [ ] Encrypt database
- [ ] Secure Google account credentials (env vars, not hardcoded)
- [ ] Respect rate limits to avoid bot detection
- [ ] Clear opt-out instructions

### UX
- [ ] Clear setup instructions for bulk import
- [ ] Dashboard showing: active alerts, recent noteworthy items, engagement stats
- [ ] Feedback mechanism: "Was this alert useful?"
- [ ] Adjust filters based on feedback (machine learning or manual tuning)

## Technical Notes

### Relevant Files
- New skill: `/skills/google-alerts/`
- Database: `/workspace/group/google-alerts.db` (or shared CRM database)
- Config: `/workspace/group/config/google-alerts-config.json`

### Dependencies
- `google-alerts` Python library (https://github.com/9b/google-alerts)
- `feedparser` for RSS parsing
- LLM API (GPT-4, Claude) for filtering
- SQLite for storage
- Scheduled tasks for polling and digests

### API Limitations
- **No official API** - Web scraping-based, fragile
- **Rate limits** - Unknown, be conservative
- **Alert creation** - May fail if Google detects automation
- **RSS updates** - Delayed (not real-time), typically 6-24 hours

### Performance Considerations
- **Polling frequency:** Every 6 hours (don't overload RSS feeds)
- **AI filtering latency:** 2-5 seconds per alert (batch processing preferred)
- **Storage:** ~10 KB per alert item, ~200 alerts/day = 2 MB/day = 730 MB/year (manageable)
- **Notification batching:** Daily digest prevents alert fatigue

### Maintenance & Reliability
- **Fragility:** Google may change RSS feed format or block scraping
- **Monitoring:** Log all RSS fetch failures and alert creation errors
- **Fallback:** If automation fails, provide manual creation guide
- **Updates:** Monitor `google-alerts` library for updates

## Use Cases Unlocked

### 1. Job Change Outreach
**Scenario:** David Cohen gets promoted to VP of Engineering

**Alert Flow:**
1. Google Alert detects TechCrunch article about promotion
2. AI filters as "noteworthy" (job_change, high priority)
3. Immediate notification sent to shaliach
4. Shaliach sends: "Mazal tov on the VP role! Let's catch up over coffee"
5. CRM updated: "Current role: VP of Engineering at TechCorp"

**Impact:** Timely outreach strengthens relationship, shows genuine interest

### 2. Business Milestone Recognition
**Scenario:** Sarah Goldstein's company raises Series B funding

**Alert Flow:**
1. Alert detects VentureBeat article about $20M Series B
2. AI categorizes as "business_news" (high priority)
3. Daily digest includes suggested action: "Congrats on funding!"
4. Shaliach reaches out within 24 hours
5. Follow-up: "Would you sponsor our youth program?"

**Impact:** Congratulations + engagement opportunity

### 3. Publication & Thought Leadership
**Scenario:** Michael Schwartz publishes op-ed in Wall Street Journal

**Alert Flow:**
1. Alert detects WSJ op-ed
2. AI categorizes as "publication" (medium priority)
3. Daily digest: "Saw your WSJ piece - insightful!"
4. Shaliach shares article on social media, tags Michael
5. CRM tagged: "thought_leader", "media_contact"

**Impact:** Recognition + increased visibility

### 4. Award & Recognition
**Scenario:** Rachel Levine receives "40 Under 40" award

**Alert Flow:**
1. Alert detects local business journal article
2. AI categorizes as "award" (high priority)
3. Immediate notification to shaliach
4. Shaliach: "Mazal tov on 40 Under 40! Well-deserved!"
5. Follow-up: Invite to speak at community event

**Impact:** Timely recognition + engagement invitation

### 5. Life Event (Public Announcement)
**Scenario:** Jonathan Stein announces engagement on LinkedIn

**Alert Flow:**
1. Alert detects LinkedIn post (public)
2. AI categorizes as "life_event" (high priority)
3. Immediate notification: "Jonathan just announced engagement"
4. Shaliach reaches out: "Mazal tov! We'd love to help with planning"
5. CRM updated: "Lifecycle stage: engaged", "Wedding planning: yes"

**Impact:** Meaningful moment + service opportunity

### 6. Weekly Review
**Scenario:** Shaliach reviews weekly summary on Shabbat afternoon

**Alert Flow:**
1. Weekly digest sent Friday 2 PM
2. Summary: "This week: 42 alerts, 12 noteworthy, 8 contacted"
3. Includes filtered-out alerts for review ("Did we miss anything?")
4. Shaliach adjusts filters: "Mark 'routine promotions' as low priority"
5. System learns preferences over time

**Impact:** Continuous improvement + full visibility

## Related

- Feature request: Birthday Reminder System (2026-03-04) - Complementary touchpoint automation
- Feature request: WhatsApp Full History Ingestion (2026-03-01) - Another data source for life events
- Feature request: NotebookLM Integration (2026-03-04) - Could store alert research in notebooks

---

## Notes

This feature transforms relationship management from reactive (waiting to hear news) to proactive (systematically monitoring and reaching out). By automating the tedious work of searching for updates, shluchim can focus on the human work of actually connecting with people.

The key insight: People appreciate when you notice and acknowledge their achievements. A timely "mazal tov" or "congratulations" creates a powerful touchpoint that strengthens relationships and opens doors for deeper engagement.

**User's exact request:** "Make a feature for creating and managing Google Alerts. Would be nice to have Google Alerts for all of my balabaton, and then a pipeline for consuming those alerts. And if anything there seems to be noteworthy or interesting, like a major life event, uh, a successful, uh, uh, thing with their business, something like that, then I'll get an alert"
