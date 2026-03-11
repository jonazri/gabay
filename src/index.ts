import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

import {
  ASSISTANT_NAME,
  CREDENTIAL_PROXY_PORT,
  IDLE_TIMEOUT,
  POLL_INTERVAL,
  TIMEZONE,
  TRIGGER_PATTERN,
} from './config.js';
import { startCredentialProxy } from './credential-proxy.js';
import './channels/index.js';
import {
  getChannelFactory,
  getRegisteredChannelNames,
} from './channels/registry.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import {
  cleanupOrphans,
  ensureContainerRuntimeRunning,
  PROXY_BIND_HOST,
} from './container-runtime.js';
import {
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getMessageById,
  getRouterState,
  initDatabase,
  deleteRegisteredGroup,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import {
  startGoogleAssistantSocket,
  stopGoogleAssistantSocket,
} from './google-assistant.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { startIpcWatcher } from './ipc.js';
// Side-effect imports: register custom IPC handlers before dispatch
import './ipc-handlers/google-home.js';
import './ipc-handlers/group-lifecycle.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import {
  isSenderAllowed,
  isTriggerAllowed,
  loadSenderAllowlist,
  shouldDropMessage,
} from './sender-allowlist.js';
import {
  initShabbatSchedule,
  isShabbatOrYomTov,
  startCandleLightingNotifier,
  stopCandleLightingNotifier,
} from './shabbat.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { StatusTracker } from './status-tracker.js';
import {
  Channel,
  NewMessage,
  QuotedMessageKey,
  RegisteredGroup,
} from './types.js';
import { logger } from './logger.js';
import {
  onGuardLifted,
  registerProcessingGuard,
  runChannelsReadyHooks,
  runShutdownHooks,
  runStartupHooks,
  shouldProcessMessages,
  runGuardLiftedHooks,
} from './lifecycle.js';
import { CursorManager } from './cursor-manager.js';
import {
  emitAgentStarting,
  emitAgentOutput,
  emitAgentSuccess,
  emitAgentError,
  emitMessagePiped,
} from './message-events.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
const agentCursors = new CursorManager();
let messageLoopRunning = false;

const channels: Channel[] = [];
const queue = new GroupQueue();
let statusTracker: StatusTracker | null = null;

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    agentCursors.loadAll(agentTs ? JSON.parse(agentTs) : {});
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    agentCursors.loadAll({});
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState('last_agent_timestamp', JSON.stringify(agentCursors.getAll()));
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Send a post-Shabbat summary of pending messages across all groups.
 * Registered as a guard-lifted hook via the lifecycle system.
 */
