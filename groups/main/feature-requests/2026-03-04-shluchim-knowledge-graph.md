# Feature Request: Shluchim Knowledge Graph

**Date:** 2026-03-04
**Status:** new
**Requested by:** Yonatan Azrielant
**Priority:** high

## Problem

The Shluchim network is a complex web of organizational hierarchies and family relationships, but currently:

1. **No relationship mapping** - Can't see who reports to whom in organizational structure
2. **Lost context** - Don't know if two Shluchim are related, went to yeshiva together, or work in same region
3. **Missed connections** - Can't find shortest path between two Shluchim ("how do I know Rabbi Cohen?")
4. **No hierarchy visualization** - Unclear who is regional director, national director, head Shliach
5. **Referrals are difficult** - Don't know who to ask for introduction to a specific Shliach
6. **Network analysis impossible** - Can't analyze influence, clusters, or community structure

**Real-world impact:** When trying to connect with a Shliach, knowing "He's the head Shliach for 5 Shluchim in your region" or "He's Rabbi Goldstein's brother-in-law" or "You both studied under Rabbi Klein" provides crucial social context for effective relationship building.

## Proposed Solution

Create a **Shluchim Knowledge Graph** that:
1. **Maps organizational hierarchy** - Head Shliach relationships (local, regional, national)
2. **Tracks family relationships** - Parents, siblings, in-laws, children
3. **Records educational connections** - Yeshiva classmates, mentors, students
4. **Stores geographic relationships** - Same city, region, proximity
5. **Enables graph queries** - "How am I connected to X?", "Who reports to Y?", "Find all regional directors"
6. **Provides social context** - Enhance every Shliach profile with relationship network

### Core Capabilities

#### 1. Graph Database Schema

**Using Graph Database (Neo4j) or Graph-in-SQLite:**

**Nodes (Entities):**
```javascript
// Shliach Node
{
  type: "Shliach",
  id: 1234,
  name: "Rabbi Mendy Cohen",
  first_name: "Mendy",
  last_name: "Cohen",
  title: "Rabbi",
  city: "Miami Beach",
  state: "Florida",
  country: "United States",
  organization: "Chabad of Miami Beach",
  appointed_year: 2005,
  // Links to shluchim.db
  shluchim_db_id: 1234
}

// Organization Node
{
  type: "Organization",
  id: 5678,
  name: "Chabad of Florida",
  organization_type: "Regional Office",
  region: "Florida",
  country: "United States"
}

// Yeshiva Node
{
  type: "Yeshiva",
  id: 9012,
  name: "Yeshivas Tomchei Tmimim - 770",
  city: "Brooklyn",
  country: "United States"
}

// Family Node (for grouping)
{
  type: "Family",
  id: 3456,
  name: "Cohen Family",
  primary_location: "Crown Heights, NY"
}
```

**Relationships (Edges):**

**1. Organizational Hierarchy:**
```javascript
// Head Shliach relationship
{
  type: "REPORTS_TO",
  from: shliach_id,
  to: head_shliach_id,
  role: "local_head_shliach" | "regional_head_shliach" | "national_head_shliach",
  since: 2005,
  region: "Miami-Dade County" | "Florida" | "United States"
}

// Example chain:
// Local Shliach → Reports to → Campus Director
// Campus Director → Reports to → Regional Director (Florida)
// Regional Director → Reports to → National Director (Merkos)
```

**2. Family Relationships:**
```javascript
{
  type: "FAMILY",
  from: shliach_id,
  to: related_shliach_id,
  relationship: "father" | "mother" | "brother" | "sister" | "son" | "daughter" |
                "father_in_law" | "mother_in_law" | "brother_in_law" | "sister_in_law" |
                "uncle" | "aunt" | "cousin" | "nephew" | "niece",
  notes: "Optional context"
}

// Examples:
// Rabbi A → FAMILY(father) → Rabbi B
// Rabbi C → FAMILY(brother_in_law) → Rabbi D
```

**3. Educational Connections:**
```javascript
{
  type: "STUDIED_AT",
  from: shliach_id,
  to: yeshiva_id,
  years: [2000, 2005],
  role: "student" | "faculty"
}

{
  type: "STUDIED_WITH",
  from: shliach_id,
  to: shliach_id,
  institution: yeshiva_id,
  years: [2000, 2005],
  notes: "Classmates"
}

{
  type: "MENTORED_BY",
  from: shliach_id,
  to: shliach_id,
  context: "Yeshiva mashpia" | "Head Shliach training"
}
```

