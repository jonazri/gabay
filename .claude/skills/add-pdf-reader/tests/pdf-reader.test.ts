import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import yaml from 'yaml';

const skillDir = path.resolve(__dirname, '..');

describe('pdf-reader skill package', () => {
  it('has a valid manifest', () => {
    const manifestPath = path.join(skillDir, 'manifest.yaml');
    expect(fs.existsSync(manifestPath)).toBe(true);

    const content = yaml.parse(fs.readFileSync(manifestPath, 'utf-8'));
    expect(content.skill).toBe('add-pdf-reader');
    expect(content.modifies).toContain('container/Dockerfile');
    expect(content.modifies).toContain('src/media-processing.ts');
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

  it('has pdf-reader CLI script', () => {
    const scriptPath = path.join(
      skillDir, 'add', 'container', 'skills', 'pdf-reader', 'pdf-reader',
    );
    expect(fs.existsSync(scriptPath)).toBe(true);

    const content = fs.readFileSync(scriptPath, 'utf-8');
    expect(content).toContain('#!/bin/bash');
    expect(content).toContain('pdftotext');
    expect(content).toContain('extract');
    expect(content).toContain('fetch');
    expect(content).toContain('info');
  });

  it('has container skill SKILL.md', () => {
    const docPath = path.join(
      skillDir, 'add', 'container', 'skills', 'pdf-reader', 'SKILL.md',
    );
    expect(fs.existsSync(docPath)).toBe(true);
  });

  it('has Dockerfile overlay with poppler-utils', () => {
    const overlayPath = path.join(skillDir, 'modify', 'container', 'Dockerfile');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain('poppler-utils');
    expect(content).toContain('pdf-reader');
  });

  it('has media-processing.ts overlay with PDF handler', () => {
    const overlayPath = path.join(skillDir, 'modify', 'src', 'media-processing.ts');
    expect(fs.existsSync(overlayPath)).toBe(true);

    const content = fs.readFileSync(overlayPath, 'utf-8');
    expect(content).toContain("'application/pdf'");
    expect(content).toContain('downloadMediaMessage');
    expect(content).toContain('pdf-reader extract');
    // Must preserve image placeholder for image-vision
    expect(content).toContain('--- Image attachments ---');
  });

  it('has intent docs for modified files', () => {
    expect(fs.existsSync(
      path.join(skillDir, 'modify', 'src', 'media-processing.ts.intent.md'),
    )).toBe(true);
    expect(fs.existsSync(
      path.join(skillDir, 'modify', 'container', 'Dockerfile.intent.md'),
    )).toBe(true);
  });
});
