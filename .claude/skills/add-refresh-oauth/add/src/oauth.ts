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
const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Check if an externally-managed token is available (e.g. long-term token in
 * bashrc/environment or .env file). When present, proactive refresh is
 * unnecessary — the reactive safety nets handle the rare revocation case.
 */
function hasExternalToken(): boolean {
  // Check process environment (e.g. bashrc, systemd Environment=)
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true;

  // Check .env file (systemd services don't source bashrc)
  try {
    const content = fs.readFileSync(DOTENV_PATH, 'utf-8');
    return /^CLAUDE_CODE_OAUTH_TOKEN=.+$/m.test(content);
  } catch {
    return false;
  }
}

/**
 * Sync the OAuth token from credentials file to .env if they differ.
 * Skipped when a system-level token is available.
 */
function syncTokenToEnv(): void {
  if (hasExternalToken()) return;

  try {
    const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf-8'));
    const credToken: string | undefined = creds?.claudeAiOauth?.accessToken;
    if (!credToken) return;

    const envContent = fs.existsSync(DOTENV_PATH)
      ? fs.readFileSync(DOTENV_PATH, 'utf-8')
      : '';
    const envToken = envContent.match(/^CLAUDE_CODE_OAUTH_TOKEN=(.+)$/m)?.[1];

    if (envToken === credToken) return; // Already in sync

    // Atomic replace: strip old token line, append new one
    const filtered = envContent
      .split('\n')
      .filter((l) => !l.startsWith('CLAUDE_CODE_OAUTH_TOKEN='))
      .join('\n');
    const updated =
      filtered.endsWith('\n') || filtered === ''
        ? `${filtered}CLAUDE_CODE_OAUTH_TOKEN=${credToken}\n`
        : `${filtered}\nCLAUDE_CODE_OAUTH_TOKEN=${credToken}\n`;
    fs.writeFileSync(`${DOTENV_PATH}.tmp`, updated);
    fs.renameSync(`${DOTENV_PATH}.tmp`, DOTENV_PATH);
    logger.info('Synced OAuth token from credentials to .env');
  } catch (err) {
    logger.debug({ err }, 'Could not sync token to .env');
  }
}

/**
 * Ensure the OAuth token is fresh before spawning a container.
 * When a system-level token is set, always returns true (no check needed).
 * Otherwise checks credentials file and refreshes if near expiry.
 */
export async function ensureTokenFresh(): Promise<boolean> {
  if (hasExternalToken()) return true;

  try {
    const raw = fs.readFileSync(CREDENTIALS_PATH, 'utf-8');
    const creds = JSON.parse(raw);
    const expiresAt: number | undefined = creds?.claudeAiOauth?.expiresAt;

    if (!expiresAt) {
      logger.debug('No expiresAt in credentials, skipping pre-flight check');
      return true;
    }

    const nowMs = Date.now();
    const remainingMs = expiresAt - nowMs;

    if (remainingMs > REFRESH_BUFFER_MS) {
      syncTokenToEnv();
      return true; // Token still fresh
    }

    logger.warn(
      { remainingMs, expiresAt: new Date(expiresAt).toISOString() },
      'Token expired or expiring soon, refreshing before container spawn',
    );
    const ok = await refreshOAuthToken();
    if (ok) syncTokenToEnv();
    return ok;
  } catch (err) {
    // If we can't read credentials, don't block — let the container try anyway
    logger.debug({ err }, 'Could not check token freshness');
    return true;
  }
}

export function refreshOAuthToken(): Promise<boolean> {
  const script = path.join(process.cwd(), 'scripts', 'oauth', 'refresh.sh');
  return new Promise((resolve) => {
    execFile(script, { timeout: 60_000 }, (err) => {
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
  // System-level token (e.g. long-term token in bashrc) — no proactive refresh needed.
  // Reactive safety nets (ensureTokenFresh pre-flight + auth error retry in runAgent)
  // handle the rare case where the token is revoked.
  if (hasExternalToken()) {
    logger.info(
      'External CLAUDE_CODE_OAUTH_TOKEN found, proactive refresh disabled',
    );
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
        // Already close to expiry or expired — refresh soon
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
        if (hadFailure) {
          hadFailure = false;
          onAlert?.('OAuth token refreshed. Services restored.');
        }
        schedule(); // Re-read credentials and schedule next
      } else {
        hadFailure = true;
        onAlert?.('OAuth token refresh failed — retrying in 5 min.');
        refreshTimer = setTimeout(() => schedule(), RETRY_DELAY_MS);
      }
    }, delayMs);
  };

  schedule();
}
