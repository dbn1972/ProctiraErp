/**
 * Plugin Compatibility Checker
 *
 * Validates that a plugin's declared supported product versions
 * are compatible with the current platform version using semver range matching.
 *
 * Supports common semver range patterns:
 * - Exact: "1.2.3"
 * - Caret: "^1.2.3" (>=1.2.3 <2.0.0)
 * - Tilde: "~1.2.3" (>=1.2.3 <1.3.0)
 * - Range: ">=1.0.0 <2.0.0"
 * - Wildcard: "*" (any version)
 */

interface SemverParts {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
}

/**
 * Parse a semver string into its component parts.
 */
export function parseSemver(version: string): SemverParts | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z0-9.]+))?$/);
  if (!match) return null;
  return {
    major: parseInt(match[1]!, 10),
    minor: parseInt(match[2]!, 10),
    patch: parseInt(match[3]!, 10),
    prerelease: match[4] ?? null,
  };
}

/**
 * Compare two semver versions.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareSemver(a: SemverParts, b: SemverParts): -1 | 0 | 1 {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  // Pre-release versions have lower precedence than release
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return 0;
}

/**
 * Check if version satisfies a single comparator (e.g., ">=1.0.0", "<2.0.0", "1.2.3").
 */
function satisfiesComparator(version: SemverParts, comparator: string): boolean {
  const trimmed = comparator.trim();

  if (trimmed === '*' || trimmed === '') return true;

  // Match operator + version
  const match = trimmed.match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!match) return false;

  const operator = match[1] || '=';
  const targetStr = match[2]!.trim();
  const target = parseSemver(targetStr);
  if (!target) return false;

  const cmp = compareSemver(version, target);

  switch (operator) {
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0;
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    case '=':
      return cmp === 0;
    default:
      return false;
  }
}

/**
 * Expand a caret range (^) into comparators.
 * ^1.2.3 → >=1.2.3 <2.0.0
 * ^0.2.3 → >=0.2.3 <0.3.0
 * ^0.0.3 → >=0.0.3 <0.0.4
 */
function expandCaret(version: SemverParts): string[] {
  if (version.major > 0) {
    return [`>=${version.major}.${version.minor}.${version.patch}`, `<${version.major + 1}.0.0`];
  }
  if (version.minor > 0) {
    return [
      `>=${version.major}.${version.minor}.${version.patch}`,
      `<${version.major}.${version.minor + 1}.0`,
    ];
  }
  return [
    `>=${version.major}.${version.minor}.${version.patch}`,
    `<${version.major}.${version.minor}.${version.patch + 1}`,
  ];
}

/**
 * Expand a tilde range (~) into comparators.
 * ~1.2.3 → >=1.2.3 <1.3.0
 */
function expandTilde(version: SemverParts): string[] {
  return [
    `>=${version.major}.${version.minor}.${version.patch}`,
    `<${version.major}.${version.minor + 1}.0`,
  ];
}

/**
 * Check if a product version satisfies a semver range expression.
 *
 * @param productVersion - The current product version (e.g., "2.1.0")
 * @param range - The supported version range from the plugin manifest
 * @returns true if the product version is compatible
 */
export function checkCompatibility(productVersion: string, range: string): boolean {
  const version = parseSemver(productVersion);
  if (!version) return false;

  const trimmedRange = range.trim();

  // Wildcard
  if (trimmedRange === '*') return true;

  // Caret range
  if (trimmedRange.startsWith('^')) {
    const target = parseSemver(trimmedRange.slice(1));
    if (!target) return false;
    const comparators = expandCaret(target);
    return comparators.every((c) => satisfiesComparator(version, c));
  }

  // Tilde range
  if (trimmedRange.startsWith('~')) {
    const target = parseSemver(trimmedRange.slice(1));
    if (!target) return false;
    const comparators = expandTilde(target);
    return comparators.every((c) => satisfiesComparator(version, c));
  }

  // Space-separated comparators (AND logic): ">=1.0.0 <2.0.0"
  const parts = trimmedRange.split(/\s+/);
  if (parts.length > 1) {
    return parts.every((part) => satisfiesComparator(version, part));
  }

  // Single comparator or exact version
  return satisfiesComparator(version, trimmedRange);
}

/**
 * Result of a compatibility check.
 */
export interface CompatibilityResult {
  compatible: boolean;
  productVersion: string;
  supportedRange: string;
  message: string;
}

/**
 * Perform a full compatibility check and return a structured result.
 */
export function validateCompatibility(
  productVersion: string,
  supportedRange: string,
): CompatibilityResult {
  const compatible = checkCompatibility(productVersion, supportedRange);
  return {
    compatible,
    productVersion,
    supportedRange,
    message: compatible
      ? `Plugin is compatible with product version ${productVersion}`
      : `Plugin requires product version ${supportedRange} but current version is ${productVersion}`,
  };
}
