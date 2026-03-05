import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Mock child_process so refreshOAuthToken() doesn't need real refresh.sh
vi.mock('child_process', () => ({
  execFile: vi.fn(
    (_path: string, _opts: unknown, cb: (err: Error | null) => void) =>
      cb(null),
  ),
}));

import {
  attemptAuthRecovery,
  readOAuthState,
  writeOAuthState,
  getPrimaryToken,
  initOAuthState,
  activateFallback,
  probePrimaryToken,
  ensureTokenFresh,
  startTokenRefreshScheduler,
  stopTokenRefreshScheduler,
  startPrimaryProbe,
  stopPrimaryProbe,
} from './oauth.js';

const STATE_PATH = path.join(process.cwd(), '.oauth-state.json');

function cleanState() {
  try {
    fs.unlinkSync(STATE_PATH);
  } catch {
    // ignore
  }
}

beforeEach(() => {
  cleanState();
  stopTokenRefreshScheduler();
  stopPrimaryProbe();
  delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
});

afterEach(() => {
  cleanState();
  stopTokenRefreshScheduler();
  stopPrimaryProbe();
  vi.restoreAllMocks();
});

describe('readOAuthState / writeOAuthState', () => {
  it('returns defaults when no state file exists', () => {
    const state = readOAuthState();
    expect(state).toEqual({
      usingFallback: false,
      fallbackSince: null,
    });
  });

  it('round-trips state', () => {
    const state = {
      usingFallback: true,
      fallbackSince: '2026-03-05T02:44:00.000Z',
    };
    writeOAuthState(state);
    expect(readOAuthState()).toEqual(state);
  });
});

describe('getPrimaryToken', () => {
  it('returns process.env token when set', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-env-token';
    expect(getPrimaryToken()).toBe('sk-env-token');
  });

  it('falls back to .env file when process.env is empty', () => {
    // getPrimaryToken reads .env file as fallback; the project .env has a token
    const token = getPrimaryToken();
    // Should return something (from .env) rather than null
    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
  });
});

describe('initOAuthState', () => {
  it('does not crash when no token exists', () => {
    initOAuthState();
    const state = readOAuthState();
    expect(state.usingFallback).toBe(false);
  });

  it('preserves fallback mode on restart', () => {
    writeOAuthState({
      usingFallback: true,
      fallbackSince: '2026-03-05T02:44:00.000Z',
    });
    initOAuthState();
    const state = readOAuthState();
    expect(state.usingFallback).toBe(true);
  });
});

describe('activateFallback', () => {
  it('transitions to fallback and calls onAlert', async () => {
    writeOAuthState({
      usingFallback: false,
      fallbackSince: null,
    });

    const alerts: string[] = [];
    const ok = await activateFallback((msg) => alerts.push(msg));

    expect(ok).toBe(true);
    const state = readOAuthState();
    expect(state.usingFallback).toBe(true);
    expect(state.fallbackSince).toBeTruthy();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/fallback/i);

    // Cleanup timers started by activateFallback
    stopTokenRefreshScheduler();
    stopPrimaryProbe();
  });

  it('stays in fallback when already there', async () => {
    writeOAuthState({
      usingFallback: true,
      fallbackSince: '2026-03-05T02:44:00.000Z',
    });

    const ok = await activateFallback();
    expect(ok).toBe(true);
    // Should still be in fallback
    const state = readOAuthState();
    expect(state.usingFallback).toBe(true);
  });
});

describe('probePrimaryToken', () => {
  it('returns true on 200', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200 }),
    );
    expect(await probePrimaryToken('sk-test')).toBe(true);
  });

  it('returns false on 401', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    expect(await probePrimaryToken('sk-test')).toBe(false);
  });

  it('returns false on network error', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    expect(await probePrimaryToken('sk-test')).toBe(false);
  });
});

describe('ensureTokenFresh', () => {
  it('returns true immediately in primary mode with token', async () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-primary';
    writeOAuthState({
      usingFallback: false,
      fallbackSince: null,
    });
    expect(await ensureTokenFresh()).toBe(true);
  });
});

describe('attemptAuthRecovery', () => {
  it('returns false for non-auth errors', async () => {
    const notifications: string[] = [];
    const result = await attemptAuthRecovery(
      'ENOENT: file not found',
      (msg) => {
        notifications.push(msg);
      },
    );
    expect(result).toBe(false);
    expect(notifications).toHaveLength(0);
  });

  it('returns true and notifies on auth error when not in fallback', async () => {
    writeOAuthState({ usingFallback: false, fallbackSince: null });
    const notifications: string[] = [];
    const result = await attemptAuthRecovery(
      'API Error: 401 Unauthorized',
      (msg) => {
        notifications.push(msg);
      },
    );
    expect(result).toBe(true);
    expect(notifications).toContainEqual(
      expect.stringContaining('Auth token expired'),
    );
    expect(notifications).toContainEqual(
      expect.stringContaining('Token refreshed'),
    );
    // activateFallback starts timers — clean up
    stopTokenRefreshScheduler();
    stopPrimaryProbe();
  });

  it('returns true and calls refreshOAuthToken when already in fallback', async () => {
    writeOAuthState({
      usingFallback: true,
      fallbackSince: '2026-03-05T00:00:00.000Z',
    });
    const notifications: string[] = [];
    const result = await attemptAuthRecovery('token expired', (msg) => {
      notifications.push(msg);
    });
    expect(result).toBe(true);
    expect(notifications).toContainEqual(
      expect.stringContaining('Token refreshed'),
    );
  });
});

describe('startTokenRefreshScheduler', () => {
  it('does not start when not in fallback mode', () => {
    writeOAuthState({
      usingFallback: false,
      fallbackSince: null,
    });
    // Should not throw or set any timers
    startTokenRefreshScheduler();
    stopTokenRefreshScheduler();
  });
});
