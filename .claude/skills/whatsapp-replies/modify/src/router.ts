import { Channel, NewMessage } from './types.js';

export function escapeXml(s: string): string {
  if (!s) return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function formatMessages(messages: NewMessage[]): string {
  const lines = messages.map((m) => {
    const replyAttrs = m.replied_to_id
      ? ` replied_to_id="${escapeXml(m.replied_to_id)}" replied_to_sender="${escapeXml(m.replied_to_sender || '')}"`
      : '';
    const replyTag = m.replied_to_content
      ? `\n  <reply_to>${escapeXml(m.replied_to_content)}</reply_to>`
      : '';
    const content = `${replyTag}\n  ${escapeXml(m.content)}`.trimEnd();
    if (replyTag) {
      return `<message id="${escapeXml(m.id)}" sender="${escapeXml(m.sender_name)}" time="${m.timestamp}"${replyAttrs}>${content}\n</message>`;
    }
    return `<message id="${escapeXml(m.id)}" sender="${escapeXml(m.sender_name)}" time="${m.timestamp}"${replyAttrs}>${escapeXml(m.content)}</message>`;
  });
  return `<messages>\n${lines.join('\n')}\n</messages>`;
}

export function stripInternalTags(text: string): string {
  return text.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
}

export function formatOutbound(rawText: string): string {
  const text = stripInternalTags(rawText);
  if (!text) return '';
  return text;
}

export function routeOutbound(
  channels: Channel[],
  jid: string,
  text: string,
): Promise<void> {
  const channel = channels.find((c) => c.ownsJid(jid) && c.isConnected());
  if (!channel) throw new Error(`No channel for JID: ${jid}`);
  return channel.sendMessage(jid, text);
}

export function findChannel(
  channels: Channel[],
  jid: string,
): Channel | undefined {
  return channels.find((c) => c.ownsJid(jid));
}
