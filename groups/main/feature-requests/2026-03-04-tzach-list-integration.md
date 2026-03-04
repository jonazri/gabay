# Feature Request: TzachList Integration & Local Cache

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** high

## Problem

TzachList (tzachlist.com) is a static directory of Anash (Chabad community members) complementary to the Shluchim list, but currently:

1. **No local access** - Must visit website manually to look up individuals
2. **No search integration** - Can't search TzachList from Andy
3. **No cross-referencing** - Can't compare TzachList with Shluchim list or user contacts
4. **Slow lookups** - Web scraping on-demand is slow (5-10 seconds)
5. **No offline access** - Can't search when internet is down or slow
6. **No data enrichment** - TzachList data not used to enrich contact profiles

**Real-world impact:** TzachList contains valuable information about Anash community members that complements the Shluchim database. Users frequently need to look up Anash members for connections, referrals, or community building, but accessing TzachList requires manual web browsing.

## Proposed Solution

Create a **TzachList local cache** that:
1. **Maintains local database** of all Anash from TzachList
2. **Periodic crawler daemon** that updates the list weekly/monthly
3. **Fast search API** for name-based and location-based queries
4. **Cross-referencing** - Identify overlap with Shluchim list and user contacts
5. **Contact enrichment** - Enhance profiles with TzachList data
6. **Always available** - Works offline, instant responses

### Core Capabilities

#### 1. Local TzachList Database

**Data Schema:**
```sql
CREATE TABLE tzachlist_anash (
  id INTEGER PRIMARY KEY,

  -- Personal Information
  first_name TEXT,
  last_name TEXT,
  title TEXT, -- "Mr.", "Mrs.", "Rabbi", "Rebbetzin"

  -- Location
  city TEXT,
  state TEXT,
  country TEXT,
  address TEXT,
  latitude REAL,
  longitude REAL,

  -- Contact Information
  phone TEXT,
  email TEXT,

  -- Additional Information
  occupation TEXT,
  organization TEXT,
  notes TEXT,

  -- Cross-Reference
  is_shliach BOOLEAN DEFAULT false,
  shluchim_db_id INTEGER, -- If also in Shluchim database

  -- Metadata
  source TEXT DEFAULT 'tzachlist.com',
  source_url TEXT,
  last_updated TIMESTAMP,
  verified BOOLEAN,

  -- Search Optimization
  search_text TEXT, -- Full-text search: name + city + organization

  UNIQUE(first_name, last_name, city, state, country)
);

-- Indexes for fast searches
CREATE INDEX idx_tzach_name ON tzachlist_anash(last_name, first_name);
CREATE INDEX idx_tzach_location ON tzachlist_anash(city, state, country);
CREATE INDEX idx_tzach_country ON tzachlist_anash(country);

-- Full-text search
CREATE VIRTUAL TABLE tzachlist_fts USING fts5(
  full_name,
  city,
  state,
  country,
  occupation,
  organization,
  content=tzachlist_anash
);

-- Track updates
CREATE TABLE tzachlist_update_log (
  id INTEGER PRIMARY KEY,
  crawl_started_at TIMESTAMP,
  crawl_completed_at TIMESTAMP,
  records_updated INTEGER,
  records_added INTEGER,
  records_removed INTEGER,
  status TEXT, -- 'success', 'failed', 'partial'
  error_message TEXT
);
```

**Sample Record:**
```json
{
  "id": 1,
  "first_name": "David",
  "last_name": "Cohen",
  "title": "Mr.",
  "city": "Brooklyn",
  "state": "New York",
  "country": "United States",
  "address": "123 Eastern Parkway, Brooklyn, NY 11213",
  "latitude": 40.6694,
  "longitude": -73.9422,
  "phone": "+1-718-555-1234",
  "email": "david.cohen@example.com",
  "occupation": "Software Engineer",
  "organization": "Tech Company Inc.",
  "notes": "Community volunteer",
  "is_shliach": false,
  "shluchim_db_id": null,
  "source": "tzachlist.com",
  "source_url": "https://tzachlist.com/directory/cohen-david",
  "last_updated": "2026-03-04T12:00:00Z",
  "verified": true
}
```

#### 2. TzachList Crawler

