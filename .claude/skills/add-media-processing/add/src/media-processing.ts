// src/media-processing.ts
import { downloadMediaMessage, type WAMessage } from '@whiskeysockets/baileys';

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
  // (added by pdf-reader skill)

  return null;
}
