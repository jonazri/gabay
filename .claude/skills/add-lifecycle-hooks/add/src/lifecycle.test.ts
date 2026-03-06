import { describe, it, expect, beforeEach } from 'vitest';
import {
  onStartup,
  onShutdown,
  onChannelsReady,
  registerProcessingGuard,
  onGuardLifted,
  runStartupHooks,
  runShutdownHooks,
  runChannelsReadyHooks,
  shouldProcessMessages,
  runGuardLiftedHooks,
  _resetForTests,
} from './lifecycle.js';

beforeEach(() => _resetForTests());

describe('startup/shutdown hooks', () => {
  it('runs startup hooks in registration order', async () => {
    const order: number[] = [];
    onStartup(() => {
      order.push(1);
    });
    onStartup(() => {
      order.push(2);
    });
    await runStartupHooks();
    expect(order).toEqual([1, 2]);
  });

  it('runs shutdown hooks in reverse registration order', async () => {
    const order: number[] = [];
    onShutdown(() => {
      order.push(1);
    });
    onShutdown(() => {
      order.push(2);
    });
    await runShutdownHooks();
    expect(order).toEqual([2, 1]);
  });

  it('runs channels-ready hooks with channel list', async () => {
    const received: any[] = [];
    onChannelsReady((chs) => {
      received.push(chs);
    });
    const fakeChannels = [{ name: 'whatsapp' }] as any;
    await runChannelsReadyHooks(fakeChannels);
    expect(received).toEqual([fakeChannels]);
  });
});

describe('processing guards', () => {
  it('returns true when no guards registered', () => {
    expect(shouldProcessMessages()).toBe(true);
  });

  it('returns false when any guard returns false', () => {
    registerProcessingGuard(() => false);
    expect(shouldProcessMessages()).toBe(false);
  });

  it('returns true only when all guards return true', () => {
    registerProcessingGuard(() => true);
    registerProcessingGuard(() => true);
    expect(shouldProcessMessages()).toBe(true);
  });

  it('runs guard-lifted hooks after guard returns true', async () => {
    let guardActive = true;
    registerProcessingGuard(() => !guardActive);
    const calls: string[] = [];
    onGuardLifted(async () => {
      calls.push('lifted');
    });

    // Guard active → shouldProcess false
    expect(shouldProcessMessages()).toBe(false);

    // Guard lifts
    guardActive = false;
    expect(shouldProcessMessages()).toBe(true);
    await runGuardLiftedHooks();
    expect(calls).toEqual(['lifted']);
  });
});
