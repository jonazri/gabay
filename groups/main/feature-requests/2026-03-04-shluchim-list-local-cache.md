# Feature Request: Shluchim List Local Cache & Search

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** high

## Problem

Users frequently need to find Shluchim (Chabad emissaries) by location, but currently:

1. **No local access** - Must visit Chabad.org or other websites manually
2. **Slow lookups** - Web scraping on-demand is slow (5-10 seconds per query)
3. **No offline access** - Can't search when internet is down or slow
4. **No integration with contacts** - Can't easily compare Shluchim list with existing contacts to identify gaps or duplicates
5. **Stale data** - No systematic way to keep Shluchim information up-to-date
6. **Limited search** - Can't do fuzzy search, "near me" queries, or advanced filtering

**Real-world impact:** When a user asks "Who is the Shliach in Miami Beach?" or "Do I have contact info for the Shliach in Paris?", Andy either has to scrape Chabad.org (slow) or say "I don't know" (unhelpful). This creates friction in common workflows like referrals, event coordination, and network building.

## Proposed Solution

Create a **Shluchim List Local Cache System** that:
1. **Maintains local database** of all Shluchim worldwide with contact information
2. **Periodic crawler daemon** that updates the list automatically (daily/weekly)
3. **Fast search API** for location-based and name-based queries
4. **Contact comparison** - Match Shluchim list against user's contacts to find gaps
5. **Rich metadata** - Location, organization, contact details, specialties
6. **Always available** - Works offline, instant responses

### Core Capabilities

#### 1. Local Shluchim Database

**Data Schema:**
```sql
CREATE TABLE shluchim (
  id INTEGER PRIMARY KEY,
  first_name TEXT,
  last_name TEXT,
  title TEXT, -- "Rabbi", "Rebbetzin", etc.

  -- Location
  city TEXT,
  state TEXT,
  country TEXT,
  region TEXT, -- "North America", "Europe", etc.
  latitude REAL,
  longitude REAL,
  address TEXT,

  -- Organization
  organization_name TEXT, -- "Chabad of Miami Beach"
  organization_type TEXT, -- "Chabad House", "Chabad on Campus", "Merkos Shliach"
  website TEXT,

  -- Contact Information
  email TEXT,
  phone TEXT,
  whatsapp TEXT,

  -- Metadata
  year_appointed INTEGER,
  specialties JSON, -- ["Campus Outreach", "Young Professionals", "Russian Community"]
  languages JSON, -- ["English", "Hebrew", "Russian"]

  -- Data Source
  source TEXT, -- "chabad.org", "manual", "imported"
  source_url TEXT,
  last_updated TIMESTAMP,
  verified BOOLEAN,

  -- Search Optimization
  search_text TEXT, -- Full-text search field: name + city + organization

  UNIQUE(first_name, last_name, city, state, country)
);

-- Index for fast location searches
CREATE INDEX idx_location ON shluchim(city, state, country);
CREATE INDEX idx_country ON shluchim(country);
CREATE INDEX idx_organization ON shluchim(organization_name);

-- Full-text search index
CREATE VIRTUAL TABLE shluchim_fts USING fts5(
  full_name,
  city,
  state,
  country,
  organization_name,
  content=shluchim
);

-- Geospatial index for "near me" queries
CREATE INDEX idx_geo ON shluchim(latitude, longitude);

-- Track updates
CREATE TABLE shluchim_update_log (
  id INTEGER PRIMARY KEY,
  crawl_started_at TIMESTAMP,
  crawl_completed_at TIMESTAMP,
  records_updated INTEGER,
  records_added INTEGER,
  records_removed INTEGER,
  source TEXT,
  status TEXT, -- 'success', 'failed', 'partial'
  error_message TEXT
);
```

