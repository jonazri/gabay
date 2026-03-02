import { createRequire } from 'module';
import { config } from 'dotenv';
import { resolve } from 'path';
import {
  initDb,
  ENTITIES_V5,
  ENTITIES_V3,
  type EntityV3,
} from './db.js';
import { AkiflowAuth } from './auth.js';
import { syncV5Entity } from './sync/v5.js';
import { syncV3Entity } from './sync/v3.js';
import { startPendingWritePoller } from './pending.js';
import { logger } from './logger.js';
import type { Channel, Options } from 'pusher-js';
import type { ChannelAuthorizationCallback } from 'pusher-js';

// Load .env from project root (cwd when run as systemd service)
config({ path: resolve(process.cwd(), '.env') });

const PUSHER_APP_KEY = '4fa6328da6969ef162ec';
const PUSHER_CLUSTER = 'eu';

// pusher-js is a CJS package — use createRequire so NodeNext module resolution works
const require = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-var-requires
const PusherCtor = require('pusher-js') as {
  new (key: string, options: Options): {
    subscribe(channelName: string): Channel;
    connection: {
      bind(event: string, callback: (...args: unknown[]) => void): void;
    };
  };
};

async function main(): Promise<void> {
  const refreshToken = process.env.AKIFLOW_REFRESH_TOKEN;
  const dbPath = process.env.AKIFLOW_DB_PATH ?? './akiflow/akiflow.db';
  const envPath = resolve(process.cwd(), '.env');

  if (!refreshToken) throw new Error('AKIFLOW_REFRESH_TOKEN not set in .env');

  logger.info('[daemon] starting akiflow-sync');

  const db = initDb(resolve(process.cwd(), dbPath));
  const auth = new AkiflowAuth(refreshToken, envPath);

  // Reset any rows stuck in 'processing' from a previous crash
  const stuck = db.prepare(
    "UPDATE pending_writes SET status = 'pending' WHERE status = 'processing'"
  ).run();
  if (stuck.changes > 0) {
    logger.warn(`[daemon] reset ${stuck.changes} stuck 'processing' row(s) to 'pending'`);
  }

  logger.info('[daemon] running initial sync of all entities');
  await syncAllEntities(db, auth);

  startPendingWritePoller(db, auth);
  logger.info('[daemon] pending write poller started (2s interval)');

  const userId = await auth.getUserId();

  const pusher = new PusherCtor(PUSHER_APP_KEY, {
    cluster: PUSHER_CLUSTER,
    channelAuthorization: {
      transport: 'ajax',
      endpoint: 'unused',
      customHandler: (
        params: { channelName: string; socketId: string },
        callback: ChannelAuthorizationCallback,
      ) => {
        auth.authorizePusherChannel(params.channelName, params.socketId).then(
          data => callback(null, data),
          (e: Error) => callback(e, null),
        );
      },
    },
  });

  const channel = pusher.subscribe(`private-user.${userId}`);

  channel.bind('connector-updated', async (data: { syncEntities?: string[] }) => {
    const entities = data?.syncEntities;
    if (entities?.length) {
      logger.info(`[pusher] incremental sync triggered for: ${entities.join(', ')}`);
      await syncEntities(db, auth, entities);
    } else {
      logger.info('[pusher] full sync triggered');
      await syncAllEntities(db, auth);
    }
  });

  channel.bind('account-connected', () =>
    syncAllEntities(db, auth).catch(e => logger.error('[pusher] sync error:', e))
  );
  channel.bind('account-disconnected', () =>
    syncAllEntities(db, auth).catch(e => logger.error('[pusher] sync error:', e))
  );
  channel.bind('user-update', () =>
    syncV5Entity(db, 'accounts', auth).catch(e => logger.error('[pusher] sync error:', e))
  );

  pusher.connection.bind('connected', () =>
    logger.info(`[pusher] connected to private-user.${userId}`)
  );
  pusher.connection.bind('disconnected', () =>
    logger.warn('[pusher] disconnected — will auto-reconnect')
  );
  pusher.connection.bind('error', (e: unknown) =>
    logger.error('[pusher] connection error:', e)
  );

  logger.info('[daemon] ready');
}

async function syncAllEntities(
  db: Parameters<typeof syncV5Entity>[0],
  auth: AkiflowAuth,
): Promise<void> {
  await Promise.all([
    ...ENTITIES_V5.map(e =>
      syncV5Entity(db, e, auth).catch(err =>
        logger.error(`[daemon] V5 sync failed for ${e}:`, err)
      )
    ),
    ...ENTITIES_V3.map(e =>
      syncV3Entity(db, e as EntityV3, auth).catch(err =>
        logger.error(`[daemon] V3 sync failed for ${e}:`, err)
      )
    ),
  ]);
}

async function syncEntities(
  db: Parameters<typeof syncV5Entity>[0],
  auth: AkiflowAuth,
  entities: string[],
): Promise<void> {
  await Promise.all(
    entities.map(e => {
      if ((ENTITIES_V5 as readonly string[]).includes(e))
        return syncV5Entity(db, e, auth).catch(err =>
          logger.error(`[daemon] sync failed for ${e}:`, err)
        );
      if ((ENTITIES_V3 as readonly string[]).includes(e))
        return syncV3Entity(db, e as EntityV3, auth).catch(err =>
          logger.error(`[daemon] sync failed for ${e}:`, err)
        );
      logger.warn(`[daemon] unknown entity in Pusher message: ${e}`);
      return Promise.resolve();
    })
  );
}

main().catch(e => {
  logger.error('[daemon] fatal error:', e);
  process.exit(1);
});
