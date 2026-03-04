# Feature Request: Simcha & Levaya Monitoring Agent

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** critical

## Problem

Jewish lifecycle events (simchas and levayas) are time-sensitive opportunities for relationship building and community support, but shluchim often miss them because:

1. **Information is scattered** - Announcements appear on COL Live, Anash.org, WhatsApp groups, word-of-mouth
2. **No automatic matching** - Must manually connect "Sarah Cohen's son's wedding" to "Is that the Sarah Cohen I know?"
3. **Timing is critical** - Congratulations are meaningful when timely; condolences must be immediate
4. **Relationship context missing** - Hard to remember connection strength with hundreds of community members
5. **Notification overload** - Don't need alerts for strangers, but can't miss close connections

**Real-world impact:** A shaliach who reaches out for a simcha or levaya at the right moment creates a powerful touchpoint. Missing these moments damages relationships and misses engagement opportunities.

## Proposed Solution

Create a **Simcha & Levaya Monitoring Agent** that:
1. **Monitors COL Live and Anash.org** for lifecycle event announcements
2. **Matches events to contacts** using name matching, family relationships, location
3. **Prioritizes by relationship strength** - Immediate alerts for close connections, daily digest for acquaintances
4. **Provides action suggestions** - "Send mazal tov", "Attend levaya", "Make shiva visit"
5. **Tracks engagement** - Did you reach out? What was the response?

### Core Capabilities

#### 1. Event Monitoring & Scraping

**Data Sources:**
- **COL Live** (CrownHeights.info)
  - Engagement announcements
  - Wedding announcements
  - Birth announcements (bris, kiddush)
  - Bar/Bat Mitzvah announcements
  - Petirah (passing) notices
  - Levaya (funeral) announcements
  - Shiva information

- **Anash.org**
  - Community announcements
  - Simcha listings
  - Levaya notices
  - Yahrtzeit announcements

**Monitoring Frequency:**
- COL Live: Check every 2 hours (events are time-sensitive)
- Anash.org: Check every 2 hours
- High-priority events (levaya): Real-time monitoring (every 15 minutes)