**Sample Record:**
```json
{
  "id": 1234,
  "first_name": "Mendy",
  "last_name": "Kotlarsky",
  "title": "Rabbi",
  "city": "Miami Beach",
  "state": "Florida",
  "country": "United States",
  "region": "North America",
  "latitude": 25.7907,
  "longitude": -80.1300,
  "address": "1234 Collins Ave, Miami Beach, FL 33139",
  "organization_name": "Chabad of Miami Beach",
  "organization_type": "Chabad House",
  "website": "https://chabadmiamibeach.com",
  "email": "rabbi@chabadmiamibeach.com",
  "phone": "+1-305-555-1234",
  "whatsapp": "+1-305-555-1234",
  "year_appointed": 2005,
  "specialties": ["Young Professionals", "Beach Community"],
  "languages": ["English", "Hebrew", "Yiddish"],
  "source": "chabad.org",
  "source_url": "https://www.chabad.org/centers/default_cdo/country/USA/state/Florida/city/Miami-Beach",
  "last_updated": "2026-03-04T12:00:00Z",
  "verified": true
}
```

#### 2. Periodic Crawler Daemon

**Crawler Service:**
- Runs as background daemon (systemd service or cron job)
- Scrapes Chabad.org Shluchim directory
- Updates local database with new/changed information
- Deduplicates and merges records
- Logs all changes for audit trail

**Data Sources:**
1. **Chabad.org Directory** (primary)
   - https://www.chabad.org/centers/
   - Country → State/Province → City hierarchy
   - Contains: Name, location, contact info, website

2. **COL Live Directory** (secondary)
   - Crown Heights community directory
   - Additional contact details

3. **Manual entries** (tertiary)
   - User-submitted additions/corrections
   - Import from spreadsheets

**Crawl Schedule:**
- **Full crawl:** Weekly (Sunday 2 AM)
- **Incremental crawl:** Daily (check recently updated Shluchim)
- **On-demand:** User can trigger manual refresh

**Crawler Implementation:**
```python
import requests
from bs4 import BeautifulSoup
import sqlite3
from datetime import datetime

class ShluchimCrawler:
    def __init__(self, db_path):
        self.db_path = db_path
        self.base_url = "https://www.chabad.org/centers/"

    def crawl_all_countries(self):
        """
        Crawl all countries in Chabad.org directory
        """
        countries_url = f"{self.base_url}default_cdo/jewish/centers.htm"
        response = requests.get(countries_url)
        soup = BeautifulSoup(response.content, 'html.parser')

        countries = self.parse_countries(soup)

        for country in countries:
            self.crawl_country(country)

    def crawl_country(self, country_code):
        """
        Crawl all states/cities in a country
        """
        url = f"{self.base_url}default_cdo/country/{country_code}"
        response = requests.get(url)
        soup = BeautifulSoup(response.content, 'html.parser')

        # Parse states/provinces
        states = self.parse_states(soup)

        for state in states:
            self.crawl_state(country_code, state)

    def crawl_state(self, country_code, state_code):
        """
        Crawl all cities in a state
        """
        url = f"{self.base_url}default_cdo/country/{country_code}/state/{state_code}"
        response = requests.get(url)
        soup = BeautifulSoup(response.content, 'html.parser')

        # Parse cities
        cities = self.parse_cities(soup)

        for city in cities:
            self.crawl_city(country_code, state_code, city)

    def crawl_city(self, country, state, city):
        """
        Crawl all Shluchim in a city
        """
        url = f"{self.base_url}default_cdo/country/{country}/state/{state}/city/{city}"
        response = requests.get(url)
        soup = BeautifulSoup(response.content, 'html.parser')

        # Parse Shluchim listings
        shluchim = self.parse_shluchim_listings(soup, country, state, city)

        for shliach in shluchim:
            self.save_shliach(shliach)

    def parse_shluchim_listings(self, soup, country, state, city):
        """
        Extract Shluchim information from HTML
        """
        shluchim = []

        # Find all Chabad house listings
        listings = soup.select('.chabad-center-listing')

        for listing in listings:
            shliach = {
                'first_name': self.extract_first_name(listing),
                'last_name': self.extract_last_name(listing),
                'title': self.extract_title(listing),
                'city': city,
                'state': state,
                'country': country,
                'organization_name': self.extract_org_name(listing),
                'address': self.extract_address(listing),
                'phone': self.extract_phone(listing),
                'email': self.extract_email(listing),
                'website': self.extract_website(listing),
                'source': 'chabad.org',
                'source_url': listing.select_one('a')['href'],
                'last_updated': datetime.now().isoformat()
            }

            # Geocode address to get lat/lng
            lat, lng = self.geocode_address(shliach['address'])
            shliach['latitude'] = lat
            shliach['longitude'] = lng

            shluchim.append(shliach)

        return shluchim

    def save_shliach(self, shliach):
        """
        Insert or update Shliach in database
        """
        conn = sqlite3.connect(self.db_path)
        cursor = conn.cursor()

        # Check if exists
        cursor.execute('''
            SELECT id FROM shluchim
            WHERE first_name = ? AND last_name = ? AND city = ? AND country = ?
        ''', (shliach['first_name'], shliach['last_name'], shliach['city'], shliach['country']))

        existing = cursor.fetchone()

        if existing:
            # Update existing record
            cursor.execute('''
                UPDATE shluchim
                SET phone = ?, email = ?, website = ?, address = ?,
                    organization_name = ?, last_updated = ?
                WHERE id = ?
            ''', (shliach['phone'], shliach['email'], shliach['website'],
                  shliach['address'], shliach['organization_name'],
                  shliach['last_updated'], existing[0]))
        else:
            # Insert new record
            cursor.execute('''
                INSERT INTO shluchim (first_name, last_name, title, city, state, country,
                                      organization_name, address, phone, email, website,
                                      latitude, longitude, source, source_url, last_updated)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ''', (shliach['first_name'], shliach['last_name'], shliach['title'],
                  shliach['city'], shliach['state'], shliach['country'],
                  shliach['organization_name'], shliach['address'],
                  shliach['phone'], shliach['email'], shliach['website'],
                  shliach['latitude'], shliach['longitude'],
                  shliach['source'], shliach['source_url'], shliach['last_updated']))

        conn.commit()
        conn.close()

    def geocode_address(self, address):
        """
        Convert address to lat/lng using geocoding API
        """
        # Use Google Geocoding API, Nominatim, or similar
        # For now, placeholder
        return (0.0, 0.0)

# Daemon entry point
if __name__ == '__main__':
    crawler = ShluchimCrawler('/workspace/project/data/shluchim.db')
    crawler.crawl_all_countries()
```

