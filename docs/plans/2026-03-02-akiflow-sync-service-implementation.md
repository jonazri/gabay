# Akiflow Sync Service — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a standalone always-on TypeScript daemon that keeps a local SQLite DB in sync with Akiflow via Pusher WebSocket and a sync-token pull loop, and update the agent skill to read from SQLite instead of calling the API on every invocation.

**Architecture:** Standalone Node.js service (`akiflow-sync/`) in the project root. Daemon owns all API communication. Agent reads SQLite directly via `sqlite3` CLI; writes queue via `pending_writes` table. WAL mode allows concurrent access without blocking.

**Tech Stack:** TypeScript, `pusher-js`, `better-sqlite3`, Node.js native `fetch`, `vitest`

**Design doc:** `docs/plans/2026-03-02-akiflow-sync-service-design.md`

---

## Before you start

Read the design doc. All architectural decisions are already made there. This plan is the step-by-step execution.

**Key field names from actual API responses** (verify with `sqlite3 akiflow/akiflow.db "SELECT data FROM tasks LIMIT 1" | jq .` after first sync):
- The API returns a mix of snake_case (`user_id`, `deleted_at`, `tags_ids`) and camelCase (`listId`, `recurringId`). Store raw JSON verbatim — do not map.
- Conflict resolution fields: `global_updated_at`, `global_list_id_updated_at`, `global_tags_ids_updated_at` (snake_case with `global_` prefix).
- Local field timestamps set by agent writes: store as `list_id_updated_at`, `tags_ids_updated_at` in the data JSON.

---

## Task 1: Scaffold `akiflow-sync` package

**Files:**
- Create: `akiflow-sync/package.json`
- Create: `akiflow-sync/tsconfig.json`
- Create: `akiflow-sync/vitest.config.ts`
- Create: `akiflow-sync/src/.gitkeep`

**Step 1: Create directory and package.json**

```bash
mkdir -p akiflow-sync/src akiflow-sync/tests/sync
```

```json
// akiflow-sync/package.json
{
  "name": "akiflow-sync",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/daemon.js",
    "dev": "tsx src/daemon.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "pusher-js": "^8.4.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "@types/pusher-js": "^8.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^2.0.0"
  }
}
```

**Step 2: Create tsconfig.json**

```json
// akiflow-sync/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

**Step 3: Create vitest.config.ts**

```typescript
// akiflow-sync/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
  },
});
```

**Step 4: Create a minimal logger (used by all modules)**

```typescript
// akiflow-sync/src/logger.ts
export const logger = {
  info: (...args: unknown[]) => console.log('[INFO]', ...args),
  warn: (...args: unknown[]) => console.warn('[WARN]', ...args),
  error: (...args: unknown[]) => console.error('[ERROR]', ...args),
  debug: (...args: unknown[]) => {
    if (process.env.LOG_LEVEL === 'debug') console.debug('[DEBUG]', ...args);
  },
};
```

**Step 5: Install dependencies**

```bash
cd akiflow-sync && npm install && cd ..
```

Expected: `node_modules/` created, `package-lock.json` generated.

**Step 6: Commit**

```bash
git add akiflow-sync/
git commit -m "feat(akiflow-sync): scaffold standalone sync service package"
```

---

## Task 2: Database layer (`db.ts`)

**Files:**
- Create: `akiflow-sync/src/db.ts`
- Create: `akiflow-sync/tests/db.test.ts`

**Step 1: Write the failing tests**

```typescript
// akiflow-sync/tests/db.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { initDb, upsertEntity, getEntity, getSyncToken, setSyncToken, getV3SyncState, setV3SyncState, ENTITIES_V5 } from '../src/db.js';

describe('initDb', () => {
  it('creates all entity tables', () => {
    const db = initDb(':memory:');
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('tasks');
    expect(names).toContain('events');
    expect(names).toContain('labels');
    expect(names).toContain('sync_tokens');
    expect(names).toContain('pending_writes');
  });

  it('enables WAL mode', () => {
    const db = initDb(':memory:');
    const row = db.pragma('journal_mode') as { journal_mode: string }[];
    // In-memory DBs don't support WAL, so just check it can be set
    expect(row).toBeDefined();
  });

  it('is idempotent — calling twice does not throw', () => {
    const db = initDb(':memory:');
    expect(() => initDb(':memory:')).not.toThrow();
  });
});

describe('upsertEntity', () => {
  it('inserts a new entity', () => {
    const db = initDb(':memory:');
    upsertEntity(db, 'tasks', { id: 'task-1', title: 'Test', global_updated_at: '2026-01-01T00:00:00Z' });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(row).toBeDefined();
    expect(JSON.parse(row!.data).title).toBe('Test');
  });

  it('replaces existing entity', () => {
    const db = initDb(':memory:');
    upsertEntity(db, 'tasks', { id: 'task-1', title: 'Old', global_updated_at: '2026-01-01T00:00:00Z' });
    upsertEntity(db, 'tasks', { id: 'task-1', title: 'New', global_updated_at: '2026-01-02T00:00:00Z' });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(JSON.parse(row!.data).title).toBe('New');
  });

  it('stores global_updated_at as epoch ms', () => {
    const db = initDb(':memory:');
    upsertEntity(db, 'tasks', { id: 'task-1', global_updated_at: '2026-01-01T00:00:00Z' });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(row!.global_updated_at).toBe(new Date('2026-01-01T00:00:00Z').getTime());
  });

  it('handles null global_updated_at', () => {
    const db = initDb(':memory:');
    upsertEntity(db, 'tasks', { id: 'task-1', title: 'No ts' });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(row).toBeDefined();
    expect(row!.global_updated_at).toBeNull();
  });
});

describe('sync tokens', () => {
  it('returns null for unknown entity', () => {
    const db = initDb(':memory:');
    expect(getSyncToken(db, 'tasks')).toBeNull();
  });

  it('stores and retrieves a token', () => {
    const db = initDb(':memory:');
    setSyncToken(db, 'tasks', 'abc123');
    expect(getSyncToken(db, 'tasks')).toBe('abc123');
  });

  it('overwrites existing token', () => {
    const db = initDb(':memory:');
    setSyncToken(db, 'tasks', 'token-1');
    setSyncToken(db, 'tasks', 'token-2');
    expect(getSyncToken(db, 'tasks')).toBe('token-2');
  });
});