**Crawler Implementation:**
```python
import requests
from bs4 import BeautifulSoup
import sqlite3
from datetime import datetime

class TzachListCrawler:
    def __init__(self, db_path):
        self.db_path = db_path
        self.base_url = "https://tzachlist.com"

    def crawl_directory(self):
        """
        Crawl TzachList directory for all Anash
        """
        # Navigate directory structure (alphabetical, by location, etc.)
        entries = self.scrape_all_entries()

        for entry in entries:
            self.save_entry(entry)

    def scrape_all_entries(self):
        """
        Scrape all directory entries
        """
        entries = []

        # Assuming alphabetical listing (adjust based on actual site structure)
        for letter in 'ABCDEFGHIJKLMNOPQRSTUVWXYZ':
            url = f"{self.base_url}/directory/{letter}"
            response = requests.get(url)
            soup = BeautifulSoup(response.content, 'html.parser')

            page_entries = self.parse_directory_page(soup)
            entries.extend(page_entries)

            # Rate limiting
            time.sleep(1)

        return entries

    def parse_directory_page(self, soup):
        """
        Parse individual directory page
        """
        entries = []

        # Adjust selectors based on actual HTML structure
        listings = soup.select('.directory-entry')

        for listing in listings:
            entry = {
                'first_name': self.extract_first_name(listing),
                'last_name': self.extract_last_name(listing),
                'title': self.extract_title(listing),
                'city': self.extract_city(listing),
                'state': self.extract_state(listing),
                'country': self.extract_country(listing),
                'address': self.extract_address(listing),
                'phone': self.extract_phone(listing),
                'email': self.extract_email(listing),
                'occupation': self.extract_occupation(listing),
                'organization': self.extract_organization(listing),
                'source': 'tzachlist.com',
                'source_url': self.extract_url(listing),
                'last_updated': datetime.now().isoformat()
            }

            # Geocode address
            if entry['address']:
                lat, lng = self.geocode_address(entry['address'])
                entry['latitude'] = lat
                entry['longitude'] = lng

            entries.append(entry)

        return entries

    def save_entry(self, entry):
        """
        Insert or update TzachList entry in database
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Check if exists
        cursor.execute('''
            SELECT id FROM tzachlist_anash
            WHERE first_name = ? AND last_name = ? AND city = ? AND country = ?
        ''', (entry['first_name'], entry['last_name'], entry['city'], entry['country']))

        existing = cursor.fetchone()

        if existing:
            # Update existing
            cursor.execute('''
                UPDATE tzachlist_anash
                SET phone = ?, email = ?, occupation = ?, organization = ?,
                    address = ?, latitude = ?, longitude = ?, last_updated = ?
                WHERE id = ?
            ''', (entry['phone'], entry['email'], entry['occupation'],
                  entry['organization'], entry['address'], entry.get('latitude'),
                  entry.get('longitude'), entry['last_updated'], existing[0]))
        else:
            # Insert new
            cursor.execute('''
                INSERT INTO tzachlist_anash (
                    first_name, last_name, title, city, state, country,
                    address, phone, email, occupation, organization,
                    latitude, longitude, source, source_url, last_updated
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                entry['first_name'], entry['last_name'], entry.get('title'),
                entry['city'], entry.get('state'), entry['country'],
                entry.get('address'), entry.get('phone'), entry.get('email'),
                entry.get('occupation'), entry.get('organization'),
                entry.get('latitude'), entry.get('longitude'),
                entry['source'], entry.get('source_url'), entry['last_updated']
            ))

        conn.commit()
        conn.close()

# Daemon entry point
if __name__ == '__main__':
    crawler = TzachListCrawler('/workspace/project/data/tzachlist.db')
    crawler.crawl_directory()
```

**Crawler Schedule:**
- **Full crawl:** Monthly (1st of each month at 2 AM)
- **Spot check:** Weekly (verify no major changes)
- **On-demand:** User can trigger manual refresh

