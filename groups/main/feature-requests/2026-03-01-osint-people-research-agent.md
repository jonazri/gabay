# Feature Request: Ethical OSINT People Research Agent

**Date:** 2026-03-01
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** important

## Problem

Comprehensive people research currently requires:
- Manual searches across dozens of platforms
- Hours of work per subject
- No standardized methodology
- Inconsistent verification
- Legal/ethical compliance uncertainty
- Risk of privacy violations
- Scattered, unstructured results

**User Impact:**
- Due diligence takes 4-8 hours per person
- Background checks are expensive ($50-200 per subject)
- Investigative work is manual and error-prone
- No audit trail for compliance
- Cannot scale research across multiple subjects
- Ethical boundaries unclear

**Use Cases:**
- Business: Partnership due diligence, hiring background checks
- Legal: Witness/expert verification, litigation support
- Personal: Dating safety, roommate screening
- Nonprofit: Donor verification, board member vetting

## Proposed Solution

### Core Capability
Build an AI-powered OSINT agent with a state-of-the-art research protocol, integrated tools, and strict ethical/legal guardrails that generates comprehensive, verified profiles from public sources only.

### Agent Architecture

```
User Input (Name + Known Info)
    ↓
Ethical Compliance Check
    ↓
Multi-Source OSINT Pipeline
    ↓
AI-Powered Verification & Synthesis
    ↓
Structured Profile Output
    ↓
Audit Log (Compliance)
```

### Input Format

```typescript
interface OSINTRequest {
  // Required
  subject: {
    name: string;                    // Full name
    purpose: string;                 // Why researching (required for ethics)
  };

  // Optional (improves accuracy)
  knownInfo?: {
    location?: string;               // City, state
    age?: number | { min: number; max: number };
    employer?: string;
    education?: string;
    email?: string;
    phone?: string;
    socialMedia?: string[];          // Known usernames
  };

  // Scope control
  scope?: {
    includeAddresses?: boolean;      // Default: true
    includeCriminalRecords?: boolean; // Default: false (requires explicit consent)
    includeCourtRecords?: boolean;    // Default: false
    includeSocialMedia?: boolean;     // Default: true
    includeBusinessRecords?: boolean; // Default: true
    maxDepth?: 'basic' | 'standard' | 'comprehensive'; // Default: standard
  };
}
```

### Output Format

```typescript
interface OSINTProfile {
  subject: {
    name: string;
    aliases: string[];               // Known variations
    confidence: number;              // 0-100 identity match confidence
  };

  contactInfo: {
    emails: Array<{ address: string; source: string; verified: boolean }>;
    phones: Array<{ number: string; type: string; source: string }>;
    addresses: Array<{
      street: string;
      city: string;
      state: string;
      zip: string;
      current: boolean;
      dateRange: string;
      source: string;
    }>;
  };

  demographics: {
    age?: number | { min: number; max: number };
    gender?: string;
    maritalStatus?: string;
    education?: Array<{
      institution: string;
      degree?: string;
      year?: number;
      source: string;
    }>;
  };

  professionalInfo: {
    currentEmployer?: string;
    title?: string;
    workHistory?: Array<{
      company: string;
      title?: string;
      dates?: string;
      source: string;
    }>;
    linkedinProfile?: string;
  };

  businessOwnership?: Array<{
    entityName: string;
    type: string;                    // LLC, Corp, etc.
    role: string;                    // Owner, Officer, etc.
    state: string;
    status: string;                  // Active, Dissolved
    source: string;
  }>;

  propertyOwnership?: Array<{
    address: string;
    type: string;                    // Residential, Commercial
    value?: number;
    ownership: string;               // Sole, Joint
    source: string;
  }>;

  socialMediaProfiles: Array<{
    platform: string;
    username: string;
    url: string;
    verified: boolean;
    followers?: number;
    lastActivity?: string;
  }>;

  psychographics?: {
    interests: string[];             // Derived from social media
    values: string[];                // Derived from posts
    politicalLeanings?: string;      // If publicly stated
    religiousAffiliation?: string;   // If publicly stated
    personality?: string;            // Myers-Briggs, Big 5 (if inferable)
    confidence: number;              // 0-100
  };

  publicRecords?: {
    criminalRecords?: Array<{
      jurisdiction: string;
      charge: string;
      date: string;
      disposition: string;
      source: string;
    }>;
    courtRecords?: Array<{
      caseNumber: string;
      court: string;
      type: string;                  // Civil, Family, etc.
      status: string;
      date: string;
      source: string;
    }>;
    bankruptcies?: Array<{
      chapter: string;
      date: string;
      status: string;
      source: string;
    }>;
    liens?: Array<{
      type: string;
      amount: number;
      date: string;
      source: string;
    }>;
  };

  lifeHistory: {
    timeline: Array<{
      year: number;
      event: string;
      source: string;
    }>;
    biography?: string;              // AI-synthesized from sources
  };

  metadata: {
    generatedAt: string;
    purpose: string;                 // From request
    sourcesConsulted: number;
    verificationLevel: 'low' | 'medium' | 'high';
    ethicsFlags: string[];           // Any concerns raised
    auditId: string;                 // For compliance tracking
  };

  sources: Array<{
    name: string;
    url?: string;
    accessDate: string;
    dataExtracted: string[];
  }>;
}
```

