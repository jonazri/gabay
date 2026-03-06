import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

export type IpcErrorCode =
  | 'unknown_ipc_type'
  | 'handler_error'
  | 'malformed_request'
  | 'invalid_request';

/**
 * Write an error notification file to ipc/{group}/input/ so the agent-runner's
 * drainIpcInput() picks it up and pipes the error message into the running
 * conversation.
 */
export function writeIpcNotification(
  sourceGroup: string,
  errorCode: IpcErrorCode,
  ipcType: string,
  errorMessage: string,
): void {
  const inputDir = path.join(DATA_DIR, 'ipc', sourceGroup, 'input');
  fs.mkdirSync(inputDir, { recursive: true });

  const agentAction =
    errorCode === 'unknown_ipc_type'
      ? 'If this is your mistake (typo, wrong type name), correct and retry. If the type matches a known CLI tool or skill, it\'s a host-side bug — the handler registration is broken. Write a bug report to /workspace/group/feature-requests/.'
      : errorCode === 'handler_error'
        ? 'The host handler crashed. This is a host-side bug. Write a bug report to /workspace/group/feature-requests/ and inform the user.'
        : 'This is likely your mistake. Fix the request and retry.';

  const text = `[IPC Error] Type "${ipcType}" failed (${errorCode}): ${errorMessage}. ${agentAction}`;

  const timestamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const filePath = path.join(inputDir, `${timestamp}.json`);
  const tempFile = `${filePath}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify({ type: 'message', text }));
  fs.renameSync(tempFile, filePath);

  logger.info(
    { sourceGroup, errorCode, ipcType },
    'IPC error notification written for agent',
  );
}
