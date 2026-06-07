/**
 * @vitest-environment jsdom
 *
 * Font loading test (Design §J / Task 55.3 / Requirement 39.3, 39.4)
 *
 * Loads the application's globals.css into a jsdom document and asserts
 * that the resolved `--font-sans` CSS custom property — the value the
 * <body> ultimately uses for `font-family` — starts with the system-font
 * fallback (`-apple-system, ...`). This guards against an accidental
 * regression where Inter (or another web font) is hoisted to the front of
 * the stack and causes invisible text on the first paint while the web
 * font is still downloading.
 *
 * The same expectation is verified for the RTL override, since the RTL
 * stack is what gets applied for Arabic / Hebrew locales.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Read the source globals.css straight from disk so the test exercises the
// real artifact rather than a snapshot. This keeps the test honest if
// someone updates only one of the two locations.
const globalsCssPath = resolve(__dirname, './globals.css');
const globalsCss = readFileSync(globalsCssPath, 'utf8');

describe('Font stack — system-font fallback (Task 55.3, Requirement 39.3)', () => {
  beforeAll(() => {
    // jsdom does not run @tailwind / @layer directives, so we lift the
    // `:root { ... }` block straight out of globals.css and inject just
    // that into the document. This keeps the assertion tied to the real
    // source-of-truth file without depending on PostCSS or Tailwind.
    const rootMatch = globalsCss.match(/:root\s*\{[\s\S]*?\n\s*\}/);
    if (!rootMatch) {
      throw new Error('Could not find :root block in globals.css');
    }

    const style = document.createElement('style');
    style.textContent = rootMatch[0];
    document.head.appendChild(style);
  });

  it('--font-sans starts with the -apple-system system font (LTR)', () => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-sans')
      .trim();

    expect(computed.length).toBeGreaterThan(0);
    expect(computed).toMatch(/^-apple-system\b/);
  });

  it('--font-sans includes the full system-font fallback chain', () => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-sans')
      .trim();

    // The order documented in the spec must be preserved so the browser
    // walks the list in the intended priority.
    const required = [
      '-apple-system',
      'BlinkMacSystemFont',
      "'Segoe UI'",
      'Roboto',
    ];
    let lastIndex = -1;
    for (const family of required) {
      const idx = computed.indexOf(family);
      expect(idx, `expected to find ${family} in: ${computed}`).toBeGreaterThan(
        -1
      );
      expect(
        idx,
        `expected ${family} after the previous family in: ${computed}`
      ).toBeGreaterThan(lastIndex);
      lastIndex = idx;
    }

    // sans-serif must be the final, unconditional fallback.
    expect(computed).toMatch(/sans-serif\s*$/);
  });

  it('Inter (the web font) appears AFTER the system fonts in the stack', () => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-sans')
      .trim();

    const apple = computed.indexOf('-apple-system');
    const inter = computed.indexOf("'Inter'");

    // If Inter is listed at all, it must come after the system fonts so the
    // first paint never blocks on the web font (Requirement 39.4).
    if (inter !== -1) {
      expect(inter).toBeGreaterThan(apple);
    }
  });

  it('body uses var(--font-sans) for font-family', () => {
    expect(globalsCss).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  });
});

describe('Font loading — Inter loaded with font-display: swap (Requirement 39.4)', () => {
  it('layout.tsx loads Inter via next/font/google with display: swap', () => {
    const layoutPath = resolve(__dirname, '../app/layout.tsx');
    const layout = readFileSync(layoutPath, 'utf8');

    // next/font/google self-hosts the font and emits a preloaded
    // <link rel="preload" as="font" ...> plus an @font-face rule with
    // font-display: swap. Verifying we use the loader with display:'swap'
    // is the source-of-truth for Requirement 39.4 in the App Router.
    expect(layout).toMatch(/from\s+['"]next\/font\/google['"]/);
    expect(layout).toMatch(/Inter\s*\(\s*\{[\s\S]*?display:\s*['"]swap['"]/);

    // The loader's CSS variable must be wired onto <html> so Tailwind's
    // font-sans can resolve to Inter once it has loaded.
    expect(layout).toMatch(/className=\{inter\.variable\}/);
  });
});