### Research Protocol (SOTA)

**Phase 1: Identity Disambiguation (5-10 min)**
1. Search common name databases (Whitepages, TruePeopleSearch, Pipl)
2. Cross-reference age, location to narrow candidates
3. Verify identity using unique identifiers (email, phone, address)
4. Confidence scoring: Name + 2 unique identifiers = 90%+ confidence

**Phase 2: Contact Information Gathering (5-10 min)**
1. Email discovery: Hunter.io, Voila Norbert, email permutation
2. Phone lookup: TrueCaller, SearchBug API
3. Address history: Property records, voter registration
4. Validation: Email verification APIs, phone carrier lookup

**Phase 3: Social Media Discovery (10-15 min)**
1. Username enumeration: Sherlock, Blackbird OSINT
2. Platform search: LinkedIn, Facebook, Twitter, Instagram, TikTok
3. Profile verification: Cross-reference photos, bio details
4. Content scraping: Recent posts, interests, connections

**Phase 4: Professional & Business Research (10-15 min)**
1. LinkedIn deep dive: Work history, skills, recommendations
2. Business entity search: State Secretary of State databases
3. Property ownership: County assessor records
4. Professional licenses: State licensing boards

**Phase 5: Public Records & Court Research (15-20 min)**
1. Criminal background: SearchBug API, county clerk searches
2. Court records: PACER (federal), state court databases
3. Bankruptcy: PACER bankruptcy search
4. Liens/judgments: County recorder offices

**Phase 6: Psychographic Profiling (10-15 min)**
1. Social media content analysis: Use LLM to analyze posts
2. Interest extraction: Topics, hashtags, likes
3. Values inference: Causes supported, statements made
4. Personality assessment: Language patterns, Big 5 traits

**Phase 7: Verification & Synthesis (10-15 min)**
1. Cross-source verification: Minimum 2 sources per fact
2. Conflict resolution: Flag discrepancies, use most recent
3. Timeline construction: Chronological life events
4. Biography generation: AI-synthesized narrative
5. Confidence scoring: Per-fact and overall

**Total Time: 60-90 minutes per subject**

---

## Technical Implementation

### Tool Stack

