import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';

let testDataDir: string;

vi.mock('./config.js', () => ({
  get DATA_DIR() {
    return testDataDir;
  },
}));

describe('writeIpcNotification', () => {
  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-heal-'));
  });

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  it('writes notification file to ipc/{group}/input/', async () => {
    vi.resetModules();
    const { writeIpcNotification } = await import('./ipc-self-heal.js');

    writeIpcNotification(
      'test-group',
      'unknown_ipc_type',
      'schedule_tasks',
      'No handler registered for type "schedule_tasks"',
    );

    const inputDir = path.join(testDataDir, 'ipc', 'test-group', 'input');
    const files = fs.readdirSync(inputDir).filter((f) => f.endsWith('.json'));
    expect(files).toHaveLength(1);

    const content = JSON.parse(
      fs.readFileSync(path.join(inputDir, files[0]), 'utf-8'),
    );
    expect(content.type).toBe('message');
    expect(content.text).toContain('[IPC Error]');
    expect(content.text).toContain('schedule_tasks');
    expect(content.text).toContain('unknown_ipc_type');
  });
});

describe('writeIpcErrorResponse', () => {
  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-heal-'));
  });

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  it('writes error response to ipc/{group}/responses/{requestId}.json', async () => {
    vi.resetModules();
    const { writeIpcErrorResponse } = await import('./ipc-self-heal.js');

    writeIpcErrorResponse(
      'test-group',
      'req-123',
      'unknown_ipc_type',
      'bad_type',
      'No handler',
    );

    const responsePath = path.join(
      testDataDir,
      'ipc',
      'test-group',
      'responses',
      'req-123.json',
    );
    expect(fs.existsSync(responsePath)).toBe(true);

    const content = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
    expect(content.status).toBe('error');
    expect(content.error_code).toBe('unknown_ipc_type');
    expect(content.ipc_type).toBe('bad_type');
    expect(content.error).toBe('No handler');
  });

  it('skips writing when requestId is undefined', async () => {
    vi.resetModules();
    const { writeIpcErrorResponse } = await import('./ipc-self-heal.js');

    writeIpcErrorResponse(
      'test-group',
      undefined,
      'handler_error',
      'foo',
      'Crash',
    );

    const responsesDir = path.join(
      testDataDir,
      'ipc',
      'test-group',
      'responses',
    );
    expect(fs.existsSync(responsesDir)).toBe(false);
  });
});

describe('processTaskIpc self-heal integration', () => {
  beforeEach(() => {
    testDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ipc-heal-'));
  });

  afterEach(() => {
    fs.rmSync(testDataDir, { recursive: true, force: true });
  });

  const makeDeps = () => ({
    sendMessage: async () => {},
    registeredGroups: () => ({
      'main@g.us': {
        name: 'Main',
        folder: 'main',
        trigger: 'always' as const,
        added_at: '2024-01-01',
        isMain: true,
      },
    }),
    registerGroup: () => {},
    syncGroups: async () => {},
    getAvailableGroups: () => [],
    writeGroupsSnapshot: () => {},
  });

  it('unknown IPC type writes notification to input dir', async () => {
    vi.resetModules();
    const { _initTestDatabase } = await import('./db.js');
    _initTestDatabase();
    const { processTaskIpc } = await import('./ipc.js');

    await processTaskIpc(
      { type: 'nonexistent_type', requestId: 'req-456' },
      'main',
      true,
      makeDeps(),
    );

    // Should have written notification
    const inputDir = path.join(testDataDir, 'ipc', 'main', 'input');
    const inputFiles = fs
      .readdirSync(inputDir)
      .filter((f) => f.endsWith('.json'));
    expect(inputFiles.length).toBeGreaterThanOrEqual(1);

    const notification = JSON.parse(
      fs.readFileSync(path.join(inputDir, inputFiles[0]), 'utf-8'),
    );
    expect(notification.text).toContain('[IPC Error]');
    expect(notification.text).toContain('nonexistent_type');

    // Should have written error response
    const responsePath = path.join(
      testDataDir,
      'ipc',
      'main',
      'responses',
      'req-456.json',
    );
    expect(fs.existsSync(responsePath)).toBe(true);
    const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));
    expect(response.status).toBe('error');
    expect(response.error_code).toBe('unknown_ipc_type');
  });

  it('handler exception writes handler_error notification', async () => {
    vi.resetModules();
    const { _initTestDatabase } = await import('./db.js');
    _initTestDatabase();
    const ipcHandlers = await import('./ipc-handlers.js');
    ipcHandlers.registerIpcHandler('crasher', async () => {
      throw new Error('handler boom');
    });
    const { processTaskIpc } = await import('./ipc.js');

    await processTaskIpc(
      { type: 'crasher', requestId: 'req-789' },
      'main',
      true,
      makeDeps(),
    );

    const inputDir = path.join(testDataDir, 'ipc', 'main', 'input');
    const inputFiles = fs
      .readdirSync(inputDir)
      .filter((f) => f.endsWith('.json'));
    expect(inputFiles.length).toBeGreaterThanOrEqual(1);

    const notification = JSON.parse(
      fs.readFileSync(path.join(inputDir, inputFiles[0]), 'utf-8'),
    );
    expect(notification.text).toContain('handler_error');
    expect(notification.text).toContain('handler boom');
  });
});