**Daemon Configuration (systemd):**
```ini
[Unit]
Description=Shluchim List Crawler Daemon
After=network.target

[Service]
Type=simple
User=node
WorkingDirectory=/workspace/project
ExecStart=/usr/bin/python3 /workspace/project/crawlers/shluchim_crawler.py
Restart=on-failure
RestartSec=3600

[Install]
WantedBy=multi-user.target
```

**Cron Schedule (Alternative):**
```cron
# Full crawl every Sunday at 2 AM
0 2 * * 0 /usr/bin/python3 /workspace/project/crawlers/shluchim_crawler.py --full

# Incremental crawl daily at 3 AM
0 3 * * * /usr/bin/python3 /workspace/project/crawlers/shluchim_crawler.py --incremental
```

#### 3. Search API

**Query Types:**

**1. Location Search:**
```javascript
// Find Shliach in specific city
const results = await searchShluchim({
  city: "Miami Beach",
  state: "Florida",
  country: "United States"
});

// Find all Shluchim in a state
const results = await searchShluchim({
  state: "California",
  country: "United States"
});

// Find all Shluchim in a country
const results = await searchShluchim({
  country: "France"
});
```

**2. Name Search:**
```javascript
// Find Shliach by name
const results = await searchShluchim({
  name: "Mendy Kotlarsky"
});

// Fuzzy name search
const results = await searchShluchim({
  name: "Kotlarski", // Finds "Kotlarsky"
  fuzzy: true
});
```

**3. Organization Search:**
```javascript
// Find by organization name
const results = await searchShluchim({
  organization: "Chabad on Campus"
});
```

**4. Geographic Proximity Search:**
```javascript
// Find Shluchim near a location
const results = await searchShluchim({
  near: {
    latitude: 40.7128,
    longitude: -74.0060,
    radius_km: 50 // Within 50km
  }
});

// Find nearest Shliach
const results = await searchShluchim({
  near: {
    latitude: 40.7128,
    longitude: -74.0060,
    limit: 1 // Closest one
  }
});
```

**5. Full-Text Search:**
```javascript
// Search across all fields
const results = await searchShluchim({
  query: "Miami Beach Young Professionals",
  fulltext: true
});
```

