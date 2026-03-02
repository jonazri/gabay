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