describe('v3 sync state', () => {
  it('returns null when never synced', () => {
    const db = initDb(':memory:');
    expect(getV3SyncState(db, 'events')).toBeNull();
  });

  it('stores and retrieves last_sync_at', () => {
    const db = initDb(':memory:');
    setV3SyncState(db, 'events', 1700000000000);
    expect(getV3SyncState(db, 'events')).toBe(1700000000000);
  });
});
```

**Step 2: Run tests to confirm they fail**

```bash
cd akiflow-sync && npm test -- tests/db.test.ts
```

Expected: FAIL — `Cannot find module '../src/db.js'`

**Step 3: Implement `db.ts`**

```typescript
// akiflow-sync/src/db.ts
import Database from 'better-sqlite3';

export const ENTITIES_V5 = [
  'tasks', 'labels', 'tags', 'time_slots',
  'calendars', 'accounts', 'settings',
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
```

**Step 4: Run tests to confirm they pass**

```bash
cd akiflow-sync && npm test -- tests/db.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add akiflow-sync/src/db.ts akiflow-sync/src/logger.ts akiflow-sync/tests/db.test.ts
git commit -m "feat(akiflow-sync): add SQLite schema and entity storage layer"
```

---

## Task 3: Auth module (`auth.ts`)

**Files:**
- Create: `akiflow-sync/src/auth.ts`
- Create: `akiflow-sync/tests/auth.test.ts`

**Step 1: Write failing tests**

```typescript
// akiflow-sync/tests/auth.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AkiflowAuth } from '../src/auth.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('AkiflowAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exchanges refresh token for access token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: 'test-access-token',
        refresh_token: 'same-refresh',
        expires_in: 1800,
      }),
    });

    const auth = new AkiflowAuth('my-refresh-token', '/tmp/test.env');
    const token = await auth.getAccessToken();
    expect(token).toBe('test-access-token');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://web.akiflow.com/oauth/refreshToken',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('caches token and does not re-fetch within expiry', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: 'cached-token',
        refresh_token: 'r',
        expires_in: 1800,
      }),
    });

    const auth = new AkiflowAuth('refresh', '/tmp/test.env');
    await auth.getAccessToken();
    await auth.getAccessToken();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('throws on failed token refresh', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });
    const auth = new AkiflowAuth('bad-token', '/tmp/test.env');
    await expect(auth.getAccessToken()).rejects.toThrow('Token refresh failed: 401');
  });

  it('fetches user ID from /user/me', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', refresh_token: 'r', expires_in: 1800 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 12345 }),
      });

    const auth = new AkiflowAuth('refresh', '/tmp/test.env');
    const userId = await auth.getUserId();
    expect(userId).toBe('12345');
  });

  it('authorizes Pusher channel', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'tok', refresh_token: 'r', expires_in: 1800 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: 'channel-auth-string' }),
      });

    const auth = new AkiflowAuth('refresh', '/tmp/test.env');
    const result = await auth.authorizePusherChannel('private-user.123', 'socket-id-abc');
    expect(result.auth).toBe('channel-auth-string');
    expect(mockFetch).toHaveBeenCalledWith(
      'https://web.akiflow.com/api/pusherAuth',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ channel_name: 'private-user.123', socket_id: 'socket-id-abc' }),
      }),
    );
  });

  it('retries with fresh token on 401', async () => {
    mockFetch
      // Initial token fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'stale', refresh_token: 'r', expires_in: 1800 }),
      })
      // API call returns 401
      .mockResolvedValueOnce({ ok: false, status: 401 })
      // Token refresh
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: 'fresh', refresh_token: 'r', expires_in: 1800 }),
      })
      // Retry succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ id: 999 }),
      });

    const auth = new AkiflowAuth('refresh', '/tmp/test.env');
    const userId = await auth.getUserId();
    expect(userId).toBe('999');
  });
});
```

**Step 2: Run to confirm fail**

```bash
cd akiflow-sync && npm test -- tests/auth.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `auth.ts`**

```typescript
// akiflow-sync/src/auth.ts
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { logger } from './logger.js';

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

export interface PusherAuthResponse {
  auth: string;
  channel_data?: string;
}

export class AkiflowAuth {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  constructor(
    private refreshToken: string,
    private envPath: string,
  ) {}

  async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }
    return this.refresh();
  }

  async refresh(): Promise<string> {
    const resp = await fetch('https://web.akiflow.com/oauth/refreshToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: '1', refresh_token: this.refreshToken }),
    });
    if (!resp.ok) throw new Error(`Token refresh failed: ${resp.status}`);

    const data = await resp.json() as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;

    if (data.refresh_token && data.refresh_token !== this.refreshToken) {
      logger.info('[auth] refresh token rotated, updating .env');
      this.refreshToken = data.refresh_token;
      this.updateEnvFile(data.refresh_token);
    }

    return this.accessToken;
  }

  async getUserId(): Promise<string> {
    const resp = await this.fetchWithAuth('https://web.akiflow.com/user/me');
    if (!resp.ok) throw new Error(`Failed to get user: ${resp.status}`);
    const data = await resp.json() as { id: string | number };
    return String(data.id);
  }

  async authorizePusherChannel(
    channelName: string,
    socketId: string,
  ): Promise<PusherAuthResponse> {
    const resp = await this.fetchWithAuth(
      'https://web.akiflow.com/api/pusherAuth',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel_name: channelName, socket_id: socketId }),
      },
    );
    if (!resp.ok) throw new Error(`Pusher auth failed: ${resp.status}`);
    return resp.json() as Promise<PusherAuthResponse>;
  }

  async fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
    const token = await this.getAccessToken();
    const resp = await fetch(url, {
      ...options,
      headers: { ...options.headers as Record<string, string>, Authorization: `Bearer ${token}` },
    });

    if (resp.status === 401) {
      await this.refresh();
      const newToken = await this.getAccessToken();
      return fetch(url, {
        ...options,
        headers: { ...options.headers as Record<string, string>, Authorization: `Bearer ${newToken}` },
      });
    }

    return resp;
  }

  private updateEnvFile(newRefreshToken: string): void {
    if (!existsSync(this.envPath)) return;
    try {
      let content = readFileSync(this.envPath, 'utf-8');
      content = content.replace(
        /^AKIFLOW_REFRESH_TOKEN=.*/m,
        `AKIFLOW_REFRESH_TOKEN=${newRefreshToken}`,
      );
      writeFileSync(this.envPath, content);
    } catch (e) {
      logger.error('[auth] failed to update .env with new refresh token:', e);
    }
  }
}
```