**Search Implementation:**
```javascript
async function searchShluchim(params) {
  const db = await openDatabase('/workspace/project/data/shluchim.db');

  let query = 'SELECT * FROM shluchim WHERE 1=1';
  const bindings = [];

  // Location filters
  if (params.city) {
    query += ' AND city LIKE ?';
    bindings.push(`%${params.city}%`);
  }

  if (params.state) {
    query += ' AND state LIKE ?';
    bindings.push(`%${params.state}%`);
  }

  if (params.country) {
    query += ' AND country LIKE ?';
    bindings.push(`%${params.country}%`);
  }

  // Name search
  if (params.name) {
    const nameParts = params.name.split(' ');
    if (nameParts.length === 2) {
      query += ' AND (first_name LIKE ? OR last_name LIKE ?)';
      bindings.push(`%${nameParts[0]}%`, `%${nameParts[1]}%`);
    } else {
      query += ' AND (first_name LIKE ? OR last_name LIKE ?)';
      bindings.push(`%${params.name}%`, `%${params.name}%`);
    }
  }

  // Geographic proximity
  if (params.near) {
    // Haversine formula for distance calculation
    query = `
      SELECT *,
        (6371 * acos(cos(radians(?)) * cos(radians(latitude)) *
        cos(radians(longitude) - radians(?)) + sin(radians(?)) *
        sin(radians(latitude)))) AS distance_km
      FROM shluchim
      WHERE distance_km < ?
      ORDER BY distance_km
    `;
    bindings.push(
      params.near.latitude,
      params.near.longitude,
      params.near.latitude,
      params.near.radius_km || 50
    );

    if (params.near.limit) {
      query += ` LIMIT ${params.near.limit}`;
    }
  }

  // Full-text search
  if (params.fulltext && params.query) {
    query = `
      SELECT s.* FROM shluchim s
      JOIN shluchim_fts fts ON s.id = fts.rowid
      WHERE shluchim_fts MATCH ?
      ORDER BY rank
    `;
    bindings.push(params.query);
  }

  const results = await db.all(query, bindings);
  return results;
}
```

**Natural Language Query Processing:**
```javascript
async function naturalLanguageSearch(userQuery) {
  // Parse natural language queries like:
  // "Who is the Shliach in Paris?"
  // "Find me Shluchim in California"
  // "Chabad on campus near Columbia University"

  const parsed = parseQuery(userQuery);

  if (parsed.city || parsed.state || parsed.country) {
    return await searchShluchim({
      city: parsed.city,
      state: parsed.state,
      country: parsed.country
    });
  }

  if (parsed.organization) {
    return await searchShluchim({
      organization: parsed.organization
    });
  }

  if (parsed.location_coords) {
    return await searchShluchim({
      near: {
        latitude: parsed.location_coords.lat,
        longitude: parsed.location_coords.lng,
        radius_km: 50
      }
    });
  }

  // Fallback to full-text search
  return await searchShluchim({
    query: userQuery,
    fulltext: true
  });
}
```

#### 4. Contact Comparison & Gap Analysis

**Compare Shluchim List vs. User Contacts:**

```javascript
async function compareShluchimWithContacts() {
  const shluchim = await getAllShluchim();
  const contacts = await getUserContacts(); // From phone, CRM, etc.

  const comparison = {
    matched: [],      // Shluchim already in contacts
    missing: [],      // Shluchim NOT in contacts (gaps)
    extra: [],        // Contacts that are Shluchim but not in official list
    duplicates: []    // Multiple contacts for same Shliach
  };

  for (const shliach of shluchim) {
    const match = findContactMatch(shliach, contacts);

    if (match) {
      comparison.matched.push({
        shliach,
        contact: match,
        match_confidence: calculateMatchConfidence(shliach, match)
      });
    } else {
      comparison.missing.push(shliach);
    }
  }

  return comparison;
}

function findContactMatch(shliach, contacts) {
  // Fuzzy match by name
  for (const contact of contacts) {
    const nameMatch = fuzzyMatch(
      `${shliach.first_name} ${shliach.last_name}`,
      contact.name
    );

    if (nameMatch > 0.8) {
      return contact;
    }

    // Match by phone
    if (shliach.phone && contact.phone) {
      if (normalizePhone(shliach.phone) === normalizePhone(contact.phone)) {
        return contact;
      }
    }

    // Match by email
    if (shliach.email && contact.email) {
      if (shliach.email.toLowerCase() === contact.email.toLowerCase()) {
        return contact;
      }
    }
  }

  return null;
}

async function generateGapReport() {
  const comparison = await compareShluchimWithContacts();

  const report = `
