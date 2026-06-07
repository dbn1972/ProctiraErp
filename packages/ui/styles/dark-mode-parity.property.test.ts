/**
 * Property Test: Dark Mode Parity (Property F-2)
 *
 * Validates: Requirements 36.5, 36.6, 37.2, 37.8
 *
 * Property: For every CSS custom property (design token) defined in the
 * light-mode block (:root, :root.light), there SHALL exist a corresponding
 * custom property with the same name in the dark-mode block (:root.dark).
 *
 * This ensures that every themed surface inverts correctly between light and
 * dark modes, preventing unstyled or broken appearances when the user toggles
 * Theme_Mode. Tokens that are structural (non-color, e.g. spacing, radius,
 * font stacks, font weights) are excluded from the parity check since they
 * are intentionally shared across modes.
 *
 * The test uses fast-check to sample arbitrary subsets of light-mode tokens
 * and verify each sampled token has a dark-mode counterpart, providing
 * shrinkable counterexamples on failure.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const themeCssPath = resolve(here, './theme.css');
const themeCss = readFileSync(themeCssPath, 'utf8');

// ---------------------------------------------------------------------------
// CSS Parsing Utilities
// ---------------------------------------------------------------------------

/**
 * Extracts the body of a CSS block by matching the selector and then
 * performing brace-counting to handle nested blocks correctly.
 */
function extractBlockBody(css: string, selectorPattern: RegExp): string {
  const match = css.match(selectorPattern);
  if (!match || match.index === undefined) return '';

  const openBrace = css.indexOf('{', match.index);
  if (openBrace === -1) return '';

  let depth = 0;
  let end = -1;
  for (let i = openBrace; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}') {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  if (end === -1) return '';
  return css.slice(openBrace + 1, end);
}

/**
 * Extracts all CSS custom property names (--*) from a CSS block body.
 * Returns a Set of property names (e.g., '--background', '--primary').
 */
function extractCustomProperties(blockBody: string): Set<string> {
  const props = new Set<string>();
  const regex = /(--[\w-]+)\s*:/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(blockBody)) !== null) {
    props.add(match[1]);
  }
  return props;
}

// ---------------------------------------------------------------------------
// Token Extraction
// ---------------------------------------------------------------------------

