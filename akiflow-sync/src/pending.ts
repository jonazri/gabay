import type Database from 'better-sqlite3';
import type { AkiflowAuth } from './auth.js';
import { resolveAndUpsert, type ConflictCtx } from './conflict.js';
import type { ApiEntity } from './db.js';
import { logger } from './logger.js';

const V5_BASE = 'https://api.akiflow.com/v5';
const V3_BASE = 'https://api.akiflow.com/v3';
const POLL_INTERVAL_MS = 100;
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 5;

interface PendingWrite {
  id: number;
  entity: string;
  method: string;
  payload: string;
  status: string;
  retry_count: number;
}

export function startPendingWritePoller(
  db: Database.Database,
  auth: AkiflowAuth,
): NodeJS.Timeout {
  return setInterval(() => {
    processPendingWritesOnce(db, auth).catch(e =>
      logger.error('[pending] poller error:', e)
    );
  }, POLL_INTERVAL_MS);
}

export async function processPendingWritesOnce(
  db: Database.Database,
  auth: AkiflowAuth,
): Promise<void> {
  const rows = db.prepare(`
    SELECT * FROM pending_writes
    WHERE status = 'pending'
    ORDER BY created_at ASC
    LIMIT ?
  `).all(MAX_BATCH_SIZE) as PendingWrite[];

  if (rows.length === 0) return;

  // Group by entity for batching
  const byEntity = new Map<string, PendingWrite[]>();
  for (const row of rows) {
    const list = byEntity.get(row.entity) ?? [];
    list.push(row);
    byEntity.set(row.entity, list);
  }

  for (const [entity, writes] of byEntity) {
    await processBatch(db, auth, entity, writes);
  }
}

async function processBatch(
  db: Database.Database,
  auth: AkiflowAuth,
  entity: string,
  writes: PendingWrite[],
): Promise<void> {
  const ids = writes.map(w => w.id);
  db.prepare(
    `UPDATE pending_writes SET status = 'processing' WHERE id IN (${ids.join(',')})`
  ).run();

  const isV3 = entity === 'events' || entity === 'event_modifiers';
  const url = isV3 ? `${V3_BASE}/events` : `${V5_BASE}/${entity}`;
  const payloads = writes.map(w => JSON.parse(w.payload));

  try {
    const resp = await auth.fetchWithAuth(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payloads),
    });

    if (!resp.ok) throw new Error(`${entity} PATCH failed: ${resp.status}`);

    const body = await resp.json() as { data: ApiEntity | ApiEntity[] };
    const returned = Array.isArray(body.data) ? body.data : [body.data];
    const ctx: ConflictCtx = { db, table: entity };
    for (const item of returned) {
      if (item?.id) resolveAndUpsert(ctx, item);
    }

    db.prepare(
      `UPDATE pending_writes SET status = 'done', processed_at = ? WHERE id IN (${ids.join(',')})`
    ).run(Date.now());

    logger.info(`[pending] ${entity}: ${writes.length} write(s) confirmed`);
  } catch (e) {
    const isMaxRetry = writes[0].retry_count >= MAX_RETRIES - 1;
    const newStatus = isMaxRetry ? 'failed' : 'pending';

    db.prepare(`
      UPDATE pending_writes
      SET status = ?, retry_count = retry_count + 1, error = ?, processed_at = ?
      WHERE id IN (${ids.join(',')})
    `).run(newStatus, String(e), Date.now());

    if (isMaxRetry) {
      logger.error(`[pending] ${entity}: writes failed after ${MAX_RETRIES} retries, ids=${ids.join(',')}`);
    }
  }
}