**4. Geographic Relationships:**
```javascript
{
  type: "SAME_CITY",
  from: shliach_id,
  to: shliach_id,
  city: "Miami Beach",
  distance_km: 0
}

{
  type: "SAME_REGION",
  from: shliach_id,
  to: shliach_id,
  region: "Florida",
  distance_km: 350
}

{
  type: "NEARBY",
  from: shliach_id,
  to: shliach_id,
  distance_km: 25
}
```

**5. Collaborative Relationships:**
```javascript
{
  type: "COLLABORATES_WITH",
  from: shliach_id,
  to: shliach_id,
  context: "Joint events" | "Shared programs" | "Regional committee",
  since: 2020
}

{
  type: "SERVES_TOGETHER",
  from: shliach_id,
  to: organization_id,
  role: "Board member" | "Committee member"
}
```

#### 2. Graph Storage Implementation

**Option 1: Neo4j (Dedicated Graph Database)**

```cypher
// Create Shliach node
CREATE (s:Shliach {
  id: 1234,
  name: "Rabbi Mendy Cohen",
  city: "Miami Beach",
  state: "Florida",
  organization: "Chabad of Miami Beach"
})

// Create organizational relationship
MATCH (s1:Shliach {id: 1234}), (s2:Shliach {id: 5678})
CREATE (s1)-[:REPORTS_TO {role: "regional_head_shliach", since: 2010}]->(s2)

// Create family relationship
MATCH (s1:Shliach {id: 1234}), (s2:Shliach {id: 9012})
CREATE (s1)-[:FAMILY {relationship: "brother"}]->(s2)

// Query: Find all Shluchim who report to Rabbi Cohen
MATCH (s:Shliach)-[:REPORTS_TO]->(head:Shliach {name: "Rabbi Mendy Cohen"})
RETURN s

// Query: Find organizational hierarchy
MATCH path = (s:Shliach {id: 1234})-[:REPORTS_TO*]->(top)
WHERE NOT (top)-[:REPORTS_TO]->()
RETURN path

// Query: Find shortest path between two Shluchim
MATCH path = shortestPath(
  (s1:Shliach {id: 1234})-[*]-(s2:Shliach {id: 5678})
)
RETURN path
```

**Option 2: SQLite with Graph Tables (Lighter Weight)**

```sql
-- Nodes table
CREATE TABLE graph_nodes (
  id INTEGER PRIMARY KEY,
  node_type TEXT, -- 'shliach', 'organization', 'yeshiva', 'family'
  entity_id INTEGER, -- Reference to shluchim.db or other tables
  name TEXT,
  properties JSON -- Additional attributes
);

-- Edges table
CREATE TABLE graph_edges (
  id INTEGER PRIMARY KEY,
  edge_type TEXT, -- 'REPORTS_TO', 'FAMILY', 'STUDIED_WITH', etc.
  from_node_id INTEGER,
  to_node_id INTEGER,
  properties JSON, -- {role, since, relationship, etc.}
  created_at TIMESTAMP,

  FOREIGN KEY (from_node_id) REFERENCES graph_nodes(id),
  FOREIGN KEY (to_node_id) REFERENCES graph_nodes(id)
);

-- Indexes for fast graph traversal
CREATE INDEX idx_edge_from ON graph_edges(from_node_id, edge_type);
CREATE INDEX idx_edge_to ON graph_edges(to_node_id, edge_type);
CREATE INDEX idx_edge_type ON graph_edges(edge_type);

-- Example queries using recursive CTEs (Common Table Expressions)

-- Find all Shluchim in organizational hierarchy under Rabbi Cohen
WITH RECURSIVE hierarchy AS (
  SELECT id, name, 0 as level
  FROM graph_nodes
  WHERE name = 'Rabbi Mendy Cohen' AND node_type = 'shliach'

  UNION ALL

  SELECT n.id, n.name, h.level + 1
  FROM graph_nodes n
  JOIN graph_edges e ON e.to_node_id = n.id
  JOIN hierarchy h ON e.from_node_id = h.id
  WHERE e.edge_type = 'REPORTS_TO'
)
SELECT * FROM hierarchy;

-- Find all family members of a Shliach
SELECT n2.name, e.properties->>'relationship' as relationship
FROM graph_nodes n1
JOIN graph_edges e ON e.from_node_id = n1.id
JOIN graph_nodes n2 ON e.to_node_id = n2.id
WHERE n1.id = 1234 AND e.edge_type = 'FAMILY';

-- Find shortest path (BFS approach, requires multiple queries)
-- More complex, typically use specialized graph library
```

