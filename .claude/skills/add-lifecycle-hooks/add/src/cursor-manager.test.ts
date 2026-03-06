import { describe, it, expect, beforeEach } from 'vitest';
import { CursorManager } from './cursor-manager.js';

describe('CursorManager', () => {
  let cm: CursorManager;
  beforeEach(() => { cm = new CursorManager(); });

  it('returns empty string for unknown chatJid', () => {
    expect(cm.get('unknown')).toBe('');
  });

  it('advances cursor', () => {
    cm.advance('jid1', '2026-01-01T00:00:00Z');
    expect(cm.get('jid1')).toBe('2026-01-01T00:00:00Z');
  });

  it('saves and rolls back', () => {
    cm.advance('jid1', 'ts1');
    cm.save('jid1');
    cm.advance('jid1', 'ts2');
    expect(cm.get('jid1')).toBe('ts2');
    cm.rollback('jid1');
    expect(cm.get('jid1')).toBe('ts1');
  });

  it('rollback is no-op without prior save', () => {
    cm.advance('jid1', 'ts1');
    cm.rollback('jid1');
    expect(cm.get('jid1')).toBe('ts1');
  });

  it('getAll returns all cursors', () => {
    cm.advance('a', '1');
    cm.advance('b', '2');
    expect(cm.getAll()).toEqual({ a: '1', b: '2' });
  });

  it('loadAll restores state', () => {
    cm.loadAll({ x: '3', y: '4' });
    expect(cm.get('x')).toBe('3');
    expect(cm.get('y')).toBe('4');
  });

  it('clearSaved removes saved cursor', () => {
    cm.advance('jid1', 'ts1');
    cm.save('jid1');
    cm.advance('jid1', 'ts2');
    cm.clearSaved('jid1');
    cm.rollback('jid1'); // no-op, saved was cleared
    expect(cm.get('jid1')).toBe('ts2');
  });

  it('hasSaved returns correct state', () => {
    expect(cm.hasSaved('jid1')).toBe(false);
    cm.advance('jid1', 'ts1');
    cm.save('jid1');
    expect(cm.hasSaved('jid1')).toBe(true);
    cm.clearSaved('jid1');
    expect(cm.hasSaved('jid1')).toBe(false);
  });
});