**Step 4: Run tests to confirm pass**

```bash
cd akiflow-sync && npm test -- tests/auth.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add akiflow-sync/src/auth.ts akiflow-sync/tests/auth.test.ts
git commit -m "feat(akiflow-sync): add auth module with token refresh and Pusher auth"
```

---

## Task 4: Conflict resolution (`conflict.ts`)

This is the most critical module. Test it thoroughly.

**Files:**
- Create: `akiflow-sync/src/conflict.ts`
- Create: `akiflow-sync/tests/conflict.test.ts`

**Step 1: Write failing tests**

```typescript
// akiflow-sync/tests/conflict.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { initDb } from '../src/db.js';
import { resolveAndUpsert } from '../src/conflict.js';

describe('resolveAndUpsert — entity-level LWW', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('inserts entity when no local exists', () => {
    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1', title: 'New', global_updated_at: '2026-01-01T00:00:00Z',
    });
    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    expect(JSON.parse(row.data).title).toBe('New');
  });

  it('overwrites local when remote global_updated_at is newer', () => {
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({ id: 'task-1', title: 'Old', global_updated_at: '2026-01-01T00:00:00Z' }),
      new Date('2026-01-01T00:00:00Z').getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1', title: 'Updated', global_updated_at: '2026-01-02T00:00:00Z',
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    expect(JSON.parse(row.data).title).toBe('Updated');
  });

  it('keeps local when remote global_updated_at is older', () => {
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({ id: 'task-1', title: 'Local winner', global_updated_at: '2026-01-03T00:00:00Z' }),
      new Date('2026-01-03T00:00:00Z').getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1', title: 'Stale remote', global_updated_at: '2026-01-01T00:00:00Z',
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    expect(JSON.parse(row.data).title).toBe('Local winner');
  });

  it('keeps local when timestamps are equal', () => {
    const ts = '2026-01-01T00:00:00Z';
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({ id: 'task-1', title: 'Local', global_updated_at: ts }),
      new Date(ts).getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1', title: 'Remote same ts', global_updated_at: ts,
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    expect(JSON.parse(row.data).title).toBe('Local');
  });

  it('works for non-task entities (labels, events) without field-level logic', () => {
    resolveAndUpsert({ db, table: 'labels' }, {
      id: 'label-1', name: 'Work', global_updated_at: '2026-01-01T00:00:00Z',
    });
    db.prepare('SELECT data FROM labels WHERE id = ?').get('label-1');
    // Just verify no crash and data is stored
    const row = db.prepare('SELECT data FROM labels WHERE id = ?').get('label-1') as any;
    expect(JSON.parse(row.data).name).toBe('Work');
  });
});

describe('resolveAndUpsert — field-level LWW for tasks', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = initDb(':memory:');
  });

  it('protects locally-newer listId when remote wins globally', () => {
    // Local: global entity older, but listId changed more recently
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({
        id: 'task-1',
        title: 'Task',
        listId: 'local-project',
        list_id_updated_at: '2026-01-03T00:00:00Z', // local field is newer
        global_updated_at: '2026-01-01T00:00:00Z',
      }),
      new Date('2026-01-01T00:00:00Z').getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1',
      title: 'Updated title',
      listId: 'remote-project',
      global_list_id_updated_at: '2026-01-01T00:00:00Z', // remote field is older
      global_updated_at: '2026-01-02T00:00:00Z',         // remote entity is newer
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    const data = JSON.parse(row.data);
    expect(data.title).toBe('Updated title'); // remote title wins (entity-level)
    expect(data.listId).toBe('local-project'); // local listId protected (field-level)
  });

  it('applies remote listId when remote field is newer', () => {
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({
        id: 'task-1',
        listId: 'old-project',
        list_id_updated_at: '2026-01-01T00:00:00Z',
        global_updated_at: '2026-01-01T00:00:00Z',
      }),
      new Date('2026-01-01T00:00:00Z').getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1',
      listId: 'new-project',
      global_list_id_updated_at: '2026-01-03T00:00:00Z', // remote field newer
      global_updated_at: '2026-01-02T00:00:00Z',
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    expect(JSON.parse(row.data).listId).toBe('new-project');
  });

  it('protects locally-newer tags_ids when remote wins globally', () => {
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({
        id: 'task-1',
        tags_ids: ['local-tag'],
        tags_ids_updated_at: '2026-01-03T00:00:00Z',
        global_updated_at: '2026-01-01T00:00:00Z',
      }),
      new Date('2026-01-01T00:00:00Z').getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1',
      tags_ids: ['remote-tag'],
      global_tags_ids_updated_at: '2026-01-01T00:00:00Z',
      global_updated_at: '2026-01-02T00:00:00Z',
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    expect(JSON.parse(row.data).tags_ids).toEqual(['local-tag']);
  });

  it('updates local tags_ids when remote field wins (local entity wins globally)', () => {
    // Local entity wins globally, but remote has a newer tags field
    db.prepare('INSERT INTO tasks (id, data, global_updated_at) VALUES (?, ?, ?)').run(
      'task-1',
      JSON.stringify({
        id: 'task-1',
        title: 'Local title',
        tags_ids: ['old-tag'],
        tags_ids_updated_at: '2026-01-01T00:00:00Z',
        global_updated_at: '2026-01-03T00:00:00Z', // local entity wins
      }),
      new Date('2026-01-03T00:00:00Z').getTime(),
    );

    resolveAndUpsert({ db, table: 'tasks' }, {
      id: 'task-1',
      title: 'Remote title',
      tags_ids: ['new-tag'],
      global_tags_ids_updated_at: '2026-01-02T00:00:00Z', // remote field newer
      global_updated_at: '2026-01-02T00:00:00Z',          // remote entity older
    });

    const row = db.prepare('SELECT data FROM tasks WHERE id = ?').get('task-1') as any;
    const data = JSON.parse(row.data);
    expect(data.title).toBe('Local title'); // local entity wins
    expect(data.tags_ids).toEqual(['new-tag']); // but remote tags field wins
  });
});
```

