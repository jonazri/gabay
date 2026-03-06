import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { logger } from './logger.js';

export const AUTH_ERROR_PATTERN =
  /401|unauthorized|authentication|token.*expired|invalid.*token|expired.*token/i;

const CREDENTIALS_PATH = path.join(
  os.homedir(),
  '.claude',
  '.credentials.json',
);
const DOTENV_PATH = path.join(process.cwd(), '.env');
const STATE_PATH = path.join(process.cwd(), '.oauth-state.json');
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const PROBE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

// --- State types ---

interface OAuthState {
  usingFallback: boolean;
  fallbackSince: string | null;
}

const DEFAULT_STATE: OAuthState = {
  usingFallback: false,
  fallbackSince: null,
};

// --- State persistence ---

export function readOAuthState(): OAuthState {
  try {
    return {
      ...DEFAULT_STATE,
      ...JSON.parse(fs.readFileSync(STATE_PATH, 'utf-8')),
    };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

export function writeOAuthState(state: OAuthState): void {
  fs.writeFileSync(`${STATE_PATH}.tmp`, JSON.stringify(state, null, 2) + '\n');
  fs.renameSync(`${STATE_PATH}.tmp`, STATE_PATH);
}

// --- Token helpers ---

/** Get the primary (long-term) token from process.env or .env file. */
export function getPrimaryToken(): string | null {
  return process.env.CLAUDE_CODE_OAUTH_TOKEN || readEnvToken() || null;
}

/** Write a token value into .env (atomic replace). */
function writeTokenToEnv(token: string): void {
  try {
    const envContent = fs.existsSync(DOTENV_PATH)
      ? fs.readFileSync(DOTENV_PATH, 'utf-8')
      : '';
    const filtered = envContent
      .split('\n')
      .filter((l) => !l.startsWith('CLAUDE_CODE_OAUTH_TOKEN='))
      .join('\n');
    const updated =
      filtered.endsWith('\n') || filtered === ''
        ? `${filtered}CLAUDE_CODE_OAUTH_TOKEN=${token}\n`
        : `${filtered}\nCLAUDE_CODE_OAUTH_TOKEN=${token}\n`;
    fs.writeFileSync(`${DOTENV_PATH}.tmp`, updated);
    fs.renameSync(`${DOTENV_PATH}.tmp`, DOTENV_PATH);
  } catch (err) {
    logger.debug({ err }, 'Could not write token to .env');
  }
}

// --- Initialization ---

/**
 * Initialize OAuth state on startup.
 * Restart in fallback mode: stay in fallback (state file persists).
 * Otherwise: log whether a primary token is available.
 */
export function initOAuthState(): void {
  const state = readOAuthState();

  if (state.usingFallback) {
    logger.info(
      { fallbackSince: state.fallbackSince },
      'Resuming in OAuth fallback mode (short-lived token refresh cycle)',
    );
    return;
  }

  const token = getPrimaryToken();
  if (token) {
    logger.info('initOAuthState: primary token available');
  } else {
    logger.info('initOAuthState: no primary token found');
  }
}

function readEnvToken(): string | null {
  try {
    const content = fs.readFileSync(DOTENV_PATH, 'utf-8');
    return content.match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m)?.[1] || null;
  } catch {
    return null;
  }
}

/** After refresh.sh rewrites .env, propagate the new token into process.env
 * so that readSecrets() (which prefers process.env) passes the fresh token. */
function syncRefreshedToken(): void {
  const token = readEnvToken();
  if (token) {
    process.env.CLAUDE_CODE_OAUTH_TOKEN = token;
    logger.debug('Synced refreshed token from .env into process.env');
  }
}

// --- Auth error recovery ---

/**
 * Detect an auth error and attempt token recovery.
 * Returns true if the token was successfully refreshed (caller should retry).
 * Returns false if the error is not auth-related or refresh failed.
 */
export async function attemptAuthRecovery(
  error: string,
  notify: (msg: string) => void | Promise<void>,
): Promise<boolean> {
  if (!AUTH_ERROR_PATTERN.test(error)) return false;

  logger.warn('Auth error detected, attempting token recovery');
  await notify('[system] Auth token expired — refreshing and retrying.');

  const state = readOAuthState();
  const refreshed = state.usingFallback
    ? await refreshOAuthToken()
    : await activateFallback((msg) => notify(`[system] ${msg}`));

  if (refreshed) {
    syncRefreshedToken();
    await notify('[system] Token refreshed. Services restored.');
  } else {
    await notify(
      '[system] Token refresh failed. You may need to run "claude login".',
    );
  }
  return refreshed;
}

// --- Fallback activation ---

/**
 * Transition from PRIMARY to FALLBACK mode.
 * Called when an auth error is detected and we're not already in fallback.
 * Runs refresh.sh to get a short-lived token, starts the refresh scheduler
 * and primary probe timer.
 */
export async function activateFallback(
  onAlert?: (msg: string) => void,
): Promise<boolean> {
  const state = readOAuthState();
  if (state.usingFallback) {
    // Already in fallback — just refresh
    const ok = await refreshOAuthToken();
    if (ok) syncRefreshedToken();
    return ok;
  }

  logger.warn('Activating OAuth fallback mode — primary token failed');
  state.usingFallback = true;
  state.fallbackSince = new Date().toISOString();
  writeOAuthState(state);

  const ok = await refreshOAuthToken();
  if (ok) {
    syncRefreshedToken();
    startTokenRefreshScheduler(onAlert);
    startPrimaryProbe(onAlert);
    onAlert?.('Primary token failed — switched to fallback refresh cycle.');
  }
  return ok;
}

// --- Primary token probe ---

let probeTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Lightweight API call to test if the primary token still works.
 * Uses POST /v1/messages with max_tokens=1.
 */
export async function probePrimaryToken(token: string): Promise<boolean> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    });
    return res.ok;
  } catch (err) {
    logger.debug({ err }, 'Primary token probe failed (network error)');
    return false;
  }
}

