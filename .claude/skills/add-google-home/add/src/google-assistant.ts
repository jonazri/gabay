import { ChildProcess, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as https from 'https';
import * as net from 'net';
import * as path from 'path';
import * as readline from 'readline';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export interface GoogleAssistantResponse {
  status: string;
  text?: string;
  error?: string;
  warning?: string;
  raw_html?: string;
}

const VENV_PYTHON = path.join(
  process.cwd(),
  'scripts',
  'venv',
  'bin',
  'python3',
);
const PYTHON_DAEMON = path.join(
  process.cwd(),
  'scripts',
  'google-assistant-daemon.py',
);
const GOOGLE_CREDENTIALS_PATH = path.join(
  process.cwd(),
  'data',
  'google-assistant',
  'credentials.json',
);

const REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes
const RETRY_DELAY_MS = 5 * 60 * 1000; // 5 minutes on failure
const MAX_DELAY_MS = 23 * 60 * 60 * 1000; // 23 hours

// ── Google OAuth token management ─────────────────────────────────

interface GoogleCredentials {
  token?: string;
  refresh_token?: string;
  token_uri?: string;
  client_id?: string;
  client_secret?: string;
  scopes?: string[];
  expires_at?: number; // epoch ms
}

function readGoogleCredentials(): GoogleCredentials | null {
  try {
    return JSON.parse(fs.readFileSync(GOOGLE_CREDENTIALS_PATH, 'utf-8'));
  } catch {
    return null;
  }
}

function writeGoogleCredentials(creds: GoogleCredentials): void {
  const dir = path.dirname(GOOGLE_CREDENTIALS_PATH);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${GOOGLE_CREDENTIALS_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(creds, null, 2));
  fs.renameSync(tmp, GOOGLE_CREDENTIALS_PATH);
}

export function refreshGoogleToken(): Promise<boolean> {
  const creds = readGoogleCredentials();
  if (!creds?.client_id || !creds?.client_secret || !creds?.refresh_token) {
    logger.debug('Google credentials missing fields, cannot refresh');
    return Promise.resolve(false);
  }

  const postData = new URLSearchParams({
    client_id: creds.client_id,
    client_secret: creds.client_secret,
    refresh_token: creds.refresh_token,
    grant_type: 'refresh_token',
  }).toString();

  return new Promise((resolve) => {
    const req = https.request(
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Content-Length': Buffer.byteLength(postData),
        },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => {
          body += chunk.toString();
        });
        res.on('end', () => {
          if (res.statusCode !== 200) {
            logger.error(
              { statusCode: res.statusCode, body },
              'Google token refresh failed',
            );
            resolve(false);
            return;
          }
          try {
            const data = JSON.parse(body);
            const expiresAt = Date.now() + (data.expires_in ?? 3600) * 1000;
            writeGoogleCredentials({
              ...creds,
              token: data.access_token,
              expires_at: expiresAt,
            });
            logger.info(
              { expiresAt: new Date(expiresAt).toISOString() },
              'Google token refreshed',
            );
            resolve(true);
          } catch (err) {
            logger.error({ err }, 'Failed to parse Google token response');
            resolve(false);
          }
        });
      },
    );
    req.on('error', (err) => {
      logger.error({ err }, 'Google token refresh request failed');
      resolve(false);
    });
    req.write(postData);
    req.end();
  });
}

export async function ensureGoogleTokenFresh(): Promise<boolean> {
  const creds = readGoogleCredentials();
  if (!creds?.expires_at) return true; // No expiry info — let daemon handle it
  if (!creds.refresh_token) return true; // Can't refresh without refresh_token

  const remaining = creds.expires_at - Date.now();
  if (remaining > REFRESH_BUFFER_MS) return true; // Still fresh

  logger.warn(
    {
      remainingMs: remaining,
      expiresAt: new Date(creds.expires_at).toISOString(),
    },
    'Google token expired or expiring soon, refreshing',
  );
  return refreshGoogleToken();
}

let googleRefreshTimer: ReturnType<typeof setTimeout> | null = null;

