/**
 * Property F-3: RTL Safety
 *
 * For any component layout `l` shipped in `packages/ui/components/` or
 * `apps/web/src/`, `l` SHALL use logical CSS properties (margin-inline-start,
 * padding-inline-end, inset-inline-*) and SHALL contain no physical
 * `margin-left`/`margin-right`/`padding-left`/`padding-right`/`left`/`right`/
 * `border-left`/`border-right` declarations in component-authored styles.
 *
 * This property test performs a static scan of all source files in the target
 * directories and asserts that no file contains physical-axis CSS properties.
 * It checks:
 *   - Raw CSS declarations (margin-left:, padding-right:, etc.)
 *   - Tailwind physical-axis utility classes (ml-, mr-, pl-, pr-, left-, right-,
 *     border-l-, border-r-)
 *   - Inline style objects with camelCase physical properties (marginLeft, etc.)
 *
 * An allowlist exempts third-party shadcn/ui primitives whose animation/
 * positioning patterns use physical properties by necessity (e.g., Sheet slide
 * directions, Tooltip placement, DropdownMenu indicator positioning). These are
 * not "component-authored" styles — they are inherited from Radix UI patterns.
 *
 * **Validates: Requirements 18.4, 18.10**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';

// ─── Constants ───────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '../../../../..');
const SCAN_DIRS = [
  resolve(REPO_ROOT, 'apps/web/src'),
  resolve(REPO_ROOT, 'packages/ui/components/src'),
];

/** File extensions to scan for physical-axis CSS properties */
const SCANNABLE_EXTENSIONS = ['.ts', '.tsx', '.css', '.scss', '.module.css'];

/**
 * Files that are explicitly allowed to contain physical-axis properties.
 * These are third-party shadcn/ui primitives whose animation/positioning
 * patterns inherently use physical directions (slide-in-from-left, etc.)
 * and are not "component-authored" styles per the design spec.
 *
 * Paths are relative to the repo root.
 */
const ALLOWLISTED_FILES = new Set([
  // shadcn/ui Sheet uses physical slide directions for left/right panels
  'packages/ui/components/src/Sheet.tsx',
  // shadcn/ui Tooltip uses data-[side=left/right] for placement animations
  'packages/ui/components/src/Tooltip.tsx',
  // shadcn/ui ScrollArea uses border-l for scrollbar styling
  'packages/ui/components/src/ScrollArea.tsx',
  // shadcn/ui DropdownMenu uses absolute left positioning for check indicators
  'packages/ui/components/src/DropdownMenu.tsx',
]);

// ─── Physical-axis CSS property patterns ─────────────────────────────────────

/**
 * Regex patterns that detect physical-axis CSS properties in different contexts.
 *
 * CSS declarations: `margin-left:`, `padding-right:`, `left:`, `right:`,
 *   `border-left:`, `border-right:`
 *
 * Tailwind utility classes: `ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`,
 *   `border-l-`, `border-r-`, `border-l ` (border-l without size suffix)
 *
 * Inline style objects: `marginLeft`, `marginRight`, `paddingLeft`,
 *   `paddingRight`, `borderLeft`, `borderRight`
 */

