import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('IPC Handler Registry', () => {
  let registerIpcHandler: typeof import('./ipc-handlers.js').registerIpcHandler;
  let getIpcHandler: typeof import('./ipc-handlers.js').getIpcHandler;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./ipc-handlers.js');
    registerIpcHandler = mod.registerIpcHandler;
    getIpcHandler = mod.getIpcHandler;
  });

  it('registers and retrieves a handler', () => {
    const handler = async () => {};
    registerIpcHandler('test_type', handler);
    expect(getIpcHandler('test_type')).toBe(handler);
  });

  it('returns undefined for unregistered type', () => {
    expect(getIpcHandler('nonexistent')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    registerIpcHandler('dup', async () => {});
    expect(() => registerIpcHandler('dup', async () => {})).toThrow(
      'IPC handler already registered for type: dup',
    );
  });
});

describe('IPC message handler registry', () => {
  let registerIpcMessageHandler: typeof import('./ipc-handlers.js').registerIpcMessageHandler;
  let getIpcMessageHandler: typeof import('./ipc-handlers.js').getIpcMessageHandler;

  beforeEach(async () => {
    vi.resetModules();
    const mod = await import('./ipc-handlers.js');
    registerIpcMessageHandler = mod.registerIpcMessageHandler;
    getIpcMessageHandler = mod.getIpcMessageHandler;
  });

  it('registers and retrieves a message handler', () => {
    const handler = vi.fn();
    registerIpcMessageHandler('reaction', handler);
    expect(getIpcMessageHandler('reaction')).toBe(handler);
  });

  it('returns undefined for unregistered message type', () => {
    expect(getIpcMessageHandler('nonexistent')).toBeUndefined();
  });

  it('throws on duplicate message handler registration', () => {
    registerIpcMessageHandler('test_msg', vi.fn());
    expect(() => registerIpcMessageHandler('test_msg', vi.fn())).toThrow(
      'IPC message handler already registered for type: test_msg',
    );
  });
});
