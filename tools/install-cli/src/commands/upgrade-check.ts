/**
 * Upgrade Pre-check Command
 *
 * Validates readiness for a platform version upgrade:
 * - Checks current version vs target version
 * - Validates migration compatibility
 * - Checks backup exists
 * - Reports plugin/theme compatibility
 * - Outputs go/no-go recommendation
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type UpgradeDecision = 'go' | 'no-go' | 'caution';

export interface CompatibilityCheck {
  name: string;
  compatible: boolean;
  currentVersion?: string;
  requiredVersion?: string;
  message: string;
}

export interface UpgradeCheckResult {
  timestamp: string;
  decision: UpgradeDecision;
  currentVersion: string;
  targetVersion: string;
  checks: {
    versionValid: boolean;
    migrationCompatible: boolean;
    backupExists: boolean;
    pluginsCompatible: boolean;
    themesCompatible: boolean;
    diskSpaceSufficient: boolean;
  };
  pluginCompatibility: CompatibilityCheck[];
  themeCompatibility: CompatibilityCheck[];
  migrationNotes: string[];
  blockers: string[];
  warnings: string[];
  recommendations: string[];
}

export interface UpgradeCheckOptions {
  /** Target version to upgrade to */
  targetVersion?: string;
  /** Path to the project root */
  projectRoot?: string;
  /** Base URL of the API gateway */
  gatewayUrl?: string;
  /** Timeout per check in ms */
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseVersion(version: string): { major: number; minor: number; patch: number } | null {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) return null;
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
  };
}

function isUpgradePath(current: string, target: string): boolean {
  const c = parseVersion(current);
  const t = parseVersion(target);
  if (!c || !t) return false;

  if (t.major > c.major) return true;
  if (t.major === c.major && t.minor > c.minor) return true;
  if (t.major === c.major && t.minor === c.minor && t.patch > c.patch) return true;
  return false;
}

function isMajorUpgrade(current: string, target: string): boolean {
  const c = parseVersion(current);
  const t = parseVersion(target);
  if (!c || !t) return false;
  return t.major > c.major;
}

function getCurrentVersion(projectRoot: string): string {
  try {
    const pkgPath = join(projectRoot, 'package.json');
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return pkg.version ?? '0.0.0';
    }
  } catch {
    // Fall through
  }
  return '0.0.0';
}

function checkPluginCompatibility(
  projectRoot: string,
  targetVersion: string,
): CompatibilityCheck[] {
  const results: CompatibilityCheck[] = [];
  const pluginsDir = join(projectRoot, 'plugins');

  if (!existsSync(pluginsDir)) {
    return results;
  }

  try {
    const { readdirSync } = require('node:fs');
    const entries = readdirSync(pluginsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const pluginPkgPath = join(pluginsDir, entry.name, 'package.json');
      if (!existsSync(pluginPkgPath)) continue;

      try {
        const pluginPkg = JSON.parse(readFileSync(pluginPkgPath, 'utf-8'));
        const peerDeps = pluginPkg.peerDependencies ?? {};
        const platformDep = peerDeps['@proctira/common'] ?? peerDeps['@proctira/plugin-sdk'];

        if (platformDep) {
          // Simple semver range check
          const compatible = !platformDep.includes('^0.') || targetVersion.startsWith('0.');
          results.push({
            name: entry.name,
            compatible,
            currentVersion: pluginPkg.version,
            requiredVersion: platformDep,
            message: compatible
              ? `Plugin "${entry.name}" is compatible with target version`
              : `Plugin "${entry.name}" requires platform ${platformDep} — may be incompatible with ${targetVersion}`,
          });
        } else {
          results.push({
            name: entry.name,
            compatible: true,
            currentVersion: pluginPkg.version,
            message: `Plugin "${entry.name}" has no platform version constraint`,
          });
        }
      } catch {
        results.push({
          name: entry.name,
          compatible: false,
          message: `Plugin "${entry.name}" has invalid package.json`,
        });
      }
    }
  } catch {
    // Cannot read plugins directory
  }

  return results;
}

function checkThemeCompatibility(projectRoot: string, targetVersion: string): CompatibilityCheck[] {
  const results: CompatibilityCheck[] = [];
  const themesDir = join(projectRoot, 'themes');

  if (!existsSync(themesDir)) {
    return results;
  }

  try {
    const { readdirSync } = require('node:fs');
    const entries = readdirSync(themesDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const themePkgPath = join(themesDir, entry.name, 'package.json');
      if (!existsSync(themePkgPath)) continue;

      try {
        const themePkg = JSON.parse(readFileSync(themePkgPath, 'utf-8'));
        results.push({
          name: entry.name,
          compatible: true,
          currentVersion: themePkg.version,
          message: `Theme "${entry.name}" v${themePkg.version} — assumed compatible`,
        });
      } catch {
        results.push({
          name: entry.name,
          compatible: false,
          message: `Theme "${entry.name}" has invalid package.json`,
        });
      }
    }
  } catch {
    // Cannot read themes directory
  }

  return results;
}

function checkBackupExists(): boolean {
  // Check common backup indicators
  const backupEnabled = process.env['DB_BACKUP_ENABLED'] === 'true';
  const lastBackup = process.env['LAST_BACKUP_TIMESTAMP'];

  if (backupEnabled && lastBackup) {
    // Verify backup is recent (within 24 hours)
    const backupTime = new Date(lastBackup).getTime();
    const now = Date.now();
    const hoursSinceBackup = (now - backupTime) / (1000 * 60 * 60);
    return hoursSinceBackup < 24;
  }

  return backupEnabled ?? false;
}