**Step 2: Run to confirm fail**

```bash
cd akiflow-sync && npm test -- tests/conflict.test.ts
```

Expected: FAIL — module not found.

**Step 3: Implement `conflict.ts`**

```typescript
// akiflow-sync/src/conflict.ts
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
```

**Step 4: Run tests to confirm pass**

```bash
cd akiflow-sync && npm test -- tests/conflict.test.ts
```

Expected: All PASS.

**Step 5: Commit**

```bash
git add akiflow-sync/src/conflict.ts akiflow-sync/tests/conflict.test.ts
git commit -m "feat(akiflow-sync): add LWW conflict resolution with field-level task protection"
```

---

## Task 5: V5 sync engine (`sync/v5.ts`)

**Files:**
- Create: `akiflow-sync/src/sync/v5.ts`
- Create: `akiflow-sync/tests/sync/v5.test.ts`

**Step 1: Write failing tests**

```typescript
// akiflow-sync/tests/sync/v5.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDb, getSyncToken } from '../../src/db.js';
import { syncV5Entity } from '../../src/sync/v5.js';
import { AkiflowAuth } from '../../src/auth.js';

const mockFetchWithAuth = vi.fn();
vi.mock('../../src/auth.js', () => ({
  AkiflowAuth: vi.fn().mockImplementation(() => ({
    fetchWithAuth: mockFetchWithAuth,
  })),
}));

describe('syncV5Entity', () => {
  let db: ReturnType<typeof initDb>;
  let auth: AkiflowAuth;

  beforeEach(() => {
    db = initDb(':memory:');
    auth = new AkiflowAuth('', '');
    vi.clearAllMocks();
  });

  it('fetches with empty sync_token on first sync', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], has_next_page: false, sync_token: 'tok-1' }),
    });

    await syncV5Entity(db, 'tasks', auth);

    const url: string = mockFetchWithAuth.mock.calls[0][0];
    expect(url).toContain('sync_token=');
    expect(url).toContain('limit=2500');
  });

  it('saves sync_token after sync', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], has_next_page: false, sync_token: 'new-token' }),
    });

    await syncV5Entity(db, 'tasks', auth);

    expect(getSyncToken(db, 'tasks')).toBe('new-token');
  });

  it('uses stored sync_token on subsequent syncs', async () => {
    // First sync
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], has_next_page: false, sync_token: 'stored-token' }),
    });
    await syncV5Entity(db, 'tasks', auth);

    // Second sync
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], has_next_page: false, sync_token: 'stored-token-2' }),
    });
    await syncV5Entity(db, 'tasks', auth);

    const url: string = mockFetchWithAuth.mock.calls[1][0];
    expect(url).toContain('sync_token=stored-token');
  });

  it('paginates when has_next_page is true', async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'task-1', global_updated_at: '2026-01-01T00:00:00Z' }],
          has_next_page: true,
          sync_token: 'page-2-token',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'task-2', global_updated_at: '2026-01-01T00:00:00Z' }],
          has_next_page: false,
          sync_token: 'final-token',
        }),
      });

    await syncV5Entity(db, 'tasks', auth);

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
    // Verify second call used page-2-token
    const url2: string = mockFetchWithAuth.mock.calls[1][0];
    expect(url2).toContain('sync_token=page-2-token');
    // Both tasks inserted
    const count = db.prepare('SELECT count(*) as n FROM tasks').get() as { n: number };
    expect(count.n).toBe(2);
  });

  it('throws on non-ok response', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(syncV5Entity(db, 'tasks', auth)).rejects.toThrow('V5 sync tasks failed: 500');
  });
});
```

**Step 2: Run to confirm fail**

```bash
cd akiflow-sync && npm test -- tests/sync/v5.test.ts
```

**Step 3: Implement `sync/v5.ts`**

```typescript
// akiflow-sync/src/sync/v5.ts
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

    const body = await resp.json() as {
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
```

**Step 4: Run tests to confirm pass**

```bash
cd akiflow-sync && npm test -- tests/sync/v5.test.ts
```

**Step 5: Commit**

```bash
git add akiflow-sync/src/sync/v5.ts akiflow-sync/tests/sync/v5.test.ts
git commit -m "feat(akiflow-sync): add V5 sync engine with sync_token pagination"
```

---

## Task 6: V3 sync engine (`sync/v3.ts`)

**Files:**
- Create: `akiflow-sync/src/sync/v3.ts`
- Create: `akiflow-sync/tests/sync/v3.test.ts`

**Step 1: Write failing tests**

```typescript
// akiflow-sync/tests/sync/v3.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDb, getV3SyncState } from '../../src/db.js';
import { syncV3Entity } from '../../src/sync/v3.js';
import { AkiflowAuth } from '../../src/auth.js';

const mockFetchWithAuth = vi.fn();
vi.mock('../../src/auth.js', () => ({
  AkiflowAuth: vi.fn().mockImplementation(() => ({
    fetchWithAuth: mockFetchWithAuth,
  })),
}));

describe('syncV3Entity', () => {
  let db: ReturnType<typeof initDb>;
  let auth: AkiflowAuth;

  beforeEach(() => {
    db = initDb(':memory:');
    auth = new AkiflowAuth('', '');
    vi.clearAllMocks();
  });

  it('uses with_deleted=false on first sync', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], next_page_url: null }),
    });

    await syncV3Entity(db, 'events', auth);

    const url: string = mockFetchWithAuth.mock.calls[0][0];
    expect(url).toContain('with_deleted=false');
    expect(url).not.toContain('updatedAfter');
  });

  it('uses updatedAfter and with_deleted=true on subsequent syncs', async () => {
    // Seed a sync state
    db.prepare('INSERT INTO v3_sync_state (entity, last_sync_at) VALUES (?, ?)').run('events', 1700000000000);

    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], next_page_url: null }),
    });

    await syncV3Entity(db, 'events', auth);

    const url: string = mockFetchWithAuth.mock.calls[0][0];
    expect(url).toContain('with_deleted=true');
    expect(url).toContain('updatedAfter=');
  });

  it('follows next_page_url cursor', async () => {
    mockFetchWithAuth
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'ev-1', updated_at: '2026-01-01T00:00:00Z' }],
          next_page_url: 'https://api.akiflow.com/v3/events?cursor=abc',
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          data: [{ id: 'ev-2', updated_at: '2026-01-02T00:00:00Z' }],
          next_page_url: null,
        }),
      });

    await syncV3Entity(db, 'events', auth);

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
    expect(mockFetchWithAuth.mock.calls[1][0]).toBe('https://api.akiflow.com/v3/events?cursor=abc');
  });

  it('saves max updated_at as last_sync_at', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'ev-1', updated_at: '2026-01-01T00:00:00Z' },
          { id: 'ev-2', updated_at: '2026-01-03T00:00:00Z' },
          { id: 'ev-3', updated_at: '2026-01-02T00:00:00Z' },
        ],
        next_page_url: null,
      }),
    });

    await syncV3Entity(db, 'events', auth);

    expect(getV3SyncState(db, 'events')).toBe(new Date('2026-01-03T00:00:00Z').getTime());
  });

  it('throws on non-ok response', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 403 });
    await expect(syncV3Entity(db, 'events', auth)).rejects.toThrow('V3 sync events failed: 403');
  });
});
```

