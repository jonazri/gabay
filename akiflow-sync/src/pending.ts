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
}

export function startPendingWritePoller(
  db: Database.Database,
  auth: AkiflowAuth,
): NodeJS.Timeout {
  // Recover rows stuck in 'processing' from a previous crash
  const recovered = db
    .prepare(
      `UPDATE pending_writes SET status = 'pending' WHERE status = 'processing'`,
    )
    .run();
  if (recovered.changes > 0) {
    logger.info(
      `[pending] recovered ${recovered.changes} stuck processing write(s)`,
    );
  }

  return setInterval(() => {
    processPendingWritesOnce(db, auth).catch((e) =>
      logger.error('[pending] poller error:', e),
    );
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
    ORDER BY created_at ASC
    LIMIT ?
  `,
    )
    .all(MAX_BATCH_SIZE) as PendingWrite[];

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
  const payloads = writes.map((w) => JSON.parse(w.payload));

  try {
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

    db.prepare(
      `UPDATE pending_writes SET status = 'done', processed_at = ? WHERE id IN (${ids.join(',')})`,
    ).run(Date.now());

    logger.info(`[pending] ${entity}: ${writes.length} write(s) confirmed`);
  } catch (e) {
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
        error = ?,
        processed_at = ?
      WHERE id IN (${ids.join(',')})
    `,
    ).run(MAX_RETRIES, String(e), Date.now());

    const anyMaxed = writes.some((w) => w.retry_count + 1 >= MAX_RETRIES);
    if (anyMaxed) {
      logger.error(
        `[pending] ${entity}: writes failed after ${MAX_RETRIES} retries, ids=${ids.join(',')}`,
      );
    }
  }
}