**Option 3: Hybrid - SQLite + JavaScript Graph Library**

```javascript
// Use memgraph or graphology for in-memory graph queries
// Store data in SQLite, load into memory for complex queries

const Graph = require('graphology');

async function loadGraphFromDatabase() {
  const graph = new Graph();

  // Load nodes
  const nodes = await db.all('SELECT * FROM graph_nodes');
  nodes.forEach(node => {
    graph.addNode(node.id, {
      type: node.node_type,
      name: node.name,
      ...JSON.parse(node.properties)
    });
  });

  // Load edges
  const edges = await db.all('SELECT * FROM graph_edges');
  edges.forEach(edge => {
    graph.addEdge(edge.from_node_id, edge.to_node_id, {
      type: edge.edge_type,
      ...JSON.parse(edge.properties)
    });
  });

  return graph;
}

// Query: Find all relationships
function findAllRelationships(graph, shliachId) {
  const relationships = {
    reports_to: [],
    reports_from: [],
    family: [],
    studied_with: [],
    nearby: []
  };

  graph.forEachEdge(shliachId, (edge, attributes, source, target) => {
    const other = source === shliachId ? target : source;
    const otherNode = graph.getNodeAttributes(other);

    switch (attributes.type) {
      case 'REPORTS_TO':
        if (source === shliachId) {
          relationships.reports_to.push({
            name: otherNode.name,
            role: attributes.role
          });
        } else {
          relationships.reports_from.push({
            name: otherNode.name,
            role: attributes.role
          });
        }
        break;

      case 'FAMILY':
        relationships.family.push({
          name: otherNode.name,
          relationship: attributes.relationship
        });
        break;

      case 'STUDIED_WITH':
        relationships.studied_with.push({
          name: otherNode.name,
          years: attributes.years
        });
        break;

      case 'NEARBY':
        relationships.nearby.push({
          name: otherNode.name,
          distance_km: attributes.distance_km
        });
        break;
    }
  });

  return relationships;
}

// Find shortest path between two Shluchim
function findConnectionPath(graph, fromId, toId) {
  const path = shortestPath.bidirectional(graph, fromId, toId);

  if (!path) {
    return null;
  }

  const pathWithDetails = [];
  for (let i = 0; i < path.length - 1; i++) {
    const edge = graph.edge(path[i], path[i + 1]);
    const edgeAttrs = graph.getEdgeAttributes(edge);

    pathWithDetails.push({
      from: graph.getNodeAttributes(path[i]).name,
      to: graph.getNodeAttributes(path[i + 1]).name,
      relationship: edgeAttrs.type,
      details: edgeAttrs
    });
  }

  return pathWithDetails;
}
```

#### 3. Data Population

**Sources for Building the Graph:**

**1. Shluchim Database (from previous feature request)**
- All Shluchim with locations
- Organization names hint at hierarchy
- Same family names suggest relationships

**2. Tzach List Announcements**
- "Rabbi X appointed under Head Shliach Rabbi Y"
- "Son of Rabbi A married to daughter of Rabbi B"
- Family announcements reveal relationships

**3. Manual Data Entry**
- Regional/National directors list
- Known family trees
- Yeshiva attendance records

**4. Inference from Names**
- Same last name + same city → likely family
- "Chabad of X - Regional Office" → regional head
- Parent organization in hierarchy