**Step 2: Run to confirm fail**

```bash
cd akiflow-sync && npm test -- tests/sync/v3.test.ts
```

**Step 3: Implement `sync/v3.ts`**

```typescript
// akiflow-sync/src/sync/v3.ts
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
```

**Step 4: Run tests to confirm pass**

```bash
cd akiflow-sync && npm test -- tests/sync/v3.test.ts
```

**Step 5: Commit**

```bash
git add akiflow-sync/src/sync/v3.ts akiflow-sync/tests/sync/v3.test.ts
git commit -m "feat(akiflow-sync): add V3 sync engine with updatedAfter cursor pagination"
```

---

## Task 7: Pending writes processor (`pending.ts`)

**Files:**
- Create: `akiflow-sync/src/pending.ts`
- Create: `akiflow-sync/tests/pending.test.ts`

**Step 1: Write failing tests**

```typescript
// akiflow-sync/tests/pending.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { initDb } from '../src/db.js';
import { processPendingWritesOnce } from '../src/pending.js';
import { AkiflowAuth } from '../src/auth.js';

const mockFetchWithAuth = vi.fn();
vi.mock('../src/auth.js', () => ({
  AkiflowAuth: vi.fn().mockImplementation(() => ({
    fetchWithAuth: mockFetchWithAuth,
  })),
}));

function insertPendingWrite(
  db: ReturnType<typeof initDb>,
  overrides: Partial<{ entity: string; method: string; payload: string; status: string; retry_count: number }> = {}
) {
  db.prepare(`
    INSERT INTO pending_writes (entity, method, payload, status, retry_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    overrides.entity ?? 'tasks',
    overrides.method ?? 'PATCH',
    overrides.payload ?? JSON.stringify({ id: 'task-1', title: 'Test' }),
    overrides.status ?? 'pending',
    overrides.retry_count ?? 0,
    Date.now(),
  );
}

describe('processPendingWritesOnce', () => {
  let db: ReturnType<typeof initDb>;
  let auth: AkiflowAuth;

  beforeEach(() => {
    db = initDb(':memory:');
    auth = new AkiflowAuth('', '');
    vi.clearAllMocks();
  });

  it('does nothing when no pending writes', async () => {
    await processPendingWritesOnce(db, auth);
    expect(mockFetchWithAuth).not.toHaveBeenCalled();
  });

  it('marks write as done on success', async () => {
    insertPendingWrite(db);
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{ id: 'task-1', global_updated_at: '2026-01-01T00:00:00Z' }] }),
    });

    await processPendingWritesOnce(db, auth);

    const row = db.prepare('SELECT status FROM pending_writes WHERE id = 1').get() as any;
    expect(row.status).toBe('done');
  });

  it('marks write as failed after max retries', async () => {
    insertPendingWrite(db, { retry_count: 4 }); // one away from MAX_RETRIES=5
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 500 });

    await processPendingWritesOnce(db, auth);

    const row = db.prepare('SELECT status, retry_count FROM pending_writes WHERE id = 1').get() as any;
    expect(row.status).toBe('failed');
    expect(row.retry_count).toBe(5);
  });

  it('resets to pending with incremented retry_count on retryable failure', async () => {
    insertPendingWrite(db, { retry_count: 1 });
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 500 });

    await processPendingWritesOnce(db, auth);

    const row = db.prepare('SELECT status, retry_count FROM pending_writes WHERE id = 1').get() as any;
    expect(row.status).toBe('pending');
    expect(row.retry_count).toBe(2);
  });

  it('batches multiple writes for the same entity', async () => {
    insertPendingWrite(db, { payload: JSON.stringify({ id: 'task-1', title: 'A' }) });
    insertPendingWrite(db, { payload: JSON.stringify({ id: 'task-2', title: 'B' }) });

    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'task-1', global_updated_at: '2026-01-01T00:00:00Z' },
          { id: 'task-2', global_updated_at: '2026-01-01T00:00:00Z' },
        ],
      }),
    });

    await processPendingWritesOnce(db, auth);

    // Only one API call for both writes
    expect(mockFetchWithAuth).toHaveBeenCalledTimes(1);
    const body = JSON.parse(mockFetchWithAuth.mock.calls[0][1].body);
    expect(body).toHaveLength(2);
  });

  it('sends separate requests for different entities', async () => {
    insertPendingWrite(db, { entity: 'tasks', payload: JSON.stringify({ id: 'task-1' }) });
    insertPendingWrite(db, { entity: 'labels', payload: JSON.stringify({ id: 'label-1' }) });

    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ id: 'x', global_updated_at: '2026-01-01T00:00:00Z' }] }),
    });

    await processPendingWritesOnce(db, auth);

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
  });
});
```

**Step 2: Run to confirm fail**

```bash
cd akiflow-sync && npm test -- tests/pending.test.ts
```

**Step 3: Implement `pending.ts`**

```typescript
// akiflow-sync/src/pending.ts
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
```

**Step 4: Run tests to confirm pass**

```bash
cd akiflow-sync && npm test -- tests/pending.test.ts
```

**Step 5: Run all tests**

```bash
cd akiflow-sync && npm test
```

Expected: All tests pass.

**Step 6: Commit**

```bash
git add akiflow-sync/src/pending.ts akiflow-sync/tests/pending.test.ts
git commit -m "feat(akiflow-sync): add pending writes processor with batching and retry"
```

---

## Task 8: Daemon entry point (`daemon.ts`)

No unit tests for the daemon — it's thin orchestration. Verify manually after wiring.

**Files:**
- Create: `akiflow-sync/src/daemon.ts`

**Step 1: Create the daemon**

```typescript
// akiflow-sync/src/daemon.ts
import Pusher from 'pusher-js';
import { config } from 'dotenv'; // add dotenv to dependencies first
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  initDb,
  ENTITIES_V5,
  ENTITIES_V3,
  type EntityV5,
  type EntityV3,
} from './db.js';
import { AkiflowAuth } from './auth.js';
import { syncV5Entity } from './sync/v5.js';
import { syncV3Entity } from './sync/v3.js';
import { startPendingWritePoller } from './pending.js';
import { logger } from './logger.js';

