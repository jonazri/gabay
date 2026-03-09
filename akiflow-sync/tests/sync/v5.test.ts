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
      json: async () => ({
        data: [],
        has_next_page: false,
        sync_token: 'tok-1',
      }),
    });

    await syncV5Entity(db, 'tasks', auth);

    const url: string = mockFetchWithAuth.mock.calls[0][0];
    expect(url).toContain('sync_token=');
    expect(url).toContain('limit=2500');
  });

  it('saves sync_token after sync', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
        has_next_page: false,
        sync_token: 'new-token',
      }),
    });

    await syncV5Entity(db, 'tasks', auth);

    expect(getSyncToken(db, 'tasks')).toBe('new-token');
  });

  it('uses stored sync_token on subsequent syncs', async () => {
    // First sync
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
        has_next_page: false,
        sync_token: 'stored-token',
      }),
    });
    await syncV5Entity(db, 'tasks', auth);

    // Second sync
    mockFetchWithAuth.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [],
        has_next_page: false,
        sync_token: 'stored-token-2',
      }),
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
    const count = db.prepare('SELECT count(*) as n FROM tasks').get() as {
      n: number;
    };
    expect(count.n).toBe(2);
  });

  it('throws on non-ok response', async () => {
    mockFetchWithAuth.mockResolvedValueOnce({ ok: false, status: 500 });
    await expect(syncV5Entity(db, 'tasks', auth)).rejects.toThrow(
      'V5 sync tasks failed: 500',
    );
  });
});