**Data Population Script:**
```python
def populate_knowledge_graph():
    """
    Build knowledge graph from various sources
    """
    graph = Graph()

    # 1. Load all Shluchim as nodes
    shluchim = load_all_shluchim()
    for shliach in shluchim:
        graph.add_node(
            node_id=shliach['id'],
            node_type='shliach',
            name=f"{shliach['title']} {shliach['first_name']} {shliach['last_name']}",
            properties=shliach
        )

    # 2. Infer organizational relationships
    # Look for "Regional Office", "National Director" in org names
    for shliach in shluchim:
        if 'regional' in shliach['organization_name'].lower():
            # This is a regional head
            # Find Shluchim in same region
            subordinates = find_shluchim_in_region(shliach['region'])
            for sub in subordinates:
                if sub['id'] != shliach['id']:
                    graph.add_edge(
                        from_id=sub['id'],
                        to_id=shliach['id'],
                        edge_type='REPORTS_TO',
                        properties={'role': 'regional_head_shliach'}
                    )

    # 3. Infer family relationships from same last name
    family_clusters = cluster_by_last_name(shluchim)
    for family_name, family_members in family_clusters.items():
        if len(family_members) > 1:
            # Create family node
            family_id = graph.add_node(
                node_type='family',
                name=f"{family_name} Family"
            )

            # Link all family members
            for member in family_members:
                graph.add_edge(
                    from_id=member['id'],
                    to_id=family_id,
                    edge_type='BELONGS_TO_FAMILY'
                )

            # Infer sibling relationships
            for i, m1 in enumerate(family_members):
                for m2 in family_members[i+1:]:
                    # Same generation? Likely siblings
                    if abs(m1.get('appointed_year', 0) - m2.get('appointed_year', 0)) < 10:
                        graph.add_edge(
                            from_id=m1['id'],
                            to_id=m2['id'],
                            edge_type='FAMILY',
                            properties={'relationship': 'likely_sibling', 'confidence': 0.6}
                        )

    # 4. Parse Tzach List for relationship mentions
    tzach_announcements = load_tzach_announcements()
    for announcement in tzach_announcements:
        relationships = extract_relationships_from_text(announcement['body'])
        for rel in relationships:
            graph.add_edge(
                from_id=rel['from_id'],
                to_id=rel['to_id'],
                edge_type=rel['type'],
                properties=rel['properties']
            )

    # 5. Geographic relationships
    for s1 in shluchim:
        for s2 in shluchim:
            if s1['id'] >= s2['id']:
                continue

            distance = calculate_distance(s1['latitude'], s1['longitude'],
                                          s2['latitude'], s2['longitude'])

            if s1['city'] == s2['city']:
                graph.add_edge(
                    from_id=s1['id'],
                    to_id=s2['id'],
                    edge_type='SAME_CITY',
                    properties={'city': s1['city'], 'distance_km': distance}
                )
            elif distance < 50:
                graph.add_edge(
                    from_id=s1['id'],
                    to_id=s2['id'],
                    edge_type='NEARBY',
                    properties={'distance_km': distance}
                )

    return graph

def extract_relationships_from_text(text):
    """
    Parse Tzach announcements for relationship mentions
    """
    relationships = []

    # Pattern: "Rabbi X appointed under Head Shliach Rabbi Y"
    pattern = r"(?:Rabbi )?([\w\s]+) appointed under (?:Head Shliach )?(?:Rabbi )?([\w\s]+)"
    matches = re.findall(pattern, text)
    for match in matches:
        shliach = find_shliach_by_name(match[0])
        head_shliach = find_shliach_by_name(match[1])
        if shliach and head_shliach:
            relationships.append({
                'from_id': shliach['id'],
                'to_id': head_shliach['id'],
                'type': 'REPORTS_TO',
                'properties': {'role': 'local_head_shliach', 'source': 'tzach_list'}
            })

    # Pattern: "Son of Rabbi X"
    pattern = r"[Ss]on of (?:Rabbi )?([\w\s]+)"
    matches = re.findall(pattern, text)
    for match in matches:
        father = find_shliach_by_name(match)
        # Need to identify the son from context (previous mentions in text)
        # This is simplified - real implementation needs better NLP

    return relationships
```

#### 4. Graph Query API

**Common Queries:**

**1. Find Organizational Hierarchy:**
```javascript
// Get all Shluchim under a Head Shliach
async function getOrganizationalTree(headShliachId) {
  const tree = await traverseGraph({
    startNode: headShliachId,
    edgeType: 'REPORTS_TO',
    direction: 'incoming', // People who report TO this person
    maxDepth: 5
  });

  return formatAsTree(tree);
}

// Example result:
{
  "name": "Rabbi Yossi Goldstein - Regional Director, Florida",
  "children": [
    {
      "name": "Rabbi Mendy Cohen - Chabad of Miami Beach",
      "children": [
        {"name": "Rabbi David Klein - Chabad on Campus FIU"},
        {"name": "Rabbi Sarah Levy - Chabad of South Beach"}
      ]
    },
    {
      "name": "Rabbi Moshe Schwartz - Chabad of Tampa",
      "children": []
    }
  ]
}
```

