import fs from 'fs';
import path from 'path';
import yaml from 'yaml';
import { initNanoclawDir } from '../skills-engine/init.js';
import { readManifest } from '../skills-engine/manifest.js';
import { replaySkills, findSkillDir } from '../skills-engine/replay.js';
import {
  computeFileHash,
  readState,
  recordSkillApplication,
} from '../skills-engine/state.js';
import {
  loadPathRemap,
  resolvePathRemap,
} from '../skills-engine/path-remap.js';
import {
  areRangesCompatible,
  mergeNpmDependencies,
  runNpmInstall,
} from '../skills-engine/structured.js';

const INSTALLED_SKILLS_PATH = '.nanoclaw/installed-skills.yaml';

/**
 * Copy back non-src/ added files from skills after clean-skills removes them.
 * TypeScript files in src/ are compiled to dist/ before clean-skills runs,
 * so they don't need to be physically present after build. Everything else
 * (Python scripts, shell scripts, container skill files, config files, etc.)
 * must be restored for the runtime to function correctly.
 */
function restoreRuntimeFiles(
  skillNames: string[],
  skillDirs: Record<string, string>,
): void {
  const pathRemap = loadPathRemap();
  const restored: string[] = [];

  for (const skillName of skillNames) {
    const manifest = readManifest(skillDirs[skillName]);

    for (const relPath of manifest.adds) {
      const resolvedPath = resolvePathRemap(relPath, pathRemap);

      // src/ TypeScript files are compiled into dist/ before clean-skills runs
      if (resolvedPath.startsWith('src/')) continue;

      const destPath = path.join(process.cwd(), resolvedPath);
      if (fs.existsSync(destPath)) continue; // Already present

      const srcPath = path.join(skillDirs[skillName], 'add', resolvedPath);
      if (!fs.existsSync(srcPath)) continue; // Not in skill's add/ dir

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      restored.push(resolvedPath);
    }
  }

  if (restored.length > 0) {
    console.log(
      `Restored ${restored.length} runtime file(s): ${restored.join(', ')}`,
    );
  }
}

