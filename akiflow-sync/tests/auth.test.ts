import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AkiflowAuth } from '../src/auth.js';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Build a minimal fake JWT with the given sub claim
const makeJwt = (sub: string): string =>
  `x.${Buffer.from(JSON.stringify({ sub })).toString('base64')}.x`;

describe('AkiflowAuth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('exchanges refresh token for access token', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        access_token: makeJwt('42'),
        refresh_token: 'same-refresh',
        expires_in: 1800,
      }),
    });

    const auth = new AkiflowAuth('my-refresh-token', '/tmp/test.env');
    const token = await auth.getAccessToken();
    expect(token).toBe(makeJwt('42'));
    expect(mockFetch).toHaveBeenCalledWith(
      'https://web.akiflow.com/oauth/refreshToken',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('caches token and does not re-fetch within expiry', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        access_token: makeJwt('42'),
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

  it('extracts user ID from JWT sub claim', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ access_token: makeJwt('12345'), refresh_token: 'r', expires_in: 1800 }),
    });

    const auth = new AkiflowAuth('refresh', '/tmp/test.env');
    const userId = await auth.getUserId();
    expect(userId).toBe('12345');
    // Only one fetch call (token refresh) — no HTTP call to /user/me
    expect(mockFetch).toHaveBeenCalledTimes(1);
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

  it('retries fetchWithAuth with fresh token on 401', async () => {
    mockFetch
      // Initial token fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: makeJwt('42'), refresh_token: 'r', expires_in: 1800 }),
      })
      // Pusher auth call returns 401
      .mockResolvedValueOnce({ ok: false, status: 401 })
      // Token refresh
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: makeJwt('42'), refresh_token: 'r', expires_in: 1800 }),
      })
      // Retry succeeds
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ auth: 'retry-auth' }),
      });

    const auth = new AkiflowAuth('refresh', '/tmp/test.env');
    const result = await auth.authorizePusherChannel('private-user.42', 'socket-id');
    expect(result.auth).toBe('retry-auth');
  });
});
