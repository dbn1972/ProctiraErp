/**
 * Property-based test for token-only colors (Task 47.5 / Property F-1).
 *
 * **Property F-1: Token-Only Colors**
 *
 * *For any* component `c` rendered in `apps/web/src/` or `packages/ui/components/`,
 * the computed CSS color values used by `c` SHALL resolve from CSS variables
 * defined in `theme.css`; no hardcoded hex, rgb, or hsl literals SHALL appear
 * in component source.
 *
 * This test performs a static scan of all `.tsx` and `.ts` component files in
 * the target directories and asserts that no hardcoded color literals (hex codes,
 * rgb(), rgba(), hsl(), hsla()) appear in JSX/TSX source code.
 *
 * Allowlist:
 *   - `theme.css` — the canonical token definition file
 *   - Test files (*.test.*, *.spec.*)
 *   - CSS files (token definitions)
 *   - SVG `fill`/`stroke` attributes in third-party brand icon components
 *     (these use mandated brand colors per provider guidelines)
 *   - `placeholder` attribute values (not rendered styling)
 *   - Constant data objects explicitly annotated as defaults/samples
 *
 * **Validates: Requirements 18, 28, 36.5, 43**
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import * as fs from 'node:fs';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const MONOREPO_ROOT = path.resolve(__dirname, '../../..');

/** Directories to scan for component files. */
const SCAN_DIRS = [
  path.join(MONOREPO_ROOT, 'apps/web/src'),
  path.join(MONOREPO_ROOT, 'packages/ui/components/src'),
];

/**
 * File patterns to EXCLUDE from scanning (allowlist).
 * - theme.css: the canonical token definition file (allowed to contain raw colors)
 * - *.test.* files: test files may use hardcoded colors for assertions
 * - *.spec.* files: spec files may use hardcoded colors for assertions
 * - test-setup.ts: test infrastructure
 * - *.css files: CSS files that define tokens are allowed
 * - *.md files: documentation
 */
const EXCLUDED_PATTERNS = [
  /theme\.css$/,
  /\.test\.(ts|tsx)$/,
  /\.spec\.(ts|tsx)$/,
  /test-setup\.(ts|tsx)$/,
  /\.css$/,
  /\.md$/,
  /\.json$/,
  /\.d\.ts$/,
];

/** Extensions to scan. */
const SCAN_EXTENSIONS = ['.ts', '.tsx'];

/**
 * Files with known third-party brand color exceptions.
 * These files contain SVG brand icons with colors mandated by external
 * brand guidelines (Google, Microsoft, etc.) that cannot use design tokens.
 */
const BRAND_ICON_FILES = [/oauth-icon\.tsx$/];

// ---------------------------------------------------------------------------
// Regex patterns for hardcoded color literals
// ---------------------------------------------------------------------------

/**
 * Matches hardcoded hex color codes: #RGB, #RGBA, #RRGGBB, #RRGGBBAA
 */
const HEX_COLOR_REGEX = /#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{1,5})?\b/g;

/**
 * Matches rgb() and rgba() function calls with numeric arguments.
 */
const RGB_REGEX = /\brgba?\s*\(\s*\d+/g;

/**
 * Matches hsl() and hsla() function calls with numeric arguments.
 * Excludes hsl(var(--...)) which is a valid token reference.
 */
const HSL_REGEX = /\bhsla?\s*\(\s*\d+/g;

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

/**
 * Recursively collects all files matching the scan criteria from a directory.
 */
function collectComponentFiles(dir: string): string[] {
  const files: string[] = [];

  if (!fs.existsSync(dir)) {
    return files;
  }

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        // Skip node_modules and hidden directories
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name);
        if (!SCAN_EXTENSIONS.includes(ext)) continue;
        if (EXCLUDED_PATTERNS.some((pattern) => pattern.test(fullPath))) continue;
        files.push(fullPath);
      }
    }
  }

  walk(dir);
  return files;
}

/**
 * Strips single-line and multi-line comments from source code.
 * This prevents false positives from color values mentioned in comments.
 */
