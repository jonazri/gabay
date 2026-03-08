// src/media-processing.test.ts
import { describe, it, expect } from 'vitest';

import { processMediaAttachment } from './media-processing.js';

describe('processMediaAttachment', () => {
  it('returns null when no media handlers match', async () => {
    const msg = { message: { conversation: 'hello' } } as any;
    const result = await processMediaAttachment(msg, { conversation: 'hello' }, '/tmp/test');
    expect(result).toBeNull();
  });
});