# Shluchim Network Gap Analysis

## Summary
- Total Shluchim: ${comparison.matched.length + comparison.missing.length}
- In your contacts: ${comparison.matched.length}
- Missing from contacts: ${comparison.missing.length}
- Coverage: ${(comparison.matched.length / (comparison.matched.length + comparison.missing.length) * 100).toFixed(1)}%

## Missing Shluchim (Top 20 by relevance)

${comparison.missing.slice(0, 20).map(s => `
- **${s.title} ${s.first_name} ${s.last_name}**
  ${s.organization_name}
  ${s.city}, ${s.state}, ${s.country}
  📞 ${s.phone || 'N/A'}
  📧 ${s.email || 'N/A'}
`).join('\n')}

## Suggestions
1. Import missing Shluchim to contacts? (Bulk import available)
2. Focus on [region] - ${comparison.missing.filter(s => s.region === 'North America').length} Shluchim missing
3. Prioritize campus Shluchim - ${comparison.missing.filter(s => s.organization_type === 'Chabad on Campus').length} missing
`;

  return report;
}
```

**Bulk Import Missing Shluchim:**
```javascript
async function importShluchimToContacts(shluchim_ids) {
  // Import selected Shluchim to Google Contacts, phone contacts, or CRM
  for (const id of shluchim_ids) {
    const shliach = await getShliach(id);

    // Create contact in Google Contacts
    await googleContacts.createContact({
      name: `${shliach.title} ${shliach.first_name} ${shliach.last_name}`,
      phone: shliach.phone,
      email: shliach.email,
      organization: shliach.organization_name,
      address: shliach.address,
      website: shliach.website,
      notes: `Shliach in ${shliach.city}, ${shliach.country}. Added from Shluchim directory on ${new Date().toISOString()}`
    });
  }
}
```

#### 5. Integration with Andy (Conversational Interface)

**User queries Andy can answer instantly:**

**Example 1: Location Query**
```
User: "Who is the Shliach in Paris?"

Andy: "There are 3 Shluchim in Paris, France:

1. *Rabbi Mendy Azimov*
   Chabad Loubavitch de France
   📍 17 Rue Pavée, 75004 Paris
   📞 +33 1 48 87 20 84
   🌐 loubavitch.fr

2. *Rabbi Yonathan Amram*
   Chabad of the Marais
   📍 25 Rue des Rosiers, 75004 Paris
   📞 +33 1 42 74 20 84
   🌐 chabadmarais.com

3. *Rabbi Moshe Lewin*
   Chabad of the 8th Arrondissement
   📍 8 Rue Copernic, 75116 Paris
   📞 +33 1 47 63 00 10

Would you like contact info for any of them?"
```

**Example 2: Nearest Shliach**
```
User: "Find the nearest Shliach to me"

Andy: *[Checks user's location from phone GPS or IP]*

"The nearest Shliach is *Rabbi David Cohen* at Chabad of Midtown Manhattan, just 2.3 km from your location.

📍 1245 Lexington Ave, New York, NY 10028
📞 +1-212-555-1234
💬 WhatsApp: +1-212-555-1234
🌐 chabadmidtown.com

Would you like directions or should I send him a message?"
```

**Example 3: Contact Gap Analysis**
```
User: "Do I know all the Shluchim in New York?"

Andy: "Let me check your contacts against the Shluchim list...

You have 37 out of 89 Shluchim in New York state in your contacts (42% coverage).

*Missing from your contacts:*
- 15 Chabad on Campus Shluchim
- 22 community Shluchim in upstate NY
- 15 Shluchim in Brooklyn/Queens

Would you like me to generate a full gap report or import the missing contacts?"
```

