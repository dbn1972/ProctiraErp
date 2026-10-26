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
 * - Range: ">=1.0.0 <2.0.0" (operators may be followed by spaces: ">= 1.0.0")
 * - Wildcard: "*" (any version)
 * - Union: "^1.0.0 || ^2.0.0" (any alternative may match)
 * - X-range / partial: "1.x", "1.2.*", "1", "1.2"
 * - Hyphen: "1.2.3 - 1.4.0" (inclusive; a partial upper bound such as "1.4" means <1.5.0)
 *
 * Pre-release identifiers are compared per SemVer 2.0.0 §11.
 *
 * PRC-L480: implemented without a new dependency (adding `semver` is out of scope).
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
  if (a.prerelease && b.prerelease) return comparePrerelease(a.prerelease, b.prerelease);
  return 0;
}

/**
 * Compare pre-release identifier lists per SemVer 2.0.0 §11: dot-separated
 * identifiers compared left to right; numeric identifiers compare numerically
 * and rank below alphanumeric ones; a shorter list ranks lower when all
 * preceding identifiers are equal.
 */
function comparePrerelease(a: string, b: string): -1 | 0 | 1 {
  const left = a.split('.');
  const right = b.split('.');
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) {
    const x = left[i];
    const y = right[i];
    if (x === undefined) return -1;
    if (y === undefined) return 1;
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      const diff = Number(x) - Number(y);
      if (diff !== 0) return diff < 0 ? -1 : 1;
      continue;
    }
    if (xNumeric) return -1;
    if (yNumeric) return 1;
    if (x !== y) return x < y ? -1 : 1;
  }
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

/** A possibly partial version: `null` components are wildcards ("1.x", "1.2", "*"). */
interface PartialVersion {
  major: number | null;
  minor: number | null;
  patch: number | null;
  prerelease: string | null;
}

/**
 * Parse a full, partial or x-range version ("1.2.3", "1.2", "1", "1.x", "1.2.*", "*").
 * Once a component is a wildcard, every later component is a wildcard too.
 */
function parsePartial(input: string): PartialVersion | null {
  const match = input
    .trim()
    .match(/^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([a-zA-Z0-9.]+))?$/);
  if (!match) return null;
  const parts: Array<number | null> = [];
  let wildcard = false;
  for (const raw of [match[1], match[2], match[3]]) {
    if (wildcard || raw === undefined || /^[xX*]$/.test(raw)) {
      wildcard = true;
      parts.push(null);
    } else {
      parts.push(parseInt(raw, 10));
    }
  }
  const [major, minor, patch] = parts as [number | null, number | null, number | null];
  // A pre-release tag only makes sense on a full version.
  if (match[4] && patch === null) return null;
  return { major, minor, patch, prerelease: match[4] ?? null };
}

function formatVersion(major: number, minor: number, patch: number, prerelease?: string | null) {
  return `${major}.${minor}.${patch}${prerelease ? `-${prerelease}` : ''}`;
}

/** Comparators for an x-range / partial version with an optional operator. */
function expandPartial(operator: string, v: PartialVersion): string[] {
  if (v.major !== null && v.minor !== null && v.patch !== null) {
    return [`${operator || '='}${formatVersion(v.major, v.minor, v.patch, v.prerelease)}`];
  }
  const major = v.major;
  const minor = v.minor;
  switch (operator) {
    case '>':
      if (major === null) return ['<0.0.0'];
      if (minor === null) return [`>=${major + 1}.0.0`];
      return [`>=${major}.${minor + 1}.0`];
    case '>=':
      if (major === null) return [];
      return [`>=${major}.${minor ?? 0}.0`];
    case '<':
      if (major === null) return ['<0.0.0'];
      return [`<${major}.${minor ?? 0}.0`];
    case '<=':
      if (major === null) return [];
      if (minor === null) return [`<${major + 1}.0.0`];
      return [`<${major}.${minor + 1}.0`];
    default:
      // No operator or "=": the x-range itself.
      if (major === null) return [];
      if (minor === null) return [`>=${major}.0.0`, `<${major + 1}.0.0`];
      return [`>=${major}.${minor}.0`, `<${major}.${minor + 1}.0`];
  }
}

