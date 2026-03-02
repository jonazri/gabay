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