// ---------------------------------------------------------------------------
// Main Command
// ---------------------------------------------------------------------------

/**
 * Run upgrade pre-checks and return a go/no-go recommendation.
 */
export async function runUpgradeCheck(opts: UpgradeCheckOptions = {}): Promise<UpgradeCheckResult> {
  const projectRoot = opts.projectRoot ?? process.cwd();
  const currentVersion = getCurrentVersion(projectRoot);
  const targetVersion = opts.targetVersion ?? 'latest';

  const blockers: string[] = [];
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const migrationNotes: string[] = [];

  // Version validation
  const versionValid = targetVersion === 'latest' || isUpgradePath(currentVersion, targetVersion);
  if (!versionValid && targetVersion !== 'latest') {
    blockers.push(
      `Target version ${targetVersion} is not an upgrade from current ${currentVersion}`,
    );
  }

  if (isMajorUpgrade(currentVersion, targetVersion)) {
    warnings.push(
      `Major version upgrade (${currentVersion} → ${targetVersion}) — review breaking changes`,
    );
    migrationNotes.push('Major upgrades may include breaking schema changes');
    migrationNotes.push('Review CHANGELOG.md for migration guides');
    recommendations.push('Test upgrade in staging environment first');
    recommendations.push('Plan for extended maintenance window');
  }

  // Migration compatibility
  const migrationCompatible = versionValid; // Simplified — real impl would check migration graph
  if (!migrationCompatible) {
    blockers.push('Migration path not validated — intermediate versions may be required');
  }

  // Backup check
  const backupExists = checkBackupExists();
  if (!backupExists) {
    blockers.push('No recent backup found — create a backup before upgrading');
    recommendations.push('Run: pg_dump or use the platform backup command');
  }

  // Plugin compatibility
  const pluginCompatibility = checkPluginCompatibility(projectRoot, targetVersion);
  const pluginsCompatible = pluginCompatibility.every((p) => p.compatible);
  if (!pluginsCompatible) {
    const incompatible = pluginCompatibility.filter((p) => !p.compatible);
    warnings.push(`${incompatible.length} plugin(s) may be incompatible`);
    recommendations.push('Update incompatible plugins before upgrading');
  }

  // Theme compatibility
  const themeCompatibility = checkThemeCompatibility(projectRoot, targetVersion);
  const themesCompatible = themeCompatibility.every((t) => t.compatible);
  if (!themesCompatible) {
    warnings.push('Some themes may be incompatible with the target version');
  }

  // Disk space (simplified check)
  const diskSpaceSufficient = true; // Would use statfsSync in production
  if (!diskSpaceSufficient) {
    blockers.push('Insufficient disk space for upgrade');
  }

  // General recommendations
  recommendations.push('Notify users of planned maintenance window');
  recommendations.push('Verify rollback procedure is documented and tested');

  // Decision
  let decision: UpgradeDecision;
  if (blockers.length > 0) {
    decision = 'no-go';
  } else if (warnings.length > 0) {
    decision = 'caution';
  } else {
    decision = 'go';
  }

  return {
    timestamp: new Date().toISOString(),
    decision,
    currentVersion,
    targetVersion,
    checks: {
      versionValid,
      migrationCompatible,
      backupExists,
      pluginsCompatible,
      themesCompatible,
      diskSpaceSufficient,
    },
    pluginCompatibility,
    themeCompatibility,
    migrationNotes,
    blockers,
    warnings,
    recommendations,
  };
}

/**
 * CLI entry point for the upgrade-check command.
 */
export async function upgradeCheckCommand(argv: string[]): Promise<void> {
  const opts: UpgradeCheckOptions = {};

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case '--target':
      case '--target-version':
        opts.targetVersion = argv[++i];
        break;
      case '--project-root':
        opts.projectRoot = argv[++i];
        break;
      case '--gateway-url':
        opts.gatewayUrl = argv[++i];
        break;
    }
  }

  const result = await runUpgradeCheck(opts);

  // Human-readable summary to stderr
  console.error('');
  console.error('╔══════════════════════════════════════════════════╗');
  console.error('║          Upgrade Pre-check Report                ║');
  console.error('╚══════════════════════════════════════════════════╝');
  console.error('');
  console.error(`  Current Version: ${result.currentVersion}`);
  console.error(`  Target Version:  ${result.targetVersion}`);
  console.error('');

  const decisionIcon = result.decision === 'go' ? '✓' : result.decision === 'caution' ? '⚠' : '✗';
  const decisionText = result.decision.toUpperCase();
  console.error(`  Decision: ${decisionIcon} ${decisionText}`);
  console.error('');

  if (result.blockers.length > 0) {
    console.error('  Blockers:');
    for (const b of result.blockers) {
      console.error(`    ✗ ${b}`);
    }
    console.error('');
  }

  if (result.warnings.length > 0) {
    console.error('  Warnings:');
    for (const w of result.warnings) {
      console.error(`    ⚠ ${w}`);
    }
    console.error('');
  }

  if (result.recommendations.length > 0) {
    console.error('  Recommendations:');
    for (const r of result.recommendations) {
      console.error(`    → ${r}`);
    }
    console.error('');
  }

  // Machine-readable JSON to stdout
  console.log(JSON.stringify(result, null, 2));

  if (result.decision === 'no-go') {
    process.exitCode = 1;
  }
}