/** Comparators for a caret range, including partial targets ("^1.x", "^0.2"). */
function expandCaretPartial(v: PartialVersion): string[] {
  if (v.major !== null && v.minor !== null && v.patch !== null) {
    const full: SemverParts = {
      major: v.major,
      minor: v.minor,
      patch: v.patch,
      prerelease: v.prerelease,
    };
    const [lower, upper] = expandCaret(full);
    return [
      v.prerelease ? `>=${formatVersion(v.major, v.minor, v.patch, v.prerelease)}` : lower!,
      upper!,
    ];
  }
  if (v.major === null) return [];
  if (v.minor === null) return [`>=${v.major}.0.0`, `<${v.major + 1}.0.0`];
  if (v.major > 0) return [`>=${v.major}.${v.minor}.0`, `<${v.major + 1}.0.0`];
  return [`>=0.${v.minor}.0`, `<0.${v.minor + 1}.0`];
}

/** Comparators for a tilde range, including partial targets ("~1", "~1.2"). */
function expandTildePartial(v: PartialVersion): string[] {
  if (v.major !== null && v.minor !== null && v.patch !== null) {
    const [lower, upper] = expandTilde({
      major: v.major,
      minor: v.minor,
      patch: v.patch,
      prerelease: v.prerelease,
    });
    return [
      v.prerelease ? `>=${formatVersion(v.major, v.minor, v.patch, v.prerelease)}` : lower!,
      upper!,
    ];
  }
  if (v.major === null) return [];
  if (v.minor === null) return [`>=${v.major}.0.0`, `<${v.major + 1}.0.0`];
  return [`>=${v.major}.${v.minor}.0`, `<${v.major}.${v.minor + 1}.0`];
}

/** Expand one whitespace-free token ("^1.2.3", ">=1.0.0", "1.x", "*") into comparators. */
function expandToken(token: string): string[] | null {
  if (token === '' || token === '*') return [];
  if (token.startsWith('^') || token.startsWith('~')) {
    const target = parsePartial(token.slice(1));
    if (!target) return null;
    return token.startsWith('^') ? expandCaretPartial(target) : expandTildePartial(target);
  }
  const match = token.match(/^(>=|<=|>|<|=)?(.+)$/);
  if (!match) return null;
  const target = parsePartial(match[2]!);
  if (!target) return null;
  return expandPartial(match[1] ?? '', target);
}

/** Expand a hyphen range "A - B" (inclusive) into comparators. */
function expandHyphen(lowerStr: string, upperStr: string): string[] | null {
  const lower = parsePartial(lowerStr);
  const upper = parsePartial(upperStr);
  if (!lower || !upper) return null;
  const comparators: string[] = [];
  if (lower.major !== null) {
    comparators.push(
      `>=${formatVersion(lower.major, lower.minor ?? 0, lower.patch ?? 0, lower.prerelease)}`,
    );
  }
  if (upper.major !== null) {
    if (upper.minor === null) comparators.push(`<${upper.major + 1}.0.0`);
    else if (upper.patch === null) comparators.push(`<${upper.major}.${upper.minor + 1}.0`);
    else
      comparators.push(
        `<=${formatVersion(upper.major, upper.minor, upper.patch, upper.prerelease)}`,
      );
  }
  return comparators;
}

/** Expand one `||` alternative into an AND-list of comparators, or null when unparseable. */
function expandComparatorSet(alternative: string): string[] | null {
  // ">= 1.2.3" → ">=1.2.3", "^ 1.2" → "^1.2"
  const normalised = alternative.trim().replace(/([<>]=?|=|\^|~)\s+/g, '$1');
  const hyphen = normalised.match(/^(\S+)\s+-\s+(\S+)$/);
  if (hyphen) return expandHyphen(hyphen[1]!, hyphen[2]!);
  const comparators: string[] = [];
  for (const token of normalised.split(/\s+/)) {
    const expanded = expandToken(token);
    if (!expanded) return null;
    comparators.push(...expanded);
  }
  return comparators;
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
  // Union (OR logic): "^1.0.0 || ^2.0.0"
  const alternatives = range.split('||');
  // A union with an empty side ("1.0.0 ||") is malformed; do not let it widen to "*".
  if (alternatives.length > 1 && alternatives.some((alternative) => alternative.trim() === '')) {
    return false;
  }
  return alternatives.some((alternative) => {
    const comparators = expandComparatorSet(alternative);
    if (!comparators) return false;
    // Space-separated comparators (AND logic): ">=1.0.0 <2.0.0"
    return comparators.every((c) => satisfiesComparator(version, c));
  });
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