// Load .env from project root (cwd when run as systemd service)
config({ path: resolve(process.cwd(), '.env') });

const PUSHER_APP_KEY = '4fa6328da6969ef162ec';
const PUSHER_CLUSTER = 'eu';

async function main(): Promise<void> {
  const refreshToken = process.env.AKIFLOW_REFRESH_TOKEN;
  const dbPath = process.env.AKIFLOW_DB_PATH ?? './akiflow/akiflow.db';
  const envPath = resolve(process.cwd(), '.env');

  if (!refreshToken) throw new Error('AKIFLOW_REFRESH_TOKEN not set in .env');

  logger.info('[daemon] starting akiflow-sync');

  const db = initDb(resolve(process.cwd(), dbPath));
  const auth = new AkiflowAuth(refreshToken, envPath);

  logger.info('[daemon] running initial sync of all entities');
  await syncAllEntities(db, auth);

  startPendingWritePoller(db, auth);
  logger.info('[daemon] pending write poller started (100ms interval)');

  const userId = await auth.getUserId();

  const pusher = new Pusher(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
    channelAuthorization: {
      transport: 'ajax',
      endpoint: 'unused',
      customHandler: async ({ channelName, socketId }, callback) => {
        try {
          const data = await auth.authorizePusherChannel(channelName, socketId);
          callback(null, data);
        } catch (e) {
          callback(e as Error, null);
        }
      },
    },
  });

  const channel = pusher.subscribe(`private-user.${userId}`);

  channel.bind('connector-updated', async (data: { syncEntities?: string[] }) => {
    const entities = data?.syncEntities;
    if (entities?.length) {
      logger.info(`[pusher] incremental sync triggered for: ${entities.join(', ')}`);
      await syncEntities(db, auth, entities);
    } else {
      logger.info('[pusher] full sync triggered');
      await syncAllEntities(db, auth);
    }
  });

  channel.bind('account-connected', () =>
    syncAllEntities(db, auth).catch(e => logger.error('[pusher] sync error:', e))
  );
  channel.bind('account-disconnected', () =>
    syncAllEntities(db, auth).catch(e => logger.error('[pusher] sync error:', e))
  );
  channel.bind('user-update', () =>
    syncV5Entity(db, 'accounts', auth).catch(e => logger.error('[pusher] sync error:', e))
  );

  pusher.connection.bind('connected', () =>
    logger.info(`[pusher] connected to private-user.${userId}`)
  );
  pusher.connection.bind('disconnected', () =>
    logger.warn('[pusher] disconnected — will auto-reconnect')
  );
  pusher.connection.bind('error', (e: unknown) =>
    logger.error('[pusher] connection error:', e)
  );

  logger.info('[daemon] ready');
}

async function syncAllEntities(
  db: Parameters<typeof syncV5Entity>[0],
  auth: AkiflowAuth,
): Promise<void> {
  await Promise.all([
    ...ENTITIES_V5.map(e =>
      syncV5Entity(db, e, auth).catch(err =>
        logger.error(`[daemon] V5 sync failed for ${e}:`, err)
      )
    ),
    ...ENTITIES_V3.map(e =>
      syncV3Entity(db, e as EntityV3, auth).catch(err =>
        logger.error(`[daemon] V3 sync failed for ${e}:`, err)
      )
    ),
  ]);
}

async function syncEntities(
  db: Parameters<typeof syncV5Entity>[0],
  auth: AkiflowAuth,
  entities: string[],
): Promise<void> {
  await Promise.all(
    entities.map(e => {
      if ((ENTITIES_V5 as readonly string[]).includes(e))
        return syncV5Entity(db, e, auth).catch(err =>
          logger.error(`[daemon] sync failed for ${e}:`, err)
        );
      if ((ENTITIES_V3 as readonly string[]).includes(e))
        return syncV3Entity(db, e as EntityV3, auth).catch(err =>
          logger.error(`[daemon] sync failed for ${e}:`, err)
        );
      logger.warn(`[daemon] unknown entity in Pusher message: ${e}`);
      return Promise.resolve();
    })
  );
}

main().catch(e => {
  logger.error('[daemon] fatal error:', e);
  process.exit(1);
});
```

**Step 2: Add `dotenv` to dependencies**

```bash
cd akiflow-sync && npm install dotenv && cd ..
```

**Step 3: Verify TypeScript compiles**

```bash
cd akiflow-sync && npm run build && cd ..
```

Expected: `dist/` created with no errors.

**Step 4: Smoke test with real credentials (run from project root)**

```bash
cd akiflow-sync && node --experimental-vm-modules dist/daemon.js &
sleep 10 && kill %1
```

Expected: Logs show token refresh, initial sync completing, Pusher connecting. Check `akiflow/akiflow.db` exists and has rows:

```bash
sqlite3 akiflow/akiflow.db "SELECT count(*) FROM tasks; SELECT count(*) FROM events;"
```

Expected: Non-zero counts.

**Step 5: Commit**

```bash
git add akiflow-sync/src/daemon.ts akiflow-sync/package.json akiflow-sync/package-lock.json
git commit -m "feat(akiflow-sync): add daemon entry point with Pusher + sync orchestration"
```

---

## Task 9: Systemd unit and setup script

**Files:**
- Create: `akiflow-sync/akiflow-sync.service`
- Create: `akiflow-sync/install.sh`

**Step 1: Create systemd unit**

```ini
# akiflow-sync/akiflow-sync.service
[Unit]
Description=Akiflow Sync Daemon
After=network.target
PartOf=nanoclaw.service

