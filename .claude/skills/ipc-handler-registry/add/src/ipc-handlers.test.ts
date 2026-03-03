import { describe, it, expect, beforeEach } from 'vitest';

// We'll import from the module under test once it exists
// For now this file defines the expected behavior

describe('IPC Handler Registry', () => {
  // Need to reset module state between tests — use dynamic import
  let registerIpcHandler: typeof import('./ipc-handlers.js').registerIpcHandler;
  let getIpcHandler: typeof import('./ipc-handlers.js').getIpcHandler;

  beforeEach(async () => {
    // Re-import to reset the handlers Map
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
