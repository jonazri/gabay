import type Database from 'better-sqlite3';
import { getSyncToken, setSyncToken, type ApiEntity } from '../db.js';
import { resolveAndUpsert } from '../conflict.js';
import type { AkiflowAuth } from '../auth.js';
import { logger } from '../logger.js';

const V5_BASE = 'https://api.akiflow.com/v5';
const PAGE_LIMIT = 2500;

export async function syncV5Entity(
  db: Database.Database,
  entity: string,
  auth: AkiflowAuth,
): Promise<void> {
  let token = getSyncToken(db, entity) ?? '';
  let hasNextPage = true;
  let pageCount = 0;

  while (hasNextPage) {
    const url = `${V5_BASE}/${entity}?limit=${PAGE_LIMIT}&sync_token=${encodeURIComponent(token)}`;
    const resp = await auth.fetchWithAuth(url);
    if (!resp.ok) throw new Error(`V5 sync ${entity} failed: ${resp.status}`);

    const body = (await resp.json()) as {
      data: ApiEntity[];
      has_next_page: boolean;
      sync_token: string;
    };

    for (const item of body.data) {
      resolveAndUpsert({ db, table: entity }, item);
    }

    if (body.sync_token) {
      token = body.sync_token;
      setSyncToken(db, entity, token);
    }

    hasNextPage = body.has_next_page ?? false;
    pageCount++;
  }

  logger.info(`[v5] synced ${entity} (${pageCount} page(s))`);
}
