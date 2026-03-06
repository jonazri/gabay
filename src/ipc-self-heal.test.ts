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