**Example 4: Referral**
```
User: "My friend is moving to Austin, Texas. Can you connect him with the local Shliach?"

Andy: "The Shliach in Austin is *Rabbi Yosef Levertov* at Chabad of the University of Texas.

📞 +1-512-555-1234
📧 rabbi@chabadut.com

Would you like me to:
1. Send him an introduction via WhatsApp
2. Email an introduction
3. Just share the contact info with your friend"
```

**Example 5: Network Building**
```
User: "I'm organizing a regional Shluchim event. Get me contact info for all Shluchim in Florida"

Andy: "Found 47 Shluchim in Florida. Generating contact list...

*[Creates CSV/VCF file with all Florida Shluchim]*

📊 Florida Shluchim:
- Miami-Dade: 12 Shluchim
- Broward: 8 Shluchim
- Palm Beach: 6 Shluchim
- Orlando: 4 Shluchim
- Tampa Bay: 5 Shluchim
- Other cities: 12 Shluchim

Download: [florida_shluchim_contacts.csv]

Would you like me to draft an event invitation email?"
```

#### 6. Export & Sharing

**Export Formats:**
- **CSV** - Spreadsheet for bulk import
- **VCF (vCard)** - Import to phone contacts
- **JSON** - Programmatic access
- **Google Contacts** - Direct import
- **Markdown** - Human-readable reports

**Example CSV Export:**
```csv
First Name,Last Name,Title,Organization,City,State,Country,Phone,Email,Website,Address
Mendy,Kotlarsky,Rabbi,Chabad of Miami Beach,Miami Beach,Florida,United States,+1-305-555-1234,rabbi@chabadmiamibeach.com,https://chabadmiamibeach.com,"1234 Collins Ave, Miami Beach, FL 33139"
```

**Example VCF Export:**
```vcard
BEGIN:VCARD
VERSION:3.0
FN:Rabbi Mendy Kotlarsky
N:Kotlarsky;Mendy;;Rabbi;
ORG:Chabad of Miami Beach
TEL;TYPE=CELL:+1-305-555-1234
EMAIL:rabbi@chabadmiamibeach.com
URL:https://chabadmiamibeach.com
ADR;TYPE=WORK:;;1234 Collins Ave;Miami Beach;FL;33139;United States
NOTE:Shliach in Miami Beach\, Florida. Specialties: Young Professionals\, Beach Community
END:VCARD
```

### Implementation Details

#### File Structure
```
/workspace/project/
├── data/
│   ├── shluchim.db                 # Main database
│   └── shluchim_update_log.json    # Crawler run history
├── crawlers/
│   ├── shluchim_crawler.py         # Main crawler
│   ├── parsers/
│   │   ├── chabad_org.py           # Chabad.org parser
│   │   └── col_live.py             # COL Live parser
│   └── geocoder.py                 # Address → lat/lng
├── search/
│   ├── shluchim_search.js          # Search API
│   └── natural_language.js         # NL query parser
└── skills/
    └── shluchim/                   # Andy skill for Shluchim queries
        ├── search.js
        ├── compare.js
        └── export.js
```

#### Database Location
- **Production:** `/workspace/project/data/shluchim.db`
- **Accessible to:** All group containers (read-only)
- **Writable by:** Crawler daemon only
- **Size estimate:** ~10 MB for 5,000 Shluchim with full metadata

#### Crawler Daemon

**Systemd Service:**
```ini
[Unit]
Description=Shluchim List Crawler
After=network.target

[Service]
Type=oneshot
User=node
WorkingDirectory=/workspace/project
ExecStart=/usr/bin/python3 /workspace/project/crawlers/shluchim_crawler.py --full
StandardOutput=append:/var/log/shluchim_crawler.log
StandardError=append:/var/log/shluchim_crawler_error.log

[Install]
WantedBy=multi-user.target
```

**Systemd Timer (Weekly):**
```ini
[Unit]
Description=Shluchim Crawler Timer

[Timer]
OnCalendar=Sun *-*-* 02:00:00
Persistent=true

[Install]
WantedBy=timers.target
```

**Monitoring:**
- Log all crawl runs to `shluchim_update_log` table
- Alert if crawl fails 3 times in a row
- Track records added/updated/removed per run
- Validate data quality (no NULL emails for recent Shluchim, etc.)

