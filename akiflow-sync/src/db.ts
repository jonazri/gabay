import Database from 'better-sqlite3';

// 'settings' excluded — Akiflow V5 /settings returns 404; settings are
// embedded in the account object returned by /accounts.
export const ENTITIES_V5 = [
  'tasks',
  'labels',
  'tags',
  'time_slots',
  'calendars',
  'accounts',
] as const;

export const ENTITIES_V3 = ['events', 'event_modifiers'] as const;

export type EntityV5 = (typeof ENTITIES_V5)[number];
export type EntityV3 = (typeof ENTITIES_V3)[number];

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
      ON events(json_extract(data,'$.start_time'));

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
      retry_after  INTEGER,
      error        TEXT,
      created_at   INTEGER NOT NULL,
      processed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_pending_status
      ON pending_writes(status, created_at);

    CREATE TABLE IF NOT EXISTS event_instances (
      instance_id   TEXT PRIMARY KEY,
      master_id     TEXT NOT NULL,
      title         TEXT,
      start_time    TEXT,
      end_time      TEXT,
      timezone      TEXT,
      calendar_id   TEXT,
      calendar_name TEXT,
      description   TEXT,
      status        TEXT,
      declined      INTEGER DEFAULT 0,
      organizer     TEXT,
      expanded_at   INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_event_instances_start
      ON event_instances(start_time);
  `);

  // Views for convenient querying by container agent and smoke tests
  db.exec(`
    CREATE VIEW IF NOT EXISTS labels_view AS
    SELECT
      json_extract(data, '$.id')         AS id,
      json_extract(data, '$.title')      AS title,
      json_extract(data, '$.color')      AS color,
      json_extract(data, '$.is_tag')     AS is_tag,
      json_extract(data, '$.folder_id')  AS folder_id,
      json_extract(data, '$.sorting')    AS sorting,
      json_extract(data, '$.deleted_at') AS deleted_at,
      data
    FROM labels;

    -- Raw union of single events + expanded recurring instances (internal)
    CREATE VIEW IF NOT EXISTS events_raw AS
    SELECT
      json_extract(data, '$.id')                AS id,
      json_extract(data, '$.title')             AS title,
      json_extract(data, '$.start_time')        AS start,
      json_extract(data, '$.end_time')          AS end,
      json_extract(data, '$.start_datetime_tz') AS timezone,
      json_extract(data, '$.origin_calendar_id') AS calendar_name,
      json_extract(data, '$.description')       AS description,
      json_extract(data, '$.status')            AS status,
      COALESCE(json_extract(data, '$.declined'), 0) AS declined,
      json_extract(data, '$.organizer_id')      AS organizer,
      0                                         AS recurring,
      json_extract(data, '$.deleted_at')        AS deleted_at
    FROM events
    WHERE (json_extract(data, '$.recurrence') IS NULL
       OR json_extract(data, '$.recurrence') = '[]')
    UNION ALL
    SELECT
      instance_id   AS id,
      title,
      start_time    AS start,
      end_time      AS end,
      timezone,
      calendar_name,
      description,
      status,
      declined,
      organizer,
      1             AS recurring,
      NULL          AS deleted_at
    FROM event_instances;

    -- Deduped, filtered view for agent consumption
    CREATE VIEW IF NOT EXISTS events_view AS
    SELECT
      MIN(id)                                AS id,
      title,
      start,
      MIN(end)                               AS end,
      MIN(timezone)                          AS timezone,
      GROUP_CONCAT(DISTINCT calendar_name)   AS calendar,
      MIN(description)                       AS description,
      status,
      MAX(recurring)                         AS recurring,
      MIN(organizer)                         AS organizer,
      CASE
        WHEN MIN(calendar_name) LIKE '%myjli.com'              THEN 'JLI'
        WHEN MIN(calendar_name) LIKE '%tefillinconnection.org'  THEN 'TTO'
        WHEN MIN(calendar_name) LIKE '%dichalane.com'           THEN 'DLN'
        WHEN MIN(calendar_name) LIKE '%gmail.com'               THEN 'Personal'
        ELSE MIN(calendar_name)
      END                                    AS account
    FROM events_raw
    WHERE deleted_at IS NULL
      AND status != 'cancelled'
      AND declined = 0
      AND start IS NOT NULL
    GROUP BY title, start;

    CREATE VIEW IF NOT EXISTS calendars_view AS
    SELECT
      json_extract(data, '$.id')         AS id,
      json_extract(data, '$.title')      AS title,
      json_extract(data, '$.color')      AS color,
      json_extract(data, '$.deleted_at') AS deleted_at,
      data
    FROM calendars;

    CREATE VIEW IF NOT EXISTS accounts_view AS
    SELECT
      json_extract(data, '$.id')         AS id,
      json_extract(data, '$.identifier') AS identifier,
      json_extract(data, '$.connector')  AS connector,
      json_extract(data, '$.deleted_at') AS deleted_at,
      data
    FROM accounts;

    CREATE VIEW IF NOT EXISTS tags_view AS
    SELECT
      json_extract(data, '$.id')         AS id,
      json_extract(data, '$.title')      AS title,
      json_extract(data, '$.color')      AS color,
      json_extract(data, '$.deleted_at') AS deleted_at,
      data
    FROM tags;

    CREATE VIEW IF NOT EXISTS time_slots_view AS
    SELECT
      json_extract(data, '$.id')         AS id,
      json_extract(data, '$.title')      AS title,
      json_extract(data, '$.date')       AS date,
      json_extract(data, '$.start')      AS start,
      json_extract(data, '$.end')        AS end,
      json_extract(data, '$.deleted_at') AS deleted_at,
      data
    FROM time_slots;

    CREATE VIEW IF NOT EXISTS tasks_display AS
    SELECT
      json_extract(t.data, '$.id')                  AS id,
      json_extract(t.data, '$.title')               AS title,
      CASE json_extract(t.data, '$.status')
        WHEN 1  THEN 'inbox'
        WHEN 2  THEN 'planned'
        WHEN 3  THEN 'completed'
        WHEN 4  THEN 'snoozed'
        WHEN 5  THEN 'archived'
        WHEN 6  THEN 'deleted'
        WHEN 7  THEN 'someday'
        WHEN 8  THEN 'hidden'
        WHEN 9  THEN 'permanently_deleted'
        WHEN 10 THEN 'trashed'
        WHEN 11 THEN 'cancelled'
        ELSE         'unknown(' || json_extract(t.data, '$.status') || ')'
      END                                           AS status,
      json_extract(t.data, '$.done')                AS done,
      json_extract(t.data, '$.listId')              AS list_id,
      l.title                                       AS label,
      CASE
        WHEN json_extract(t.data, '$.connector_id') IN ('gmail', 'google')
             AND a.identifier LIKE '%myjli.com'              THEN 'JLI'
        WHEN json_extract(t.data, '$.connector_id') IN ('gmail', 'google')
             AND a.identifier LIKE '%tefillinconnection.org'  THEN 'TTO'
        WHEN json_extract(t.data, '$.connector_id') IN ('gmail', 'google')
             AND a.identifier LIKE '%dichalane.com'           THEN 'DLN'
        WHEN json_extract(t.data, '$.connector_id') IN ('gmail', 'google')
             AND a.identifier LIKE '%gmail.com'               THEN 'Personal'
        ELSE l.title
      END                                           AS org,
      json_extract(t.data, '$.tags_ids')            AS tags_ids,
      CASE
        WHEN json_extract(t.data, '$.date') IS NOT NULL
             AND json_extract(t.data, '$.date') != ''
          THEN json_extract(t.data, '$.date')
        WHEN json_extract(t.data, '$.plan_unit') = 'MONTH'
             AND length(json_extract(t.data, '$.plan_period')) = 6
          THEN date(
            substr(json_extract(t.data, '$.plan_period'), 1, 4) || '-'
            || substr(json_extract(t.data, '$.plan_period'), 5, 2) || '-01',
            '+1 month', '-1 day')
        WHEN json_extract(t.data, '$.plan_unit') = 'WEEK'
             AND length(json_extract(t.data, '$.plan_period')) = 6
          THEN date(
            substr(json_extract(t.data, '$.plan_period'), 1, 4) || '-01-04',
            'weekday 0',
            '+' || ((CAST(substr(json_extract(t.data, '$.plan_period'), 5, 2) AS INTEGER) - 1) * 7) || ' days')
        ELSE NULL
      END                                           AS scheduled_date,
      json_extract(t.data, '$.datetime')            AS datetime,
      json_extract(t.data, '$.plan_unit')           AS plan_unit,
      json_extract(t.data, '$.plan_period')         AS plan_period,
      json_extract(t.data, '$.priority')            AS priority,
      json_extract(t.data, '$.description')         AS description,
      json_extract(t.data, '$.links')               AS links,
      json_extract(t.data, '$.connector_id')        AS connector_id,
      json_extract(t.data, '$.due_date')            AS due_date,
      json_extract(t.data, '$.sorting')             AS sorting,
      json_extract(t.data, '$.global_created_at')   AS global_created_at,
      json_extract(t.data, '$.deleted_at')          AS deleted_at,
      t.data
    FROM tasks t
    LEFT JOIN labels_view l ON json_extract(t.data, '$.listId') = l.id
    LEFT JOIN accounts_view a ON json_extract(t.data, '$.akiflow_account_id') = a.id;
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

  db.prepare(
    `
    INSERT OR REPLACE INTO ${table}
      (id, data, global_updated_at, deleted_at, synced_at)
    VALUES (?, ?, ?, ?, ?)
  `,
  ).run(
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
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as
    | EntityRow
    | undefined;
}

export function getSyncToken(
  db: Database.Database,
  entity: string,
): string | null {
  const row = db
    .prepare('SELECT token FROM sync_tokens WHERE entity = ?')
    .get(entity) as { token: string } | undefined;
  return row?.token ?? null;
}

export function setSyncToken(
  db: Database.Database,
  entity: string,
  token: string,
): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO sync_tokens (entity, token, updated_at)
    VALUES (?, ?, ?)
  `,
  ).run(entity, token, Date.now());
}

export function getV3SyncState(
  db: Database.Database,
  entity: string,
): number | null {
  const row = db
    .prepare('SELECT last_sync_at FROM v3_sync_state WHERE entity = ?')
    .get(entity) as { last_sync_at: number } | undefined;
  return row?.last_sync_at ?? null;
}

export function setV3SyncState(
  db: Database.Database,
  entity: string,
  lastSyncAt: number,
): void {
  db.prepare(
    `
    INSERT OR REPLACE INTO v3_sync_state (entity, last_sync_at)
    VALUES (?, ?)
  `,
  ).run(entity, lastSyncAt);
}
