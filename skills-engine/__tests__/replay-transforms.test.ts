import fs from 'fs';
import path from 'path';
import { stringify } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { replaySkills } from '../replay.js';
import {
  cleanup,
  createMinimalState,
  createTempDir,
  initGitRepo,
  setupNanoclawDir,
} from './test-helpers.js';

describe('replay with transforms', () => {
  let tmpDir: string;
  const originalCwd = process.cwd();

  beforeEach(() => {
    tmpDir = createTempDir();
    setupNanoclawDir(tmpDir);
    createMinimalState(tmpDir);
    initGitRepo(tmpDir);
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(originalCwd);
    cleanup(tmpDir);
  });

  /**
   * Helper to create a skill package with optional transforms.
   */
  function createSkillWithTransforms(opts: {
    skill: string;
    adds?: string[];
    modifies?: string[];
    addFiles?: Record<string, string>;
    modifyFiles?: Record<string, string>;
    transforms?: Record<
      string,
      {
        manifest_patches?: {
          add_depends?: string[];
          remove_modifies?: string[];
          add_modifies?: string[];
        };
        overlay_files?: string[];
      }
    >;
    transformOverlayFiles?: Record<string, Record<string, string>>;
    // e.g. { 'target-skill': { 'src/foo.ts': 'content' } }
    dirName?: string;
  }): string {
    const skillDir = path.join(tmpDir, opts.dirName ?? `skill-${opts.skill}`);
    fs.mkdirSync(skillDir, { recursive: true });

    const manifest: Record<string, unknown> = {
      skill: opts.skill,
      version: '1.0.0',
      description: 'test',
      core_version: '1.0.0',
      adds: opts.adds ?? [],
      modifies: opts.modifies ?? [],
      conflicts: [],
      depends: [],
    };
    if (opts.transforms) {
      manifest.transforms = opts.transforms;
    }

    fs.writeFileSync(path.join(skillDir, 'manifest.yaml'), stringify(manifest));

    if (opts.addFiles) {
      for (const [relPath, content] of Object.entries(opts.addFiles)) {
        const fullPath = path.join(skillDir, 'add', relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }
    }

    if (opts.modifyFiles) {
      for (const [relPath, content] of Object.entries(opts.modifyFiles)) {
        const fullPath = path.join(skillDir, 'modify', relPath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }
    }

    if (opts.transformOverlayFiles) {
      for (const [target, files] of Object.entries(
        opts.transformOverlayFiles,
      )) {
        for (const [relPath, content] of Object.entries(files)) {
          const fullPath = path.join(
            skillDir,
            'transforms',
            target,
            'modify',
            relPath,
          );
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, content);
        }
      }
    }

    return skillDir;
  }

  it('applies transform overlay files to target skill', async () => {
    // Set up base file that media-processing adds
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });

    // Foundation skill adds a file
    const foundationDir = createSkillWithTransforms({
      skill: 'foundation',
      adds: ['src/processor.ts'],
      addFiles: {
        'src/processor.ts':
          'export function process() {\n  // placeholder\n  return null;\n}\n',
      },
      transforms: {
        handler: {
          manifest_patches: {
            add_depends: ['foundation'],
            add_modifies: ['src/processor.ts'],
          },
          overlay_files: ['src/processor.ts'],
        },
      },
      transformOverlayFiles: {
        handler: {
          'src/processor.ts':
            'export function process() {\n  // handler logic\n  return "handled";\n}\n',
        },
      },
    });

    // Target skill (handler) — originally only adds its own file
    const handlerDir = createSkillWithTransforms({
      skill: 'handler',
      adds: ['src/handler.ts'],
      addFiles: { 'src/handler.ts': 'export const handler = true;\n' },
    });

    const result = await replaySkills({
      skills: ['foundation', 'handler'],
      skillDirs: { foundation: foundationDir, handler: handlerDir },
      projectRoot: tmpDir,
    });

    expect(result.success).toBe(true);
    expect(result.perSkill.foundation.success).toBe(true);
    expect(result.perSkill.handler.success).toBe(true);

    // handler.ts added by handler skill
    expect(fs.existsSync(path.join(tmpDir, 'src', 'handler.ts'))).toBe(true);

    // processor.ts should have the transform's content merged in
    const processor = fs.readFileSync(
      path.join(tmpDir, 'src', 'processor.ts'),
      'utf-8',
    );
    expect(processor).toContain('handler logic');
    expect(processor).toContain('return "handled"');
  });

  it('applies manifest patches (add_depends, remove_modifies, add_modifies)', async () => {
    // Set up base files
    const baseDir = path.join(tmpDir, '.nanoclaw', 'base', 'src');
    fs.mkdirSync(baseDir, { recursive: true });
    fs.writeFileSync(path.join(baseDir, 'channel.ts'), 'channel code\n');
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'channel.ts'), 'channel code\n');

    // Foundation adds processor.ts
    const foundationDir = createSkillWithTransforms({
      skill: 'foundation',
      adds: ['src/processor.ts'],
      addFiles: {
        'src/processor.ts': 'export function process() { return null; }\n',
      },
      transforms: {
        handler: {
          manifest_patches: {
            add_depends: ['foundation'],
            remove_modifies: ['src/channel.ts'],
            add_modifies: ['src/processor.ts'],
          },
          overlay_files: ['src/processor.ts'],
        },
      },
      transformOverlayFiles: {
        handler: {
          'src/processor.ts': 'export function process() { return "ok"; }\n',
        },
      },
    });

    // Handler originally modifies channel.ts — but transform removes that
    const handlerDir = createSkillWithTransforms({
      skill: 'handler',
      modifies: ['src/channel.ts'],
      modifyFiles: {
        'src/channel.ts': 'channel code\nhandler addition\n',
      },
    });

    const result = await replaySkills({
      skills: ['foundation', 'handler'],
      skillDirs: { foundation: foundationDir, handler: handlerDir },
      projectRoot: tmpDir,
    });

    expect(result.success).toBe(true);

    // channel.ts should NOT have handler's changes (remove_modifies removed it)
    const channel = fs.readFileSync(
      path.join(tmpDir, 'src', 'channel.ts'),
      'utf-8',
    );
    expect(channel).not.toContain('handler addition');

    // processor.ts should have transform overlay applied
    const processor = fs.readFileSync(
      path.join(tmpDir, 'src', 'processor.ts'),
      'utf-8',
    );
    expect(processor).toContain('return "ok"');
  });

  it('fails when overlay_files entry is not in effective modifies list', async () => {
    const foundationDir = createSkillWithTransforms({
      skill: 'foundation',
      adds: ['src/base.ts'],
      addFiles: { 'src/base.ts': 'base\n' },
      transforms: {
        handler: {
          // overlay_files declares src/base.ts but no add_modifies for it
          overlay_files: ['src/base.ts'],
        },
      },
      transformOverlayFiles: {
        handler: { 'src/base.ts': 'modified\n' },
      },
    });

    const handlerDir = createSkillWithTransforms({
      skill: 'handler',
      adds: ['src/handler.ts'],
      addFiles: { 'src/handler.ts': 'handler\n' },
    });

    const result = await replaySkills({
      skills: ['foundation', 'handler'],
      skillDirs: { foundation: foundationDir, handler: handlerDir },
      projectRoot: tmpDir,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('not in the effective modifies list');
  });

  it('skips transform when target skill is not installed', async () => {
    const foundationDir = createSkillWithTransforms({
      skill: 'foundation',
      adds: ['src/base.ts'],
      addFiles: { 'src/base.ts': 'base\n' },
      transforms: {
        'not-installed': {
          manifest_patches: { add_depends: ['foundation'] },
          overlay_files: ['src/base.ts'],
        },
      },
      transformOverlayFiles: {
        'not-installed': {
          'src/base.ts': 'should not be used\n',
        },
      },
    });

    const result = await replaySkills({
      skills: ['foundation'],
      skillDirs: { foundation: foundationDir },
      projectRoot: tmpDir,
    });

    expect(result.success).toBe(true);
    // base.ts should have the original add content, not the transform overlay
    const content = fs.readFileSync(
      path.join(tmpDir, 'src', 'base.ts'),
      'utf-8',
    );
    expect(content).toBe('base\n');
  });
});