export function stopGoogleTokenScheduler(): void {
  if (googleRefreshTimer) {
    clearTimeout(googleRefreshTimer);
    googleRefreshTimer = null;
  }
}

export function startGoogleTokenScheduler(
  onAlert?: (msg: string) => void,
): void {
  // Only schedule if credentials file exists with refresh_token
  const creds = readGoogleCredentials();
  if (!creds?.refresh_token) {
    logger.debug('No Google refresh_token, skipping token scheduler');
    return;
  }

  let hadFailure = false;

  const schedule = () => {
    if (googleRefreshTimer) clearTimeout(googleRefreshTimer);

    const currentCreds = readGoogleCredentials();
    if (!currentCreds?.expires_at) {
      logger.debug('No expires_at in Google credentials, skipping schedule');
      return;
    }

    const remaining = currentCreds.expires_at - Date.now();
    let delayMs: number;

    if (remaining > REFRESH_BUFFER_MS) {
      delayMs = Math.min(remaining - REFRESH_BUFFER_MS, MAX_DELAY_MS);
    } else {
      delayMs = RETRY_DELAY_MS;
    }

    logger.info(
      { delayMs, expiresAt: new Date(currentCreds.expires_at).toISOString() },
      'Scheduled Google token refresh',
    );

    googleRefreshTimer = setTimeout(async () => {
      const ok = await refreshGoogleToken();
      if (ok) {
        if (hadFailure) {
          hadFailure = false;
          onAlert?.('Google token refreshed. Services restored.');
        }
        schedule();
      } else {
        hadFailure = true;
        onAlert?.('Google token refresh failed — retrying in 5 min.');
        googleRefreshTimer = setTimeout(() => schedule(), RETRY_DELAY_MS);
      }
    }, delayMs);
  };

  schedule();
}

// ── Python daemon management ──────────────────────────────────────

interface PendingCommand {
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: ReturnType<typeof setTimeout>;
}

let daemon: ChildProcess | null = null;
let daemonRL: readline.Interface | null = null;
const pendingCommands = new Map<string, PendingCommand>();
let daemonReady = false;
let daemonStarting: Promise<void> | null = null;
let consecutiveFailures = 0;

async function ensureDaemon(): Promise<void> {
  if (daemon && !daemon.killed && daemonReady) return;
  if (daemonStarting) return daemonStarting;

  // Clean up any dead process
  if (daemon) {
    daemon.kill();
    daemon = null;
    daemonRL = null;
    daemonReady = false;
  }

  daemonStarting = new Promise<void>((resolve, reject) => {
    const proc = spawn(VENV_PYTHON, [PYTHON_DAEMON], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PROTOCOL_BUFFERS_PYTHON_IMPLEMENTATION: 'python' },
    });

    proc.stderr!.on('data', (data: Buffer) => {
      logger.info({ stderr: data.toString().trim() }, 'google-assistant-daemon');
    });

    proc.on('error', (err) => {
      logger.error({ err }, 'Failed to spawn Google Assistant daemon');
      daemon = null;
      daemonReady = false;
      reject(err);
    });

    proc.on('exit', (code) => {
      logger.info({ code }, 'Google Assistant daemon exited');
      daemon = null;
      daemonRL = null;
      daemonReady = false;
      // Reject all pending commands
      for (const [id, pending] of pendingCommands) {
        clearTimeout(pending.timer);
        pending.reject(new Error(`Daemon exited with code ${code}`));
      }
      pendingCommands.clear();
    });

    const rl = readline.createInterface({ input: proc.stdout! });

    rl.on('line', (line: string) => {
      let parsed: any;
      try {
        parsed = JSON.parse(line);
      } catch {
        logger.warn({ line }, 'Non-JSON line from Google Assistant daemon');
        return;
      }

      // First message is the "ready" signal
      if (!daemonReady && parsed.status === 'ready') {
        daemonReady = true;
        resolve();
        return;
      }

      // Route response to the correct pending command by ID
      const cmdId = parsed.id as string | undefined;
      if (cmdId && pendingCommands.has(cmdId)) {
        const pending = pendingCommands.get(cmdId)!;
        pendingCommands.delete(cmdId);
        clearTimeout(pending.timer);
        pending.resolve(parsed);
      } else if (pendingCommands.size === 1) {
        // Fallback for responses without id (backward compat)
        const entry = pendingCommands.entries().next().value;
        if (entry) {
          const [fallbackId, pending] = entry;
          pendingCommands.delete(fallbackId);
          clearTimeout(pending.timer);
          pending.resolve(parsed);
        }
      } else if (pendingCommands.size > 0) {
        logger.warn(
          { cmdId, pending: pendingCommands.size },
          'Unroutable response from daemon (no matching id)',
        );
      }
    });

    daemon = proc;
    daemonRL = rl;

    // Timeout if daemon doesn't connect within 30s
    setTimeout(() => {
      if (!daemonReady) {
        proc.kill();
        reject(new Error('Google Assistant daemon timed out during startup'));
      }
    }, 30_000);
  }).finally(() => {
    daemonStarting = null;
  });

  return daemonStarting;
}

