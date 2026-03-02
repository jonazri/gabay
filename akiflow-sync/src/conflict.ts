import type Database from 'better-sqlite3';
import { getEntity, upsertEntity, type ApiEntity } from './db.js';

export interface ConflictCtx {
  db: Database.Database;
  table: string;
}

export function resolveAndUpsert(ctx: ConflictCtx, remote: ApiEntity): void {
  const local = getEntity(ctx.db, ctx.table, remote.id);

  if (!local) {
    upsertEntity(ctx.db, ctx.table, remote);
    return;
  }

  const remoteTs = toMs(remote.global_updated_at as string | null);
  const localTs = local.global_updated_at ?? 0;

  if (remoteTs > localTs) {
    // Remote wins globally — apply, but protect locally-newer fields for tasks
    const entity = ctx.table === 'tasks'
      ? protectLocalFields(remote, local.data)
      : remote;
    upsertEntity(ctx.db, ctx.table, entity);
  } else {
    // Local wins globally — keep local, but apply remotely-newer fields for tasks
    if (ctx.table === 'tasks') {
      applyNewerRemoteFields(ctx, remote, local.data);
    }
  }
}

/** When remote wins globally: preserve local field values that are newer. */
function protectLocalFields(remote: ApiEntity, localDataJson: string): ApiEntity {
  const local = JSON.parse(localDataJson) as Record<string, unknown>;
  const entity = { ...remote };

  const remoteListTs = toMs(remote.global_list_id_updated_at as string | null);
  const localListTs = toMs(local.list_id_updated_at as string | null);
  if (localListTs > remoteListTs) {
    entity.listId = local.listId;
    entity.sectionId = local.sectionId;
  }

  const remoteTagsTs = toMs(remote.global_tags_ids_updated_at as string | null);
  const localTagsTs = toMs(local.tags_ids_updated_at as string | null);
  if (localTagsTs > remoteTagsTs) {
    entity.tags_ids = local.tags_ids;
  }

  return entity;
}

/** When local wins globally: apply remote field values that are newer. */
function applyNewerRemoteFields(
  ctx: ConflictCtx,
  remote: ApiEntity,
  localDataJson: string,
): void {
  const local = JSON.parse(localDataJson) as Record<string, unknown>;
  let changed = false;

  const remoteListTs = toMs(remote.global_list_id_updated_at as string | null);
  const localListTs = toMs(local.list_id_updated_at as string | null);
  if (remoteListTs > localListTs) {
    local.listId = remote.listId;
    local.sectionId = remote.sectionId;
    local.global_list_id_updated_at = remote.global_list_id_updated_at;
    changed = true;
  }

  const remoteTagsTs = toMs(remote.global_tags_ids_updated_at as string | null);
  const localTagsTs = toMs(local.tags_ids_updated_at as string | null);
  if (remoteTagsTs > localTagsTs) {
    local.tags_ids = remote.tags_ids;
    local.global_tags_ids_updated_at = remote.global_tags_ids_updated_at;
    changed = true;
  }

  if (changed) {
    upsertEntity(ctx.db, ctx.table, local as ApiEntity);
  }
}

function toMs(isoStr: string | null | undefined): number {
  if (!isoStr) return 0;
  const ms = new Date(isoStr).getTime();
  return isNaN(ms) ? 0 : ms;
}