[Service]
Type=simple
WorkingDirectory=%h/code/yonibot/gabay
EnvironmentFile=%h/code/yonibot/gabay/.env
ExecStartPre=/usr/bin/npm run build --prefix %h/code/yonibot/gabay/akiflow-sync
ExecStart=/usr/bin/node %h/code/yonibot/gabay/akiflow-sync/dist/daemon.js
Restart=always
RestartSec=5
StandardOutput=append:%h/code/yonibot/gabay/akiflow/akiflow-sync.log
StandardError=append:%h/code/yonibot/gabay/akiflow/akiflow-sync.log

[Install]
WantedBy=default.target
```

**Step 2: Create install script**

```bash
#!/usr/bin/env bash
# akiflow-sync/install.sh
# Run from project root to install the systemd service.
set -euo pipefail

UNIT_NAME="akiflow-sync"
UNIT_SRC="$(pwd)/akiflow-sync/akiflow-sync.service"
SYSTEMD_DIR="${HOME}/.config/systemd/user"

mkdir -p "${HOME}/code/yonibot/gabay/akiflow"
mkdir -p "${SYSTEMD_DIR}"
cp "${UNIT_SRC}" "${SYSTEMD_DIR}/${UNIT_NAME}.service"

systemctl --user daemon-reload
systemctl --user enable "${UNIT_NAME}"
systemctl --user start "${UNIT_NAME}"

echo "akiflow-sync service installed and started."
echo "Logs: tail -f ~/code/yonibot/gabay/akiflow/akiflow-sync.log"
```

```bash
chmod +x akiflow-sync/install.sh
```

**Step 3: Commit**

```bash
git add akiflow-sync/akiflow-sync.service akiflow-sync/install.sh
git commit -m "feat(akiflow-sync): add systemd unit and install script"
```

---

## Task 10: Container modifications

**Files:**
- Modify: `.claude/skills/add-akiflow-sync/modify/src/container-runner.ts`
- Modify: `.claude/skills/add-akiflow-sync/modify/container/Dockerfile`

### 10a: container-runner.ts — inject AKIFLOW_DB and add mount

Find the `buildVolumeMounts` function. After the existing mounts block (around line 247, before `return mounts`), add:

```typescript
// In buildVolumeMounts(), before the final `return mounts`:

// Akiflow SQLite DB (shared with akiflow-sync daemon)
const akiflowDbPath = process.env.AKIFLOW_DB_PATH
  ? path.resolve(process.cwd(), process.env.AKIFLOW_DB_PATH)
  : path.join(process.cwd(), 'akiflow', 'akiflow.db');
const akiflowDir = path.dirname(akiflowDbPath);
if (fs.existsSync(akiflowDir)) {
  mounts.push({
    hostPath: akiflowDir,
    containerPath: '/workspace/akiflow',
    readonly: false,
  });
}
```

Find `buildContainerArgs`. After the TZ env var line, add:

```typescript
// After: args.push('-e', `TZ=${TIMEZONE}`);
const akiflowDbPath = process.env.AKIFLOW_DB_PATH
  ? path.resolve(process.cwd(), process.env.AKIFLOW_DB_PATH)
  : path.join(process.cwd(), 'akiflow', 'akiflow.db');