async function sendCommand(cmd: Record<string, unknown>): Promise<any> {
  // Auto-restart daemon after consecutive failures
  if (consecutiveFailures >= 3 && daemon && !daemon.killed) {
    logger.warn(
      { consecutiveFailures },
      'Too many consecutive failures, restarting daemon',
    );
    daemon.kill();
    daemon = null;
    daemonRL = null;
    daemonReady = false;
    consecutiveFailures = 0;
  }

  await ensureGoogleTokenFresh();
  await ensureDaemon();

  if (!daemon || !daemon.stdin) {
    throw new Error('Google Assistant daemon not available');
  }

  const id = crypto.randomUUID();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (pendingCommands.has(id)) {
        pendingCommands.delete(id);
        reject(new Error('Command timed out'));
      }
    }, 30_000);

    pendingCommands.set(id, { resolve, reject, timer });

    daemon!.stdin!.write(JSON.stringify({ ...cmd, id }) + '\n');
  });
}

// ── Eager daemon startup ──────────────────────────────────────────

/**
 * Pre-start the Python daemon at NanoClaw startup to avoid cold-start delays.
 * Fire-and-forget — logs but never throws.
 */
export async function initGoogleAssistantDaemon(): Promise<void> {
  try {
    await ensureDaemon();
    logger.info('Google Assistant daemon initialized');
  } catch (err) {
    logger.warn(
      { err },
      'Google Assistant daemon failed to start at init (will retry on first command)',
    );
  }
}

// ── Public API ────────────────────────────────────────────────────

/**
 * Send a text command to Google Assistant and return the response.
 */
export async function sendGoogleAssistantCommand(
  text: string,
): Promise<GoogleAssistantResponse> {
  let result: any;
  try {
    result = await sendCommand({ cmd: 'command', text });
  } catch (err) {
    consecutiveFailures++;
    throw err;
  }

  if (result.error) {
    consecutiveFailures++;
    throw new Error(result.error);
  }

  consecutiveFailures = 0;

  const response: GoogleAssistantResponse = {
    status: result.status,
    text: result.text,
    raw_html: result.raw_html,
  };
  if (result.warning) {
    response.warning = result.warning;
  }
  return response;
}

/**
 * Reset the Google Assistant conversation (clear conversation state).
 */
export async function resetGoogleAssistantConversation(): Promise<GoogleAssistantResponse> {
  const result = await sendCommand({ cmd: 'reset_conversation' });

  if (result.error) {
    throw new Error(result.error);
  }

  consecutiveFailures = 0;
  return result;
}

/**
 * Check Google Assistant daemon health.
 */
export async function googleAssistantHealth(): Promise<GoogleAssistantResponse> {
  const result = await sendCommand({ cmd: 'health' });
  consecutiveFailures = 0;
  return result;
}

/**
 * Shut down the Python daemon (call on process exit).
 */
