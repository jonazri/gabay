import fs from 'fs';
import path from 'path';
import { IpcHandler, registerIpcHandler } from '../ipc-handlers.js';
import {
  sendGoogleAssistantCommand,
  resetGoogleAssistantConversation,
  googleAssistantHealth,
} from '../google-assistant.js';
import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';

const handler: IpcHandler = async (data, _deps, context) => {
  const requestId = data.requestId as string | undefined;
  const text = data.text as string | undefined;

  const writeIpcResponse = (reqId: string, response: object) => {
    const responsesDir = path.join(
      DATA_DIR,
      'ipc',
      context.sourceGroup,
      'responses',
    );
    fs.mkdirSync(responsesDir, { recursive: true });
    const responseFile = path.join(responsesDir, `${reqId}.json`);
    const tempFile = `${responseFile}.tmp`;
    fs.writeFileSync(tempFile, JSON.stringify(response));
    fs.renameSync(tempFile, responseFile);
  };

  if (!requestId || !text) {
    logger.warn(
      { data },
      'Invalid google_assistant_command: missing requestId or text',
    );
    if (requestId) {
      writeIpcResponse(requestId, {
        status: 'error',
        error: `Invalid google_assistant_command: missing ${!text ? 'text' : 'requestId'}`,
      });
    }
    return;
  }

  try {
    const result =
      text === '__reset_conversation__'
        ? await resetGoogleAssistantConversation()
        : text === '__health__'
          ? await googleAssistantHealth()
          : await sendGoogleAssistantCommand(text);

    // When Google Assistant returns no text (common for compound commands
    // like "set lights to daylight and 20%"), the command may still have
    // executed successfully. Don't escalate to error — return ok with
    // a synthetic confirmation.
    if (result.warning === 'no_response_text') {
      result.text = 'Command sent (no verbal confirmation from Assistant).';
    }

    writeIpcResponse(requestId, result);
    logger.info(
      { requestId, sourceGroup: context.sourceGroup, text: text.slice(0, 50) },
      'Google Assistant command processed',
    );
  } catch (err) {
    writeIpcResponse(requestId, {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
    logger.error(
      { err, requestId, sourceGroup: context.sourceGroup },
      'Google Assistant command failed',
    );
  }
};

registerIpcHandler('google_assistant_command', handler);
registerIpcHandler('google_home_command', handler);
