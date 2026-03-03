import fs from 'fs';
import path from 'path';
import { registerIpcHandler } from '../ipc-handlers.js';
import {
  sendGoogleAssistantCommand,
  resetGoogleAssistantConversation,
  googleAssistantHealth,
} from '../google-assistant.js';
import { DATA_DIR } from '../config.js';
import { logger } from '../logger.js';

registerIpcHandler('google_assistant_command', async (data, _deps, context) => {
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

    if (result.warning === 'no_response_text') {
      result.status = 'error';
      result.error =
        'Google Assistant returned no response text. Try splitting compound commands.';
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
});
