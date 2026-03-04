import { registerIpcHandler } from '../ipc-handlers.js';
import { logger } from '../logger.js';

registerIpcHandler('unregister_group', (data, deps, context) => {
  if (!context.isMain) {
    logger.warn(
      { sourceGroup: context.sourceGroup },
      'Unauthorized unregister_group attempt blocked',
    );
    return;
  }
  if (typeof data.jid !== 'string' || !data.jid) {
    logger.warn(
      { data },
      'Invalid unregister_group request - jid must be a string',
    );
    return;
  }
  if (!deps.unregisterGroup) {
    logger.warn('unregister_group IPC received but handler not provided');
    return;
  }
  const deleted = deps.unregisterGroup(data.jid);
  if (deleted) {
    logger.info(
      { jid: data.jid, sourceGroup: context.sourceGroup },
      'Group unregistered via IPC',
    );
  } else {
    logger.warn(
      { jid: data.jid, sourceGroup: context.sourceGroup },
      'unregister_group: JID not found',
    );
  }
});