#### API Design

**REST API (optional, for external access):**
```
GET  /api/shluchim/search?city=Paris&country=France
GET  /api/shluchim/nearby?lat=40.7128&lng=-74.0060&radius=50
GET  /api/shluchim/:id
POST /api/shluchim/compare-contacts
POST /api/shluchim/export?format=csv&region=Florida
```

**Direct Function Calls (for Andy):**
```javascript
const { searchShluchim, compareShluchim, exportShluchim } = require('./search/shluchim_search');

// Used in Andy's conversation flow
const results = await searchShluchim({ city: "Paris" });
```

### Privacy & Data Considerations

**Public Data:**
- Shluchim information on Chabad.org is publicly available
- No scraping of private or restricted directories
- Only collect what's already published

**Data Usage:**
- Local cache for faster access
- No redistribution of data externally
- Used only for internal queries and contact management

**Updates:**
- Respect Chabad.org robots.txt and rate limits
- Add delays between requests (1-2 seconds)
- User-Agent identification
- Contact Chabad.org if crawling causes issues

**Corrections:**
- Allow manual corrections for inaccurate data
- Flag unverified entries
- Provide feedback mechanism to Chabad.org for corrections

### Error Handling

**Crawler Failures:**
- Retry with exponential backoff
- Continue crawling other regions if one fails
- Log detailed error messages
- Email alert if full crawl fails

**Data Quality:**
- Validate required fields (name, city, country)
- Detect duplicates (same person, multiple entries)
- Handle encoding issues (Hebrew characters, special chars)
- Normalize phone numbers, addresses

**Search Failures:**
- Fallback to simpler queries if complex search fails
- Suggest corrections for typos ("Did you mean Paris?")
- Handle empty results gracefully

## Alternatives Considered

### 1. Always Scrape Chabad.org On-Demand
- **Pros:** Always fresh data, no storage needed
- **Cons:** Slow (5-10 sec per query), fails offline, rate limit risk
- **Rejected:** Too slow for conversational interface

### 2. Use Chabad.org API (if available)
- **Pros:** Official, reliable, real-time
- **Cons:** No public API exists
- **Rejected:** Not available

### 3. Manual Contact List
- **Pros:** Full control, custom fields
- **Cons:** Massive manual effort, always outdated
- **Rejected:** Doesn't scale, unsustainable

### 4. Google Sheets + Zapier
- **Pros:** Easy to update manually
- **Cons:** No auto-updates, limited search, no geolocation
- **Rejected:** Not automated enough

### 5. Third-Party CRM Integration Only
- **Pros:** Leverage existing CRM
- **Cons:** CRM may not have all Shluchim, requires manual entry
- **Rejected:** Complements but doesn't replace local cache

## Acceptance Criteria

### Database
- [ ] SQLite database with Shluchim schema
- [ ] Full-text search index
- [ ] Geospatial index for location queries
- [ ] Update log table for tracking crawls
- [ ] Handle 5,000+ Shluchim records efficiently

### Crawler
- [ ] Scrape Chabad.org directory (all countries)
- [ ] Parse: name, location, contact info, organization
- [ ] Geocode addresses to lat/lng
- [ ] Deduplicate records
- [ ] Weekly automated crawl (systemd timer or cron)
- [ ] Daily incremental updates
- [ ] Log all crawl runs with statistics
- [ ] Error handling and retry logic
- [ ] Respect rate limits (1-2 sec delays)

### Search API
- [ ] Location search (city, state, country)
- [ ] Name search (first, last, fuzzy)
- [ ] Organization search
- [ ] Geographic proximity search (nearest, within radius)
- [ ] Full-text search across all fields
- [ ] Natural language query parsing
- [ ] Return results in < 100ms (local DB)

### Contact Comparison
- [ ] Compare Shluchim list vs. user contacts
- [ ] Identify matches (name, phone, email)
- [ ] Identify gaps (Shluchim not in contacts)
- [ ] Generate gap analysis report
- [ ] Bulk import missing Shluchim to contacts
- [ ] Export to CSV, VCF, JSON

