import { describe, it, expect, beforeEach } from 'vitest';
import {
  onAgentStarting,
  onAgentOutput,
  onAgentSuccess,
  onAgentError,
  onMessagePiped,
  emitAgentStarting,
  emitAgentOutput,
  emitAgentSuccess,
  emitAgentError,
  emitMessagePiped,
  _resetForTests,
} from './message-events.js';

beforeEach(() => _resetForTests());

describe('message lifecycle events', () => {
  it('emits agentStarting to all listeners', async () => {
    const calls: string[] = [];
    onAgentStarting(async (jid) => { calls.push(`a:${jid}`); });
    onAgentStarting(async (jid) => { calls.push(`b:${jid}`); });
    await emitAgentStarting('jid1', { name: 'test' } as any);
    expect(calls).toEqual(['a:jid1', 'b:jid1']);
  });

  it('emits agentOutput with ContainerOutput', async () => {
    const outputs: any[] = [];
    onAgentOutput(async (_jid, out) => { outputs.push(out); });
    await emitAgentOutput('jid1', { result: 'hello' } as any);
    expect(outputs).toEqual([{ result: 'hello' }]);
  });

  it('emits agentSuccess', async () => {
    const calls: string[] = [];
    onAgentSuccess(async (jid) => { calls.push(jid); });
    await emitAgentSuccess('jid1');
    expect(calls).toEqual(['jid1']);
  });

  it('emits agentError', async () => {
    const calls: Array<[string, string | null]> = [];
    onAgentError(async (jid, err) => { calls.push([jid, err]); });
    await emitAgentError('jid1', 'boom');
    expect(calls).toEqual([['jid1', 'boom']]);
  });

  it('emits messagePiped', async () => {
    const calls: Array<[string, number]> = [];
    onMessagePiped(async (jid, count) => { calls.push([jid, count]); });
    await emitMessagePiped('jid1', 5);
    expect(calls).toEqual([['jid1', 5]]);
  });

  it('listener errors do not break other listeners', async () => {
    const calls: string[] = [];
    onAgentSuccess(async () => { throw new Error('boom'); });
    onAgentSuccess(async (jid) => { calls.push(jid); });
    await emitAgentSuccess('jid1');
    expect(calls).toEqual(['jid1']);
  });
});
