import { MAIN_GROUP_FOLDER } from './config.js';
import type { RegisteredGroup } from './types.js';

export async function notifyMainGroup(
  registeredGroups: Record<string, RegisteredGroup>,
  sendMessage: (jid: string, text: string) => Promise<void>,
  text: string,
  mainGroupFolder?: string,
): Promise<void> {
  const folder = mainGroupFolder ?? MAIN_GROUP_FOLDER;
  const mainJid = Object.entries(registeredGroups).find(
    ([_, g]) => g.folder === folder,
  )?.[0];
  if (mainJid) {
    await sendMessage(mainJid, text);
  }
}