### Andy Integration
- [ ] Answer "Who is the Shliach in [city]?"
- [ ] Answer "Find nearest Shliach"
- [ ] Answer "Do I have contact for Shliach in [city]?"
- [ ] Generate contact lists by region
- [ ] Export Shluchim contacts in various formats
- [ ] Referral workflow (introduce friend to Shliach)

### Data Quality
- [ ] Validate required fields
- [ ] Normalize phone numbers
- [ ] Handle duplicate detection
- [ ] Support manual corrections
- [ ] Flag unverified entries

### Monitoring & Maintenance
- [ ] Log crawler runs and errors
- [ ] Alert on crawler failures
- [ ] Track database size and growth
- [ ] Monitor search query performance
- [ ] Weekly data quality report

## Technical Notes

### Relevant Files
- Database: `/workspace/project/data/shluchim.db`
- Crawler: `/workspace/project/crawlers/shluchim_crawler.py`
- Search API: `/workspace/project/search/shluchim_search.js`
- Andy skill: `/workspace/project/skills/shluchim/`
- Logs: `/var/log/shluchim_crawler.log`

### Dependencies
- Python: `requests`, `beautifulsoup4`, `sqlite3`, `geopy` (geocoding)
- Node.js: `better-sqlite3`, `fuse.js` (fuzzy search)
- Systemd (for daemon scheduling)

### Performance Considerations
- **Database size:** ~10 MB for 5,000 Shluchim
- **Crawl time:** ~2-3 hours for full worldwide crawl (with rate limiting)
- **Search latency:** < 100ms for most queries (local SQLite)
- **Incremental updates:** ~10 minutes daily

### Maintenance
- **Weekly full crawl:** Keeps data fresh
- **Daily incremental:** Catches new Shluchim
- **Manual corrections:** Override crawled data when needed
- **Database backups:** Daily backup of shluchim.db

## Use Cases Unlocked

### 1. Instant Location Lookup
**User:** "Who is the Shliach in Berlin?"
**Andy:** "[Instant response with contact details from local DB]"

### 2. Referral Network
**User:** "My colleague is moving to Denver. Connect him with the local Shliach."
**Andy:** "[Finds Shliach, offers to send introduction]"

### 3. Event Planning
**User:** "I'm hosting a regional event. Get me all Shluchim in the Southwest US."
**Andy:** "[Exports 87 Shluchim contacts in CSV]"

### 4. Network Gap Analysis
**User:** "Which Shluchim am I missing from my contacts?"
**Andy:** "[Generates report: 143 Shluchim missing, offers bulk import]"

### 5. Traveling
**User:** "I'm traveling to Tokyo next week. Who should I visit?"
**Andy:** "[Finds 2 Shluchim in Tokyo, shares contact info and directions]"

### 6. Research
**User:** "How many Chabad on Campus Shluchim are there in California?"
**Andy:** "[Queries DB: 12 campus Shluchim, lists them]"

## Related

- Feature request: Google Alerts Monitoring (2026-03-04) - Could track Shluchim news
- Feature request: Simcha & Levaya Monitoring (2026-03-04) - Cross-reference with Shluchim list
- Feature request: Attio CRM Integration (2026-03-04) - Import Shluchim to CRM

---

## Notes

This feature transforms "Who is the Shliach in [city]?" from a 10-second web search into an instant answer. The local cache enables offline access, fast searches, and powerful contact comparison features that aren't possible with on-demand scraping.

The key insight: Shluchim data changes infrequently (new Shluchim appointed weekly/monthly, not daily), so a weekly crawl + daily incremental updates provides 99% accuracy while enabling instant access.

**User's exact request:** "Add a PRD for keeping a local copy of the Shluchen list on the server accessible to the agent for searches. The Shluchen list also needs a daemon that can run a crawl job to update the list on a periodic basis. And that Shluchen list should be available context so that when the agent needs to know or when the user needs to know who is the Shliach in such and such location, we have a quick and easy answer and also for comparing with our existing contacts."

**Next steps:**
1. Build initial crawler for Chabad.org
2. Design database schema and create tables
3. Implement search API with geospatial queries
4. Set up systemd timer for weekly crawls
5. Create Andy skill for conversational queries
6. Build contact comparison feature
