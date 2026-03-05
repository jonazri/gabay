import { Channel } from './types.js';
import { logger } from './logger.js';

type AsyncVoidFn = () => void | Promise<void>;
type ChannelsReadyFn = (channels: Channel[]) => void | Promise<void>;
type GuardFn = () => boolean;

const startupHooks: AsyncVoidFn[] = [];
const shutdownHooks: AsyncVoidFn[] = [];
const channelsReadyHooks: ChannelsReadyFn[] = [];
const processingGuards: GuardFn[] = [];
const guardLiftedHooks: AsyncVoidFn[] = [];

// --- Registration ---

export function onStartup(fn: AsyncVoidFn): void {
  startupHooks.push(fn);
}

export function onShutdown(fn: AsyncVoidFn): void {
  shutdownHooks.push(fn);
}

export function onChannelsReady(fn: ChannelsReadyFn): void {
  channelsReadyHooks.push(fn);
}

export function registerProcessingGuard(fn: GuardFn): void {
  processingGuards.push(fn);
}

export function onGuardLifted(fn: AsyncVoidFn): void {
  guardLiftedHooks.push(fn);
}

// --- Dispatch ---

export async function runStartupHooks(): Promise<void> {
  for (const fn of startupHooks) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, 'Startup hook failed');
    }
  }
}

export async function runShutdownHooks(): Promise<void> {
  // Reverse order: last registered shuts down first (LIFO)
  for (const fn of [...shutdownHooks].reverse()) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, 'Shutdown hook failed');
    }
  }
}

export async function runChannelsReadyHooks(channels: Channel[]): Promise<void> {
  for (const fn of channelsReadyHooks) {
    try {
      await fn(channels);
    } catch (err) {
      logger.error({ err }, 'Channels-ready hook failed');
    }
  }
}

export function shouldProcessMessages(): boolean {
  return processingGuards.every((fn) => fn());
}

export async function runGuardLiftedHooks(): Promise<void> {
  for (const fn of guardLiftedHooks) {
    try {
      await fn();
    } catch (err) {
      logger.error({ err }, 'Guard-lifted hook failed');
    }
  }
}

/** @internal - for tests only */
export function _resetForTests(): void {
  startupHooks.length = 0;
  shutdownHooks.length = 0;
  channelsReadyHooks.length = 0;
  processingGuards.length = 0;
  guardLiftedHooks.length = 0;
}