async function sendPostShabbatSummary(): Promise<void> {
  const userJid = Object.entries(registeredGroups).find(
    ([_, g]) => g.isMain === true,
  )?.[0];
  if (!userJid) return;

  const channel = findChannel(channels, userJid);
  if (!channel) return;

  const summaryLines: string[] = [];
  const pendingJids: string[] = [];
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = agentCursors.get(chatJid);
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      summaryLines.push(`• ${group.name}: ${pending.length} messages`);
      pendingJids.push(chatJid);
    }
  }

  let text = 'Shavua Tov!';
  if (summaryLines.length > 0) {
    text += `\n\nHere's what happened over Shabbat:\n${summaryLines.join('\n')}\n\nCatching up now.`;
  }

  await channel.sendMessage(userJid, text);
  logger.info(
    { groupsWithActivity: summaryLines.length },
    'Post-Shabbat summary sent',
  );

  for (const chatJid of pendingJids) {
    queue.enqueueMessageCheck(chatJid);
  }
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(
  groups: Record<string, RegisteredGroup>,
): void {
  registeredGroups = groups;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
    return true;
  }

  if (!shouldProcessMessages()) return true;

  const isMainGroup = group.isMain === true;

  const sinceTimestamp = agentCursors.get(chatJid);
  const missedMessages = getMessagesSince(
    chatJid,
    sinceTimestamp,
    ASSISTANT_NAME,
  );

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const allowlistCfg = loadSenderAllowlist();
    const hasTrigger = missedMessages.some(
      (m) =>
        TRIGGER_PATTERN.test(m.content.trim()) &&
        (m.is_from_me || isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
    );
    if (!hasTrigger) return true;
  }

  const prompt = formatMessages(missedMessages, TIMEZONE);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = agentCursors.get(chatJid);
  agentCursors.advance(
    chatJid,
    missedMessages[missedMessages.length - 1].timestamp,
  );
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages',
  );

  // Track received messages for emoji status reactions
  for (const msg of missedMessages) {
    const fromMe = msg.is_from_me === true || (msg.is_from_me as unknown) === 1;
    statusTracker?.markReceived(msg.id, chatJid, fromMe);
  }

  // Advance user messages to THINKING (👀 → 💭)
  const userMessages = missedMessages.filter(
    (m) => !m.is_bot_message && (isMainGroup || !m.is_from_me),
  );
  for (const msg of userMessages) {
    statusTracker?.markThinking(msg.id);
  }

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug(
        { group: group.name },
        'Idle timeout, closing container stdin',
      );
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  await emitAgentStarting(chatJid, group);
  await channel.setTyping?.(chatJid, true);
  let hadError = false;
  let outputSentToUser = false;
  let firstOutputSeen = false;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    await emitAgentOutput(chatJid, result);
    // Streaming output callback — called for each agent result
    if (result.result) {
      // Advance user messages to WORKING on first output (💭 → 🔄)
      if (!firstOutputSeen) {
        firstOutputSeen = true;
        for (const um of userMessages) {
          statusTracker?.markWorking(um.id);
        }
      }
      const raw =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      await emitAgentSuccess(chatJid);
      queue.notifyIdle(chatJid);
      statusTracker?.markAllDone(chatJid);
    }

    if (result.status === 'error') {
      await emitAgentError(chatJid, result.error || null);
      hadError = true;
    }
  });

  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      statusTracker?.markAllDone(chatJid);
      logger.warn(
        { group: group.name },
        'Agent error after output was sent, skipping cursor rollback to prevent duplicates',
      );
      return true;
    }
    statusTracker?.markAllFailed(chatJid, 'Agent error — retrying.');
    // Roll back cursor so retries can re-process these messages
    agentCursors.advance(chatJid, previousCursor);
    saveState();
    logger.warn(
      { group: group.name },
      'Agent error, rolled back message cursor for retry',
    );
    return false;
  }

  statusTracker?.markAllDone(chatJid);
  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
): Promise<'success' | 'error'> {
  const isMain = group.isMain === true;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) =>
        queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  let wasGuarded = !shouldProcessMessages();

  while (true) {
    // Lifecycle guard: skip processing when guards are active (e.g. Shabbat mode)
    if (!shouldProcessMessages()) {
      wasGuarded = true;
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
      continue;
    }
    if (wasGuarded) {
      await runGuardLiftedHooks();
      wasGuarded = false;
    }

    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(
        jids,
        lastTimestamp,
        ASSISTANT_NAME,
      );

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            logger.warn({ chatJid }, 'No channel owns JID, skipping messages');
            continue;
          }

          const isMainGroup = group.isMain === true;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const allowlistCfg = loadSenderAllowlist();
            const hasTrigger = groupMessages.some(
              (m) =>
                TRIGGER_PATTERN.test(m.content.trim()) &&
                (m.is_from_me ||
                  isTriggerAllowed(chatJid, m.sender, allowlistCfg)),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since agentCursors so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            agentCursors.get(chatJid),
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend, TIMEZONE);

          if (queue.sendMessage(chatJid, formatted)) {
            await emitMessagePiped(chatJid, messagesToSend.length);
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            agentCursors.advance(
              chatJid,
              messagesToSend[messagesToSend.length - 1].timestamp,
            );
            saveState();
            // Show typing indicator while the container processes the piped message
            channel
              .setTyping?.(chatJid, true)
              ?.catch((err) =>
                logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
              );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = agentCursors.get(chatJid);
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();
  initShabbatSchedule();

  // Register Shabbat/Yom Tov as a processing guard (returns false to block processing)
  registerProcessingGuard(() => !isShabbatOrYomTov());

  // Start credential proxy (containers route API calls through this)
  const proxyServer = await startCredentialProxy(
    CREDENTIAL_PROXY_PORT,
    PROXY_BIND_HOST,
  );

  await runStartupHooks();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    proxyServer.close();
    stopCandleLightingNotifier();
    stopGoogleAssistantSocket();
    await statusTracker?.shutdown();
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    await runShutdownHooks();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (chatJid: string, msg: NewMessage) => {
      // Sender allowlist drop mode: discard messages from denied senders before storing
      if (!msg.is_from_me && !msg.is_bot_message && registeredGroups[chatJid]) {
        const cfg = loadSenderAllowlist();
        if (
          shouldDropMessage(chatJid, cfg) &&
          !isSenderAllowed(chatJid, msg.sender, cfg)
        ) {
          if (cfg.logDenied) {
            logger.debug(
              { chatJid, sender: msg.sender },
              'sender-allowlist: dropping message (drop mode)',
            );
          }
          return;
        }
      }
      storeMessage(msg);
    },
    onChatMetadata: (
      chatJid: string,
      timestamp: string,
      name?: string,
      channel?: string,
      isGroup?: boolean,
    ) => storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect all registered channels.
  // Each channel self-registers via the barrel import above.
  // Factories return null when credentials are missing, so unconfigured channels are skipped.
  for (const channelName of getRegisteredChannelNames()) {
    const factory = getChannelFactory(channelName)!;
    const channel = factory(channelOpts);
    if (!channel) {
      logger.warn(
        { channel: channelName },
        'Channel installed but credentials missing — skipping. Check .env or re-run the channel skill.',
      );
      continue;
    }
    channels.push(channel);
    await channel.connect();
  }
  await runChannelsReadyHooks(channels);
  if (channels.length === 0) {
    logger.fatal('No channels connected');
    process.exit(1);
  }

  // Initialize status tracker for emoji reactions
  statusTracker = new StatusTracker({
    sendReaction: async (chatJid, messageKey, emoji) => {
      const channel = findChannel(channels, chatJid);
      if (!channel?.sendReaction) return;
      await channel.sendReaction(chatJid, messageKey, emoji);
    },
    sendMessage: async (chatJid, text) => {
      const channel = findChannel(channels, chatJid);
      if (!channel) return;
      await channel.sendMessage(chatJid, text);
    },
    isMainGroup: (chatJid) => registeredGroups[chatJid]?.isMain === true,
    isContainerAlive: (chatJid) => queue.isActive(chatJid),
  });
  await statusTracker.recover();

  // Start Google Assistant socket server for container CLI access
  startGoogleAssistantSocket();

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) =>
      queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        logger.warn({ jid }, 'No channel owns JID, cannot send message');
        return;
      }
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    unregisterGroup: (jid: string) => {
      const existed = deleteRegisteredGroup(jid);
      if (existed) delete registeredGroups[jid];
      return existed;
    },
    syncGroups: async (force: boolean) => {
      await Promise.all(
        channels
          .filter((ch) => ch.syncGroups)
          .map((ch) => ch.syncGroups!(force)),
      );
    },
    sendMessageWithQuote: (jid, text, quotedMessageId) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      const quotedMsg = getMessageById(quotedMessageId, jid);
      const quotedKey: QuotedMessageKey = {
        id: quotedMessageId,
        remoteJid: jid,
        fromMe: quotedMsg?.is_from_me ?? false,
        participant: quotedMsg?.sender,
        content: quotedMsg?.content,
      };
      return channel.sendMessage(jid, text, quotedKey);
    },
    sendReaction: async (jid, emoji, messageId) => {
      const channel = findChannel(channels, jid);
      if (!channel) return;
      if (messageId && channel.sendReaction) {
        const msg = getMessageById(messageId, jid);
        const key = {
          id: messageId,
          remoteJid: jid,
          fromMe: msg?.is_from_me === true || (msg?.is_from_me as unknown) === 1,
          participant: msg?.sender,
        };
        await channel.sendReaction(jid, key, emoji);
      } else if (channel.reactToLatestMessage) {
        await channel.reactToLatestMessage(jid, emoji);
      }
    },
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) =>
      writeGroupsSnapshot(gf, im, ag, rj),
  });
  queue.setProcessMessagesFn(processGroupMessages);

  // Candle lighting reminders (erev Shabbat and erev Yom Tov)
  const userJid = Object.entries(registeredGroups).find(
    ([_, g]) => g.isMain === true,
  )?.[0];
  if (userJid) {
    startCandleLightingNotifier((text) => {
      const channel = findChannel(channels, userJid);
      if (channel) {
        channel.sendMessage(userJid, text).catch((err) =>
          logger.error({ err }, 'Failed to send candle lighting notification'),
        );
      }
    });
  } else {
    logger.warn('No main group registered — candle lighting notifier disabled');
  }

  // Register post-Shabbat summary hook (runs when guard lifts after Shabbat/Yom Tov)
  onGuardLifted(sendPostShabbatSummary);

  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const thisFile = fileURLToPath(import.meta.url);
const entryFile = process.argv[1] ? path.resolve(process.argv[1]) : null;
const isDirectRun = entryFile != null && thisFile === entryFile;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
