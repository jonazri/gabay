// src/media-processing.ts
import fs from 'fs';
import path from 'path';

import {
  downloadMediaMessage,
  type WAMessage,
} from '@whiskeysockets/baileys';

import { logger } from './logger.js';

export interface MediaResult {
  content: string;
}

/**
 * Process media attachments from an incoming WhatsApp message.
 * Returns enriched content with attachment markers, or null if no media detected.
 * Individual media handlers are added by skill overlays (image-vision, pdf-reader, etc.).
 */
export async function processMediaAttachment(
  msg: WAMessage,
  normalized: Record<string, any> | null | undefined,
  groupDir: string,
): Promise<MediaResult | null> {
  // --- Image attachments ---
  // (added by image-vision skill)

  // --- Document attachments ---
  if ((normalized as any)?.documentMessage?.mimetype === 'application/pdf') {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const attachDir = path.join(groupDir, 'attachments');
      fs.mkdirSync(attachDir, { recursive: true });
      const filename = path.basename(
        (normalized as any).documentMessage.fileName || `doc-${Date.now()}.pdf`,
      );
      const filePath = path.join(attachDir, filename);
      fs.writeFileSync(filePath, buffer as Buffer);
      const sizeKB = Math.round((buffer as Buffer).length / 1024);
      const pdfRef = `[PDF: attachments/${filename} (${sizeKB}KB)]\nUse: pdf-reader extract attachments/${filename}`;
      const caption = (normalized as any).documentMessage.caption || '';
      return { content: caption ? `${caption}\n\n${pdfRef}` : pdfRef };
    } catch (err) {
      logger.warn({ err, groupDir }, 'PDF download failed');
    }
  }

  return null;
}
