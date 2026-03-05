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
