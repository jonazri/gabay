import type Database from 'better-sqlite3';
import type { AkiflowAuth } from './auth.js';
import { resolveAndUpsert, type ConflictCtx } from './conflict.js';
import type { ApiEntity } from './db.js';
import { logger } from './logger.js';

const V5_BASE = 'https://api.akiflow.com/v5';
const V3_BASE = 'https://api.akiflow.com/v3';
const POLL_INTERVAL_MS = 2000;
const MAX_BATCH_SIZE = 100;
const MAX_RETRIES = 5;

const VALID_ENTITIES = new Set([
  'tasks',
  'labels',
  'lists',
  'sections',
  'integrations',
  'events',
  'event_modifiers',
  'time_slots',
]);

const V3_ENTITIES = new Set(['events', 'event_modifiers']);

interface PendingWrite {
  id: number;
  entity: string;
  method: string;
  payload: string;
  status: string;
  retry_count: number;
  retry_after: number | null;
}

export function startPendingWritePoller(
  db: Database.Database,
  auth: AkiflowAuth,
): NodeJS.Timeout {
  // Stuck-row recovery is handled once at daemon startup (daemon.ts).
  // No need to duplicate it here — the poller only starts after recovery runs.

  let running = false;
  return setInterval(() => {
    if (running) return;
    running = true;
    processPendingWritesOnce(db, auth)
      .catch((e) => logger.error('[pending] poller error:', e))
      .finally(() => {
        running = false;
      });
  }, POLL_INTERVAL_MS);
}

export async function processPendingWritesOnce(
  db: Database.Database,
  auth: AkiflowAuth,
): Promise<void> {
  const rows = db
    .prepare(
      `
    SELECT * FROM pending_writes
    WHERE status = 'pending'
      AND (retry_after IS NULL OR retry_after <= ?)
    ORDER BY created_at ASC
    LIMIT ?
  `,
    )
    .all(Date.now(), MAX_BATCH_SIZE) as PendingWrite[];

  if (rows.length === 0) return;

  // Group by entity+method so different HTTP methods aren't mixed
  const byKey = new Map<string, PendingWrite[]>();
  for (const row of rows) {
    if (!VALID_ENTITIES.has(row.entity)) {
      db.prepare(
        `UPDATE pending_writes SET status = 'failed', error = ? WHERE id = ?`,
      ).run(`invalid entity: ${row.entity}`, row.id);
      continue;
    }
    const key = `${row.entity}:${row.method}`;
    const list = byKey.get(key) ?? [];
    list.push(row);
    byKey.set(key, list);
  }

  for (const [, writes] of byKey) {
    await processBatch(db, auth, writes[0].entity, writes);
  }
}

async function processBatch(
  db: Database.Database,
  auth: AkiflowAuth,
  entity: string,
  writes: PendingWrite[],
): Promise<void> {
  const ids = writes.map((w) => w.id);
  db.prepare(
    `UPDATE pending_writes SET status = 'processing' WHERE id IN (${ids.join(',')})`,
  ).run();

  const isV3 = V3_ENTITIES.has(entity);
  let url: string;
  if (entity === 'events') {
    url = `${V3_BASE}/events`;
  } else if (entity === 'event_modifiers') {
    url = `${V3_BASE}/events/modifiers`;
  } else {
    url = `${V5_BASE}/${entity}`;
  }
  const method = writes[0].method;
  try {
    const payloads = writes.map((w) => JSON.parse(w.payload));
    // V3 endpoints expect a single object per request; V5 accepts arrays
    if (isV3) {
      for (let i = 0; i < writes.length; i++) {
        const resp = await auth.fetchWithAuth(url, {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloads[i]),
        });
        if (!resp.ok)
          throw new Error(`${entity} ${method} failed: ${resp.status}`);
        const body = (await resp.json()) as { data: ApiEntity | ApiEntity[] };
        const returned = Array.isArray(body.data) ? body.data : [body.data];
        const ctx: ConflictCtx = { db, table: entity };
        for (const item of returned) {
          if (item?.id) resolveAndUpsert(ctx, item);
        }
        db.prepare(
          `UPDATE pending_writes SET status = 'done', processed_at = ? WHERE id = ?`,
        ).run(Date.now(), writes[i].id);
      }
    } else {
      const resp = await auth.fetchWithAuth(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloads),
      });
      if (!resp.ok)
        throw new Error(`${entity} ${method} failed: ${resp.status}`);
      const body = (await resp.json()) as { data: ApiEntity | ApiEntity[] };
      const returned = Array.isArray(body.data) ? body.data : [body.data];
      const ctx: ConflictCtx = { db, table: entity };
      for (const item of returned) {
        if (item?.id) resolveAndUpsert(ctx, item);
      }
    }

    // V5 batch: mark all done at once; V3 already marked individually above
    if (!isV3) {
      db.prepare(
        `UPDATE pending_writes SET status = 'done', processed_at = ? WHERE id IN (${ids.join(',')})`,
      ).run(Date.now());
    }

    logger.info(`[pending] ${entity}: ${writes.length} write(s) confirmed`);
  } catch (e) {
    const now = Date.now();
    // Exponential backoff: 2s, 4s, 8s, 16s, 32s (capped by MAX_RETRIES=5)
    // Uses max retry_count in the batch to compute a single delay
    const maxRetry = Math.max(...writes.map((w) => w.retry_count));
    const backoffMs = Math.min(2000 * Math.pow(2, maxRetry), 32_000);
    db.prepare(
      `
      UPDATE pending_writes
      SET
        retry_count = retry_count + 1,
        status = CASE
          WHEN retry_count + 1 >= ?
          THEN 'failed'
          ELSE 'pending'
        END,
        retry_after = CASE
          WHEN retry_count + 1 >= ?
          THEN NULL
          ELSE ?
        END,
        error = ?,
        processed_at = ?
      WHERE id IN (${ids.join(',')})
    `,
    ).run(MAX_RETRIES, MAX_RETRIES, now + backoffMs, String(e), now);

    const anyMaxed = writes.some((w) => w.retry_count + 1 >= MAX_RETRIES);
    if (anyMaxed) {
      logger.error(
        `[pending] ${entity}: writes failed after ${MAX_RETRIES} retries, ids=${ids.join(',')}`,
      );
    }
  }
}
