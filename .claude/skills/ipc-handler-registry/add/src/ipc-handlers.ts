import type { IpcDeps } from './ipc.js';

export interface IpcContext {
  sourceGroup: string;
  isMain: boolean;
}

export type IpcHandler = (
  data: Record<string, any>,
  deps: IpcDeps,
  context: IpcContext,
) => void | Promise<void>;

const handlers = new Map<string, IpcHandler>();

export function registerIpcHandler(type: string, handler: IpcHandler): void {
  if (handlers.has(type)) {
    throw new Error(`IPC handler already registered for type: ${type}`);
  }
  handlers.set(type, handler);
}

export function getIpcHandler(type: string): IpcHandler | undefined {
  return handlers.get(type);
}

// --- IPC Message Handlers (for processIpcFiles message types) ---

export type IpcMessageHandler = (
  data: Record<string, any>,
  deps: IpcDeps,
  context: IpcContext,
) => void | Promise<void>;

const messageHandlers = new Map<string, IpcMessageHandler>();

export function registerIpcMessageHandler(type: string, handler: IpcMessageHandler): void {
  if (messageHandlers.has(type)) {
    throw new Error(`IPC message handler already registered for type: ${type}`);
  }
  messageHandlers.set(type, handler);
}

export function getIpcMessageHandler(type: string): IpcMessageHandler | undefined {
  return messageHandlers.get(type);
}