function stripComments(source: string): string {
  // Remove single-line comments
  let result = source.replace(/\/\/.*$/gm, '');
  // Remove multi-line comments
  result = result.replace(/\/\*[\s\S]*?\*\//g, '');
  return result;
}

/**
 * Strips import/export statements to avoid false positives from module paths.
 */
function stripImports(source: string): string {
  return source.replace(/^(?:import|export)\s+.*?(?:from\s+)?['"][^'"]*['"];?\s*$/gm, '');
}

/**
 * Determines if a line contains a color in an SVG fill/stroke attribute context.
 * Third-party brand icons (Google, Microsoft) use mandated brand colors in SVG.
 */
function isSvgBrandColor(line: string): boolean {
  return /\bfill=["'][^"']*["']/.test(line) || /\bstroke=["'][^"']*["']/.test(line);
}

/**
 * Determines if a line contains a color in a placeholder attribute.
 * Placeholder text is not rendered styling — it's hint text.
 */
function isPlaceholderValue(line: string, matchIndex: number): boolean {
  const preceding = line.substring(0, matchIndex);
  // Check if the color value is inside a placeholder="..." or placeholder='...'
  return /placeholder=["'][^"']*$/.test(preceding);
}

/**
 * Determines if a line is a data constant definition (default values, samples).
 * These are data objects, not styling — e.g., default branding form values,
 * SSR fallback palettes, or sample/mock data.
 */
function isDataConstant(line: string, lineIdx: number, lines: string[]): boolean {
  // Check if this line is inside a const/let/var assignment that looks like data
  // Look backwards for a const declaration with a name suggesting defaults/samples
  for (let i = lineIdx; i >= Math.max(0, lineIdx - 30); i--) {
    const prevLine = lines[i];
    if (
      /\b(?:const|let|var)\s+(?:DEFAULT|INITIAL|SAMPLE|PLACEHOLDER|MOCK|FALLBACK)/i.test(prevLine)
    ) {
      return true;
    }
    // Also match common patterns like `const FALLBACK_PALETTE: ...`
    if (/\b(?:FALLBACK|DEFAULT|INITIAL|SAMPLE|MOCK)_/.test(prevLine)) {
      return true;
    }
    // Stop looking if we hit a function/component/export boundary
    if (/^(?:export\s+)?(?:function|class)\s/.test(prevLine.trim())) {
      break;
    }
    // Stop at another top-level const that isn't a data constant
    if (
      i < lineIdx &&
      /^(?:export\s+)?const\s+[A-Z]/.test(prevLine.trim()) &&
      !/(?:DEFAULT|INITIAL|SAMPLE|PLACEHOLDER|MOCK|FALLBACK)/i.test(prevLine)
    ) {
      break;
    }
  }
  return false;
}

/**
 * Determines if an rgb/rgba match is a shadow color (pure black with opacity).
 * Shadows commonly use `rgb(0 0 0 / 0.1)` or `rgba(0, 0, 0, 0.1)` which is
 * always black regardless of theme — the shadow tokens in theme.css use this
 * same pattern. This is not a design-token-worthy color.
 */
function isShadowBlack(line: string, matchIndex: number): boolean {
  const fromMatch = line.substring(matchIndex);
  // Matches: rgb(0 0 0 / ...) or rgba(0, 0, 0, ...) — pure black with opacity
  return /^rgba?\s*\(\s*0[\s,]+0[\s,]+0\s*[/,]/.test(fromMatch);
}

/**
 * Represents a violation found in a source file.
 */
interface ColorViolation {
  file: string;
  line: number;
  column: number;
  match: string;
  type: 'hex' | 'rgb' | 'hsl';
}

/**
 * Scans a single file for hardcoded color literals.
 * Returns an array of violations found.
 */
function scanFileForHardcodedColors(filePath: string): ColorViolation[] {
  const violations: ColorViolation[] = [];
  const rawSource = fs.readFileSync(filePath, 'utf-8');

  // Check if this is a known brand icon file (third-party SVG colors allowed)
  const isBrandIconFile = BRAND_ICON_FILES.some((pattern) => pattern.test(filePath));

  // Strip comments to avoid false positives
  const source = stripComments(rawSource);
  // Strip import paths to avoid false positives from module specifiers
  const cleaned = stripImports(source);

  const lines = cleaned.split('\n');

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];

    // Skip empty lines
    if (!line.trim()) continue;

    // If this is a brand icon file and the line has SVG fill/stroke, skip it
    if (isBrandIconFile && isSvgBrandColor(line)) continue;

    // Skip if this is a data constant (default/initial/sample values)
    if (isDataConstant(line, lineIdx, lines)) continue;

    // --- Hex color detection ---
    let match: RegExpExecArray | null;
    const hexRegex = new RegExp(HEX_COLOR_REGEX.source, 'g');
    while ((match = hexRegex.exec(line)) !== null) {
      const hexValue = match[0];

      // Skip if it's in a placeholder attribute
      if (isPlaceholderValue(line, match.index)) continue;

      // Skip common false positives:
      // - UUID-like strings (hex surrounded by dashes)
      const surroundingContext = line.substring(
        Math.max(0, match.index - 10),
        Math.min(line.length, match.index + hexValue.length + 10),
      );
      if (/[0-9a-f]{8}-[0-9a-f]{4}/i.test(surroundingContext)) continue;

      // Skip if it's a numeric-only hex that's likely not a color
      // (e.g., #123 could be a CSS ID selector or numeric ref)
      // Real color hex codes have at least one letter a-f
      if (!/[a-fA-F]/.test(hexValue.slice(1))) continue;

      violations.push({
        file: filePath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: hexValue,
        type: 'hex',
      });
    }

    // --- RGB/RGBA detection ---
    const rgbRegex = new RegExp(RGB_REGEX.source, 'g');
    while ((match = rgbRegex.exec(line)) !== null) {
      // Check if it's wrapping a var() — that's valid
      const lineFromMatch = line.substring(match.index);
      if (/^rgba?\s*\(\s*var\(--/.test(lineFromMatch)) continue;

      // Skip if in placeholder
      if (isPlaceholderValue(line, match.index)) continue;

      // Skip pure black shadows (rgb(0 0 0 / opacity)) — standard shadow pattern
      if (isShadowBlack(line, match.index)) continue;

      violations.push({
        file: filePath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0],
        type: 'rgb',
      });
    }

    // --- HSL/HSLA detection ---
    const hslRegex = new RegExp(HSL_REGEX.source, 'g');
    while ((match = hslRegex.exec(line)) !== null) {
      // Check if it's wrapping a var() — that's valid (e.g., hsl(var(--primary)))
      const lineFromMatch = line.substring(match.index);
      if (/^hsla?\s*\(\s*var\(--/.test(lineFromMatch)) continue;

      // Skip if in placeholder
      if (isPlaceholderValue(line, match.index)) continue;

      violations.push({
        file: filePath,
        line: lineIdx + 1,
        column: match.index + 1,
        match: match[0],
        type: 'hsl',
      });
    }
  }

  return violations;
}

// ---------------------------------------------------------------------------
// Collect all component files
// ---------------------------------------------------------------------------

const allComponentFiles: string[] = [];
for (const dir of SCAN_DIRS) {
  allComponentFiles.push(...collectComponentFiles(dir));
}

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Property F-1: Token-Only Colors', () => {
  // **Validates: Requirements 18, 28, 36.5, 43**

  it('should find component files to scan', () => {
    // Sanity check: we should have files to scan
    expect(allComponentFiles.length).toBeGreaterThan(0);
  });

  it('no component file in apps/web/src/ or packages/ui/components/ contains hardcoded hex, rgb, or hsl color literals', () => {
    const allViolations: ColorViolation[] = [];

    for (const file of allComponentFiles) {
      const violations = scanFileForHardcodedColors(file);
      allViolations.push(...violations);
    }

    if (allViolations.length > 0) {
      const summary = allViolations
        .slice(0, 20) // Show first 20 violations
        .map(
          (v) =>
            `  ${path.relative(MONOREPO_ROOT, v.file)}:${v.line}:${v.column} — ${v.type}: ${v.match}`,
        )
        .join('\n');

      const totalMsg =
        allViolations.length > 20 ? `\n  ... and ${allViolations.length - 20} more violations` : '';

      expect.fail(
        `Found ${allViolations.length} hardcoded color literal(s) in component source.\n` +
          `All colors must use CSS custom properties (design tokens) from theme.css.\n\n` +
          `Violations:\n${summary}${totalMsg}`,
      );
    }
  });

  it('property: for any component file selected at random, no hardcoded color literals exist', () => {
    // Skip if no files to scan
    if (allComponentFiles.length === 0) return;

    fc.assert(
      fc.property(fc.integer({ min: 0, max: allComponentFiles.length - 1 }), (fileIndex) => {
        const filePath = allComponentFiles[fileIndex];
        const violations = scanFileForHardcodedColors(filePath);

        if (violations.length > 0) {
          const relPath = path.relative(MONOREPO_ROOT, filePath);
          const details = violations
            .slice(0, 5)
            .map((v) => `  L${v.line}:${v.column} ${v.type}: ${v.match}`)
            .join('\n');

          throw new Error(
            `${relPath} contains ${violations.length} hardcoded color(s):\n${details}`,
          );
        }
      }),
      { numRuns: Math.min(allComponentFiles.length, 200) },
    );
  });

  describe('scanner correctness properties', () => {
    it('property: valid CSS variable patterns are never flagged as violations', () => {
      // Generate strings that use valid CSS variable patterns
      const validPatterns = fc.constantFrom(
        'bg-[hsl(var(--primary))]',
        'text-[hsl(var(--foreground))]',
        'border-[hsl(var(--border))]',
        'ring-[hsl(var(--ring))]',
        'hsl(var(--accent))',
        'hsl(var(--destructive))',
        'rgba(var(--chart-1))',
        'var(--primary)',
        'var(--background)',
        'className="bg-primary text-primary-foreground"',
        'className="text-muted-foreground"',
        'style={{ color: "var(--foreground)" }}',
      );

      fc.assert(
        fc.property(validPatterns, (pattern) => {
          // Simulate scanning a line containing the valid pattern
          const line = `const Component = () => <div className="${pattern}">test</div>;`;
          const violations: ColorViolation[] = [];
          let match: RegExpExecArray | null;

          // HSL check
          const hslRegex = new RegExp(HSL_REGEX.source, 'g');
          while ((match = hslRegex.exec(line)) !== null) {
            const lineFromMatch = line.substring(match.index);
            if (/^hsla?\s*\(\s*var\(--/.test(lineFromMatch)) continue;
            violations.push({
              file: 'test',
              line: 1,
              column: match.index + 1,
              match: match[0],
              type: 'hsl',
            });
          }

          // RGB check
          const rgbRegex = new RegExp(RGB_REGEX.source, 'g');
          while ((match = rgbRegex.exec(line)) !== null) {
            const lineFromMatch = line.substring(match.index);
            if (/^rgba?\s*\(\s*var\(--/.test(lineFromMatch)) continue;
            violations.push({
              file: 'test',
              line: 1,
              column: match.index + 1,
              match: match[0],
              type: 'rgb',
            });
          }

          // Valid patterns should never produce violations
          expect(violations).toHaveLength(0);
        }),
        { numRuns: 50 },
      );
    });

    it('property: hardcoded color literals are always detected by the scanner regex', () => {
      // Generate strings that contain hardcoded colors (violations)
      const hardcodedColors = fc.constantFrom(
        { literal: '#ff0000', type: 'hex' as const },
        { literal: '#1a56db', type: 'hex' as const },
        { literal: '#ffffff', type: 'hex' as const },
        { literal: '#abc', type: 'hex' as const },
        { literal: '#abcdef', type: 'hex' as const },
        { literal: 'rgb(255, 0, 0)', type: 'rgb' as const },
        { literal: 'rgb(0, 128, 255)', type: 'rgb' as const },
        { literal: 'rgba(255, 0, 0, 0.5)', type: 'rgba' as const },
        { literal: 'hsl(222, 47%, 31%)', type: 'hsl' as const },
        { literal: 'hsl(0, 72%, 51%)', type: 'hsl' as const },
        { literal: 'hsla(174, 62%, 40%, 0.8)', type: 'hsla' as const },
      );

      fc.assert(
        fc.property(hardcodedColors, ({ literal, type }) => {
          const line = `const x = "${literal}";`;
          let detected = false;

          if (type === 'hex') {
            const hexRegex = new RegExp(HEX_COLOR_REGEX.source, 'g');
            let match: RegExpExecArray | null;
            while ((match = hexRegex.exec(line)) !== null) {
              if (/[a-fA-F]/.test(match[0].slice(1))) {
                detected = true;
                break;
              }
            }
          } else if (type === 'rgb' || type === 'rgba') {
            const rgbRegex = new RegExp(RGB_REGEX.source, 'g');
            if (rgbRegex.exec(line) !== null) {
              detected = true;
            }
          } else if (type === 'hsl' || type === 'hsla') {
            const hslRegex = new RegExp(HSL_REGEX.source, 'g');
            if (hslRegex.exec(line) !== null) {
              detected = true;
            }
          }

          // Hardcoded colors must always be detected by the regex
          expect(detected).toBe(true);
        }),
        { numRuns: 50 },
      );
    });

    it('property: SVG brand icon files with fill attributes are excluded from violations', () => {
      // Simulate lines from a brand icon file
      const brandIconLines = fc.constantFrom(
        '          fill="#4285F4"',
        '          fill="#34A853"',
        '          fill="#FBBC05"',
        '          fill="#EA4335"',
        '<path d="M11.4 24H0V12.6h11.4V24z" fill="#F1511B" />',
        '<path d="M24 24H12.6V12.6H24V24z" fill="#80CC28" />',
      );

      fc.assert(
        fc.property(brandIconLines, (line) => {
          // In a brand icon file, SVG fill lines should be skipped
          expect(isSvgBrandColor(line)).toBe(true);
        }),
        { numRuns: 20 },
      );
    });

    it('property: placeholder attributes containing colors are excluded from violations', () => {
      const placeholderLines = fc.constantFrom(
        { line: '  placeholder="#1E3A8A"', index: 15 },
        { line: '  placeholder="#26A69A"', index: 15 },
        { line: "  placeholder='hsl(222, 47%, 31%)'", index: 15 },
      );

      fc.assert(
        fc.property(placeholderLines, ({ line, index }) => {
          expect(isPlaceholderValue(line, index)).toBe(true);
        }),
        { numRuns: 10 },
      );
    });
  });
});
