import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const skillDir = path.resolve(__dirname, '..');

describe('media-processing skill package', () => {
  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(content.skill).toBe('media-processing');
    expect(content.adds).toContain('src/media-processing.ts');
    expect(content.modifies).toContain('src/channels/whatsapp.ts');
    expect(content.depends).toContain('whatsapp');
  });

  it('has the base module', () => {
    const modulePath = path.join(skillDir, 'add', 'src', 'media-processing.ts');
    expect(fs.existsSync(modulePath)).toBe(true);

    const content = fs.readFileSync(modulePath, 'utf-8');
    expect(content).toContain('export async function processMediaAttachment');
    expect(content).toContain('export interface MediaResult');
    expect(content).toContain('downloadMediaMessage');
    expect(content).toContain('--- Image attachments ---');
    expect(content).toContain('--- Document attachments ---');
    expect(content).toContain('return null');
  });

  it('has the unit test', () => {
    const testPath = path.join(
      skillDir,
      'add',
      'src',
      'media-processing.test.ts',
    );
    expect(fs.existsSync(testPath)).toBe(true);

    const content = fs.readFileSync(testPath, 'utf-8');
    expect(content).toContain('processMediaAttachment');
    expect(content).toContain('returns null');
  });

  it('has whatsapp.ts overlay with correct changes', () => {
    const overlayPath = path.join(
      skillDir,
      'modify',
      'src',
      'channels',
      'whatsapp.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    // Delta changes
    expect(content).toContain(
      "import { processMediaAttachment } from '../media-processing.js';",
    );
    expect(content).toContain('resolveGroupFolderPath');
    expect(content).toContain('let content =');
    expect(content).toContain('await processMediaAttachment(');

    // Invariants
    expect(content).toContain('class WhatsAppChannel');
    expect(content).toContain("registerChannel('whatsapp'");
    expect(content).toContain('normalizeMessageContent');
    expect(content).toContain('translateJid');
  });

  it('has intent doc for whatsapp.ts', () => {
    const intentPath = path.join(
      skillDir,
      'modify',
      'src',
      'channels',
      'whatsapp.ts.intent.md',
    );
    expect(fs.existsSync(intentPath)).toBe(true);
  });

  it('declares transforms for image-vision and pdf-reader', () => {
    const content = yaml.parse(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    );
    expect(content.transforms).toBeDefined();
    expect(content.transforms['image-vision']).toBeDefined();
    expect(content.transforms['pdf-reader']).toBeDefined();

    // Both transforms add media-processing dependency and redirect to media-processing.ts
    for (const target of ['image-vision', 'pdf-reader']) {
      const t = content.transforms[target];
      expect(t.manifest_patches.add_depends).toContain('media-processing');
      expect(t.manifest_patches.remove_modifies).toContain(
        'src/channels/whatsapp.ts',
      );
      expect(t.manifest_patches.add_modifies).toContain(
        'src/media-processing.ts',
      );
      expect(t.overlay_files).toContain('src/media-processing.ts');
    }
  });

  it('has transform overlay files for image-vision', () => {
    const overlayPath = path.join(
      skillDir,
      'transforms',
      'image-vision',
      'modify',
      'src',
      'media-processing.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('isImageMessage');
    expect(content).toContain('processImage');
    expect(content).toContain('processMediaAttachment');
  });

  it('has transform overlay files for pdf-reader', () => {
    const overlayPath = path.join(
      skillDir,
      'transforms',
      'pdf-reader',
      'modify',
      'src',
      'media-processing.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('documentMessage');
    expect(content).toContain('application/pdf');
    expect(content).toContain('processMediaAttachment');
  });
});
