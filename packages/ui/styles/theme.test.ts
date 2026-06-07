/**
 * Base typography accessibility test (Task 56.1 / Requirement 37 AC 1 / Design §K)
 *
 * Locks in the Tailwind v4 base layer rules in `theme.css`:
 *   - `html { font-size: 18px }` (or `var(--font-size, 18px)`)
 *   - `body { line-height: 1.5 }`
 *
 * Requirement 37 AC 1: "THE Frontend_Shell SHALL render body text at a
 * minimum base font size of 18 pixels and SHALL maintain a line height of
 * at least 1.5 for body text."
 *
 * The test reads `theme.css` from disk and parses the relevant blocks so
 * we exercise the real artifact (rather than a snapshot). It intentionally
 * does not run PostCSS / Tailwind, so the assertions stay fast and free of
 * environment dependencies.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const themeCssPath = resolve(here, './theme.css');
const themeCss = readFileSync(themeCssPath, 'utf8');

/** Extracts the body of the first declaration block matching `selector`. */
function extractBlock(css: string, selector: string): string {
  // Match: `selector  {  ...declarations...  }` allowing whitespace and
  // nested-free declarations (the rules under test are flat).
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\s)${escaped}\\s*\\{([^}]*)\\}`, 'm');
  const match = css.match(re);
  return match ? match[1] : '';
}

describe('theme.css — base typography (Task 56.1, Requirement 37 AC 1)', () => {
  it('declares an @layer base block (Tailwind base override)', () => {
    expect(themeCss).toMatch(/@layer\s+base\s*\{/);
  });

  it('html sets font-size to 18px (directly or via the --font-size token)', () => {
    const htmlBlock = extractBlock(themeCss, 'html');
    expect(
      htmlBlock,
      'expected an `html { ... }` rule inside theme.css'
    ).not.toBe('');

    // Accept either a literal `18px` or the token form
    // `var(--font-size, 18px)` — both resolve to 18 px because the
    // `:root, :root.light` block declares `--font-size: 18px`.
    const literal = /font-size:\s*18px\b/i.test(htmlBlock);
    const tokenForm = /font-size:\s*var\(\s*--font-size\s*(?:,\s*18px\s*)?\)/i.test(
      htmlBlock
    );
    expect(
      literal || tokenForm,
      `expected html font-size to resolve to 18px, got: ${htmlBlock.trim()}`
    ).toBe(true);
  });

  it('--font-size token is declared as 18px on :root', () => {
    // `:root` (or `:root, :root.light`) must set --font-size: 18px so the
    // var() reference on `html` resolves to the accessibility minimum.
    expect(themeCss).toMatch(/--font-size:\s*18px\s*;/);
  });

  it('body sets line-height to 1.5 (WCAG body-copy minimum)', () => {
    const bodyBlock = extractBlock(themeCss, 'body');
    expect(
      bodyBlock,
      'expected a `body { ... }` rule inside theme.css'
    ).not.toBe('');
    expect(bodyBlock).toMatch(/line-height:\s*1\.5\s*;?/);
  });

  it('the base typography override is documented in a comment', () => {
    // Future-proofing: the override exists for a regulatory reason
    // (Requirement 37 AC 1). A documenting comment must accompany the rule
    // so a refactor cannot quietly delete it.
    expect(themeCss).toMatch(/Requirement\s+37/i);
    expect(themeCss).toMatch(/Task\s+56\.1/i);
  });
});

/**
 * Global focus-ring test (Task 56.4 / Requirement 37 AC 3 / Design §K)
 *
 * Locks in the global keyboard-focus indicator declared in `theme.css`:
 *   - `*:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }`
 *
 * Requirement 37 AC 3 (paraphrased): every keyboard-focused element must
 * present a 2 px focus ring whose contrast against adjacent colors is
 * ≥ 3:1 in both light and dark themes.
 *
 * The ring colour comes from `--ring`, which is declared in both
 * `:root, :root.light` and `:root.dark` blocks. The contrast computation
 * for the recorded ring/background pairs is documented in-line in
 * `theme.css` and was verified with the WCAG 2.1 luminance helpers in
 * `packages/backend/theme/src/accessibility.ts`.
 *
 * Known opt-outs (documented for future-proofing, not asserted):
 *   shadcn/ui components in `packages/ui/components/src/*.tsx` (Button,
 *   Input, Checkbox, RadioGroup, Select, etc.) and a handful of app-level
 *   call sites in `apps/web/src/app/...` and `apps/public-website/src/...`
 *   set `focus-visible:outline-none` (Tailwind compiles that to a
 *   transparent 2 px outline) and replace the outline ring with a matching
 *   `box-shadow`-based ring via `focus-visible:ring-2 focus-visible:ring-ring`.
 *   Those component overrides win on selector specificity over the global
 *   `*:focus-visible` rule, but they preserve the same visual contract
 *   (ring colour from `--ring`, ≥ 2 px stroke). The global rule is the
 *   accessibility default for everything that does not opt out.
 */