/** CSS declaration patterns (used in .css files and style strings) */
const CSS_PHYSICAL_PROPS = /(?:^|[;\s{])(?:margin-left|margin-right|padding-left|padding-right|border-left|border-right)\s*:/gm;

/**
 * Standalone `left:` and `right:` in CSS — these are positional properties.
 * We need to be careful not to match `text-align: left` or `float: left`.
 * Only match when `left` or `right` appears as a property name (after ; or {).
 */
const CSS_POSITION_PROPS = /(?:^|[;\s{])(?:left|right)\s*:/gm;

/**
 * Tailwind physical-axis utility classes.
 * Matches: ml-{n}, mr-{n}, pl-{n}, pr-{n}, left-{n}, right-{n},
 *          border-l-{n}, border-r-{n}, border-l , border-r
 *
 * Uses word boundary or class-name boundary (space, quote, backtick) to avoid
 * false positives like `slide-in-from-left` (which is an animation, not layout).
 *
 * Negative lookbehind excludes Tailwind animation classes:
 *   - slide-in-from-left, slide-out-to-left, slide-in-from-right, slide-out-to-right
 *   - data-[side=left], data-[side=right] (Radix placement attributes)
 *   - data-[state=closed]:slide-out-to-left (animation state classes)
 */
const TAILWIND_PHYSICAL_CLASSES = /(?<![a-z-])(?:ml|mr|pl|pr)-(?:\[.*?\]|\d+(?:\/\d+)?(?:\.\d+)?)/g;
const TAILWIND_LEFT_RIGHT = /(?<![a-z-])(?:left|right)-(?:\[.*?\]|\d+(?:\/\d+)?(?:\.\d+)?)/g;
const TAILWIND_BORDER_LR = /(?<![a-z-])border-(?:l|r)(?:-(?:\[.*?\]|\d+)|(?=\s|"|'|`|$))/g;

/** Inline style object camelCase physical properties */
const INLINE_STYLE_PHYSICAL = /\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderLeft|borderRight)\b/g;

// ─── File Discovery ──────────────────────────────────────────────────────────

/**
 * Recursively collects all scannable source files from the target directories.
 */
function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];

  function walk(currentDir: string) {
    let entries: string[];
    try {
      entries = readdirSync(currentDir);
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(currentDir, entry);

      // Skip node_modules, .next, dist, and test files
      if (
        entry === 'node_modules' ||
        entry === '.next' ||
        entry === 'dist' ||
        entry === '__tests__'
      ) {
        continue;
      }

      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }

      if (stat.isDirectory()) {
        walk(fullPath);
      } else if (stat.isFile()) {
        const ext = entry.slice(entry.lastIndexOf('.'));
        if (SCANNABLE_EXTENSIONS.includes(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Checks whether a file is in the allowlist (third-party shadcn/ui primitives).
 */
function isAllowlisted(filePath: string): boolean {
  const rel = relative(REPO_ROOT, filePath).replace(/\\/g, '/');
  return ALLOWLISTED_FILES.has(rel);
}

/**
 * Represents a physical-axis CSS violation found in a source file.
 */
interface Violation {
  file: string;
  line: number;
  column: number;
  match: string;
  type: 'css-declaration' | 'tailwind-class' | 'inline-style' | 'css-position';
}

/**
 * Scans a single file for physical-axis CSS property violations.
 * Returns an array of violations found.
 */
function scanFileForViolations(filePath: string): Violation[] {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const violations: Violation[] = [];
  const relPath = relative(REPO_ROOT, filePath).replace(/\\/g, '/');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx]!;

    // Skip comment lines (single-line JS/TS comments and CSS comments)
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) {
      continue;
    }

    // Check CSS declaration physical properties
    let match: RegExpExecArray | null;
    const cssPropsRegex = new RegExp(CSS_PHYSICAL_PROPS.source, 'gm');
    while ((match = cssPropsRegex.exec(line)) !== null) {
      violations.push({
        file: relPath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0].trim(),
        type: 'css-declaration',
      });
    }

    // Check CSS positional properties (left:, right:) only in .css files
    if (filePath.endsWith('.css') || filePath.endsWith('.scss')) {
      const posPropsRegex = new RegExp(CSS_POSITION_PROPS.source, 'gm');
      while ((match = posPropsRegex.exec(line)) !== null) {
        violations.push({
          file: relPath,
          line: lineIdx + 1,
          column: match.index + 1,
          match: match[0].trim(),
          type: 'css-position',
        });
      }
    }

    // Check Tailwind physical-axis utility classes
    const twPhysicalRegex = new RegExp(TAILWIND_PHYSICAL_CLASSES.source, 'g');
    while ((match = twPhysicalRegex.exec(line)) !== null) {
      // Skip if inside a Tailwind animation class (slide-in-from-*, slide-out-to-*)
      const before = line.slice(0, match.index);
      if (/(?:slide-(?:in-from|out-to)-|from-|to-)$/.test(before)) {
        continue;
      }
      violations.push({
        file: relPath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0],
        type: 'tailwind-class',
      });
    }

    // Check Tailwind left-/right- positioning classes
    const twLRRegex = new RegExp(TAILWIND_LEFT_RIGHT.source, 'g');
    while ((match = twLRRegex.exec(line)) !== null) {
      // Skip animation classes
      const before = line.slice(0, match.index);
      if (/(?:slide-(?:in-from|out-to)-|from-|to-)$/.test(before)) {
        continue;
      }
      violations.push({
        file: relPath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0],
        type: 'tailwind-class',
      });
    }

    // Check Tailwind border-l/border-r classes
    const twBorderRegex = new RegExp(TAILWIND_BORDER_LR.source, 'g');
    while ((match = twBorderRegex.exec(line)) !== null) {
      violations.push({
        file: relPath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0],
        type: 'tailwind-class',
      });
    }

    // Check inline style camelCase physical properties
    const inlineRegex = new RegExp(INLINE_STYLE_PHYSICAL.source, 'g');
    while ((match = inlineRegex.exec(line)) !== null) {
      violations.push({
        file: relPath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0],
        type: 'inline-style',
      });
    }
  }

  return violations;
}