**Event Types to Track:**
- 🎉 **Simchas:**
  - Engagement (vort, l'chaim)
  - Wedding (chasunah)
  - Birth (kiddush, bris, baby naming)
  - Bar/Bat Mitzvah
  - Upshernish
  - Anniversary milestone

- 🕯️ **Levayas:**
  - Petirah announcement
  - Levaya details (time, location)
  - Shiva information (address, times)
  - Shloshim
  - Yahrzeit (first year)

#### 2. Entity Extraction & Parsing

**Extract from announcements:**
- Primary names (e.g., "Menachem Mendel Cohen")
- Family relationships ("son of Rabbi Shalom and Sarah Cohen")
- Event type (engagement, bris, levaya, etc.)
- Date and time
- Location (synagogue, hall, cemetery, shiva house)
- Additional context (yeshiva, organization affiliations)

**Example Parsing:**

**Input (COL Live):**
```
Engagement: Menachem Mendel Cohen (Crown Heights)
to Chaya Mushka Goldstein (Los Angeles)

Son of Rabbi Shalom and Sarah Cohen
Daughter of Rabbi Moshe and Rivka Goldstein

L'Chaim: Tonight, 8:00 PM at 770
```

**Extracted Data:**
```json
{
  "event_type": "engagement",
  "groom": {
    "name": "Menachem Mendel Cohen",
    "location": "Crown Heights",
    "father": "Rabbi Shalom Cohen",
    "mother": "Sarah Cohen"
  },
  "bride": {
    "name": "Chaya Mushka Goldstein",
    "location": "Los Angeles",
    "father": "Rabbi Moshe Goldstein",
    "mother": "Rivka Goldstein"
  },
  "event_details": {
    "type": "L'Chaim",
    "date": "2026-03-04",
    "time": "8:00 PM",
    "location": "770"
  },
  "source": "COL Live",
  "published_at": "2026-03-04T14:30:00Z"
}
```

#### 3. Contact Matching & Relationship Mapping

**Matching Algorithm:**

1. **Direct name match** (primary person)
   - "Sarah Cohen" in announcement → "Sarah Cohen" in contacts
   - Fuzzy matching for spelling variations
   - Handle Hebrew/English name differences

2. **Family relationship match** (parents, siblings, children)
   - "Son of Rabbi Shalom Cohen" → Check if "Shalom Cohen" in contacts
   - "Daughter of Sarah Goldstein" → Match mother's name
   - Build family tree from CRM data

3. **Location context**
   - "Crown Heights" → Prioritize contacts in Brooklyn
   - "Los Angeles" → Match with LA area contacts
   - Organization affiliations (shul, yeshiva)

4. **Confidence scoring**
   - High confidence (95%+): First + last name + location match
   - Medium confidence (70-95%): First + last name only
   - Low confidence (50-70%): Last name + family connection

**Match Results:**
```json
{
  "match_found": true,
  "matched_contact": {
    "contact_id": "abc123",
    "name": "Sarah Cohen",
    "relationship_strength": 8,
    "last_interaction": "2026-02-15",
    "notes": "Active donor, attended Purim event"
  },
  "confidence": 0.95,
  "match_reason": "Direct name match + Crown Heights location",
  "relationship_to_event": "Mother of groom"
}
```

#### 4. Relationship Strength Scoring

**Factors:**
- **Interaction frequency** - Last contact date, number of interactions
- **Engagement level** - Event attendance, donations, program participation
- **Relationship type** - Close friend, donor, community member, acquaintance
- **Geographic proximity** - Local vs. out-of-town
- **Family connections** - Multiple family members in community

**Scoring (1-10):**
- **9-10 (Very Close)**: Close personal friends, major donors, weekly interactions
- **7-8 (Close)**: Active community members, monthly interactions, consistent donors
- **5-6 (Regular)**: Regular event attendees, quarterly interactions
- **3-4 (Acquaintance)**: Occasional contact, met a few times
- **1-2 (Distant)**: On mailing list, minimal direct interaction

**Priority Levels:**
- **IMMEDIATE** (9-10): Alert within minutes, expect personal outreach
- **HIGH** (7-8): Alert within 2 hours, daily digest summary
- **MEDIUM** (5-6): Daily digest with details
- **LOW** (3-4): Weekly digest mention
- **IGNORE** (1-2): Log but don't notify

#### 5. Smart Notification System

**Immediate Alerts (Very Close Relationships):**

**Simcha Alert:**
```
🎉 *SIMCHA ALERT*

*Sarah Cohen's son Menachem Mendel* just got engaged!

*Event:* L'Chaim tonight at 8 PM (770)
*Relationship:* Close friend, major donor (strength: 9/10)
*Last contact:* 3 weeks ago (Purim event)

💡 *Suggested actions:*
• Attend l'chaim tonight (high priority)
• Send personal mazal tov message now
• Offer to help with wedding planning
• Follow up: Donation opportunity for young couple

🔗 [COL Live announcement](https://...)
📝 Add note to CRM
```

**Levaya Alert:**
```
🕯️ *LEVAYA ALERT - URGENT*

*David Goldstein's father* passed away (Boruch Dayan Emes)

*Levaya:* TODAY 2:00 PM at Shomrei Hadas
*Shiva:* 123 Main St, Mon-Thu, 10 AM - 8 PM
*Relationship:* Active member, attended last Shabbaton (strength: 7/10)

💡 *Immediate actions:*
• Attend levaya if possible (2 hours from now)
• Send condolence message NOW
• Schedule shiva visit (suggest Tuesday 3 PM)
• Add to yahrzeit calendar (1 year reminder)

🔗 [Anash.org notice](https://...)
📝 Add note to CRM
```

**Daily Digest (Close Relationships):**
```
📅 *Daily Simcha & Levaya Digest* (March 4, 2026)

🎉 *3 Simchas* (Close connections):

1. *Rachel Levine's daughter* - Bar Mitzvah this Shabbos
   Strength: 8/10 (Regular donor)
   Action: Send mazal tov, offer to sponsor kiddush

2. *Michael Schwartz* - Birth announcement (baby boy)
   Strength: 7/10 (Community member)
   Action: Congratulate, bris details TBD

3. *Jonathan Stein's son* - Engagement announced
   Strength: 6/10 (Event attendee)
   Action: Send warm wishes

🕯️ *1 Levaya* (Acquaintance):

• *Mark Cohen's grandmother* - Levaya yesterday
  Strength: 5/10 (Mailing list)
  Action: Send brief condolence note

---
📊 *This week:* 12 events tracked, 8 matched to contacts, 4 required action
```

**Weekly Summary:**
```
📊 *Weekly Simcha & Levaya Summary* (Feb 26 - Mar 4)

🎉 *Simchas matched:* 15
- Engagements: 4
- Weddings: 3
- Births: 6
- Bar/Bat Mitzvahs: 2

🕯️ *Levayas matched:* 3

✅ *Your engagement:*
- Messages sent: 11
- Events attended: 2
- Shiva visits: 1

🎯 *Upcoming:*
- 3 weddings next week (2 close connections)
- 2 bar mitzvahs this month

📈 *Relationship impact:*
- Timely outreach: 11 touchpoints
- Deepened relationships: 8 contacts
```

#### 6. CRM Integration & Action Tracking

**Auto-update contact records:**
- Add lifecycle event to timeline: "Son engaged (3/4/26)"
- Update family structure: Add child's name, spouse's family
- Tag with event type: "recent_simcha", "recent_levaya", "shiva_visit_needed"
- Track engagement: "mazal_tov_sent", "levaya_attended", "shiva_visited"
- Set future reminders: Wedding date, bar mitzvah anniversary, yahrzeit

**Action Workflow:**
1. Alert received → Review match and priority
2. Click "Send mazal tov" → Opens WhatsApp/SMS with suggested message
3. Mark action taken → Updates CRM timeline
4. Track response → Log engagement level
5. Schedule follow-up → Set reminder for wedding/shiva/etc.

**Example CRM Update:**
```
Contact: Sarah Cohen
Timeline:
• 3/4/26: Son Menachem Mendel engaged (COL Live)
• 3/4/26: Sent personal mazal tov via WhatsApp ✓
• 3/4/26: Attended l'chaim at 770 ✓
• [FUTURE] 6/15/26: Son's wedding (reminder set)

Family:
• Son: Menachem Mendel Cohen (engaged to Chaya Mushka Goldstein)

Tags: recent_simcha, active_engagement, close_connection
```

#### 7. Event Calendar & Timeline

**Lifecycle Timeline View:**
- Upcoming simchas (next 30 days)
- Recent events (last 7 days)
- Shiva schedules (current)
- Anniversary reminders (bar mitzvah, yahrzeit)

**Calendar Integration:**
- Export to Google Calendar
- Add levaya times automatically
- Block shiva visit slots
- Wedding RSVP tracking

### Implementation Details

#### Backend Architecture

**Components:**
1. **Scraper Service** - Monitors COL Live & Anash.org
2. **NLP Parser** - Extracts entities from announcements
3. **Matcher Engine** - Finds contacts related to events
4. **Scorer** - Calculates relationship strength and priority
5. **Notifier** - Sends alerts based on priority
6. **CRM Sync** - Updates contact records

**Database Schema:**
```sql
CREATE TABLE lifecycle_events (
  id INTEGER PRIMARY KEY,
  source TEXT, -- 'col_live', 'anash_org', 'manual'
  event_type TEXT, -- 'engagement', 'wedding', 'bris', 'levaya', etc.
  primary_person TEXT,
  family_members JSON, -- [{name, relationship}, ...]
  event_details JSON, -- {date, time, location, ...}
  raw_announcement TEXT,
  url TEXT,
  published_at TIMESTAMP,
  scraped_at TIMESTAMP
);

CREATE TABLE event_matches (
  id INTEGER PRIMARY KEY,
  event_id INTEGER,
  contact_id TEXT,
  confidence REAL, -- 0.0 to 1.0
  match_reason TEXT,
  relationship_to_event TEXT, -- 'primary', 'parent', 'sibling', 'child'
  relationship_strength INTEGER, -- 1-10
  priority_level TEXT, -- 'immediate', 'high', 'medium', 'low', 'ignore'
  notified_at TIMESTAMP,
  action_taken TEXT, -- 'message_sent', 'attended', 'visited', etc.
  action_taken_at TIMESTAMP,
  notes TEXT
);

CREATE TABLE shiva_schedules (
  id INTEGER PRIMARY KEY,
  event_id INTEGER,
  address TEXT,
  dates JSON, -- [{'date': '2026-03-05', 'times': '10AM-8PM'}, ...]
  notes TEXT,
  visit_scheduled BOOLEAN,
  visit_completed BOOLEAN,
  visit_date TIMESTAMP
);
```

#### Web Scraping Implementation

**COL Live Scraper:**
```python
import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime

def scrape_col_live():
    """
    Scrape COL Live for lifecycle announcements
    """
    url = "https://crownheights.info/"
    response = requests.get(url)
    soup = BeautifulSoup(response.content, 'html.parser')

    events = []

    # Find announcement articles (adjust selectors based on actual HTML)
    articles = soup.select('.article')

    for article in articles:
        title = article.select_one('.title').text
        content = article.select_one('.content').text
        url = article.select_one('a')['href']
        published = article.select_one('.date').text

        # Detect event type from title/content
        event_type = detect_event_type(title, content)

        if event_type:
            # Extract entities (names, dates, locations)
            extracted = extract_entities(title, content)

            events.append({
                'source': 'col_live',
                'event_type': event_type,
                'title': title,
                'content': content,
                'url': url,
                'published_at': parse_date(published),
                'extracted': extracted
            })

    return events

def detect_event_type(title, content):
    """
    Identify event type from text
    """
    text = (title + " " + content).lower()

    if any(word in text for word in ['engagement', 'vort', "l'chaim", 'engaged']):
        return 'engagement'
    elif any(word in text for word in ['wedding', 'chasunah', 'marriage']):
        return 'wedding'
    elif any(word in text for word in ['birth', 'bris', 'baby', 'kiddush']):
        return 'birth'
    elif any(word in text for word in ['bar mitzvah', 'bat mitzvah']):
        return 'bar_mitzvah'
    elif any(word in text for word in ['petirah', 'passed away', 'levaya', 'boruch dayan emes']):
        return 'levaya'
    elif any(word in text for word in ['shiva', 'sitting shiva']):
        return 'shiva'

    return None

def extract_entities(title, content):
    """
    Extract names, relationships, dates, locations using NLP
    """
    # Use spaCy or similar NLP library
    import spacy
    nlp = spacy.load("en_core_web_sm")

    doc = nlp(title + ". " + content)

    people = []
    locations = []
    dates = []

    for ent in doc.ents:
        if ent.label_ == "PERSON":
            people.append(ent.text)
        elif ent.label_ == "GPE":
            locations.append(ent.text)
        elif ent.label_ in ["DATE", "TIME"]:
            dates.append(ent.text)

    # Extract family relationships with regex
    relationships = extract_family_relationships(content)

    return {
        'people': people,
        'locations': locations,
        'dates': dates,
        'relationships': relationships
    }

def extract_family_relationships(text):
    """
    Extract "son of", "daughter of", etc.
    """
    patterns = [
        r'son of (.+?) and (.+?)[\.\n]',
        r'daughter of (.+?) and (.+?)[\.\n]',
        r'parents: (.+?) and (.+?)[\.\n]',
        r'child of (.+?) and (.+?)[\.\n]',
    ]

    relationships = {}
    for pattern in patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            relationships['father'] = match.group(1).strip()
            relationships['mother'] = match.group(2).strip()

    return relationships
```

**Anash.org Scraper:**
```python
def scrape_anash_org():
    """
    Scrape Anash.org for community announcements
    """
    url = "https://anash.org/announcements"
    # Similar structure to COL Live scraper
    # Adjust selectors for Anash.org HTML structure
    pass
```

#### Contact Matching Engine

```python
from fuzzywuzzy import fuzz
import sqlite3

def match_event_to_contacts(event):
    """
    Find contacts related to lifecycle event
    """
    matches = []

    # Get all people mentioned in event
    people = event['extracted']['people']
    relationships = event['extracted']['relationships']

    # Search contacts database
    contacts = get_all_contacts()

    for person_name in people:
        for contact in contacts:
            # Fuzzy name matching
            similarity = fuzz.ratio(person_name.lower(), contact['name'].lower())

            if similarity > 85:  # High confidence match
                match = {
                    'event_id': event['id'],
                    'contact_id': contact['id'],
                    'confidence': similarity / 100.0,
                    'match_reason': f"Direct name match ({similarity}% similarity)",
                    'relationship_to_event': 'primary',
                    'relationship_strength': contact['relationship_strength'],
                    'priority_level': calculate_priority(contact['relationship_strength'])
                }
                matches.append(match)

    # Also check parent names if mentioned
    if 'father' in relationships:
        father_matches = search_contacts_by_name(relationships['father'])
        for match in father_matches:
            matches.append({
                'contact_id': match['id'],
                'confidence': match['confidence'],
                'match_reason': "Parent name match",
                'relationship_to_event': 'parent',
                'relationship_strength': match['relationship_strength'],
                'priority_level': calculate_priority(match['relationship_strength'])
            })

    return matches

def calculate_priority(relationship_strength):
    """
    Convert relationship strength to priority level
    """
    if relationship_strength >= 9:
        return 'immediate'
    elif relationship_strength >= 7:
        return 'high'
    elif relationship_strength >= 5:
        return 'medium'
    elif relationship_strength >= 3:
        return 'low'
    else:
        return 'ignore'
```

#### Notification Service

```python
def send_notifications(matches):
    """
    Send appropriate notifications based on priority
    """
    immediate_alerts = [m for m in matches if m['priority_level'] == 'immediate']
    high_priority = [m for m in matches if m['priority_level'] == 'high']

    # Send immediate WhatsApp alerts
    for match in immediate_alerts:
        send_immediate_alert(match)

    # Queue high priority for 2-hour digest
    for match in high_priority:
        queue_for_digest(match, delay_hours=2)

    # Others go into daily/weekly digests
    # (handled by scheduled tasks)

def send_immediate_alert(match):
    """
    Send urgent WhatsApp notification
    """
    event = get_event(match['event_id'])
    contact = get_contact(match['contact_id'])

    message = format_immediate_alert(event, contact, match)

    # Use WhatsApp send_message tool
    send_whatsapp_message(message)

    # Log notification
    log_notification(match['id'], 'immediate', datetime.now())
```

#### Scheduled Monitoring Task

```javascript
// Create scheduled task for COL Live monitoring
schedule_task({
  prompt: `
    Monitor COL Live and Anash.org for new lifecycle events:
    1. Run scraper for both sites
    2. Parse new announcements (last 2 hours)
    3. Extract entities and event details
    4. Match events to contacts in CRM
    5. Calculate priority based on relationship strength
    6. Send immediate alerts for high-priority matches
    7. Queue others for daily digest

    If no new events: <internal>No new events</internal>

    For immediate-priority events: Send alert right away
  `,
  schedule_type: "cron",
  schedule_value: "0 */2 * * *", // Every 2 hours
  context_mode: "isolated"
})

// Daily digest task
schedule_task({
  prompt: `
    Generate daily simcha & levaya digest:
    1. Query events from last 24 hours
    2. Group by priority (immediate already sent, show high/medium)
    3. Format as WhatsApp message with action suggestions
    4. Include relationship context for each match
    5. Send via send_message

    If no events: <internal>No events today</internal>
  `,
  schedule_type: "cron",
  schedule_value: "0 9 * * *", // 9 AM daily
  context_mode: "isolated"
})
```

### Privacy & Ethical Considerations

**Data Sources:**
- Only scrape publicly posted announcements
- COL Live and Anash.org are public community bulletin boards
- No private social media scraping

**Matching:**
- Transparent about data source ("Found on COL Live")
- User can review matches before acting
- Option to disable monitoring for specific contacts

**Notifications:**
- User controls priority thresholds
- Can adjust relationship strength scores
- Option to pause notifications temporarily

**Storage:**
- Encrypt database containing event and match data
- Secure credentials for web scraping
- Respect GDPR/privacy regulations

### Error Handling

**Scraping Failures:**
- Handle website downtime gracefully
- Retry with exponential backoff
- Fall back to cached announcements
- Log failures for manual review

**Parsing Errors:**
- If NLP extraction fails, flag for manual review
- Don't skip announcements - human can verify later
- Improve patterns over time based on errors

**False Matches:**
- User feedback: "Not the right person"
- Adjust confidence thresholds
- Learn from corrections
- Provide "Report incorrect match" option

**Rate Limiting:**
- Respect website rate limits
- Add delays between requests
- Use caching to minimize requests
- Consider RSS feeds if available

## Alternatives Considered

### 1. Manual Monitoring
- **Pros:** No automation needed, full human judgment
- **Cons:** Time-consuming, easy to miss announcements, doesn't scale
- **Rejected:** Doesn't solve the problem

### 2. Subscribe to Email Newsletters
- **Pros:** Pushes announcements to inbox
- **Cons:** Still manual matching to contacts, email overload, not actionable
- **Rejected:** No contact matching or prioritization

### 3. Google Alerts for Names
- **Pros:** Generic tool, no custom scraping
- **Cons:** Requires creating alerts for every contact (hundreds), misses announcements on Jewish sites, no relationship context
- **Rejected:** Too broad, not lifecycle-specific

### 4. Social Media Monitoring (Facebook, Instagram)
- **Pros:** People post simchas on social media
- **Cons:** Privacy concerns, not everyone posts publicly, fragmented across platforms
- **Rejected:** COL Live/Anash.org are centralized community resources

### 5. Word-of-Mouth Network
- **Pros:** Personal touch, community-based
- **Cons:** Inconsistent, delayed, limited reach
- **Rejected:** Complements automation but doesn't replace systematic monitoring

## Acceptance Criteria

### Web Scraping
- [ ] Scrape COL Live for announcements every 2 hours
- [ ] Scrape Anash.org for announcements every 2 hours
- [ ] Parse HTML and extract article content
- [ ] Handle website downtime gracefully
- [ ] Deduplicate announcements (same event posted multiple times)
- [ ] Store raw announcements in database

### Entity Extraction
- [ ] Detect event type (engagement, wedding, bris, levaya, etc.)
- [ ] Extract primary person name(s)
- [ ] Extract family relationships (parents, siblings)
- [ ] Extract dates and times
- [ ] Extract locations (synagogue, hall, cemetery, shiva house)
- [ ] Parse event details (l'chaim, levaya schedule, shiva times)

### Contact Matching
- [ ] Fuzzy name matching with confidence scores
- [ ] Match on parent/family names
- [ ] Consider location context
- [ ] Handle spelling variations and Hebrew/English names
- [ ] Identify family relationships (is this person's child/parent/sibling?)
- [ ] Store match confidence and reasoning

### Relationship Scoring
- [ ] Calculate relationship strength (1-10) based on:
  - Last interaction date
  - Interaction frequency
  - Engagement level (donations, events)
  - Relationship type
- [ ] Assign priority level (immediate, high, medium, low, ignore)
- [ ] User can manually override scores

### Notification System
- [ ] Immediate WhatsApp alerts for very close connections (9-10)
- [ ] 2-hour digest for close connections (7-8)
- [ ] Daily digest for regular connections (5-6)
- [ ] Weekly summary for acquaintances (3-4)
- [ ] No alerts for distant connections (1-2), but log events
- [ ] Format messages appropriately (simcha vs. levaya tone)
- [ ] Include action suggestions ("Attend levaya", "Send mazal tov")
- [ ] Link to original announcement

### CRM Integration
- [ ] Auto-update contact timeline with lifecycle events
- [ ] Add family members to contact record
- [ ] Tag contacts with event types
- [ ] Track actions taken (message sent, attended, visited)
- [ ] Set future reminders (wedding date, yahrzeit)
- [ ] Update family structure in CRM

### Action Tracking
- [ ] Mark when mazal tov/condolence message sent
- [ ] Track event attendance (levaya, l'chaim, shiva)
- [ ] Log shiva visits
- [ ] Record donations made in honor/memory
- [ ] Measure engagement over time

### Calendar Integration
- [ ] Display upcoming simchas (next 30 days)
- [ ] Show current shiva schedules
- [ ] Export to Google Calendar
- [ ] Set reminders for levayas (day-of notification)
- [ ] Block suggested shiva visit times

### User Controls
- [ ] Adjust relationship strength scores manually
- [ ] Disable monitoring for specific contacts
- [ ] Pause notifications temporarily
- [ ] Report incorrect matches
- [ ] Adjust priority thresholds

### Privacy & Security
- [ ] Only scrape public announcements
- [ ] Encrypt database
- [ ] Transparent about data sources
- [ ] User consent for monitoring
- [ ] Option to opt-out specific contacts

## Technical Notes

### Relevant Files
- New monitoring service: `/skills/simcha-monitor/`
- Database: `/workspace/group/lifecycle-events.db`
- Scrapers: `/skills/simcha-monitor/scrapers/`
- Matchers: `/skills/simcha-monitor/matchers/`
- Config: `/workspace/group/config/simcha-monitor-config.json`

### Dependencies
- `beautifulsoup4` - Web scraping
- `requests` - HTTP requests
- `spacy` - NLP entity extraction
- `fuzzywuzzy` - Fuzzy string matching
- SQLite - Event and match storage
- Scheduled tasks - Monitoring automation

### API Limitations
- **No official APIs** - Must scrape HTML (fragile)
- **Rate limits** - Unknown, be conservative (2-hour intervals)
- **HTML changes** - Scrapers will break when sites redesign
- **Announcement consistency** - Format varies, NLP must be robust

### Performance Considerations
- **Scraping frequency:** Every 2 hours (balance timeliness vs. load)
- **NLP latency:** 2-5 seconds per announcement
- **Matching performance:** O(n*m) where n=announcements, m=contacts (optimize with indexing)
- **Storage:** ~100 KB per event, ~50 events/day = 5 MB/day = 1.8 GB/year (manageable)

### Maintenance & Reliability
- **Fragility:** HTML scraping is fragile, expect breakage when sites update
- **Monitoring:** Log all scraping failures and parsing errors
- **Fallback:** If scraping fails, notify user to check sites manually
- **Updates:** Monitor COL Live and Anash.org for design changes
- **Human review:** Flag low-confidence matches for manual verification

## Use Cases Unlocked

### 1. Close Friend's Simcha
**Scenario:** Sarah Cohen's son gets engaged

**Flow:**
1. COL Live posts announcement at 2 PM
2. Scraper detects at 3 PM (next 2-hour cycle)
3. Matches to "Sarah Cohen" in contacts (95% confidence)
4. Relationship strength: 9/10 (close friend, weekly interaction)
5. Immediate WhatsApp alert sent
6. You attend l'chaim that night
7. CRM updated: "Son engaged 3/4/26, attended l'chaim"

**Impact:** Timely response strengthens close relationship

### 2. Community Member's Levaya
**Scenario:** David Goldstein's father passes away

**Flow:**
1. Anash.org posts petirah notice at 10 AM
2. Scraper detects at 12 PM
3. Matches to "David Goldstein" (parent's name mentioned)
4. Relationship strength: 7/10 (regular event attendee)
5. Immediate alert: "Levaya today at 2 PM"
6. You attend levaya
7. Shiva schedule extracted and added to calendar
8. Reminder set for shiva visit (Tuesday 3 PM)

**Impact:** Presence at levaya deeply appreciated

### 3. Donor's Family Simcha
**Scenario:** Major donor's daughter has a baby

**Flow:**
1. COL Live posts bris announcement
2. Matched to donor's family
3. Relationship strength: 10/10 (major donor)
4. Immediate alert with bris details
5. You attend bris and bring gift
6. Follow-up: "Would you like to sponsor kiddush?"
7. CRM: New grandchild added to family tree

**Impact:** Deepens relationship, engagement opportunity

### 4. Daily Digest Review
**Scenario:** Morning review of overnight announcements

**Flow:**
1. Wake up to daily digest (9 AM)
2. Review 5 matches: 3 simchas, 2 levayas
3. Send mazal tov messages (WhatsApp templates)
4. Add wedding RSVPs to calendar
5. Schedule shiva visit for acquaintance
6. All actions logged in CRM automatically

**Impact:** Systematic outreach, nothing missed

### 5. Avoiding Awkward Misses
**Scenario:** Acquaintance's parent passes away

**Flow:**
1. Anash.org posts levaya for "Rabbi Moshe Stein"
2. Matched to "Jonathan Stein" (father's name match)
3. Relationship strength: 5/10 (acquaintance)
4. Daily digest includes: "Jonathan's father passed away"
5. You send brief condolence note
6. Yahrzeit reminder set for next year

**Impact:** Avoided awkward situation where you didn't know

### 6. Family Tree Building
**Scenario:** Accumulating family information over time

**Flow:**
1. Event: "Menachem Cohen's son engaged"
2. CRM: Add son's name to family tree
3. Event: "Cohen family bar mitzvah"
4. CRM: Add another child
5. Over time: Complete family structure built automatically
6. Result: Rich context for future interactions

**Impact:** "How's your son Menachem?" (personal touch)

## Related

- Feature request: Google Alerts Monitoring (2026-03-04) - Complementary for business/career news
- Feature request: Birthday Reminder System (2026-03-04) - Another lifecycle touchpoint
- Feature request: WhatsApp Full History Ingestion (2026-03-01) - Alternative data source for life events
- Feature request: Contact Enrichment (from conversations) - Build family trees from messages

---

## Notes

This feature solves a uniquely Jewish community problem: staying connected to lifecycle moments in a tight-knit but geographically dispersed community. COL Live and Anash.org serve as central bulletin boards, but manually monitoring them doesn't scale beyond a handful of close connections.

The key insight: **Relationship strength should determine notification priority.** You can't attend every levaya or simcha, but you absolutely must attend for close connections. Automation enables systematic monitoring while human judgment determines appropriate response.

**User's exact request:** "Add a feature for another monitoring agent for COL Live and Anash.org for specifically, uh, simchas and, uh, and levayas, and then overlay that on my contacts and see, uh... Let me know when, when, uh, when someone in their family has, uh, has either a, a hasanah or a bris or a, uh, another simcha or a, a petirah levaya, uh, and a-alert me depending on how close we are."