describe('theme.css — global focus ring (Task 56.4, Requirement 37 AC 3)', () => {
  it('declares a *:focus-visible rule inside @layer base', () => {
    // The rule must live inside the `@layer base` block so its specificity
    // stays at the same level as Tailwind's user-agent-style overrides
    // and component variants can intentionally opt out.
    expect(themeCss).toMatch(/@layer\s+base\s*\{/);

    // `@layer base` opens the block — find its body via brace counting so
    // the inner `html { ... }`, `body { ... }`, and `*:focus-visible { ... }`
    // rules are all included.
    const layerOpen = themeCss.search(/@layer\s+base\s*\{/);
    expect(layerOpen, 'expected an `@layer base {` opener').toBeGreaterThan(-1);

    let depth = 0;
    let i = themeCss.indexOf('{', layerOpen);
    let end = -1;
    for (; i < themeCss.length; i++) {
      const ch = themeCss[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    expect(end, 'expected a balanced `@layer base { ... }` block').toBeGreaterThan(-1);
    const body = themeCss.slice(layerOpen, end);
    expect(body).toMatch(/\*:focus-visible\s*\{/);
  });

  it('the *:focus-visible rule sets a 2px solid outline using --ring', () => {
    // Custom block extractor because the helper above escapes regex
    // specials and would treat `*` as a literal asterisk preceded by an
    // escaped backslash; here we want a real regex that matches the
    // `*:focus-visible { ... }` selector exactly.
    const focusMatch = themeCss.match(
      /\*\s*:focus-visible\s*\{([^}]*)\}/
    );
    expect(
      focusMatch,
      'expected a `*:focus-visible { ... }` rule inside theme.css'
    ).not.toBeNull();
    const focusBlock = focusMatch![1];

    // Canonical declarations from the task description.
    expect(focusBlock).toMatch(
      /outline:\s*2px\s+solid\s+var\(\s*--ring\s*\)\s*;?/i
    );
    expect(focusBlock).toMatch(/outline-offset:\s*2px\s*;?/i);
  });

  it('--ring is declared in both :root (light) and :root.dark blocks', () => {
    // The light block uses a grouped selector `:root, :root.light` with a
    // line break between the two; the dark block uses `:root.dark` alone.
    // Match each by locating the opening brace and slicing to the next `}`.
    function blockBody(re: RegExp): string {
      const m = themeCss.match(re);
      if (!m || m.index === undefined) return '';
      const open = themeCss.indexOf('{', m.index);
      const close = themeCss.indexOf('}', open);
      if (open === -1 || close === -1) return '';
      return themeCss.slice(open + 1, close);
    }

    const lightBody = blockBody(/:root\s*,\s*:root\.light\s*\{/);
    const darkBody = blockBody(/:root\.dark\s*\{/);

    expect(lightBody, 'expected a `:root, :root.light { ... }` block').not.toBe('');
    expect(darkBody, 'expected a `:root.dark { ... }` block').not.toBe('');

    expect(lightBody).toMatch(/--ring:\s*hsl\([^)]+\)\s*;?/i);
    expect(darkBody).toMatch(/--ring:\s*hsl\([^)]+\)\s*;?/i);
  });

  it('is documented with a comment referencing Task 56.4 and Requirement 37', () => {
    // Future-proofing: a regression that quietly drops the global ring
    // would re-introduce a WCAG 2.1 AA failure, so an inline rationale
    // must accompany the rule.
    expect(themeCss).toMatch(/Task\s+56\.4/i);
    expect(themeCss).toMatch(/Requirement\s+37\s+AC\s+3/i);
  });

  it('records the ≥3:1 contrast verification for both modes', () => {
    // The contrast comment must mention both light and dark verification
    // so a future colour change cannot silently violate the 3:1 floor
    // without also updating (and re-verifying) the recorded ratios.
    expect(themeCss).toMatch(/Light\s+mode/i);
    expect(themeCss).toMatch(/Dark\s+mode/i);
    expect(themeCss).toMatch(/3:1|≥\s*3:1|3\s*:\s*1/);
  });
});
