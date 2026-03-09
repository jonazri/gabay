import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const skillDir = path.resolve(__dirname, '..');

describe('image-vision skill package', () => {
  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(content.skill).toBe('image-vision');
    expect(content.adds).toContain('src/image.ts');
    expect(content.adds).toContain('src/image.test.ts');
    expect(content.modifies).toContain('src/media-processing.ts');
    expect(content.modifies).toContain('src/index.ts');
    expect(content.modifies).toContain('src/container-runner.ts');
    expect(content.modifies).toContain('container/agent-runner/src/index.ts');
    expect(content.structured.npm_dependencies.sharp).toBeDefined();
    expect(content.depends).toContain('media-processing');
  });

  it('does NOT modify whatsapp.ts', () => {
    const content = yaml.parse(
      fs.readFileSync(path.join(skillDir, 'manifest.yaml'), 'utf-8'),
    );
    const modifies = content.modifies || [];
    expect(modifies).not.toContain('src/channels/whatsapp.ts');
    expect(modifies).not.toContain('src/channels/whatsapp.test.ts');
  });

  it('has image.ts with required exports', () => {
    const filePath = path.join(skillDir, 'add', 'src', 'image.ts');
    expect(fs.existsSync(filePath)).toBe(true);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(content).toContain('export function isImageMessage');
    expect(content).toContain('export async function processImage');
    expect(content).toContain('export function parseImageReferences');
  });

  it('has image.test.ts', () => {
    const filePath = path.join(skillDir, 'add', 'src', 'image.test.ts');
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('has media-processing.ts overlay with image handler', () => {
    const overlayPath = path.join(
      skillDir,
      'modify',
      'src',
      'media-processing.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('isImageMessage');
    expect(content).toContain('processImage');
    expect(content).toContain('downloadMediaMessage');
    // Must preserve document placeholder for pdf-reader
    expect(content).toContain('--- Document attachments ---');
  });

  it('has index.ts overlay with image attachment threading', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'index.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('parseImageReferences');
    expect(content).toContain('imageAttachments');
  });

  it('has container-runner.ts overlay with imageAttachments field', () => {
    const overlayPath = path.join(
      skillDir,
      'modify',
      'src',
      'container-runner.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('imageAttachments');
    expect(content).toContain('ContainerInput');
  });

  it('has agent-runner overlay with multimodal support', () => {
    const overlayPath = path.join(
      skillDir,
      'modify',
      'container',
      'agent-runner',
      'src',
      'index.ts',
    );
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('ImageContentBlock');
    expect(content).toContain('pushMultimodal');
    expect(content).toContain('imageAttachments');
    expect(content).toContain('base64');
  });

  it('has intent docs for all modified files', () => {
    const intentFiles = [
      'modify/src/media-processing.ts.intent.md',
      'modify/src/index.ts.intent.md',
      'modify/src/container-runner.ts.intent.md',
      'modify/container/agent-runner/src/index.ts.intent.md',
    ];
    for (const file of intentFiles) {
      expect(fs.existsSync(path.join(skillDir, file))).toBe(true);
    }
  });
});
