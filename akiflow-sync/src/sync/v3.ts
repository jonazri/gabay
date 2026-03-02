import type Database from 'better-sqlite3';
import { getV3SyncState, setV3SyncState, upsertEntity, type ApiEntity } from '../db.js';
import type { AkiflowAuth } from '../auth.js';
import { logger } from '../logger.js';

const V3_BASE = 'https://api.akiflow.com/v3';

export async function syncV3Entity(
  db: Database.Database,
  entity: 'events' | 'event_modifiers',
  auth: AkiflowAuth,
): Promise<void> {
  const lastSyncAt = getV3SyncState(db, entity);
  const isFirst = lastSyncAt === null;
  const apiPath = entity === 'events' ? '/events' : '/events/modifiers';

  let nextPageUrl: string | null = null;
  let maxUpdatedAt = lastSyncAt ?? 0;
  let pageCount = 0;

  do {
    let url: string;
    if (nextPageUrl) {
      url = nextPageUrl;
    } else {
      url = `${V3_BASE}${apiPath}?per_page=2500&with_deleted=${!isFirst}`;
      if (lastSyncAt) {
        url += `&updatedAfter=${new Date(lastSyncAt).toISOString()}`;
      }
    }

    const resp = await auth.fetchWithAuth(url);
    if (!resp.ok) throw new Error(`V3 sync ${entity} failed: ${resp.status}`);

    const body = await resp.json() as {
      data: ApiEntity[];
      next_page_url: string | null;
    };

    for (const item of body.data) {
      upsertEntity(db, entity, item);
      const itemTs = item.updated_at
        ? new Date(item.updated_at as string).getTime()
        : 0;
      if (!isNaN(itemTs) && itemTs > maxUpdatedAt) maxUpdatedAt = itemTs;
    }

    nextPageUrl = body.next_page_url;
    pageCount++;
  } while (nextPageUrl);

  if (maxUpdatedAt > 0) {
    setV3SyncState(db, entity, maxUpdatedAt);
  }

  logger.info(`[v3] synced ${entity} (${pageCount} page(s))`);
}