**Systemd Timer:**
```ini
[Unit]
Description=TzachList Crawler Timer

[Timer]
OnCalendar=*-*-01 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

#### 3. Cross-Referencing with Shluchim Database

**Identify Overlap:**
```python
def cross_reference_with_shluchim():
    """
    Find people who appear in both TzachList and Shluchim database
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Find matches by name and location
    cursor.execute('''
        UPDATE tzachlist_anash
        SET is_shliach = true,
            shluchim_db_id = (
                SELECT s.id FROM shluchim s
                WHERE s.first_name = tzachlist_anash.first_name
                  AND s.last_name = tzachlist_anash.last_name
                  AND s.city = tzachlist_anash.city
                LIMIT 1
            )
        WHERE EXISTS (
            SELECT 1 FROM shluchim s
            WHERE s.first_name = tzachlist_anash.first_name
              AND s.last_name = tzachlist_anash.last_name
              AND s.city = tzachlist_anash.city
        )
    ''')

    conn.commit()
    conn.close()

def generate_cross_reference_report():
    """
    Report on overlap between TzachList and Shluchim DB
    """
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    # Count overlap
    cursor.execute('''
        SELECT COUNT(*) FROM tzachlist_anash WHERE is_shliach = true
    ''')
    overlap_count = cursor.fetchone()[0]

    # Total in each
    cursor.execute('SELECT COUNT(*) FROM tzachlist_anash')
    tzach_total = cursor.fetchone()[0]

    cursor.execute('SELECT COUNT(*) FROM shluchim')
    shluchim_total = cursor.fetchone()[0]

    report = f"""
# TzachList & Shluchim Cross-Reference Report

- Total in TzachList: {tzach_total}
- Total Shluchim: {shluchim_total}
- Overlap (in both): {overlap_count}
- Anash only (not Shluchim): {tzach_total - overlap_count}
- Shluchim not in TzachList: {shluchim_total - overlap_count}