// ─── Collect all files ───────────────────────────────────────────────────────

const allSourceFiles: string[] = [];
for (const dir of SCAN_DIRS) {
  allSourceFiles.push(...collectSourceFiles(dir));
}

/** Non-allowlisted source files that must pass the RTL safety check */
const scannableFiles = allSourceFiles.filter((f) => !isAllowlisted(f));

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Property F-3: RTL Safety', () => {
  it('no component-authored source file uses physical-axis CSS properties (random sampling)', () => {
    // Skip if no files to scan (shouldn't happen in a real project)
    if (scannableFiles.length === 0) {
      return;
    }

    const fileArb = fc.constantFrom(...scannableFiles);

    fc.assert(
      fc.property(fileArb, (filePath) => {
        const violations = scanFileForViolations(filePath);

        if (violations.length > 0) {
          const summary = violations
            .map(
              (v) =>
                `  ${v.file}:${v.line}:${v.column} — ${v.type}: "${v.match}"`,
            )
            .join('\n');

          // Fail with a descriptive message showing all violations in this file
          expect(
            violations.length,
            `Physical-axis CSS violations found (use logical properties instead):\n${summary}\n\n` +
              `Replace with logical equivalents:\n` +
              `  margin-left → margin-inline-start (ms-*)\n` +
              `  margin-right → margin-inline-end (me-*)\n` +
              `  padding-left → padding-inline-start (ps-*)\n` +
              `  padding-right → padding-inline-end (pe-*)\n` +
              `  left → inset-inline-start (start-*)\n` +
              `  right → inset-inline-end (end-*)\n` +
              `  border-left → border-inline-start (border-s-*)\n` +
              `  border-right → border-inline-end (border-e-*)\n` +
              `  ml-* → ms-*\n` +
              `  mr-* → me-*\n` +
              `  pl-* → ps-*\n` +
              `  pr-* → pe-*\n`,
          ).toBe(0);
        }
      }),
      { numRuns: Math.min(scannableFiles.length, 500) },
    );
  });

  it('exhaustive scan: ALL non-allowlisted files are free of physical-axis CSS properties', () => {
    const allViolations: Violation[] = [];

    for (const filePath of scannableFiles) {
      const violations = scanFileForViolations(filePath);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const grouped = new Map<string, Violation[]>();
      for (const v of allViolations) {
        const existing = grouped.get(v.file) || [];
        existing.push(v);
        grouped.set(v.file, existing);
      }

      const summary = [...grouped.entries()]
        .map(
          ([file, violations]) =>
            `\n  ${file} (${violations.length} violation${violations.length > 1 ? 's' : ''}):\n` +
            violations
              .map(
                (v) =>
                  `    L${v.line}:${v.column} — ${v.type}: "${v.match}"`,
              )
              .join('\n'),
        )
        .join('');

      expect(
        allViolations.length,
        `Physical-axis CSS violations found in ${grouped.size} file(s):${summary}\n\n` +
          `Use logical CSS properties for RTL safety (Requirement 18.10).`,
      ).toBe(0);
    }
  });

  it('allowlisted files are limited to known shadcn/ui primitives', () => {
    // Verify that the allowlist only contains files that actually exist
    // and are genuinely third-party shadcn/ui primitives
    for (const allowedPath of ALLOWLISTED_FILES) {
      const fullPath = resolve(REPO_ROOT, allowedPath);
      let exists = false;
      try {
        statSync(fullPath);
        exists = true;
      } catch {
        // File doesn't exist — that's fine, it may not have been created yet
      }

      if (exists) {
        // Verify it's in packages/ui/components (shadcn/ui primitives only)
        expect(
          allowedPath.startsWith('packages/ui/components/'),
          `Allowlisted file "${allowedPath}" must be in packages/ui/components/ (shadcn/ui primitives only)`,
        ).toBe(true);
      }
    }
  });
});
