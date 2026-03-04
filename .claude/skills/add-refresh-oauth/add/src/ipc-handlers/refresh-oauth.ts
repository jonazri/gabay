import path from 'path';
import { exec } from 'child_process';
import { registerIpcHandler } from '../ipc-handlers.js';
import { logger } from '../logger.js';

registerIpcHandler('refresh_oauth', (_data, _deps, context) => {
  const script = path.join(process.cwd(), 'scripts', 'oauth', 'refresh.sh');
  exec(script, { timeout: 60_000 }, (err, _stdout, stderr) => {
    if (err) {
      logger.error(
        { err, stderr, sourceGroup: context.sourceGroup },
        'OAuth refresh failed',
      );
    } else {
      logger.info(
        { sourceGroup: context.sourceGroup },
        'OAuth token refreshed via IPC',
      );
    }
  });
});
