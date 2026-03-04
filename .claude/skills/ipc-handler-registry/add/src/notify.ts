import type { RegisteredGroup } from './types.js';

export async function notifyMainGroup(
  registeredGroups: Record<string, RegisteredGroup>,
  sendMessage: (jid: string, text: string) => Promise<void>,
  text: string,
): Promise<void> {
  const mainJid = Object.entries(registeredGroups).find(
    ([_, g]) => g.isMain === true,
  )?.[0];
  if (mainJid) {
    await sendMessage(mainJid, text);
  }
}