**2. Find Connection Path:**
```javascript
// "How am I connected to Rabbi X?"
async function findConnectionPath(fromId, toId) {
  const path = await shortestPath(fromId, toId);

  if (!path) {
    return { connected: false };
  }

  const formattedPath = path.map((step, i) => {
    if (i === path.length - 1) return step.name;

    return `${step.name} --[${step.relationship}]--> `;
  }).join('');

  return {
    connected: true,
    degrees: path.length - 1,
    path: formattedPath,
    details: path
  };
}

// Example result:
{
  "connected": true,
  "degrees": 3,
  "path": "You --> Rabbi David Cohen --[STUDIED_WITH]--> Rabbi Mendy Goldstein --[BROTHER_IN_LAW]--> Rabbi Yossi Klein --[REPORTS_TO]--> Rabbi Moshe Schwartz",
  "details": [...]
}
```

**3. Find All Relationships for a Shliach:**
```javascript
async function getShliachNetwork(shliachId) {
  const network = {
    organizational: {
      reports_to: await getEdges(shliachId, 'REPORTS_TO', 'outgoing'),
      supervises: await getEdges(shliachId, 'REPORTS_TO', 'incoming'),
      colleagues: await getSameLevelPeers(shliachId)
    },
    family: {
      immediate: await getEdges(shliachId, 'FAMILY', 'both', ['father', 'mother', 'sibling', 'spouse', 'child']),
      extended: await getEdges(shliachId, 'FAMILY', 'both', ['uncle', 'aunt', 'cousin', 'in_law'])
    },
    educational: {
      studied_with: await getEdges(shliachId, 'STUDIED_WITH', 'both'),
      mentors: await getEdges(shliachId, 'MENTORED_BY', 'outgoing'),
      students: await getEdges(shliachId, 'MENTORED_BY', 'incoming')
    },
    geographic: {
      same_city: await getEdges(shliachId, 'SAME_CITY', 'both'),
      nearby: await getEdges(shliachId, 'NEARBY', 'both'),
      same_region: await getEdges(shliachId, 'SAME_REGION', 'both')
    }
  };

  return network;
}
```

**4. Find Regional/National Directors:**
```javascript
async function findDirectors(level = 'regional') {
  const directors = await query(`
    SELECT DISTINCT n.*
    FROM graph_nodes n
    JOIN graph_edges e ON e.to_node_id = n.id
    WHERE e.edge_type = 'REPORTS_TO'
      AND e.properties->>'role' = ?
    GROUP BY n.id
    HAVING COUNT(e.id) > 3
  `, [`${level}_head_shliach`]);

  return directors;
}
```

**5. Find Influential Nodes (High Degree Centrality):**
```javascript
async function findInfluentialShluchim(limit = 10) {
  // Count total connections for each Shliach
  const influential = await query(`
    SELECT n.id, n.name, COUNT(e.id) as total_connections
    FROM graph_nodes n
    JOIN graph_edges e ON (e.from_node_id = n.id OR e.to_node_id = n.id)
    WHERE n.node_type = 'shliach'
    GROUP BY n.id
    ORDER BY total_connections DESC
    LIMIT ?
  `, [limit]);

  return influential;
}
```

#### 5. Integration with Andy

**Enhanced Shliach Profiles with Context:**

```
User: "Tell me about Rabbi Mendy Cohen"

Andy: "*Rabbi Mendy Cohen*
Chabad of Miami Beach, Florida

*Organizational:*
• Reports to: Rabbi Yossi Goldstein (Regional Director, Florida)
• Supervises: 3 campus Shluchim (FIU, UM, MDC)
• Peers: 5 other Shluchim in Miami-Dade area

*Family Network:*
• Brother: Rabbi David Cohen (Chabad of Los Angeles)
• Father-in-law: Rabbi Moshe Levy (Crown Heights)
• Uncle: Rabbi Yitzi Cohen (Merkos National)

*Educational:*
• Studied at: 770 Yeshiva (2000-2005)
• Classmates include: Rabbi Goldstein (Denver), Rabbi Klein (Boston)

*Geographic:*
• 4 Shluchim in same city (Miami Beach)
• 12 Shluchim within 25km

*Your Connection:*
You're connected through: You → Rabbi Goldstein (studied together) → Rabbi Cohen (regional director relationship)

Would you like an introduction?"
```