Coverage: {overlap_count / shluchim_total * 100:.1f}% of Shluchim are in TzachList
"""

    return report
```

#### 4. Search API

**Query Types:**

```javascript
// Find by name
const results = await searchTzachList({
  name: "David Cohen"
});

// Find by location
const results = await searchTzachList({
  city: "Brooklyn",
  state: "New York"
});

// Full-text search
const results = await searchTzachList({
  query: "software engineer Brooklyn",
  fulltext: true
});

// Find Anash near a location
const results = await searchTzachList({
  near: {
    latitude: 40.7128,
    longitude: -74.0060,
    radius_km: 25
  }
});

// Search by occupation
const results = await searchTzachList({
  occupation: "doctor"
});
```

**Implementation:**
```javascript
async function searchTzachList(params) {
  const db = await openDatabase('/workspace/project/data/tzachlist.db');

  let query = 'SELECT * FROM tzachlist_anash WHERE 1=1';
  const bindings = [];

  if (params.name) {
    const nameParts = params.name.split(' ');
    if (nameParts.length >= 2) {
      query += ' AND first_name LIKE ? AND last_name LIKE ?';
      bindings.push(`%${nameParts[0]}%`, `%${nameParts[1]}%`);
    } else {
      query += ' AND (first_name LIKE ? OR last_name LIKE ?)';
      bindings.push(`%${params.name}%`, `%${params.name}%`);
    }
  }

  if (params.city) {
    query += ' AND city LIKE ?';
    bindings.push(`%${params.city}%`);
  }

  if (params.state) {
    query += ' AND state LIKE ?';
    bindings.push(`%${params.state}%`);
  }

  if (params.occupation) {
    query += ' AND occupation LIKE ?';
    bindings.push(`%${params.occupation}%`);
  }

  // Full-text search
  if (params.fulltext && params.query) {
    query = `
      SELECT t.* FROM tzachlist_anash t
      JOIN tzachlist_fts fts ON t.id = fts.rowid
      WHERE tzachlist_fts MATCH ?
      ORDER BY rank
    `;
    bindings.push(params.query);
  }

  // Geographic search
  if (params.near) {
    query = `
      SELECT *,
        (6371 * acos(cos(radians(?)) * cos(radians(latitude)) *
        cos(radians(longitude) - radians(?)) + sin(radians(?)) *
        sin(radians(latitude)))) AS distance_km
      FROM tzachlist_anash
      WHERE distance_km < ?
      ORDER BY distance_km
    `;
    bindings.push(
      params.near.latitude,
      params.near.longitude,
      params.near.latitude,
      params.near.radius_km || 25
    );
  }

  query += ' LIMIT 50';

  const results = await db.all(query, bindings);
  return results;
}
```

#### 5. Integration with Andy

**User Queries:**

**Example 1: Name Lookup**
```
User: "Find David Cohen in the TzachList"

Andy: "Found 3 David Cohens in TzachList:

1. *David Cohen* - Brooklyn, NY
   Software Engineer at Tech Company
   📞 +1-718-555-1234
   📧 david.cohen@example.com

2. *David Cohen* - Miami, FL
   Business Owner
   📞 +1-305-555-5678

3. *David Cohen* - Los Angeles, CA
   Community Volunteer
   📞 +1-310-555-9012

Which one are you looking for?"
```

**Example 2: Location Search**
```
User: "Who from TzachList lives in Crown Heights?"

Andy: "Found 87 Anash from TzachList in Crown Heights, Brooklyn:

*By Occupation:*
- Educators: 23
- Business: 31
- Healthcare: 12
- Community Service: 15
- Other: 6

Would you like:
1. Full directory export (CSV)
2. Filter by occupation
3. Show specific names"
```

**Example 3: Cross-Reference Check**
```
User: "Is Rabbi Goldstein in both Shluchim list and TzachList?"

Andy: "Yes, Rabbi Moshe Goldstein appears in both:

*Shluchim Database:*
Chabad of Denver, Colorado
Regional Director
📞 +1-303-555-1234

*TzachList:*
Denver, CO
Same contact info
✓ Verified match

The entries are linked in the database."
```

**Example 4: Network Discovery**
```
User: "Find software engineers in TzachList near me"

Andy: *[Uses your location from phone GPS]*

"Found 12 software engineers in TzachList within 25km:

1. *David Cohen* - Brooklyn (2.3 km)
   Senior Engineer at Tech Corp
   📞 +1-718-555-1234

2. *Mendy Levine* - Brooklyn (5.1 km)
   Startup Founder
   📞 +1-718-555-5678

3. *Sarah Goldstein* - Queens (18 km)
   Engineering Manager at BigTech
   📞 +1-917-555-9012

[... 9 more]

Would you like me to export the full list or introduce you to any of them?"
```

**Example 5: Contact Enrichment**
```
User: "Enrich my contacts with TzachList data"

Andy: "Checking your contacts against TzachList...

Found 34 matches:

*Enrichment available:*
- 12 contacts: Added occupation info
- 8 contacts: Added organization
- 19 contacts: Verified phone/email
- 5 contacts: Added address

*New potential connections:*
- 23 people in TzachList you don't have in contacts (same city/occupation)

Would you like to:
1. Apply enrichments to contacts
2. Review potential new connections
3. Export full match report"
```

#### 6. Export & Integration

**Export Formats:**
- CSV - Spreadsheet
- VCF - Phone contacts
- JSON - Programmatic access
- Direct Google Contacts import

**Contact Enrichment:**
```javascript
async function enrichContactsWithTzachList() {
  const contacts = await getUserContacts();
  const enrichments = [];

  for (const contact of contacts) {
    const match = await searchTzachList({
      name: contact.name,
      fuzzy: true
    });

    if (match && match.length === 1) {
      const tzachEntry = match[0];
      const enrichment = {
        contact_id: contact.id,
        enrichments: {}
      };

      // Add missing fields
      if (!contact.occupation && tzachEntry.occupation) {
        enrichment.enrichments.occupation = tzachEntry.occupation;
      }

      if (!contact.organization && tzachEntry.organization) {
        enrichment.enrichments.organization = tzachEntry.organization;
      }

      if (!contact.email && tzachEntry.email) {
        enrichment.enrichments.email = tzachEntry.email;
      }

      if (Object.keys(enrichment.enrichments).length > 0) {
        enrichments.push(enrichment);
      }
    }
  }

  return enrichments;
}
```

### Implementation Details

#### File Structure
```
/workspace/project/
├── data/
│   ├── tzachlist.db              # Main database
│   └── tzachlist_update_log.json # Crawler history
├── crawlers/
│   ├── tzachlist_crawler.py      # Main crawler
│   └── cross_reference.py        # Cross-ref with Shluchim DB
├── search/
│   └── tzachlist_search.js       # Search API
└── skills/
    └── tzachlist/                # Andy skill
        ├── search.js
        ├── enrich.js
        └── export.js
```

#### Database Location
- **Production:** `/workspace/project/data/tzachlist.db`
- **Accessible to:** All group containers (read-only)
- **Writable by:** Crawler daemon only
- **Size estimate:** ~20 MB for 10,000 Anash with full metadata

### Privacy & Data Considerations

**Public Data:**
- TzachList is a public directory
- No scraping of private information
- Only collect what's publicly listed

**Data Usage:**
- Local cache for faster access
- No redistribution externally
- Internal use for contact management and networking

**Updates:**
- Respect robots.txt and rate limits
- User-Agent identification
- Monthly updates (directory changes slowly)

## Alternatives Considered

### 1. Always Access TzachList On-Demand
- **Pros:** Always fresh, no storage
- **Cons:** Slow, fails offline
- **Rejected:** Too slow for conversational queries

### 2. Manual Directory
- **Pros:** Full control
- **Cons:** Massive manual effort, always outdated
- **Rejected:** Unsustainable

### 3. Spreadsheet Import Only
- **Pros:** Simple one-time import
- **Cons:** No updates, manual maintenance
- **Rejected:** Not automated

## Acceptance Criteria

### Database
- [ ] SQLite database with TzachList schema
- [ ] Full-text search index
- [ ] Geospatial index for location queries
- [ ] Update log tracking
- [ ] Handle 10,000+ Anash records

### Crawler
- [ ] Scrape TzachList directory
- [ ] Parse: name, location, contact info, occupation
- [ ] Geocode addresses
- [ ] Monthly automated crawl
- [ ] Deduplication logic
- [ ] Error handling and retry

### Cross-Reference
- [ ] Match with Shluchim database
- [ ] Flag overlap (is_shliach field)
- [ ] Generate cross-reference report
- [ ] Identify unique entries in each

### Search API
- [ ] Name search (first, last, fuzzy)
- [ ] Location search (city, state, country)
- [ ] Occupation search
- [ ] Geographic proximity search
- [ ] Full-text search
- [ ] Return results < 100ms

### Andy Integration
- [ ] Answer "Find [name] in TzachList"
- [ ] Answer "Who from TzachList lives in [city]?"
- [ ] Answer "Is [person] in both lists?"
- [ ] Contact enrichment from TzachList
- [ ] Export directory listings

### Data Quality
- [ ] Validate required fields
- [ ] Normalize phone numbers and addresses
- [ ] Handle duplicates
- [ ] Support manual corrections

## Technical Notes

### Relevant Files
- Database: `/workspace/project/data/tzachlist.db`
- Crawler: `/workspace/project/crawlers/tzachlist_crawler.py`
- Search: `/workspace/project/search/tzachlist_search.js`
- Andy skill: `/workspace/project/skills/tzachlist/`

### Dependencies
- Python: `requests`, `beautifulsoup4`, `sqlite3`, `geopy`
- Node.js: `better-sqlite3`
- Systemd timer for scheduling

### Performance
- **Database size:** ~20 MB for 10,000 Anash
- **Crawl time:** ~1-2 hours for full directory
- **Search latency:** < 100ms (local database)
- **Update frequency:** Monthly

## Use Cases Unlocked

### 1. Directory Lookup
**User:** "Find David Cohen in TzachList"
**Andy:** "[Instant results with contact details]"

### 2. Network Discovery
**User:** "Software engineers in Brooklyn from TzachList"
**Andy:** "[Lists 23 people with occupation: Software Engineer]"

### 3. Contact Enrichment
**User:** "Enrich my contacts with TzachList"
**Andy:** "[Adds occupation, organization data to 34 contacts]"

### 4. Cross-Reference
**User:** "Which Shluchim are also in TzachList?"
**Andy:** "[Reports 4,200 overlap out of 5,000 Shluchim]"

### 5. Location-Based Networking
**User:** "Anash near me"
**Andy:** "[Finds 47 people within 10km from TzachList]"

## Related

- Feature request: Shluchim List Local Cache (2026-03-04) - Complementary directory
- Feature request: Shluchim Knowledge Graph (2026-03-04) - Can include TzachList members
- Feature request: COL Live & Anash.org Monitoring (in Simcha/Levaya PRD) - Announcements source

---

## Notes

TzachList is a complementary directory to the Shluchim list, covering the broader Anash community. By maintaining a local cache, Andy can instantly answer queries about Anash members, enrich contact profiles, and enable community networking.

The key value: TzachList + Shluchim database together provide comprehensive coverage of the Chabad community worldwide. Cross-referencing reveals overlap and gaps, enabling better relationship management.

**User's clarification:** "TzachList is just a website with a static list of all Anash. Complementary to Shluchim List. No announcements there. Announcements will be on COLLive (aka COL) and Anash.org"

**Next steps:**
1. Research TzachList website structure
2. Build crawler for static directory
3. Set up monthly update schedule
4. Implement cross-reference with Shluchim DB
5. Create search API
6. Build contact enrichment feature
