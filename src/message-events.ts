import { ContainerOutput } from './container-runner.js';
import { RegisteredGroup } from './types.js';
import { logger } from './logger.js';

type AgentStartingFn = (chatJid: string, group: RegisteredGroup) => void | Promise<void>;
type AgentOutputFn = (chatJid: string, output: ContainerOutput) => void | Promise<void>;
type AgentSuccessFn = (chatJid: string) => void | Promise<void>;
type AgentErrorFn = (chatJid: string, error: string | null) => void | Promise<void>;
type MessagePipedFn = (chatJid: string, messageCount: number) => void | Promise<void>;

const agentStartingListeners: AgentStartingFn[] = [];
const agentOutputListeners: AgentOutputFn[] = [];
const agentSuccessListeners: AgentSuccessFn[] = [];
const agentErrorListeners: AgentErrorFn[] = [];
const messagePipedListeners: MessagePipedFn[] = [];

// --- Registration ---

export function onAgentStarting(fn: AgentStartingFn): void { agentStartingListeners.push(fn); }
export function onAgentOutput(fn: AgentOutputFn): void { agentOutputListeners.push(fn); }
export function onAgentSuccess(fn: AgentSuccessFn): void { agentSuccessListeners.push(fn); }
export function onAgentError(fn: AgentErrorFn): void { agentErrorListeners.push(fn); }
export function onMessagePiped(fn: MessagePipedFn): void { messagePipedListeners.push(fn); }

// --- Dispatch ---

async function emit<T extends any[]>(listeners: Array<(...args: T) => void | Promise<void>>, ...args: T): Promise<void> {
  for (const fn of listeners) {
    try {
      await fn(...args);
    } catch (err) {
      logger.error({ err }, 'Message event listener failed');
    }
  }
}

export async function emitAgentStarting(chatJid: string, group: RegisteredGroup): Promise<void> {
  await emit(agentStartingListeners, chatJid, group);
}

export async function emitAgentOutput(chatJid: string, output: ContainerOutput): Promise<void> {
  await emit(agentOutputListeners, chatJid, output);
}

export async function emitAgentSuccess(chatJid: string): Promise<void> {
  await emit(agentSuccessListeners, chatJid);
}

export async function emitAgentError(chatJid: string, error: string | null): Promise<void> {
  await emit(agentErrorListeners, chatJid, error);
}

export async function emitMessagePiped(chatJid: string, messageCount: number): Promise<void> {
  await emit(messagePipedListeners, chatJid, messageCount);
}

/** @internal - for tests only */
export function _resetForTests(): void {
  agentStartingListeners.length = 0;
  agentOutputListeners.length = 0;
  agentSuccessListeners.length = 0;
  agentErrorListeners.length = 0;
  messagePipedListeners.length = 0;
}
