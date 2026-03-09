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
  overrides: Partial<{
    entity: string;
    method: string;
    payload: string;
    status: string;
    retry_count: number;
  }> = {},
) {
  db.prepare(
    `
    INSERT INTO pending_writes (entity, method, payload, status, retry_count, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
  ).run(
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
      json: async () => ({
        data: [{ id: 'task-1', global_updated_at: '2026-01-01T00:00:00Z' }],
      }),
    });

    await processPendingWritesOnce(db, auth);

    const row = db
      .prepare('SELECT status FROM pending_writes WHERE id = 1')
      .get() as any;
    expect(row.status).toBe('done');
  });

  it('marks write as failed after max retries', async () => {
    insertPendingWrite(db, { retry_count: 4 }); // one away from MAX_RETRIES=5
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 500 });

    await processPendingWritesOnce(db, auth);

    const row = db
      .prepare('SELECT status, retry_count FROM pending_writes WHERE id = 1')
      .get() as any;
    expect(row.status).toBe('failed');
    expect(row.retry_count).toBe(5);
  });

  it('resets to pending with incremented retry_count on retryable failure', async () => {
    insertPendingWrite(db, { retry_count: 1 });
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 500 });

    await processPendingWritesOnce(db, auth);

    const row = db
      .prepare('SELECT status, retry_count FROM pending_writes WHERE id = 1')
      .get() as any;
    expect(row.status).toBe('pending');
    expect(row.retry_count).toBe(2);
  });

  it('batches multiple writes for the same entity', async () => {
    insertPendingWrite(db, {
      payload: JSON.stringify({ id: 'task-1', title: 'A' }),
    });
    insertPendingWrite(db, {
      payload: JSON.stringify({ id: 'task-2', title: 'B' }),
    });

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
    insertPendingWrite(db, {
      entity: 'tasks',
      payload: JSON.stringify({ id: 'task-1' }),
    });
    insertPendingWrite(db, {
      entity: 'labels',
      payload: JSON.stringify({ id: 'label-1' }),
    });

    mockFetchWithAuth.mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ id: 'x', global_updated_at: '2026-01-01T00:00:00Z' }],
      }),
    });

    await processPendingWritesOnce(db, auth);

    expect(mockFetchWithAuth).toHaveBeenCalledTimes(2);
  });
});