export function startPrimaryProbe(onAlert?: (msg: string) => void): void {
  stopPrimaryProbe();

  const probe = async () => {
    const state = readOAuthState();
    if (!state.usingFallback) return; // Already restored

    const primary = getPrimaryToken();
    if (!primary) {
      logger.debug('No primary token to probe');
      probeTimer = setTimeout(probe, PROBE_INTERVAL_MS);
      return;
    }

    const ok = await probePrimaryToken(primary);
    if (ok) {
      logger.info('Primary token probe succeeded — restoring primary mode');
      state.usingFallback = false;
      state.fallbackSince = null;
      writeOAuthState(state);
      writeTokenToEnv(primary);
      stopTokenRefreshScheduler();
      onAlert?.('Primary OAuth token restored. Fallback cycle stopped.');
    } else {
      logger.debug('Primary token probe failed — staying in fallback');
      probeTimer = setTimeout(probe, PROBE_INTERVAL_MS);
    }
  };

  probeTimer = setTimeout(probe, PROBE_INTERVAL_MS);
}

export function stopPrimaryProbe(): void {
  if (probeTimer) {
    clearTimeout(probeTimer);
    probeTimer = null;
  }
}

// --- Token freshness ---

/**
 * Ensure the OAuth token is fresh before spawning a container.
 * In primary mode with a known token: return true immediately.
 * In fallback mode: check credentials file expiry.
 */
export async function ensureTokenFresh(): Promise<boolean> {
  const state = readOAuthState();

  if (!state.usingFallback && getPrimaryToken()) {
    return true; // Primary mode — token is long-lived
  }

  // Fallback mode: check credentials file for short-lived token expiry
  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const creds = JSON.parse(raw);
    const expiresAt: number | undefined = creds?.claudeAiOauth?.expiresAt;

    if (!expiresAt) {
      logger.debug('No expiresAt in credentials, skipping pre-flight check');
      return true;
    }

    const remainingMs = expiresAt - Date.now();
    if (remainingMs > REFRESH_BUFFER_MS) {
      return true; // Token still fresh
    }

    logger.warn(
      { remainingMs, expiresAt: new Date(expiresAt).toISOString() },
      'Token expired or expiring soon, refreshing before container spawn',
    );
    const ok = await refreshOAuthToken();
    if (ok) syncRefreshedToken();
    return ok;
  } catch (err) {
    logger.debug({ err }, 'Could not check token freshness');
    return true;
  }
}

// --- Refresh ---

export function refreshOAuthToken(): Promise<boolean> {
  const script = path.join(process.cwd(), 'scripts', 'oauth', 'refresh.sh');
  return new Promise((resolve) => {
    execFile(script, { timeout: 90_000 }, (err) => {
      if (err) {
        logger.error({ err }, 'OAuth refresh script failed');
        resolve(false);
      } else {
        logger.info('OAuth token refreshed via refresh script');
        resolve(true);
      }
    });
  });
}

// --- Proactive refresh scheduler (fallback mode only) ---

const SCHEDULE_BUFFER_MS = 30 * 60 * 1000; // 30 minutes before expiry
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes on failure
const MAX_DELAY_MS = 23 * 60 * 60 * 1000; // 23 hours

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

export function stopTokenRefreshScheduler(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

export function startTokenRefreshScheduler(
  onAlert?: (msg: string) => void,
): void {
  const state = readOAuthState();
  if (!state.usingFallback) {
    logger.info('Not in fallback mode, proactive refresh disabled');
    return;
  }

  let hadFailure = false;

  const schedule = () => {
    if (refreshTimer) clearTimeout(refreshTimer);

    let delayMs: number;
    try {
      const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
      const creds = JSON.parse(raw);
      const expiresAt: number | undefined = creds?.claudeAiOauth?.expiresAt;

      if (!expiresAt) {
        logger.debug(
          'No expiresAt in credentials, skipping proactive refresh scheduler',
        );
        return;
      }

      const remainingMs = expiresAt - Date.now();

      if (remainingMs > SCHEDULE_BUFFER_MS) {
        delayMs = Math.min(remainingMs - SCHEDULE_BUFFER_MS, MAX_DELAY_MS);
      } else {
        delayMs = RETRY_DELAY_MS;
      }

      logger.info(
        { delayMs, expiresAt: new Date(expiresAt).toISOString() },
        'Scheduled OAuth refresh',
      );
    } catch (err) {
      logger.debug({ err }, 'Could not read credentials for scheduling');
      return;
    }

    refreshTimer = setTimeout(async () => {
      const ok = await refreshOAuthToken();
      if (ok) {
        syncRefreshedToken();
        if (hadFailure) {
          hadFailure = false;
          onAlert?.('OAuth token refreshed. Services restored.');
        }
        schedule();
      } else {
        hadFailure = true;
        onAlert?.('OAuth token refresh failed — retrying in 5 min.');
        refreshTimer = setTimeout(() => schedule(), RETRY_DELAY_MS);
      }
    }, delayMs);
  };

  schedule();
}
