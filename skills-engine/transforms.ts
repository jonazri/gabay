import path from 'path';

import {
  SkillManifest,
  SkillTransform,
  TransformManifestPatch,
} from './types.js';

export interface CollectedTransform {
  sourceSkill: string;
  sourceDir: string;
  transform: SkillTransform;
}

/**
 * Scan all manifests for transforms and collect them, keyed by target skill name.
 * Only includes transforms whose target is in the installed skills list.
 * Validates no self-transforms or circular transforms.
 */
export function collectTransforms(
  skills: string[],
  skillDirs: Record<string, string>,
  manifests: Record<string, SkillManifest>,
): Record<string, CollectedTransform[]> {
  const skillSet = new Set(skills);
  const result: Record<string, CollectedTransform[]> = {};

  for (const skillName of skills) {
    const manifest = manifests[skillName];
    if (!manifest?.transforms) continue;

    for (const [targetName, transform] of Object.entries(manifest.transforms)) {
      if (targetName === skillName) {
        throw new Error(
          `Skill "${skillName}" declares a transform targeting itself`,
        );
      }

      // Only include transforms for installed skills
      if (!skillSet.has(targetName)) continue;

      if (!result[targetName]) result[targetName] = [];
      result[targetName].push({
        sourceSkill: skillName,
        sourceDir: skillDirs[skillName],
        transform,
      });
    }
  }

  // Check for circular transforms (A transforms B and B transforms A)
  for (const [target, transforms] of Object.entries(result)) {
    for (const t of transforms) {
      const targetManifest = manifests[target];
      if (targetManifest?.transforms?.[t.sourceSkill]) {
        throw new Error(
          `Circular transforms: "${t.sourceSkill}" transforms "${target}" and "${target}" transforms "${t.sourceSkill}"`,
        );
      }
    }
  }

  return result;
}

/**
 * Apply manifest patches to a manifest, returning a new object (no mutation).
 */
export function applyManifestPatches(
  manifest: SkillManifest,
  patches: TransformManifestPatch[],
): SkillManifest {
  let depends = [...manifest.depends];
  let modifies = [...manifest.modifies];

  for (const patch of patches) {
    if (patch.add_depends) {
      for (const dep of patch.add_depends) {
        if (!depends.includes(dep)) depends.push(dep);
      }
    }
    if (patch.remove_modifies) {
      const toRemove = new Set(patch.remove_modifies);
      modifies = modifies.filter((m) => !toRemove.has(m));
    }
    if (patch.add_modifies) {
      for (const mod of patch.add_modifies) {
        if (!modifies.includes(mod)) modifies.push(mod);
      }
    }
  }

  return { ...manifest, depends, modifies };
}

/**
 * Resolve the filesystem path for a transform overlay file.
 */
export function resolveTransformOverlayPath(
  sourceDir: string,
  targetSkill: string,
  relPath: string,
): string {
  return path.join(sourceDir, 'transforms', targetSkill, 'modify', relPath);
}