args.push('-e', `AKIFLOW_DB=/workspace/akiflow/${path.basename(akiflowDbPath)}`);
```

**Verify the skill modify file compiles after edit:**

```bash
npm run typecheck
```

### 10b: Dockerfile — add sqlite3

Find the apt-get install line in `container/Dockerfile` and add `sqlite3`:

```dockerfile
# Before: existing apt-get install line
RUN apt-get update && apt-get install -y --no-install-recommends \
    sqlite3 \
    ... existing packages ... \
  && rm -rf /var/lib/apt/lists/*
```

**Step: Commit both**

```bash
git add .claude/skills/add-akiflow-sync/
git commit -m "feat(akiflow-sync): add container DB mount and sqlite3 to Dockerfile"
```

---

## Task 11: Update agent skill (`container/skills/akiflow/SKILL.md`)

Replace the entire SKILL.md for the container agent. The public interface (`akiflow:*` function names) stays identical. Internals change from `curl` to `sqlite3`.

**File:** `.claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md`

Key changes from the existing skill:
- Remove auth helper (`akiflow:token`) — no credentials in container
- Remove `_fetch-all-tasks` — replaced by SQLite queries
- All list functions query SQLite instead of calling the API
- Write functions do optimistic SQLite write + `pending_writes` INSERT in one transaction
- Add `akiflow:sync-status`
- `AKIFLOW_DB` env var injected by container-runner

Use the same structure as the existing SKILL.md but replace function bodies. Key patterns:

**Read function template:**
```bash
akiflow:list-inbox() {
  sqlite3 -json "$AKIFLOW_DB" "
    SELECT data FROM tasks
    WHERE json_extract(data,'$.status') = 1
      AND json_extract(data,'$.done') = 0
      AND json_extract(data,'$.deleted_at') IS NULL
    ORDER BY json_extract(data,'$.sorting') ASC"
}
```

**Write function template** (create-task example):
```bash
akiflow:create-task() {
  local json="$1"
  local id now_ms payload escaped

  id=$(node -e "process.stdout.write(require('crypto').randomUUID())")
  now_ms=$(( $(date +%s) * 1000 ))
  payload=$(echo "$json" | jq --arg id "$id" --argjson ts "$now_ms" \
    '. + {id: $id, status: 1, done: false, updated_at: $ts}')
  escaped=$(echo "$payload" | sed "s/'/''/g")

  sqlite3 "$AKIFLOW_DB" "
    BEGIN;
    INSERT OR REPLACE INTO tasks (id, data, updated_at)
      VALUES ('$id', json('$escaped'), $now_ms);
    INSERT INTO pending_writes (entity, method, payload, created_at)
      VALUES ('tasks', 'PATCH', json('$escaped'), $now_ms);
    COMMIT;"

  echo "$payload"
}
```

**After writing the new SKILL.md:**

```bash
git add .claude/skills/add-akiflow-sync/add/container/skills/akiflow/SKILL.md
git commit -m "feat(akiflow-sync): replace curl-based agent skill with SQLite-backed version"
```

---

## Task 12: Manifest and installed-skills

**Files:**
- Create: `.claude/skills/add-akiflow-sync/manifest.yaml`
- Create: `.claude/skills/add-akiflow-sync/SKILL.md`
- Modify: `.nanoclaw/installed-skills.yaml`

**Step 1: Create manifest.yaml**

```yaml
# .claude/skills/add-akiflow-sync/manifest.yaml
skill: akiflow-sync
version: 1.0.0
description: "Always-on Akiflow sync daemon with Pusher, SQLite local DB, and conflict resolution"
core_version: 0.1.0
adds:
  - container/skills/akiflow/SKILL.md
modifies:
  - src/container-runner.ts
  - container/Dockerfile
modify_base:
  src/container-runner.ts: _accumulated
  container/Dockerfile: _accumulated
conflicts:
  - akiflow
incompatible_with:
  - akiflow
depends:
  - auth-recovery
  - container-hardening
structured:
  env_additions:
    - AKIFLOW_REFRESH_TOKEN
    - AKIFLOW_DB_PATH
test: "cd akiflow-sync && npm test"
```

**Step 2: Create SKILL.md** (for Claude Code — describes when to use this skill)

```markdown
---
name: add-akiflow-sync
description: Add the Akiflow sync daemon. Installs a standalone always-on service that syncs tasks, events, labels, and all other Akiflow entities to a local SQLite database via Pusher WebSocket. Agent reads from SQLite instead of calling the API. Run after initial NanoClaw setup.
---

# add-akiflow-sync

Installs the Akiflow sync daemon and updates the agent skill.

## Steps

1. Add `AKIFLOW_REFRESH_TOKEN` and `AKIFLOW_DB_PATH=./akiflow/akiflow.db` to `.env`
2. Run `npm run build` to apply the skill
3. Run `./akiflow-sync/install.sh` to install and start the systemd service
4. Verify: `sqlite3 akiflow/akiflow.db "SELECT count(*) FROM tasks"`

## Logs

```bash
tail -f akiflow/akiflow-sync.log
```
```

**Step 3: Update installed-skills.yaml** — replace `akiflow` with `akiflow-sync`

```yaml
# In .nanoclaw/installed-skills.yaml, change:
#   - akiflow
# to:
#   - akiflow-sync
```

**Step 4: Run the build to verify skill applies cleanly**

```bash
npm run build 2>&1 | tail -20
```

Expected: No errors. `container/skills/akiflow/SKILL.md` updated.

**Step 5: Rebuild the container image**

```bash
./container/build.sh
```

**Step 6: Commit**

```bash
git add .claude/skills/add-akiflow-sync/ .nanoclaw/installed-skills.yaml
git commit -m "feat(akiflow-sync): package as NanoClaw skill, replace add-akiflow"
```

---

## Task 13: End-to-end verification

**Step 1: Start the daemon**

```bash
cd akiflow-sync && npm run dev &
```

**Step 2: Wait for initial sync (~30s), then check DB**

```bash
sqlite3 akiflow/akiflow.db "
  SELECT 'tasks', count(*) FROM tasks
  UNION ALL SELECT 'events', count(*) FROM events
  UNION ALL SELECT 'labels', count(*) FROM labels
  UNION ALL SELECT 'sync_tokens', count(*) FROM sync_tokens;"
```

Expected: Non-zero counts for each entity.

**Step 3: Test agent read path**

```bash
sqlite3 -json akiflow/akiflow.db "
  SELECT data FROM tasks
  WHERE json_extract(data,'$.status') = 1
    AND json_extract(data,'$.done') = 0
    AND json_extract(data,'$.deleted_at') IS NULL
  LIMIT 3" | jq '.'
```

Expected: 3 inbox tasks as JSON objects.

**Step 4: Test write path — create a task**

```bash
ID=$(node -e "process.stdout.write(require('crypto').randomUUID())")
NOW=$(( $(date +%s) * 1000 ))
PAYLOAD=$(echo "{\"id\":\"$ID\",\"title\":\"Test from CLI\",\"status\":1,\"done\":false,\"updated_at\":$NOW}")
ESCAPED=$(echo "$PAYLOAD" | sed "s/'/''/g")

sqlite3 akiflow/akiflow.db "
  BEGIN;
  INSERT OR REPLACE INTO tasks (id, data, updated_at) VALUES ('$ID', json('$ESCAPED'), $NOW);
  INSERT INTO pending_writes (entity, method, payload, created_at) VALUES ('tasks', 'PATCH', json('$ESCAPED'), $NOW);
  COMMIT;"
```

**Step 5: Verify pending write is processed**

```bash
sleep 2
sqlite3 akiflow/akiflow.db "SELECT id, entity, status, error FROM pending_writes ORDER BY id DESC LIMIT 5;"
```

Expected: Status `done` for the test task. Verify task appears in Akiflow app.

**Step 6: Kill dev daemon, install service**

```bash
kill %1
./akiflow-sync/install.sh
systemctl --user status akiflow-sync
```

**Step 7: Final commit**

```bash
git add akiflow/  # .gitignore should exclude akiflow.db but include the dir
git commit -m "feat(akiflow-sync): complete implementation — daemon, skill, e2e verified"
```

---

## Appendix: Field name verification

After the first full sync, run this to check the actual field names in the API response for conflict resolution:

```bash
sqlite3 akiflow/akiflow.db "SELECT data FROM tasks LIMIT 1" | jq 'keys | map(select(startswith("global_") or startswith("list") or startswith("tags")))'
```

If `listId` appears instead of `list_id`, update `conflict.ts` accordingly. The field names in `conflict.ts` must match whatever the API actually returns in `data`.