**Path-Finding Queries:**

```
User: "How do I know Rabbi Schwartz in Austin?"

Andy: "You're connected to Rabbi Schwartz through 2 degrees:

*Path:*
You → Rabbi David Klein (studied together at 770, 2000-2005)
Rabbi Klein → Rabbi Moshe Schwartz (brothers-in-law)

*Suggested approach:*
Reach out to Rabbi Klein for an introduction. You last spoke to him 2 weeks ago, so he'd be happy to connect you.

Would you like me to draft an introduction message?"
```

**Hierarchy Exploration:**

```
User: "Who are the regional directors in the US?"

Andy: "Found 8 regional directors in the United States:

*East Coast:*
• Rabbi Yossi Goldstein - Florida (supervises 47 Shluchim)
• Rabbi Mendy Levine - New York (supervises 89 Shluchim)
• Rabbi David Cohen - New England (supervises 23 Shluchim)

*West Coast:*
• Rabbi Moshe Klein - California (supervises 62 Shluchim)
• Rabbi Yitzi Schwartz - Pacific Northwest (supervises 18 Shluchim)

*Central:*
• Rabbi Shalom Stein - Midwest (supervises 31 Shluchim)
• Rabbi Mendel Goldstein - Texas (supervises 28 Shluchim)

*Other:*
• Rabbi Chaim Kotlarsky - Mountain States (supervises 15 Shluchim)

Total: 313 Shluchim under regional directors

Would you like details on a specific region?"
```

**Network Analysis:**

```
User: "Who are the most connected Shluchim?"

Andy: "Top 10 most connected Shluchim by total relationships:

1. *Rabbi Yossi Kotlarsky* (Merkos National) - 247 connections
   - 156 organizational (supervises regionally)
   - 34 family members who are Shluchim
   - 57 yeshiva classmates/students

2. *Rabbi Mendy Goldstein* (Regional Director, NY) - 189 connections
   - 89 direct reports
   - 52 same-city Shluchim
   - 48 family/educational

3. *Rabbi Moshe Klein* (California Regional) - 162 connections
   [...]

These are key influencers in the Shluchim network for:
• Introductions and referrals
• Event planning and coordination
• Information dissemination

Would you like to see your connection paths to any of them?"
```

**Family Tree Exploration:**

```
User: "Show me the Cohen family Shluchim"

Andy: "The Cohen family has 12 Shluchim across 3 generations:

*Generation 1:*
• Rabbi Shalom Cohen (Brooklyn) - Retired, mentored 23 Shluchim

*Generation 2:*
• Rabbi Mendy Cohen (Miami Beach) - son
• Rabbi David Cohen (Los Angeles) - son
• Rabbi Moshe Cohen (Chicago) - son
• Rabbi Sarah Cohen (Boston) - daughter

*Generation 3:*
• Rabbi Yitzi Cohen (Denver) - grandson (Mendy's son)
• Rabbi Chaim Cohen (Seattle) - grandson (David's son)
• [5 more grandchildren currently in yeshiva]

*Extended Family (In-laws):*
• Rabbi Goldstein (son-in-law, married to Sarah)
• Rabbi Klein (son-in-law, married to daughter)

Total reach: 47 Shluchim (direct family + those they supervise)

Would you like to see the family tree visualization?"
```

#### 6. Visualization

**Graph Visualization (Interactive):**

```javascript
// Generate graph visualization using vis.js or cytoscape.js

function visualizeNetwork(shliachId, depth = 2) {
  const network = getNetworkGraph(shliachId, depth);

  const nodes = network.nodes.map(node => ({
    id: node.id,
    label: node.name,
    color: getColorByType(node),
    size: getNodeSize(node) // Based on connections
  }));

  const edges = network.edges.map(edge => ({
    from: edge.from,
    to: edge.to,
    label: edge.relationship,
    color: getColorByEdgeType(edge.type),
    dashes: edge.type === 'FAMILY' ? false : true
  }));

  renderGraph({ nodes, edges });
}

function getColorByType(node) {
  const colors = {
    'regional_director': '#FF6B6B', // Red
    'local_head': '#4ECDC4',        // Teal
    'campus': '#45B7D1',            // Blue
    'regular': '#95E1D3'            // Light green
  };

  return colors[node.role] || colors.regular;
}
```