export function shutdownGoogleAssistant(): void {
  if (daemon && !daemon.killed) {
    daemon.kill();
    daemon = null;
    daemonRL?.close();
    daemonRL = null;
    daemonReady = false;
    // Reject all pending commands
    for (const [id, pending] of pendingCommands) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Google Assistant daemon shut down'));
    }
    pendingCommands.clear();
  }
}

// ── Unix socket server ───────────────────────────────────────────

let socketServer: net.Server | null = null;

async function handleSocketRequest(
  conn: net.Socket,
  line: string,
  isDisconnected: () => boolean,
): Promise<void> {
  let request: any;
  try {
    request = JSON.parse(line);
  } catch {
    if (!isDisconnected()) {
      conn.write(
        JSON.stringify({ status: 'error', error: 'Invalid JSON' }) + '\n',
      );
      conn.end();
    }
    return;
  }

  const { cmd, text, requestId, sourceGroup, chatJid } = request;

  let result: GoogleAssistantResponse;
  try {
    switch (cmd) {
      case 'command':
        result = await sendGoogleAssistantCommand(text);
        break;
      case 'reset':
        result = await resetGoogleAssistantConversation();
        break;
      case 'health':
        result = await googleAssistantHealth();
        break;
      default:
        result = { status: 'error', error: `Unknown command: ${cmd}` };
    }
  } catch (err) {
    result = {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // When Google Assistant returns no text (common for compound commands
  // like "set lights to daylight and 20%"), the command may still have
  // executed successfully. Provide a synthetic confirmation.
  if (result.warning === 'no_response_text') {
    result.text = 'Command sent (no verbal confirmation from Assistant).';
  }

  if (!isDisconnected()) {
    conn.write(JSON.stringify(result) + '\n');
    conn.end();
  } else if (sourceGroup && chatJid && requestId) {
    writeDeferredResponse(sourceGroup, chatJid, requestId, result);
  }
}

function writeDeferredResponse(
  sourceGroup: string,
  chatJid: string,
  requestId: string,
  result: GoogleAssistantResponse,
): void {
  const messagesDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'messages');
  fs.mkdirSync(messagesDir, { recursive: true });
  const responseText = result.error
    ? `[Google Home] Error: ${result.error}`
    : `[Google Home] ${result.text || 'Done'}`;
  const msgFile = path.join(messagesDir, `${requestId}.json`);
  const tmpFile = `${msgFile}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify({ chatJid, text: responseText }));
  fs.renameSync(tmpFile, msgFile);
  logger.info(
    { requestId, sourceGroup },
    'Deferred Google Assistant response written to IPC',
  );
}

export function startGoogleAssistantSocket(): void {
  const sockDir = path.join(DATA_DIR, 'sockets');
  fs.mkdirSync(sockDir, { recursive: true });
  const sockPath = path.join(sockDir, 'google-assistant.sock');

  // Clean up stale socket from previous run
  try {
    fs.unlinkSync(sockPath);
  } catch {}

  socketServer = net.createServer((conn) => {
    let buffer = '';
    let disconnected = false;

    conn.on('data', (data) => {
      buffer += data.toString();
      const newlineIdx = buffer.indexOf('\n');
      if (newlineIdx === -1) return;

      const line = buffer.slice(0, newlineIdx);
      buffer = buffer.slice(newlineIdx + 1);

      handleSocketRequest(conn, line, () => disconnected).catch((err) => {
        logger.error({ err }, 'Socket request handler error');
        if (!disconnected) {
          try {
            conn.write(
              JSON.stringify({ status: 'error', error: String(err) }) + '\n',
            );
            conn.end();
          } catch {}
        }
      });
    });

    conn.on('close', () => {
      disconnected = true;
    });
    conn.on('error', () => {
      disconnected = true;
    });
  });

  socketServer.listen(sockPath, () => {
    fs.chmodSync(sockPath, 0o666);
    logger.info({ sockPath }, 'Google Assistant socket server listening');
  });

  socketServer.on('error', (err) => {
    logger.error({ err }, 'Google Assistant socket server error');
  });
}

export function stopGoogleAssistantSocket(): void {
  if (socketServer) {
    socketServer.close();
    socketServer = null;
  }
}
