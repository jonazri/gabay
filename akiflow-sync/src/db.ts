import Database from 'better-sqlite3';

export const ENTITIES_V5 = [
  'tasks', 'labels', 'tags', 'time_slots',
  'calendars', 'accounts',
] as const;

export const ENTITIES_V3 = ['events', 'event_modifiers'] as const;

export type EntityV5 = typeof ENTITIES_V5[number];
export type EntityV3 = typeof ENTITIES_V3[number];

export interface ApiEntity {
  id: string;
  global_updated_at?: string | null;
  deleted_at?: string | null;
  [key: string]: unknown;
}

export function initDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  for (const entity of [...ENTITIES_V5, ...ENTITIES_V3]) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ${entity} (
        id                TEXT PRIMARY KEY,
        data              TEXT NOT NULL,
        updated_at        INTEGER,
        global_updated_at INTEGER,
        deleted_at        INTEGER,
        synced_at         INTEGER
      )
    `);
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_tasks_status
      ON tasks(json_extract(data,'$.status'));
    CREATE INDEX IF NOT EXISTS idx_tasks_date
      ON tasks(json_extract(data,'$.date'));
    CREATE INDEX IF NOT EXISTS idx_tasks_done
      ON tasks(json_extract(data,'$.done'));
    CREATE INDEX IF NOT EXISTS idx_events_start
      ON events(json_extract(data,'$.start'));

    CREATE TABLE IF NOT EXISTS sync_tokens (
      entity      TEXT PRIMARY KEY,
      token       TEXT NOT NULL,
      updated_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS v3_sync_state (
      entity       TEXT PRIMARY KEY,
      last_sync_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_writes (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      entity       TEXT NOT NULL,
      method       TEXT NOT NULL,
      payload      TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      retry_count  INTEGER NOT NULL DEFAULT 0,
      error        TEXT,
      created_at   INTEGER NOT NULL,
      processed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_pending_status
      ON pending_writes(status, created_at);
  `);

  return db;
}

export function upsertEntity(
  db: Database.Database,
  table: string,
  entity: ApiEntity,
): void {
  const globalUpdatedAt = entity.global_updated_at
    ? new Date(entity.global_updated_at).getTime()
    : null;
  const deletedAt = entity.deleted_at
    ? new Date(entity.deleted_at).getTime()
    : null;

  db.prepare(`
    INSERT OR REPLACE INTO ${table}
      (id, data, global_updated_at, deleted_at, synced_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    entity.id,
    JSON.stringify(entity),
    globalUpdatedAt,
    deletedAt,
    Date.now(),
  );
}

export interface EntityRow {
  id: string;
  data: string;
  updated_at: number | null;
  global_updated_at: number | null;
  deleted_at: number | null;
  synced_at: number | null;
}

export function getEntity(
  db: Database.Database,
  table: string,
  id: string,
): EntityRow | undefined {
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as EntityRow | undefined;
}

export function getSyncToken(db: Database.Database, entity: string): string | null {
  const row = db.prepare(
    'SELECT token FROM sync_tokens WHERE entity = ?'
  ).get(entity) as { token: string } | undefined;
  return row?.token ?? null;
}

export function setSyncToken(db: Database.Database, entity: string, token: string): void {
  db.prepare(`
    INSERT OR REPLACE INTO sync_tokens (entity, token, updated_at)
    VALUES (?, ?, ?)
  `).run(entity, token, Date.now());
}

export function getV3SyncState(db: Database.Database, entity: string): number | null {
  const row = db.prepare(
    'SELECT last_sync_at FROM v3_sync_state WHERE entity = ?'
  ).get(entity) as { last_sync_at: number } | undefined;
  return row?.last_sync_at ?? null;
}

export function setV3SyncState(db: Database.Database, entity: string, lastSyncAt: number): void {
  db.prepare(`
    INSERT OR REPLACE INTO v3_sync_state (entity, last_sync_at)
    VALUES (?, ?)
  `).run(entity, lastSyncAt);
}