**Example Visualization Output:**
- Nodes sized by number of connections (influence)
- Colors by organizational level
- Edge colors by relationship type (family = solid, organizational = dashed)
- Interactive: click to expand, hover for details
- Export as PNG/SVG

### Implementation Details

#### File Structure
```
/workspace/project/
├── data/
│   ├── knowledge_graph.db        # SQLite with graph tables
│   └── graph_export.json         # Neo4j export if using Neo4j
├── graph/
│   ├── builder.py                # Build graph from sources
│   ├── query.js                  # Graph query API
│   ├── visualize.js              # Visualization generation
│   └── inference.py              # Infer relationships
└── skills/
    └── shluchim-network/         # Andy skill
        ├── connections.js
        ├── hierarchy.js
        └── analysis.js
```

#### Database Recommendation
**Use SQLite + JavaScript Graph Library:**
- Store in SQLite (persistent, portable)
- Load into memory graph for complex queries (fast)
- Serialize back to SQLite for updates
- Best of both worlds: persistence + performance

#### Graph Maintenance
- **Weekly rebuild:** Re-infer relationships from updated Shluchim DB
- **Incremental updates:** Add new Shluchim from Tzach List
- **Manual corrections:** Override inferred relationships
- **Confidence scores:** Track reliability of inferred vs. confirmed relationships

### Privacy & Data Considerations

**Relationship Privacy:**
- Only include publicly known relationships
- Family relationships from public announcements (Tzach List)
- Organizational hierarchy from public directories
- Allow Shluchim to opt-out of network visibility

**Data Sources:**
- Public Shluchim directories
- Public Tzach List announcements
- User-contributed corrections
- No private or sensitive information

### Error Handling

**Inference Errors:**
- Tag inferred relationships with confidence scores
- Allow manual verification
- Provide "Report incorrect relationship" option
- Learn from corrections to improve inference

**Missing Data:**
- Handle Shluchim with no known relationships
- Gracefully show "unknown" for missing hierarchy
- Suggest manual data entry for important relationships

**Graph Consistency:**
- Validate bidirectional relationships (if A is B's brother, B is A's brother)
- Prevent circular hierarchies (A reports to B, B reports to A)
- Detect and flag anomalies

## Alternatives Considered

### 1. Manual Relationship Spreadsheet
- **Pros:** Simple, full control
- **Cons:** No graph queries, hard to maintain, doesn't scale
- **Rejected:** Can't do path-finding or network analysis

### 2. CRM with Custom Fields
- **Pros:** Leverages existing CRM
- **Cons:** CRMs aren't designed for graph relationships
- **Rejected:** Limited relationship modeling

### 3. Social Network Analysis Tool (Gephi, etc.)
- **Pros:** Powerful visualization and analysis
- **Cons:** Not integrated with Andy, manual export/import
- **Rejected:** Need programmatic access for conversational queries

### 4. Build on LinkedIn/Facebook Social Graph
- **Pros:** Already has connections
- **Cons:** Privacy issues, not Shluchim-specific, missing organizational hierarchy
- **Rejected:** Wrong domain, missing key relationships

## Acceptance Criteria

### Graph Database
- [ ] Store nodes: Shluchim, organizations, yeshivas, families
- [ ] Store edges: organizational, family, educational, geographic
- [ ] Support for properties on nodes and edges
- [ ] Efficient graph traversal queries
- [ ] Handle 5,000+ Shluchim, 20,000+ relationships

### Relationship Types
- [ ] Organizational: REPORTS_TO (local, regional, national)
- [ ] Family: father, mother, sibling, child, in-law, etc.
- [ ] Educational: STUDIED_AT, STUDIED_WITH, MENTORED_BY
- [ ] Geographic: SAME_CITY, NEARBY, SAME_REGION
- [ ] Collaborative: COLLABORATES_WITH, SERVES_TOGETHER

### Data Population
- [ ] Import all Shluchim from shluchim.db as nodes
- [ ] Infer organizational hierarchy from organization names
- [ ] Infer family relationships from same last names
- [ ] Parse Tzach List for explicit relationships
- [ ] Calculate geographic relationships from coordinates
- [ ] Manual entry for confirmed relationships

### Graph Queries
- [ ] Get organizational hierarchy (tree view)
- [ ] Find shortest path between two Shluchim
- [ ] Get all relationships for a Shliach
- [ ] Find regional/national directors
- [ ] Find influential Shluchim (high degree centrality)
- [ ] Search by relationship type
- [ ] Query within N degrees of separation

