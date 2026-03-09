import { describe, expect, it } from 'vitest';

import {
  applyManifestPatches,
  collectTransforms,
  resolveTransformOverlayPath,
} from '../transforms.js';
import { SkillManifest, TransformManifestPatch } from '../types.js';

function makeManifest(overrides: Partial<SkillManifest> = {}): SkillManifest {
  return {
    skill: 'test',
    version: '1.0.0',
    description: 'test',
    core_version: '1.0.0',
    adds: [],
    modifies: [],
    conflicts: [],
    depends: [],
    ...overrides,
  };
}

describe('collectTransforms', () => {
  it('collects transforms targeting installed skills', () => {
    const manifests: Record<string, SkillManifest> = {
      'media-processing': makeManifest({
        skill: 'media-processing',
        transforms: {
          'image-vision': {
            manifest_patches: { add_depends: ['media-processing'] },
            overlay_files: ['src/media-processing.ts'],
          },
        },
      }),
      'image-vision': makeManifest({ skill: 'image-vision' }),
    };

    const result = collectTransforms(
      ['media-processing', 'image-vision'],
      { 'media-processing': '/skills/mp', 'image-vision': '/skills/iv' },
      manifests,
    );

    expect(result['image-vision']).toHaveLength(1);
    expect(result['image-vision'][0].sourceSkill).toBe('media-processing');
    expect(result['image-vision'][0].sourceDir).toBe('/skills/mp');
  });

  it('skips transforms targeting uninstalled skills', () => {
    const manifests: Record<string, SkillManifest> = {
      'media-processing': makeManifest({
        skill: 'media-processing',
        transforms: {
          'image-vision': {
            manifest_patches: { add_depends: ['media-processing'] },
          },
        },
      }),
    };

    const result = collectTransforms(
      ['media-processing'],
      { 'media-processing': '/skills/mp' },
      manifests,
    );

    expect(result['image-vision']).toBeUndefined();
  });

  it('throws on self-transform', () => {
    const manifests: Record<string, SkillManifest> = {
      'bad-skill': makeManifest({
        skill: 'bad-skill',
        transforms: {
          'bad-skill': { manifest_patches: { add_depends: ['x'] } },
        },
      }),
    };

    expect(() =>
      collectTransforms(
        ['bad-skill'],
        { 'bad-skill': '/skills/bad' },
        manifests,
      ),
    ).toThrow('targeting itself');
  });

  it('throws on circular transforms', () => {
    const manifests: Record<string, SkillManifest> = {
      'skill-a': makeManifest({
        skill: 'skill-a',
        transforms: {
          'skill-b': { manifest_patches: { add_depends: ['skill-a'] } },
        },
      }),
      'skill-b': makeManifest({
        skill: 'skill-b',
        transforms: {
          'skill-a': { manifest_patches: { add_depends: ['skill-b'] } },
        },
      }),
    };

    expect(() =>
      collectTransforms(
        ['skill-a', 'skill-b'],
        { 'skill-a': '/a', 'skill-b': '/b' },
        manifests,
      ),
    ).toThrow('Circular transforms');
  });

  it('collects multiple transforms for same target', () => {
    const manifests: Record<string, SkillManifest> = {
      'skill-a': makeManifest({
        skill: 'skill-a',
        transforms: {
          target: { manifest_patches: { add_depends: ['skill-a'] } },
        },
      }),
      'skill-b': makeManifest({
        skill: 'skill-b',
        transforms: {
          target: { manifest_patches: { add_depends: ['skill-b'] } },
        },
      }),
      target: makeManifest({ skill: 'target' }),
    };

    const result = collectTransforms(
      ['skill-a', 'skill-b', 'target'],
      { 'skill-a': '/a', 'skill-b': '/b', target: '/t' },
      manifests,
    );

    expect(result.target).toHaveLength(2);
  });

  it('returns empty record when no transforms exist', () => {
    const manifests: Record<string, SkillManifest> = {
      plain: makeManifest({ skill: 'plain' }),
    };

    const result = collectTransforms(['plain'], { plain: '/p' }, manifests);

    expect(Object.keys(result)).toHaveLength(0);
  });
});

describe('applyManifestPatches', () => {
  it('adds depends', () => {
    const manifest = makeManifest({ depends: ['whatsapp'] });
    const patches: TransformManifestPatch[] = [
      { add_depends: ['media-processing'] },
    ];

    const result = applyManifestPatches(manifest, patches);
    expect(result.depends).toEqual(['whatsapp', 'media-processing']);
    // Original unchanged
    expect(manifest.depends).toEqual(['whatsapp']);
  });

  it('removes modifies', () => {
    const manifest = makeManifest({
      modifies: ['src/whatsapp.ts', 'src/whatsapp.test.ts', 'src/other.ts'],
    });
    const patches: TransformManifestPatch[] = [
      { remove_modifies: ['src/whatsapp.ts', 'src/whatsapp.test.ts'] },
    ];

    const result = applyManifestPatches(manifest, patches);
    expect(result.modifies).toEqual(['src/other.ts']);
  });

  it('adds modifies', () => {
    const manifest = makeManifest({ modifies: ['src/other.ts'] });
    const patches: TransformManifestPatch[] = [
      { add_modifies: ['src/media-processing.ts'] },
    ];

    const result = applyManifestPatches(manifest, patches);
    expect(result.modifies).toEqual([
      'src/other.ts',
      'src/media-processing.ts',
    ]);
  });

  it('does not add duplicate depends', () => {
    const manifest = makeManifest({ depends: ['media-processing'] });
    const patches: TransformManifestPatch[] = [
      { add_depends: ['media-processing'] },
    ];

    const result = applyManifestPatches(manifest, patches);
    expect(result.depends).toEqual(['media-processing']);
  });

  it('does not add duplicate modifies', () => {
    const manifest = makeManifest({ modifies: ['src/foo.ts'] });
    const patches: TransformManifestPatch[] = [
      { add_modifies: ['src/foo.ts'] },
    ];

    const result = applyManifestPatches(manifest, patches);
    expect(result.modifies).toEqual(['src/foo.ts']);
  });

  it('applies multiple patches in sequence', () => {
    const manifest = makeManifest({
      depends: [],
      modifies: ['src/a.ts', 'src/b.ts'],
    });
    const patches: TransformManifestPatch[] = [
      { add_depends: ['dep1'], remove_modifies: ['src/a.ts'] },
      { add_depends: ['dep2'], add_modifies: ['src/c.ts'] },
    ];

    const result = applyManifestPatches(manifest, patches);
    expect(result.depends).toEqual(['dep1', 'dep2']);
    expect(result.modifies).toEqual(['src/b.ts', 'src/c.ts']);
  });

  it('does not mutate original manifest', () => {
    const manifest = makeManifest({
      depends: ['a'],
      modifies: ['src/x.ts'],
    });
    const original = {
      ...manifest,
      depends: [...manifest.depends],
      modifies: [...manifest.modifies],
    };

    applyManifestPatches(manifest, [
      {
        add_depends: ['b'],
        remove_modifies: ['src/x.ts'],
        add_modifies: ['src/y.ts'],
      },
    ]);

    expect(manifest.depends).toEqual(original.depends);
    expect(manifest.modifies).toEqual(original.modifies);
  });
});

describe('resolveTransformOverlayPath', () => {
  it('builds correct path', () => {
    const result = resolveTransformOverlayPath(
      '/skills/add-media-processing',
      'image-vision',
      'src/media-processing.ts',
    );

    expect(result).toBe(
      '/skills/add-media-processing/transforms/image-vision/modify/src/media-processing.ts',
    );
  });
});
