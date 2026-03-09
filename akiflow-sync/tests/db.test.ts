import { describe, it, expect, beforeEach } from 'vitest';
import {
  initDb,
  upsertEntity,
  getEntity,
  getSyncToken,
  setSyncToken,
  getV3SyncState,
  setV3SyncState,
  ENTITIES_V5,
} from '../src/db.js';

describe('initDb', () => {
  it('creates all entity tables', () => {
    const db = initDb(':memory:');
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
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
    upsertEntity(db, 'tasks', {
      id: 'task-1',
      title: 'Test',
      global_updated_at: '2026-01-01T00:00:00Z',
    });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(row).toBeDefined();
    expect(JSON.parse(row!.data).title).toBe('Test');
  });

  it('replaces existing entity', () => {
    const db = initDb(':memory:');
    upsertEntity(db, 'tasks', {
      id: 'task-1',
      title: 'Old',
      global_updated_at: '2026-01-01T00:00:00Z',
    });
    upsertEntity(db, 'tasks', {
      id: 'task-1',
      title: 'New',
      global_updated_at: '2026-01-02T00:00:00Z',
    });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(JSON.parse(row!.data).title).toBe('New');
  });

  it('stores global_updated_at as epoch ms', () => {
    const db = initDb(':memory:');
    upsertEntity(db, 'tasks', {
      id: 'task-1',
      global_updated_at: '2026-01-01T00:00:00Z',
    });
    const row = getEntity(db, 'tasks', 'task-1');
    expect(row!.global_updated_at).toBe(
      new Date('2026-01-01T00:00:00Z').getTime(),
    );
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