const lightBlockBody = extractBlockBody(themeCss, /:root\s*,\s*\n?\s*:root\.light\s*\{/);
const darkBlockBody = extractBlockBody(themeCss, /:root\.dark\s*\{/);

const lightTokens = extractCustomProperties(lightBlockBody);
const darkTokens = extractCustomProperties(darkBlockBody);

/**
 * Tokens that are structural/shared and intentionally NOT redefined in dark
 * mode because they are mode-independent (typography, spacing, radius, etc.).
 */
const STRUCTURAL_TOKEN_PREFIXES = [
  '--font-',
  '--space-',
  '--radius',
  '--tenant-logo',
  '--tenant-favicon',
];

/**
 * Individual structural tokens that don't need dark-mode counterparts.
 */
const STRUCTURAL_TOKENS = new Set([
  '--font-size',
]);

function isStructuralToken(token: string): boolean {
  if (STRUCTURAL_TOKENS.has(token)) return true;
  return STRUCTURAL_TOKEN_PREFIXES.some((prefix) => token.startsWith(prefix));
}

/**
 * Color-related tokens from the light block that MUST have dark-mode parity.
 * These are the tokens that affect visual appearance and must invert.
 */
const colorTokens = Array.from(lightTokens).filter(
  (token) => !isStructuralToken(token)
);

// ---------------------------------------------------------------------------
// Property Tests
// ---------------------------------------------------------------------------

describe('Dark Mode Parity (Property F-2)', () => {
  // Feature: proctira-unified-platform, Property F-2: Dark Mode Parity
  // **Validates: Requirements 36.5, 36.6, 37.2, 37.8**

  it('light-mode block is parseable and contains tokens', () => {
    expect(lightTokens.size).toBeGreaterThan(0);
    expect(lightBlockBody.length).toBeGreaterThan(0);
  });

  it('dark-mode block is parseable and contains tokens', () => {
    expect(darkTokens.size).toBeGreaterThan(0);
    expect(darkBlockBody.length).toBeGreaterThan(0);
  });

  it('every light-mode color token has a corresponding dark-mode token (property)', () => {
    // Precondition: we have color tokens to test
    expect(colorTokens.length).toBeGreaterThan(0);

    // Use fast-check to sample arbitrary indices into the color token array
    // and verify each sampled token exists in the dark-mode block.
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: colorTokens.length - 1 }),
        (index) => {
          const token = colorTokens[index];
          const hasDarkCounterpart = darkTokens.has(token);
          if (!hasDarkCounterpart) {
            // Return false to signal property violation with a clear message
            throw new Error(
              `Light-mode token "${token}" has no corresponding dark-mode definition in :root.dark`
            );
          }
          return true;
        }
      ),
      { numRuns: Math.min(colorTokens.length * 3, 500), verbose: true }
    );
  });

  it('every dark-mode token has a corresponding light-mode token (no orphan dark tokens)', () => {
    // Reverse check: dark tokens should not define properties that don't
    // exist in light mode (would indicate a typo or orphaned token).
    const darkColorTokens = Array.from(darkTokens).filter(
      (token) => !isStructuralToken(token)
    );

    expect(darkColorTokens.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: darkColorTokens.length - 1 }),
        (index) => {
          const token = darkColorTokens[index];
          const hasLightCounterpart = lightTokens.has(token);
          if (!hasLightCounterpart) {
            throw new Error(
              `Dark-mode token "${token}" has no corresponding light-mode definition in :root/:root.light`
            );
          }
          return true;
        }
      ),
      { numRuns: Math.min(darkColorTokens.length * 3, 500), verbose: true }
    );
  });

  it('light and dark mode define the same set of color tokens (set equality)', () => {
    // Exhaustive check: the set of color tokens in light and dark must match
    const lightColorSet = new Set(colorTokens);
    const darkColorTokens = new Set(
      Array.from(darkTokens).filter((t) => !isStructuralToken(t))
    );

    const missingInDark = Array.from(lightColorSet).filter(
      (t) => !darkColorTokens.has(t)
    );
    const missingInLight = Array.from(darkColorTokens).filter(
      (t) => !lightColorSet.has(t)
    );

    expect(missingInDark, 'Tokens defined in light but missing in dark').toEqual([]);
    expect(missingInLight, 'Tokens defined in dark but missing in light').toEqual([]);
  });

  it('both modes define all semantic mapped tokens required by shadcn/ui', () => {
    // These are the core semantic tokens that every component surface uses.
    // Missing any of these in either mode would cause visual breakage.
    const requiredSemanticTokens = [
      '--background',
      '--foreground',
      '--card',
      '--card-foreground',
      '--popover',
      '--popover-foreground',
      '--primary',
      '--primary-foreground',
      '--secondary',
      '--secondary-foreground',
      '--muted',
      '--muted-foreground',
      '--accent',
      '--accent-foreground',
      '--destructive',
      '--destructive-foreground',
      '--border',
      '--input',
      '--ring',
    ];

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: requiredSemanticTokens.length - 1 }),
        (index) => {
          const token = requiredSemanticTokens[index];
          const inLight = lightTokens.has(token);
          const inDark = darkTokens.has(token);
          if (!inLight) {
            throw new Error(`Required semantic token "${token}" missing from light mode`);
          }
          if (!inDark) {
            throw new Error(`Required semantic token "${token}" missing from dark mode`);
          }
          return true;
        }
      ),
      { numRuns: requiredSemanticTokens.length * 5, verbose: true }
    );
  });

  it('chart tokens are defined in both modes for WCAG AA contrast (Req 36.6)', () => {
    // Requirement 36.6: dark mode chart palettes must have sufficient contrast.
    // This verifies the tokens exist in both modes (contrast values are
    // verified by the check:contrast script).
    const chartTokens = Array.from(lightTokens).filter(
      (t) => t.startsWith('--chart-')
    );

    expect(chartTokens.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: chartTokens.length - 1 }),
        (index) => {
          const token = chartTokens[index];
          if (!darkTokens.has(token)) {
            throw new Error(
              `Chart token "${token}" missing from dark mode — violates Requirement 36.6 (chart contrast in dark mode)`
            );
          }
          return true;
        }
      ),
      { numRuns: chartTokens.length * 3, verbose: true }
    );
  });

  it('sidebar tokens are defined in both modes', () => {
    const sidebarTokens = Array.from(lightTokens).filter(
      (t) => t.startsWith('--sidebar')
    );

    expect(sidebarTokens.length).toBeGreaterThan(0);

    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: sidebarTokens.length - 1 }),
        (index) => {
          const token = sidebarTokens[index];
          if (!darkTokens.has(token)) {
            throw new Error(
              `Sidebar token "${token}" missing from dark mode`
            );
          }
          return true;
        }
      ),
      { numRuns: sidebarTokens.length * 3, verbose: true }
    );
  });
});
