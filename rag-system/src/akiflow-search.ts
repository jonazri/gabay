import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import Database from 'better-sqlite3';

const COLLECTION = 'akiflow_entities';

interface SearchRequest {
  query: string;
  filters?: {
    entity_type?: 'task' | 'event';
    label?: string;
    org?: string;
    status?: string[];
    include_done?: boolean;
    include_deleted?: boolean;
  };
  limit?: number;
}

interface SearchResult {
  entity_type: string;
  entity_id: string;
  title: string;
  label: string | null;
  org: string | null;
  account: string | null;
  status: string;
  scheduled_date: string | null;
  start_time: string | null;
  priority: number;
  score: number;
}

export async function akiflowSearch(
  qdrant: QdrantClient,
  openai: OpenAI,
  db: Database.Database | null,
  req: SearchRequest,
): Promise<{ results: SearchResult[]; total: number }> {
  const t0 = Date.now();
  const rawLimit = Number(req.limit) || 10;
  const limit = Math.min(Math.max(Math.trunc(rawLimit), 1), 50);
  const filters = req.filters || {};
  console.log(`[akiflow-search] query="${req.query}" limit=${limit} filters=${JSON.stringify(filters)} db=${db ? 'yes' : 'no'}`);

  // Build Qdrant filter
  const must: Record<string, unknown>[] = [];
  if (!filters.include_done) must.push({ key: 'done', match: { value: false } });
  if (!filters.include_deleted) must.push({ key: 'deleted', match: { value: false } });
  if (filters.entity_type) must.push({ key: 'entity_type', match: { value: filters.entity_type } });
  if (filters.label) must.push({ key: 'label', match: { value: filters.label } });
  if (filters.org) must.push({ key: 'org', match: { value: filters.org } });

  // Vector search
  const tEmbed = Date.now();
  const embResponse = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: req.query,
  });
  const queryVector = embResponse.data[0].embedding;
  console.log(`[akiflow-search]   embed: ${Date.now() - tEmbed}ms`);

  const tQdrant = Date.now();
  const vectorResults = await qdrant.search(COLLECTION, {
    vector: queryVector,
    limit: limit * 4,
    filter: must.length > 0 ? { must } : undefined,
    with_payload: true,
    score_threshold: 0.2,
  });
  console.log(`[akiflow-search]   qdrant: ${Date.now() - tQdrant}ms → ${vectorResults.length} vector hits`);

  // Normalize vector scores to 0-1, dedup by title (recurring events share titles)
  const maxVectorScore = vectorResults.length > 0
    ? Math.max(...vectorResults.map((r) => r.score)) : 1;
  const vectorMap = new Map<string, { payload: Record<string, unknown>; score: number }>();
  for (const r of vectorResults) {
    const p = r.payload as Record<string, unknown>;
    const key = `${p.entity_type}:${p.title}`;
    const normalizedScore = r.score / maxVectorScore;
    const existing = vectorMap.get(key);
    if (!existing || normalizedScore > existing.score) {
      vectorMap.set(key, { payload: p, score: normalizedScore });
    }
  }

  // Keyword search via SQLite
  const tKeyword = Date.now();
  const keywordMap = new Map<string, { payload: Record<string, unknown>; score: number }>();
  if (db) {
    const terms = req.query.split(/\s+/).filter(Boolean);
    if (terms.length > 0) {
      const likeClauses = terms.map(() => 'lower(title) LIKE ?');
      const likeParams = terms.map((t) => `%${t.toLowerCase()}%`);
      const whereKeyword = likeClauses.join(' OR ');
      console.log(`[akiflow-search]   keyword SQL: WHERE (${whereKeyword}) params=${JSON.stringify(likeParams)}`);

      // Build extra filter clauses for keyword SQL
      const taskFilterClauses: string[] = [];
      const taskFilterParams: unknown[] = [...likeParams];
      if (!filters.include_done) { taskFilterClauses.push('AND done = 0'); }
      if (!filters.include_deleted) { taskFilterClauses.push('AND deleted_at IS NULL'); }
      if (filters.label) { taskFilterClauses.push('AND label = ?'); taskFilterParams.push(filters.label); }
      if (filters.org) { taskFilterClauses.push('AND org = ?'); taskFilterParams.push(filters.org); }

      // Search tasks
      if (filters.entity_type !== 'event') {
        const taskRows = db.prepare(`
          SELECT MIN(id) as id, title, status, label, org,
            scheduled_date, datetime, MAX(priority) as priority
          FROM tasks_display
          WHERE (${whereKeyword})
            ${taskFilterClauses.join(' ')}
          GROUP BY title
          LIMIT ${limit * 4}
        `).all(...taskFilterParams) as Record<string, unknown>[];
        console.log(`[akiflow-search]   keyword tasks: ${taskRows.length} hits`);

        for (const row of taskRows) {
          const titleLower = String(row.title).toLowerCase();
          const queryLower = req.query.toLowerCase();
          const score = titleLower === queryLower ? 1.0
            : titleLower.includes(queryLower) ? 0.7 : 0.4;
          keywordMap.set(`task:${row.title}`, {
            payload: {
              entity_type: 'task', entity_id: row.id, title: row.title,
              label: row.label, org: row.org, account: null,
              status: row.status, scheduled_date: row.scheduled_date,
              start_time: null, priority: row.priority || 0,
            },
            score,
          });
        }
      }

      // Search events
      if (filters.entity_type !== 'task') {
        const eventRows = db.prepare(`
          SELECT MIN(id) as id, title, MIN(start) as start,
            MIN(end) as end, account, status
          FROM events_view
          WHERE (${whereKeyword})
          GROUP BY title
          LIMIT ${limit * 4}
        `).all(...likeParams) as Record<string, unknown>[];
        console.log(`[akiflow-search]   keyword events: ${eventRows.length} hits`);

        for (const row of eventRows) {
          const titleLower = String(row.title).toLowerCase();
          const queryLower = req.query.toLowerCase();
          const score = titleLower === queryLower ? 1.0
            : titleLower.includes(queryLower) ? 0.7 : 0.4;
          keywordMap.set(`event:${row.title}`, {
            payload: {
              entity_type: 'event', entity_id: row.id, title: row.title,
              label: null, org: null, account: row.account,
              status: row.status, scheduled_date: null,
              start_time: row.start, priority: 0,
            },
            score,
          });
        }
      }
    }
    console.log(`[akiflow-search]   keyword total: ${Date.now() - tKeyword}ms → ${keywordMap.size} keyword hits`);
  } else {
    console.log(`[akiflow-search]   keyword: SKIPPED (no db)`);
  }

  // Merge: 0.6 vector + 0.4 keyword
  const combined = new Map<string, SearchResult>();
  const allKeys = new Set([...vectorMap.keys(), ...keywordMap.keys()]);
  const bothPaths: string[] = [];
  const vectorOnly: string[] = [];
  const keywordOnly: string[] = [];
  for (const key of allKeys) {
    const v = vectorMap.get(key);
    const k = keywordMap.get(key);
    const vectorScore = v?.score || 0;
    const keywordScore = k?.score || 0;
    const finalScore = 0.6 * vectorScore + 0.4 * keywordScore;
    const payload = (v?.payload || k?.payload)!;
    const title = String(payload.title);
    if (v && k) bothPaths.push(`${title} (v=${vectorScore.toFixed(2)} k=${keywordScore.toFixed(2)} → ${finalScore.toFixed(2)})`);
    else if (v) vectorOnly.push(`${title} (v=${vectorScore.toFixed(2)} → ${finalScore.toFixed(2)})`);
    else keywordOnly.push(`${title} (k=${keywordScore.toFixed(2)} → ${finalScore.toFixed(2)})`);
    combined.set(key, {
      entity_type: String(payload.entity_type),
      entity_id: String(payload.entity_id),
      title,
      label: payload.label ? String(payload.label) : null,
      org: payload.org ? String(payload.org) : null,
      account: payload.account ? String(payload.account) : null,
      status: String(payload.status),
      scheduled_date: payload.scheduled_date ? String(payload.scheduled_date) : null,
      start_time: payload.start_time ? String(payload.start_time) : null,
      priority: Number(payload.priority || 0),
      score: Math.round(finalScore * 100) / 100,
    });
  }

  const results = [...combined.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  console.log(`[akiflow-search]   merge: ${allKeys.size} unique entities (${bothPaths.length} both, ${vectorOnly.length} vector-only, ${keywordOnly.length} keyword-only)`);
  if (bothPaths.length > 0) console.log(`[akiflow-search]     both: ${bothPaths.join('; ')}`);
  if (vectorOnly.length > 0) console.log(`[akiflow-search]     vector-only: ${vectorOnly.join('; ')}`);
  if (keywordOnly.length > 0) console.log(`[akiflow-search]     keyword-only: ${keywordOnly.join('; ')}`);
  console.log(`[akiflow-search]   returned ${results.length} results in ${Date.now() - t0}ms`);

  return { results, total: results.length };
}
