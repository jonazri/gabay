// src/media-processing.ts
import {
  downloadMediaMessage,
  type WAMessage,
} from '@whiskeysockets/baileys';

import { isImageMessage, processImage } from './image.js';
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
  if (isImageMessage(msg)) {
    try {
      const buffer = await downloadMediaMessage(msg, 'buffer', {});
      const caption = (normalized as any)?.imageMessage?.caption ?? '';
      const result = await processImage(buffer as Buffer, groupDir, caption);
      if (result) {
        return { content: result.content };
      }
    } catch (err) {
      logger.warn({ err, groupDir }, 'Image download/processing failed');
    }
  }

  // --- Document attachments ---
  // (added by pdf-reader skill)

  return null;
}
