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

    writeIpcNotification('test-group', 'unknown_ipc_type', 'schedule_tasks', 'No handler registered for type "schedule_tasks"');

    const inputDir = path.join(testDataDir, 'ipc', 'test-group', 'input');
    const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
    expect(files).toHaveLength(1);

    const content = JSON.parse(fs.readFileSync(path.join(inputDir, files[0]), 'utf-8'));
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

    writeIpcErrorResponse('test-group', 'req-123', 'unknown_ipc_type', 'bad_type', 'No handler');

    const responsePath = path.join(testDataDir, 'ipc', 'test-group', 'responses', 'req-123.json');
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

    writeIpcErrorResponse('test-group', undefined, 'handler_error', 'foo', 'Crash');

    const responsesDir = path.join(testDataDir, 'ipc', 'test-group', 'responses');
    expect(fs.existsSync(responsesDir)).toBe(false);
  });
});
