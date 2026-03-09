import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import Database from 'better-sqlite3';
import crypto from 'crypto';
import { logger } from './logger.js';

const COLLECTION = 'akiflow_entities';
const VECTOR_SIZE = 1536;
const POLL_INTERVAL_MS = 5000;
const BATCH_SIZE = 100;

const pendingIndex = new Map<string, Set<string>>();
let pendingMetadataRefresh = false;

export function markForReindex(table: string, id: string): void {
  if (table === 'labels' || table === 'accounts') {
    pendingMetadataRefresh = true;
    return;
  }
  if (table !== 'tasks' && table !== 'events') return;
  if (!pendingIndex.has(table)) pendingIndex.set(table, new Set());
  pendingIndex.get(table)!.add(id);
}

export function pointId(entityType: string, entityId: string): string {
  const hash = crypto.createHash('md5').update(`${entityType}:${entityId}`).digest('hex');
  return [
    hash.slice(0, 8), hash.slice(8, 12), hash.slice(12, 16),
    hash.slice(16, 20), hash.slice(20, 32),
  ].join('-');
}

export function formatTaskText(row: Record<string, unknown>): string {
  const parts = [`[Task] ${String(row.title ?? '')}`];
  if (row.label) parts.push(`Project: ${row.label}`);
  if (row.org && row.org !== row.label) parts.push(`Org: ${row.org}`);
  if (row.status) parts.push(`Status: ${row.status}`);
  if (row.description) {
    const desc = String(row.description).slice(0, 200);
    parts.push(desc);
  }
  return parts.join(' | ');
}

export function formatEventText(row: Record<string, unknown>): string {
  const parts = [`[Event] ${String(row.title ?? '')}`];
  if (row.account) parts.push(`Account: ${row.account}`);
  if (row.description) {
    const desc = String(row.description).slice(0, 200);
    parts.push(desc);
  }
  return parts.join(' | ');
}

export async function ensureCollection(qdrant: QdrantClient): Promise<void> {
  const collections = await qdrant.getCollections();
  if (collections.collections.some((c) => c.name === COLLECTION)) return;
  await qdrant.createCollection(COLLECTION, {
    vectors: { size: VECTOR_SIZE, distance: 'Cosine' },
  });
  for (const field of ['entity_type', 'label', 'org', 'status', 'done', 'deleted']) {
    await qdrant.createPayloadIndex(COLLECTION, {
      field_name: field,
      field_schema: field === 'done' || field === 'deleted' ? 'bool' : 'keyword',
    });
  }
  await qdrant.createPayloadIndex(COLLECTION, {
    field_name: 'priority',
    field_schema: 'integer',
  });
  logger.info(`[indexer] created collection ${COLLECTION}`);
}

async function processBatch(
  db: Database.Database,
  openai: OpenAI,
  qdrant: QdrantClient,
  table: string,
  ids: string[],
): Promise<void> {
  interface EntityPayload {
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
    done: boolean;
    deleted: boolean;
    updated_at: number;
  }

  const entities: { payload: EntityPayload; text: string }[] = [];

  if (table === 'tasks') {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, title, status, done, label, org, scheduled_date,
        datetime, priority, description, deleted_at
      FROM tasks_display WHERE id IN (${placeholders})
    `).all(...ids) as Record<string, unknown>[];

    for (const row of rows) {
      entities.push({
        payload: {
          entity_type: 'task',
          entity_id: String(row.id),
          title: String(row.title || ''),
          label: row.label ? String(row.label) : null,
          org: row.org ? String(row.org) : null,
          account: null,
          status: String(row.status || 'unknown'),
          scheduled_date: row.scheduled_date ? String(row.scheduled_date) : null,
          start_time: null,
          priority: Number(row.priority || 0),
          done: Boolean(row.done),
          deleted: row.deleted_at != null,
          updated_at: Date.now(),
        },
        text: formatTaskText(row),
      });
    }

    // Tombstone tasks not found in tasks_display (hard-deleted)
    const foundTaskIds = new Set(rows.map((r) => String(r.id)));
    const missingTaskIds = ids.filter((id) => !foundTaskIds.has(id));
    for (const id of missingTaskIds) {
      try {
        await qdrant.setPayload(COLLECTION, {
          points: [pointId('task', id)],
          payload: { deleted: true, updated_at: Date.now() },
        });
      } catch { /* point may not exist yet */ }
    }
  } else if (table === 'events') {
    const placeholders = ids.map(() => '?').join(',');
    const rows = db.prepare(`
      SELECT id, title, start, end, account, description, status, recurring
      FROM events_view WHERE id IN (${placeholders})
    `).all(...ids) as Record<string, unknown>[];

    for (const row of rows) {
      entities.push({
        payload: {
          entity_type: 'event',
          entity_id: String(row.id),
          title: String(row.title || ''),
          label: null,
          org: null,
          account: row.account ? String(row.account) : null,
          status: String(row.status || ''),
          scheduled_date: null,
          start_time: row.start ? String(row.start) : null,
          priority: 0,
          done: false,
          deleted: false,
          updated_at: Date.now(),
        },
        text: formatEventText(row),
      });
    }

    // Tombstone events not found in events_view (deleted/cancelled/declined)
    const foundEventIds = new Set(rows.map((r) => String(r.id)));
    const missingEventIds = ids.filter((id) => !foundEventIds.has(id));
    for (const id of missingEventIds) {
      try {
        await qdrant.setPayload(COLLECTION, {
          points: [pointId('event', id)],
          payload: { deleted: true, updated_at: Date.now() },
        });
      } catch { /* point may not exist yet */ }
    }
  }

  if (entities.length === 0) return;

  const texts = entities.map((e) => e.text);
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: texts,
  });
  const vectors = response.data
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);

  const points = entities.map((e, i) => ({
    id: pointId(e.payload.entity_type, e.payload.entity_id),
    vector: vectors[i],
    payload: e.payload as unknown as Record<string, unknown>,
  }));

  await qdrant.upsert(COLLECTION, { points, wait: true });
  logger.info(`[indexer] indexed ${points.length} ${table}`);
}

export async function startIndexer(db: Database.Database): Promise<void> {
  const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.info('[indexer] OPENAI_API_KEY not set, vector indexing disabled');
    return;
  }

  const qdrant = new QdrantClient({ url: qdrantUrl });
  const openai = new OpenAI({ apiKey });

  try {
    await ensureCollection(qdrant);
  } catch (err) {
    logger.error(`[indexer] failed to initialize Qdrant collection, vector indexing disabled: ${err}`);
    return;
  }

  let running = false;
  setInterval(async () => {
    if (running) return;
    running = true;
    try {
      if (pendingMetadataRefresh) {
        pendingMetadataRefresh = false;
        const taskIds = db
          .prepare("SELECT id FROM tasks WHERE json_extract(data,'$.deleted_at') IS NULL")
          .all() as { id: string }[];
        for (const { id } of taskIds) markForReindex('tasks', id);
        logger.info(`[indexer] metadata refresh: queued ${taskIds.length} tasks for reindex`);
      }

      for (const [table, ids] of pendingIndex.entries()) {
        if (ids.size === 0) continue;
        const batch = [...ids].slice(0, BATCH_SIZE);
        try {
          await processBatch(db, openai, qdrant, table, batch);
          batch.forEach((id) => ids.delete(id));
        } catch (err) {
          logger.error(`[indexer] failed to process ${table} batch: ${err}`);
        }
        if (ids.size === 0) pendingIndex.delete(table);
      }
    } catch (err) {
      logger.error(`[indexer] error: ${err}`);
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);

  logger.info('[indexer] started (5s poll interval)');
}
