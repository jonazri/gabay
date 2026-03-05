import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

import {
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
      primaryToken: null,
      usingFallback: false,
      fallbackSince: null,
    });
  });

  it('round-trips state', () => {
    const state = {
      primaryToken: 'sk-test-token',
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

  it('returns persisted token when process.env is empty', () => {
    writeOAuthState({
      primaryToken: 'sk-persisted',
      usingFallback: false,
      fallbackSince: null,
    });
    expect(getPrimaryToken()).toBe('sk-persisted');
  });

  it('returns null when no token anywhere', () => {
    expect(getPrimaryToken()).toBeNull();
  });
});

describe('initOAuthState', () => {
  it('persists primary token from process.env', () => {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = 'sk-from-env';
    initOAuthState();
    const state = readOAuthState();
    expect(state.primaryToken).toBe('sk-from-env');
    expect(state.usingFallback).toBe(false);
  });

  it('preserves fallback mode on restart', () => {
    writeOAuthState({
      primaryToken: 'sk-primary',
      usingFallback: true,
      fallbackSince: '2026-03-05T02:44:00.000Z',
    });
    initOAuthState();
    const state = readOAuthState();
    expect(state.usingFallback).toBe(true);
    expect(state.primaryToken).toBe('sk-primary');
  });
});

describe('activateFallback', () => {
  it('transitions to fallback and calls onAlert', async () => {
    writeOAuthState({
      primaryToken: 'sk-primary',
      usingFallback: false,
      fallbackSince: null,
    });

    const alerts: string[] = [];
    const ok = await activateFallback((msg) => alerts.push(msg));

    // refresh.sh runs and succeeds on this machine
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
      primaryToken: 'sk-primary',
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
      primaryToken: 'sk-primary',
      usingFallback: false,
      fallbackSince: null,
    });
    expect(await ensureTokenFresh()).toBe(true);
  });
});

describe('startTokenRefreshScheduler', () => {
  it('does not start when not in fallback mode', () => {
    writeOAuthState({
      primaryToken: 'sk-primary',
      usingFallback: false,
      fallbackSince: null,
    });
    // Should not throw or set any timers
    startTokenRefreshScheduler();
    stopTokenRefreshScheduler();
  });
});