**Core OSINT Tools:**
- **Sherlock** - Username enumeration across 300+ platforms ([GitHub](https://github.com/sherlock-project/sherlock))
- **Blackbird OSINT** - Advanced username search ([GitHub](https://github.com/p1ngul1n0/blackbird))
- **SpiderFoot** - Automated OSINT aggregator, 100+ sources ([SpiderFoot](https://spiderfoot.net))
- **PhoneInfoga** - Phone number OSINT ([GitHub](https://github.com/sundowndev/PhoneInfoga))
- **Maltego** or **Lampyre** - Visual link analysis and data correlation
- **theHarvester** - Email, subdomain, people enumeration

**People Search APIs:**
- **Pipl** - 3B+ identity database, deep web search ([Pipl](https://pipl.com))
- **Whitepages** - Phone/address/background checks
- **TruePeopleSearch** - Free US lookups
- **Apollo.io** - Professional contact database
- **SearchBug** - Criminal/court records API ($2.50/query)

**Public Records:**
- **PACER** - Federal court records
- **State Secretary of State APIs** - Business entity searches
- **County property records** - Real estate ownership
- **Voter registration databases** - Address history

**Social Media:**
- **LinkedIn Sales Navigator** - Professional profiles
- **Facebook Graph Search** - (limited post-2018)
- **Twitter/X API** - Public tweets
- **Instagram scraping** - Public profiles only

**Verification:**
- **Email verification APIs** - Hunter.io, NeverBounce
- **Phone carrier lookup** - Twilio Lookup API
- **Reverse image search** - Google Images, TinEye

**LLM Integration:**
- **Claude 3.5 Sonnet** - Primary research agent
- **GPT-4** - Secondary verification
- **Custom prompts** for psychographic analysis

### Architecture

```typescript
// Main orchestrator
class OSINTAgent {
  async research(request: OSINTRequest): Promise<OSINTProfile> {
    // 1. Ethics check
    await this.ethicsGuardrail(request);

    // 2. Identity disambiguation
    const identity = await this.phase1_IdentityDisambiguation(request);

    // 3-7. Parallel research phases
    const [contact, social, professional, records, psychographics] =
      await Promise.all([
        this.phase2_ContactInfo(identity),
        this.phase3_SocialMedia(identity),
        this.phase4_Professional(identity),
        this.phase5_PublicRecords(identity, request.scope),
        this.phase6_Psychographics(identity)
      ]);

    // 8. Verification & synthesis
    const profile = await this.phase7_Synthesis({
      identity,
      contact,
      social,
      professional,
      records,
      psychographics
    });

    // 9. Audit logging
    await this.logResearch(request, profile);

    return profile;
  }
}
```

### Ethics Guardrails

**Pre-Research Checks:**
```typescript
async ethicsGuardrail(request: OSINTRequest): Promise<void> {
  // 1. Purpose validation
  if (!request.subject.purpose) {
    throw new Error("Research purpose required for ethics compliance");
  }

  // 2. Prohibited purposes
  const prohibited = [
    'stalking', 'harassment', 'discrimination', 'identity theft',
    'illegal surveillance', 'doxxing'
  ];
  if (prohibited.some(p => request.subject.purpose.toLowerCase().includes(p))) {
    throw new Error("Research purpose violates ethics policy");
  }

  // 3. Scope limits
  if (request.scope?.includeCriminalRecords) {
    // Require explicit consent and valid legal basis
    await this.validateCriminalRecordsRequest(request);
  }

  // 4. Age verification (no minors)
  if (request.knownInfo?.age && request.knownInfo.age < 18) {
    throw new Error("Cannot research minors without parental consent");
  }

  // 5. Rate limiting (prevent abuse)
  await this.checkRateLimit(request.requestedBy);
}
```

**During-Research Ethics:**
- Only use publicly accessible sources
- No password cracking or unauthorized access
- No social engineering or deception
- Respect robots.txt and ToS
- No scraping of paywalled content

**Post-Research Ethics:**
- Flag sensitive information (SSN, passwords, private medical)
- Redact children's information
- Note GDPR/CCPA rights if applicable
- Secure storage, automatic expiration (90 days)

### Privacy Compliance

**GDPR Compliance (EU):**
- [ ] Lawful basis for processing (legitimate interest)
- [ ] Data minimization (only necessary data)
- [ ] Purpose limitation (specified purpose only)
- [ ] Storage limitation (90-day retention)
- [ ] Right to erasure (delete on request)
- [ ] Data protection impact assessment (DPIA)

**CCPA Compliance (California):**
- [ ] Notice at collection (purpose disclosed)
- [ ] Right to know (sources disclosed)
- [ ] Right to deletion (delete on request)
- [ ] No sale of personal information

**Ethical AI Principles:**
- [ ] Transparency (sources cited)
- [ ] Explainability (reasoning documented)
- [ ] Fairness (no discriminatory profiling)
- [ ] Accountability (audit logs)

### Skill Interface

**New Skill: `osint-research`**

```bash
# Basic usage
osint-research "John Smith" --purpose "due diligence" --location "Boston, MA"

# Advanced usage
osint-research "Jane Doe" \
  --purpose "background check" \
  --age 35-40 \
  --employer "Acme Corp" \
  --include-criminal \
  --include-court \
  --depth comprehensive

# JSON input
osint-research --json '{
  "subject": {
    "name": "John Smith",
    "purpose": "partnership verification"
  },
  "knownInfo": {
    "location": "Boston, MA",
    "employer": "TechCo",
    "email": "john.smith@techco.com"
  },
  "scope": {
    "includeAddresses": true,
    "includeCriminalRecords": true,
    "includeBusinessRecords": true,
    "maxDepth": "comprehensive"
  }
}'

# Output options
osint-research "John Smith" --purpose "hiring" --format json > profile.json
osint-research "John Smith" --purpose "hiring" --format markdown > profile.md
osint-research "John Smith" --purpose "hiring" --format pdf > profile.pdf
```

### Database Schema

```sql
CREATE TABLE osint_research_requests (
  id TEXT PRIMARY KEY,
  requested_by TEXT NOT NULL,
  subject_name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  scope JSON,
  status TEXT,                      -- pending, in_progress, completed, failed
  started_at TEXT,
  completed_at TEXT,
  audit_id TEXT UNIQUE
);

CREATE TABLE osint_profiles (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES osint_research_requests(id),
  profile_data JSON,                -- Full OSINTProfile object
  confidence_score INTEGER,         -- 0-100
  sources_count INTEGER,
  verification_level TEXT,
  ethics_flags JSON,
  created_at TEXT,
  expires_at TEXT                   -- Auto-delete after 90 days
);

CREATE TABLE osint_audit_log (
  id TEXT PRIMARY KEY,
  request_id TEXT REFERENCES osint_research_requests(id),
  action TEXT,                      -- source_queried, data_collected, verification_performed
  details JSON,
  timestamp TEXT
);

CREATE TABLE osint_sources_used (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES osint_profiles(id),
  source_name TEXT,
  source_url TEXT,
  data_extracted TEXT,
  access_timestamp TEXT
);

-- Automatic cleanup job
CREATE TRIGGER osint_cleanup_expired
AFTER INSERT ON osint_profiles
BEGIN
  DELETE FROM osint_profiles
  WHERE datetime(expires_at) < datetime('now');
END;
```

---

## Alternatives Considered

### Alternative 1: Use Existing Services (Pipl, Whitepages Premium)
- **Cost:** $50-200 per subject, $1000s/month for API access
- **Limitations:** Limited customization, no psychographics, poor verification
- **Rejected because:** Too expensive, inflexible, doesn't meet all requirements

### Alternative 2: Manual Research Process
- **Rejected because:** 4-8 hours per subject, inconsistent quality, no scalability, no audit trail

### Alternative 3: Hire Investigator
- **Cost:** $100-300/hour, 6-10 hours = $600-3000 per subject
- **Rejected because:** Extremely expensive, slow turnaround, limited by investigator expertise

### Alternative 4: Open-Source OSINT Tools Only (Sherlock, SpiderFoot)
- **Limitations:** No synthesis, manual correlation, no psychographics, no verification
- **Rejected because:** 50% of value is in AI synthesis and verification, not raw data collection

### Alternative 5: Build Custom Maltego Transforms
- **Limitations:** Steep learning curve, limited to visual analysis, no automated workflows
- **Rejected because:** Maltego is investigator tool, not automated agent

---

## Acceptance Criteria

**Research Capability:**
- [ ] Accept name + optional context, return structured profile
- [ ] Identity disambiguation with 90%+ confidence
- [ ] Discover contact info (email, phone, addresses)
- [ ] Find social media profiles across 10+ platforms
- [ ] Extract professional history (LinkedIn, company records)
- [ ] Search business ownership (all 50 US states)
- [ ] Search property ownership (county records)
- [ ] Criminal/court records (with explicit consent)
- [ ] Psychographic profiling from social media
- [ ] AI-generated biography and timeline

**Verification & Quality:**
- [ ] Minimum 2 sources per fact
- [ ] Confidence scores per fact and overall
- [ ] Flagged conflicts between sources
- [ ] Verification level rating (low/medium/high)
- [ ] Source attribution for every data point

**Ethics & Compliance:**
- [ ] Purpose requirement enforced
- [ ] Prohibited purposes blocked
- [ ] Criminal records require explicit consent
- [ ] No research on minors without consent
- [ ] Rate limiting to prevent abuse
- [ ] Audit log for every research request
- [ ] GDPR/CCPA compliance features
- [ ] Automatic data expiration (90 days)
- [ ] Sensitive information flagged/redacted

**Performance:**
- [ ] Complete research in 60-90 minutes
- [ ] Parallel source querying
- [ ] API rate limit handling
- [ ] Graceful degradation if sources unavailable
- [ ] Cache common queries (same name searched multiple times)

**Output Quality:**
- [ ] JSON, Markdown, PDF formats
- [ ] Clean, readable formatting
- [ ] Embedded source links
- [ ] Visual timeline (optional)
- [ ] Confidence indicators throughout

**Security:**
- [ ] Encrypted storage of profiles
- [ ] Access control (who can request research)
- [ ] Audit trail of all access
- [ ] Secure API key management
- [ ] No logging of sensitive data

---

## Technical Notes

### Implementation Phases

**Phase 1: Core Infrastructure (Week 1-2)**
- Set up skill scaffold
- Implement ethics guardrails
- Build database schema
- Create audit logging
- Basic identity disambiguation

**Phase 2: Source Integration (Week 3-4)**
- Integrate 5-10 key APIs (Pipl, SearchBug, etc.)
- Implement web scrapers for free sources
- Add rate limiting and retry logic
- Build verification engine

**Phase 3: AI Synthesis (Week 5-6)**
- Implement psychographic profiling
- Build timeline generator
- Create biography synthesis
- Add confidence scoring

**Phase 4: Ethics & Compliance (Week 7)**
- Finalize ethics checks
- Add GDPR/CCPA features
- Implement auto-expiration
- Create compliance reports

**Phase 5: Polish & Testing (Week 8)**
- Output formatting (JSON, MD, PDF)
- Error handling improvements
- Performance optimization
- User testing

### Cost Analysis

**Per-Subject Costs:**
- SearchBug API (criminal records): $2.50
- Pipl API: $0.50-1.00 (if used)
- Claude API calls: $0.50-1.00 (synthesis)
- Other API calls: $0.50-2.00
- **Total per subject: $4-7**

**Monthly Costs (100 subjects):**
- API fees: $400-700
- Infrastructure: $50-100
- **Total: $450-800/month**

**ROI:**
- Alternative (hire investigator): $60,000-300,000
- Alternative (Pipl Premium): $5,000-20,000
- **Savings: 90-98%**

### Legal Considerations

**Fair Credit Reporting Act (FCRA):**
- If used for employment, credit, housing: Must comply with FCRA
- Consumer reporting agency registration may be required
- Adverse action notices required

**State-Specific Laws:**
- California: CCPA applies
- Illinois: Biometric data restrictions (facial recognition)
- New York: Employment background check laws

**Recommendation:** Include legal disclaimers, require users to certify compliance with applicable laws.

### Ethical Best Practices (2026 Standards)

**OSINT Code of Ethics:**
1. **Transparency:** Disclose sources and methods
2. **Verification:** Multiple sources, cross-checking
3. **Privacy:** Only publicly accessible information
4. **Purpose:** Legitimate, non-harmful use
5. **Proportionality:** Minimum necessary data
6. **Security:** Protect collected information
7. **Accountability:** Audit trails, compliance

**Operational Security (OPSEC):**
- Use VPN/proxy for web requests
- Rotate IP addresses
- Respect robots.txt
- Avoid triggering alarms (rate limiting)
- Anonymous queries where possible

### Future Enhancements

**Advanced Features:**
- Facial recognition (Pimeyes, PimEyes alternatives)
- Dark web monitoring (leaked credentials)
- Real-time monitoring (alerts on new info)
- Relationship mapping (associates, family)
- Comparative analysis (multiple subjects)
- Historical snapshots (track changes over time)

**International Expansion:**
- EU data sources (GDPR-compliant)
- UK Companies House API
- Canadian business registries
- Global sanctions lists (OFAC, UN)

**AI Improvements:**
- Fine-tuned LLM for OSINT synthesis
- Anomaly detection (contradictory info)
- Risk scoring (red flags)
- Predictive profiling (future behavior)

---

## Related

- **WhatsApp Search** - Similar pattern matching and verification
- **Google Alerts Integration** - Could integrate for ongoing monitoring
- **Self-Diagnostics** - Similar audit logging patterns

---

## Research Sources

**OSINT Tools:**
- [OSINT Framework](https://www.osintframework.com/)
- [OSINT-BIBLE GitHub](https://github.com/frangelbarrera/OSINT-BIBLE)
- [Bellingcat OSINT Toolkit](https://bellingcat.gitbook.io/toolkit) - Comprehensive investigative journalism toolkit
- [Top 15 OSINT Tools for 2026 - Cyble](https://cyble.com/knowledge-hub/top-15-osint-tools-for-powerful-intelligence-gathering/)
- [Best OSINT Tools - ShadowDragon](https://shadowdragon.io/blog/best-osint-tools/)
- [awesome-osint GitHub](https://github.com/jivoi/awesome-osint)

**LLMs in OSINT:**
- [Using LLMs Like ChatGPT To Support OSINT - PacketLabs](https://www.packetlabs.net/posts/using-llms-like-chatgpt-to-support-osint-campaigns/)
- [9 Best Maltego Alternatives 2026](https://technicalustad.com/maltego-alternatives/)
- [Best OSINT Tools in 2026 - Tech@Layer-x](https://tech.layer-x.com/best-osint-tools-in-2026-the-ultimate-guide-for-network-systems-engineers/)

**Ethics & Compliance:**
- [Ethical Considerations of OSINT - Medium](https://medium.com/@scottbolen/the-ethical-considerations-of-osint-privacy-vs-information-gathering-63b5b2f76c55)
- [Ethics and Compliance in OSINT - OSINT Industries](https://www.osint.industries/ethics-and-compliance)
- [How to Conduct an Ethical OSINT Investigation - Black Dot Solutions](https://blackdotsolutions.com/blog/ethics-in-data-collection)
- [OSINT & Legal and Ethical Aspects - EITHOS](https://eithos.eu/open-source-intelligence-osint-its-legal-and-ethical-aspects/)
- [Preserving Privacy: OSINT Privacy Impact Framework - New America](https://www.newamerica.org/future-security/reports/preserving-privacy-an-impact-framework/)

**People Search APIs:**
- [10 Best People Search APIs in 2026 - HeroHunt](https://www.herohunt.ai/blog/10-best-people-search-apis-full-in-depth-guide)
- [Best TruePeopleSearch Alternatives - SecureBlitz](https://secureblitz.com/best-true-people-search-alternatives/)
- [Whitepages People Search Alternatives - Galadon](https://galadon.com/whitepages-people-search)

**Public Records APIs:**
- [Background and Criminal Check APIs - SearchBug](https://www.searchbug.com/api/criminal-background-check.aspx)
- [Criminal Background Data - Tessera Data](https://tesseradata.com/)
- [Criminal Screening API - Signzy](https://www.signzy.com/background-check/criminal-screening)
- [Background Check API - Checkr](https://checkr.com/our-technology/background-check-api)

---

## Questions for Host

1. **Legal review:** Should we engage legal counsel for FCRA compliance?
2. **API budget:** Approved monthly spend on APIs (recommend $500-1000)?
3. **Retention policy:** 90-day auto-deletion acceptable, or different period?
4. **Criminal records:** Require additional consent/disclaimers beyond standard ethics check?
5. **International:** Start US-only, or include EU/UK from day 1?
6. **Access control:** Who can use this skill (internal only, or client-facing)?
7. **Audit requirements:** Any specific compliance reporting needed?

---

## Research Addendum: Advanced OSINT Tools & Methodologies (2026-03-01)

### Additional Tool Stack Evaluation

Based on comprehensive research of leading OSINT resources, the following tools should be integrated into the agent:

#### Email & Breach Intelligence

**h8mail** ([GitHub](https://github.com/khast3x/h8mail))
- **Purpose:** Email OSINT & breach hunting
- **Key Features:**
  - Email pattern recognition via regex
  - URL scraping for email discovery
  - Local breach scanning (multiprocessing)
  - Email chasing (auto-discover related addresses)
  - Multiple output formats (CSV, JSON)
- **Data Sources:**
  - HaveIBeenPwned API (breach counts)
  - Hunter.io (organizational emails)
  - Snusbase, Leak-Lookup, Dehashed, IntelX.io (breach data with passwords/hashes)
  - Local: Breach Compilation torrent, Collection#1
- **Integration:** Use for Phase 2 (Contact Info) and Phase 5 (Public Records - breach data)
- **Security Note:** Password masking for demonstrations, API keys required for premium services

#### Web Crawling & Data Extraction

**Photon** ([GitHub](https://github.com/s0md3v/Photon))
- **Purpose:** Fast web crawler optimized for OSINT
- **Extracts:**
  - URLs (in-scope, out-of-scope, parameterized)
  - Contact intelligence (emails, social profiles, AWS buckets)
  - Files (PDFs, images, XML)
  - Security data (API keys, credentials, hashes)
  - JavaScript files and embedded APIs
  - Subdomains and DNS information
- **Performance:** "Smart thread management & refined logic," 103 MB Docker container
- **Integration:** Use for deep website profiling in Phase 4 (Professional) and Phase 6 (Psychographics)
- **Wayback Integration:** Can seed crawls from archive.org

#### Multi-Purpose OSINT Management

**Seekr** ([GitHub](https://github.com/seekr-osint/seekr))
- **Purpose:** Multi-purpose toolkit with web interface
- **Unique Features:**
  - No API keys required for all capabilities
  - Desktop web interface (localhost:8569)
  - Integrated note-taking + intelligence gathering
  - Account cards and discovery system
  - GitHub-to-email conversion
  - Theme and plugin support
- **Tech Stack:** Go backend, BadgerDB
- **Integration:** Could be used as orchestration layer or reference for UI design
- **Differentiator:** Operates independently without external API dependencies

#### IntelTechniques Custom Search Tools

**IntelTechniques Tools** ([Website](https://inteltechniques.com/tools/index.html))
- **Categories:** 25+ specialized search interfaces
  - Social media (Facebook, X, Instagram, LinkedIn)
  - Personal info (names, addresses, phone, email)
  - Technical (domains, IPs, pastes, breaches)
  - Location & business (maps, vehicles, gov records)
  - Media streams (live audio/video)
- **Methodology:** Browser-based queries (no data collection)
- **Certification:** OSIP (Open Source Intelligence Professional) program
- **Integration:** Reference their search operators and query structures
- **Book:** OSINT Techniques, 11th Edition (Bazzell & Edison)

### Enhanced Research Protocol Updates

#### Phase 2: Contact Information (Enhanced)

**Add h8mail integration:**
```typescript
async function discoverEmailBreaches(email: string): Promise<BreachData> {
  // 1. HaveIBeenPwned check
  const breaches = await hibpAPI.checkEmail(email);

  // 2. h8mail for deep breach hunting
  const h8results = await h8mail.search(email, {
    sources: ['dehashed', 'snusbase', 'intelx'],
    chaseEmails: true  // Auto-discover related addresses
  });

  // 3. Hunter.io for company email pattern
  if (email.includes('@')) {
    const domain = email.split('@')[1];
    const companyEmails = await hunter.domainSearch(domain);
  }

  return {
    breaches,
    relatedEmails: h8results.discovered,
    compromisedCredentials: h8results.findings.filter(maskPasswords)
  };
}
```

**Add Photon for website email scraping:**
```typescript
async function scrapeContactsFromWebsite(domain: string): Promise<Contacts> {
  const photonResults = await photon.crawl(domain, {
    timeout: 60,
    threads: 10,
    extractEmails: true,
    extractSocial: true,
    extractFiles: ['pdf', 'docx']  // Resumes, bios
  });

  return {
    emails: photonResults.emails,
    socialProfiles: photonResults.social,
    documents: photonResults.files
  };
}
```

#### Phase 3: Social Media Discovery (Enhanced)

**Add advanced Twitter/X techniques:**
```typescript
async function advancedTwitterSearch(subject: string): Promise<XProfile> {
  // Use IntelTechniques-style operators
  const searches = [
    `"${subject.name}" min_faves:100`,  // Popular tweets
    `from:${username} until:${date}`,    // Historical posts
    `geocode:${lat},${lon},50mi`        // Location-based
  ];

  // Cross-reference with SocialBearing.com metrics
  const analytics = await socialBearing.analyze(username);

  // Twint for archive scraping (bypasses API limits)
  const twitterArchive = await twint.scrape(username, {
    since: '2020-01-01',
    hide_output: true
  });

  return {
    profile: account,
    analytics: {
      postingPatterns: analytics.sleepingTime,
      topicClusters: analytics.hashtags,
      networkMap: analytics.mentions
    },
    historicalPosts: twitterArchive
  };
}
```

#### Phase 5: Public Records (Enhanced)

**Add comprehensive breach checking:**
```typescript
async function comprehensiveBreachCheck(subject: Identity): Promise<BreachProfile> {
  const searches = await Promise.all([
    // Email breaches
    h8mail.search(subject.emails),

    // Username breaches
    dehashed.searchUsername(subject.usernames),

    // Phone number leaks
    leakcheck.searchPhone(subject.phones),

    // Name in public dumps
    snusbase.searchName(subject.name, subject.location)
  ]);

  // Cross-reference breach dates with life timeline
  const breachTimeline = correlateWithLifeEvents(searches, subject.timeline);

  return {
    totalBreaches: searches.flat().length,
    exposedData: categorizeExposure(searches),
    timeline: breachTimeline,
    riskScore: calculateRiskScore(searches)
  };
}
```

### Verification Methodology (Journalism Best Practices)

Based on OSINT Industries journalism guide:

**Visual Content Verification:**
```typescript
async function verifyVisualContent(imageUrl: string): Promise<VerificationResult> {
  const checks = await Promise.all([
    // Reverse image search (multiple engines)
    googleImages.reverseSearch(imageUrl),
    yandexImages.reverseSearch(imageUrl),  // Often better for faces
    tineye.reverseSearch(imageUrl),

    // EXIF metadata extraction
    exiftool.analyze(imageUrl),

    // Forensic analysis
    fotoForensics.ela(imageUrl),  // Error Level Analysis

    // Geolocation from visual markers
    geoSpy.analyze(imageUrl)  // AI-powered location detection
  ]);

  return {
    originalSource: checks[0].earliestMatch,
    metadata: checks[3],
    manipulationDetected: checks[4].suspiciousRegions,
    location: checks[5].confidence > 0.7 ? checks[5].location : null
  };
}
```

**Source Documentation Strategy:**
```typescript
interface SourceCapture {
  url: string;
  timestamp: string;
  screenshot: string;      // Base64 or S3 URL
  waybackSnapshot: string; // Archive.org permanent link
  pageHash: string;        // SHA-256 of content
  htmlArchive: string;     // Full HTML preserved
}

async function captureSource(url: string): Promise<SourceCapture> {
  // Capture live
  const screenshot = await puppeteer.screenshot(url);
  const html = await fetch(url).then(r => r.text());

  // Archive permanently
  const waybackUrl = await archiveOrg.save(url);

  return {
    url,
    timestamp: new Date().toISOString(),
    screenshot,
    waybackSnapshot: waybackUrl,
    pageHash: sha256(html),
    htmlArchive: await s3.upload(html)
  };
}
```

### Operational Security (OPSEC) Enhancements

**Anonymous Research Infrastructure:**
```typescript
class OSINTSession {
  private vpn: VPNConnection;
  private proxy: ProxyChain;
  private browser: PuppeteerBrowser;

  async initialize(): Promise<void> {
    // 1. Connect to VPN
    this.vpn = await vpnProvider.connect({
      country: 'randomize',  // Rotate countries
      protocol: 'wireguard'
    });

    // 2. Chain through SOCKS5 proxy
    this.proxy = await proxyChain.create({
      upstream: this.vpn.socks5Endpoint,
      rotate: true
    });

    // 3. Launch browser with anti-fingerprinting
    this.browser = await puppeteer.launch({
      proxy: this.proxy.url,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage'
      ],
      // Use randomized user agent
      userAgent: randomUserAgent.getRandom()
    });

    // 4. Verify anonymity
    const ipCheck = await this.browser.newPage();
    await ipCheck.goto('https://ifconfig.me');
    logger.info('External IP:', await ipCheck.content());
  }

  async cleanup(): Promise<void> {
    await this.browser.close();
    await this.proxy.close();
    await this.vpn.disconnect();
  }
}
```

### Tool Integration Priority Matrix

| Tool | Priority | Phase | Integration Effort | Value Add |
|------|----------|-------|-------------------|-----------|
| h8mail | High | 2, 5 | Medium | High (breach data) |
| Photon | High | 4, 6 | Low | High (website intel) |
| Sherlock | High | 3 | Low | High (username enum) |
| Hunter.io | High | 2 | Low | High (email discovery) |
| IntelTechniques operators | Medium | All | Medium | Medium (query refinement) |
| Seekr | Low | UI | High | Low (could rebuild ourselves) |
| Twint | Medium | 3 | Medium | Medium (Twitter archive) |
| PhoneInfoga | Medium | 2 | Low | Medium (phone intel) |
| ExifTool | Medium | 6 | Low | Medium (image metadata) |
| Wayback Machine | High | All | Low | High (historical data) |

### Updated Cost Analysis

**Additional API Costs:**
- h8mail APIs (Dehashed, Snusbase): $1-3/subject
- Hunter.io: $0.50/domain search
- TinEye reverse image: $0.20/image
- Archive.org saves: Free
- VPN/proxy: $0.10/session

**Revised Total: $6-12/subject** (was $4-7)
- Still 90-98% cheaper than manual investigation

### Enhanced Acceptance Criteria

**Breach Intelligence:**
- [ ] Check email breaches via HaveIBeenPwned
- [ ] Deep breach hunting with h8mail (Dehashed, Snusbase, IntelX)
- [ ] Auto-discover related email addresses
- [ ] Phone number leak detection
- [ ] Breach timeline correlation with life events

**Website Intelligence:**
- [ ] Crawl subject's website with Photon
- [ ] Extract emails, social links, documents
- [ ] Discover API endpoints and keys (if exposed)
- [ ] Subdomain enumeration
- [ ] Wayback Machine historical snapshots

**Visual Verification:**
- [ ] Reverse image search (Google, Yandex, TinEye)
- [ ] EXIF metadata extraction
- [ ] Forensic analysis (FotoForensics ELA)
- [ ] AI geolocation from visual markers

**OPSEC Implementation:**
- [ ] VPN rotation per session
- [ ] SOCKS5 proxy chaining
- [ ] Anti-fingerprinting browser config
- [ ] Randomized user agents
- [ ] IP verification logging

**Source Preservation:**
- [ ] Screenshot capture for all sources
- [ ] Wayback Machine archival
- [ ] Full HTML preservation
- [ ] SHA-256 hashing for integrity
- [ ] Permanent evidence trail

### Research Sources (Additional)

**OSINT Journalism:**
- [OSINT for Journalists - OSINT Industries](https://www.osint.industries/post/osint-journalism-our-guide-to-osint-for-journalists)

**Specialized Tools:**
- [h8mail - Email OSINT](https://github.com/khast3x/h8mail)
- [Photon - Fast Web Crawler](https://github.com/s0md3v/Photon)
- [Seekr - Multi-Purpose OSINT](https://github.com/seekr-osint/seekr)

**Comprehensive Resources:**
- [Awesome OSINT - jivoi](https://github.com/jivoi/awesome-osint)
- [OhShINT GitBook](https://github.com/OhShINT/ohshint.gitbook.io)
- [Red Team OSINT Cheat Sheet](https://github.com/H4CK3RT3CH/RedTeaming_CheatSheet/blob/main/OSINT.md)
- [IntelTechniques OSINT Tools](https://inteltechniques.com/tools/index.html)

**Key Insights:**
1. **Breach data is critical** - h8mail integration provides compromised credentials that verify identity and reveal security posture
2. **Website crawling scales** - Photon can process entire domains in minutes, extracting contact info and documents
3. **Journalism standards matter** - Visual verification and source preservation from OSINT Industries methodology prevent misinformation
4. **OPSEC is non-negotiable** - VPN + proxy + anti-fingerprinting protects researcher and maintains investigation integrity
5. **IntelTechniques query operators** - Reference their 11th edition book for advanced search syntax across platforms

---

**End of Research Addendum**

---

