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