async function installMissingNpmDeps(
  skillNames: string[],
  skillDirs: Record<string, string>,
): Promise<void> {
  const pkgPath = path.join(process.cwd(), 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
  const installed: Record<string, string> = {
    ...pkg.dependencies,
    ...pkg.devDependencies,
  };

  let needsInstall = false;
  for (const skillName of skillNames) {
    const manifest = readManifest(skillDirs[skillName]);
    if (!manifest.structured?.npm_dependencies) continue;

    const deps = manifest.structured.npm_dependencies;
    const toInstall = Object.entries(deps).filter(([name, version]) => {
      const existing = installed[name];
      if (!existing) return true;
      return !areRangesCompatible(existing, version).compatible;
    });
    if (toInstall.length === 0) continue;

    console.log(
      `Installing skill deps for ${skillName}: ${toInstall.map(([n]) => n).join(', ')}`,
    );
    mergeNpmDependencies(pkgPath, deps);
    needsInstall = true;
  }

  if (needsInstall) {
    runNpmInstall();
  }
}

interface InstalledSkills {
  skills: string[];
}

async function main() {
  const depsOnly = process.argv.includes('--deps-only');

  // Read installed skills list
  if (!fs.existsSync(INSTALLED_SKILLS_PATH)) {
    console.log('No installed-skills.yaml found. Nothing to apply.');
    process.exit(0);
  }

  const raw = fs.readFileSync(INSTALLED_SKILLS_PATH, 'utf-8');
  const config: InstalledSkills = yaml.parse(raw);

  if (!config.skills || config.skills.length === 0) {
    console.log('No skills listed in installed-skills.yaml.');
    process.exit(0);
  }

  // Initialize .nanoclaw/ if not present (snapshots current src/ as base)
  if (!depsOnly && !fs.existsSync('.nanoclaw/base')) {
    console.log('Initializing .nanoclaw/ directory...');
    initNanoclawDir();
  }

  // Locate all skill directories
  const skillDirs: Record<string, string> = {};
  for (const skillName of config.skills) {
    const dir = findSkillDir(skillName);
    if (!dir) {
      console.error(`Skill directory not found for: ${skillName}`);
      process.exit(1);
    }
    skillDirs[skillName] = dir;
  }

  // Always ensure skill npm dependencies are installed, even if skills are already applied
  await installMissingNpmDeps(config.skills, skillDirs);

  // --deps-only: restore runtime files and install deps, don't patch src/ (used as post-build step)
  if (depsOnly) {
    restoreRuntimeFiles(config.skills, skillDirs);
    process.exit(0);
  }

  // Check if already applied
  try {
    const state = readState();
    if (state.applied_skills.length > 0) {
      console.log(
        `Skills already applied (${state.applied_skills.length} skills). Use clean-skills first to re-apply.`,
      );
      process.exit(0);
    }
  } catch {
    // No state yet — fresh apply
  }

  console.log(
    `Applying ${config.skills.length} skills: ${config.skills.join(', ')}`,
  );

  // Apply sequentially using replaySkills
  const result = await replaySkills({
    skills: config.skills,
    skillDirs,
  });

  if (!result.success) {
    console.error('Skill application failed!');
    if (result.mergeConflicts?.length) {
      console.error('Merge conflicts in:', result.mergeConflicts.join(', '));
    }
    if (result.error) console.error(result.error);
    process.exit(1);
  }

  // Record each applied skill in state.yaml so clean-skills can undo them
  const pathRemap = loadPathRemap();
  for (const skillName of config.skills) {
    const dir = skillDirs[skillName];
    const manifest = readManifest(dir);
    const fileHashes: Record<string, string> = {};
    for (const f of [...manifest.adds, ...manifest.modifies]) {
      const resolvedPath = resolvePathRemap(f, pathRemap);
      const fullPath = path.join(process.cwd(), resolvedPath);
      if (fs.existsSync(fullPath)) {
        fileHashes[resolvedPath] = computeFileHash(fullPath);
      }
    }
    const outcomes: Record<string, unknown> = manifest.structured
      ? { ...manifest.structured }
      : {};
    if (manifest.test) outcomes.test = manifest.test;
    recordSkillApplication(
      manifest.skill,
      manifest.version,
      fileHashes,
      Object.keys(outcomes).length > 0 ? outcomes : undefined,
    );
  }

  // Sync container/agent-runner/src/ to all existing per-session mount dirs.
  // container-runner only copies this once at first container launch, so skill
  // changes to ipc-mcp-stdio.ts would otherwise remain stale in live sessions.
  syncAgentRunnerSrc();

  // Sync container/skills/ to all existing per-session .claude/skills/ dirs.
  // container-runner syncs these at container launch, but clean-skills removes
  // them from container/skills/ after build. This ensures all sessions get the
  // skill-applied versions and stale/removed skills are cleaned up.
  syncContainerSkills();

  console.log(`Successfully applied ${config.skills.length} skills.`);
}

function syncAgentRunnerSrc(): void {
  const agentRunnerSrc = path.join(
    process.cwd(),
    'container',
    'agent-runner',
    'src',
  );
  if (!fs.existsSync(agentRunnerSrc)) return;

  const sessionsDir = path.join(process.cwd(), 'data', 'sessions');
  if (!fs.existsSync(sessionsDir)) return;

  const synced: string[] = [];
  for (const session of fs.readdirSync(sessionsDir)) {
    const mountDir = path.join(sessionsDir, session, 'agent-runner-src');
    if (!fs.existsSync(mountDir)) continue;
    for (const file of fs.readdirSync(agentRunnerSrc)) {
      fs.copyFileSync(
        path.join(agentRunnerSrc, file),
        path.join(mountDir, file),
      );
    }
    synced.push(session);
  }

  if (synced.length > 0) {
    console.log(`Synced agent-runner/src to ${synced.length} session(s).`);
  }
}

/**
 * Sync container/skills/ to all existing per-session .claude/skills/ dirs.
 * Uses atomic swap (copy to temp, rename) so a mid-copy failure never
 * leaves a session with an empty or partial skills directory.
 */
function syncContainerSkills(): void {
  const skillsSrc = path.join(process.cwd(), 'container', 'skills');
  if (!fs.existsSync(skillsSrc)) return;

  const sessionsDir = path.join(process.cwd(), 'data', 'sessions');
  if (!fs.existsSync(sessionsDir)) return;

  const synced: string[] = [];
  for (const session of fs.readdirSync(sessionsDir)) {
    const skillsDst = path.join(sessionsDir, session, '.claude', 'skills');

    // Verify destination exists and is a real directory (not a symlink or file)
    if (!fs.existsSync(skillsDst)) continue;
    const dstStat = fs.lstatSync(skillsDst);
    if (!dstStat.isDirectory() || dstStat.isSymbolicLink()) continue;

    // Guard against path escape via symlinked session entries
    const resolvedDst = fs.realpathSync(skillsDst);
    const resolvedBase = fs.realpathSync(sessionsDir);
    const rel = path.relative(resolvedBase, resolvedDst);
    if (rel.startsWith('..') || path.isAbsolute(rel)) continue;

    // Atomic swap: populate a temp dir, then rename over the original
    const tmpDst = skillsDst + '.tmp';
    fs.rmSync(tmpDst, { recursive: true, force: true });
    fs.mkdirSync(tmpDst, { recursive: true });
    try {
      for (const skillDir of fs.readdirSync(skillsSrc)) {
        const srcDir = path.join(skillsSrc, skillDir);
        if (!fs.statSync(srcDir).isDirectory()) continue;
        fs.cpSync(srcDir, path.join(tmpDst, skillDir), { recursive: true });
      }
      fs.rmSync(skillsDst, { recursive: true });
      fs.renameSync(tmpDst, skillsDst);
      synced.push(session);
    } catch (err) {
      // Clean up temp dir on failure; original skills dir is untouched
      fs.rmSync(tmpDst, { recursive: true, force: true });
      console.warn(`Failed to sync skills for session ${session}:`, err);
    }
  }

  if (synced.length > 0) {
    console.log(`Synced container skills to ${synced.length} session(s).`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