### Andy Integration
- [ ] Enhanced Shliach profiles with relationship context
- [ ] "How am I connected to X?" path-finding
- [ ] "Who are the regional directors?" hierarchy queries
- [ ] "Show me the Cohen family Shluchim" family tree
- [ ] "Who are the most connected Shluchim?" network analysis
- [ ] Context for every Shliach mention

### Visualization
- [ ] Generate interactive graph visualization
- [ ] Export as PNG/SVG
- [ ] Color-code by organizational level
- [ ] Size nodes by connection count
- [ ] Label edges with relationship type
- [ ] Interactive: click to expand, hover for details

### Data Quality
- [ ] Tag inferred vs. confirmed relationships
- [ ] Confidence scores for inferred data
- [ ] Manual correction capability
- [ ] Validation rules (no circular hierarchies)
- [ ] Report incorrect relationship

## Technical Notes

### Relevant Files
- Database: `/workspace/project/data/knowledge_graph.db`
- Graph builder: `/workspace/project/graph/builder.py`
- Query API: `/workspace/project/graph/query.js`
- Visualization: `/workspace/project/graph/visualize.js`

### Dependencies
- SQLite for persistence
- `graphology` (JavaScript graph library) for in-memory queries
- `vis-network` or `cytoscape.js` for visualization
- `spacy` for NLP relationship extraction

### Performance
- **Database size:** ~100 MB for 5,000 Shluchim + 20,000 relationships
- **Load time:** ~2 seconds to load full graph into memory
- **Query time:** < 100ms for most queries (in-memory)
- **Path-finding:** < 500ms for 6 degrees of separation

### Maintenance
- **Weekly rebuild:** Re-infer relationships from updated data
- **Incremental updates:** Add new Shluchim and relationships daily
- **Manual corrections:** Override database for confirmed relationships
- **Validation:** Monthly consistency check

## Use Cases Unlocked

### 1. Introduction Requests
**User:** "Can you introduce me to Rabbi Schwartz in Austin?"
**Andy:** "You're connected through Rabbi Klein (your yeshiva classmate). Should I draft an introduction request?"

### 2. Hierarchy Navigation
**User:** "Who does Rabbi Cohen report to?"
**Andy:** "Rabbi Cohen reports to Rabbi Goldstein (Regional Director, Florida), who reports to Rabbi Kotlarsky (National Director, Merkos)."

### 3. Family Discovery
**User:** "Are there other Goldsteins who are Shluchim?"
**Andy:** "Yes, 8 Shluchim in the Goldstein family across 3 generations. [Shows family tree]"

### 4. Referral Networks
**User:** "Who should I contact about events in California?"
**Andy:** "Rabbi Klein is the Regional Director for California, supervising 62 Shluchim. You're connected through..."

### 5. Network Analysis
**User:** "Who are the key influencers in the network?"
**Andy:** "[Lists top 10 most connected Shluchim with connection paths]"

## Related

- Feature request: Shluchim List Local Cache (2026-03-04) - Provides node data
- Feature request: Tzach List Integration (2026-03-04) - Source of relationship data
- Feature request: Simcha & Levaya Monitoring (2026-03-04) - Family relationship insights

---

## Notes

This knowledge graph transforms the Shluchim network from a flat list into a rich, queryable social graph. The key insight: relationships matter as much as individual profiles. Knowing "Rabbi Cohen's brother-in-law" or "Regional Director for Florida supervising 47 Shluchim" provides crucial social context for networking, referrals, and relationship building.

The graph enables powerful queries that would be impossible with a traditional database: "How am I connected to X?" (path-finding), "Who are the most influential Shluchim?" (centrality analysis), "Show me the Cohen family tree" (relationship traversal).

**User's exact request:** "Produce a knowledge graph of entity relationships between shluchim. Every shliach has a head shliach. That shliach has a head shliach. There are shluchim that are regional national um and also there are family relationships ah ah so so use that to produce a knowledge graph um with different relationship types um and let's use that to map out how ah relationships function in this extended social network that is the network of shluchim."

**Next steps:**
1. Design graph schema (nodes + edge types)
2. Build initial graph from Shluchim DB
3. Implement inference algorithms for relationships
4. Create graph query API
5. Integrate with Andy for conversational queries
6. Build visualization system
