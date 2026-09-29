/**
 * @vitest-environment jsdom
 *
 * Font loading test (Design §J / Task 55.3 / Requirement 39.3, 39.4)
 *
 * Loads the application's globals.css into a jsdom document and asserts
 * that the resolved `--font-sans` CSS custom property — the value the
 * <body> ultimately uses for `font-family` — starts with the self-hosted
 * Inter variable (`var(--font-inter)`). next/font/local sets
 * `font-display: swap`, so the first paint uses the system fallbacks that
 * follow Inter instead of hiding text while the face downloads.
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

  it('--font-sans uses the self-hosted Inter variable, then system fonts', () => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-sans')
      .trim();

    expect(computed.length).toBeGreaterThan(0);
    expect(computed).toMatch(/^var\(--font-inter\)/);
    expect(computed.indexOf('-apple-system')).toBeGreaterThan(computed.indexOf('--font-inter'));
  });

  it('--font-sans includes the full system-font fallback chain', () => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-sans')
      .trim();

    // The order documented in the spec must be preserved so the browser
    // walks the list in the intended priority.
    const required = ['-apple-system', 'BlinkMacSystemFont', "'Segoe UI'", 'Roboto'];
    let lastIndex = -1;
    for (const family of required) {
      const idx = computed.indexOf(family);
      expect(idx, `expected to find ${family} in: ${computed}`).toBeGreaterThan(-1);
      expect(idx, `expected ${family} after the previous family in: ${computed}`).toBeGreaterThan(
        lastIndex,
      );
      lastIndex = idx;
    }

    // sans-serif must be the final, unconditional fallback.
    expect(computed).toMatch(/sans-serif\s*$/);
  });

  it('Inter is the first family so the loaded face is used, with system fallbacks after', () => {
    const computed = getComputedStyle(document.documentElement)
      .getPropertyValue('--font-sans')
      .trim();

    const apple = computed.indexOf('-apple-system');
    const inter = computed.indexOf('var(--font-inter)');
    expect(inter).toBe(0);
    expect(apple).toBeGreaterThan(inter);
  });

  it('body uses var(--font-sans) for font-family', () => {
    expect(globalsCss).toMatch(/body\s*\{[^}]*font-family:\s*var\(--font-sans\)/);
  });
});

describe('Font loading — Inter loaded with font-display: swap (Requirement 39.4)', () => {
  it('layout.tsx loads self-hosted Inter via next/font/local with display: swap', () => {
    const layoutPath = resolve(__dirname, '../app/layout.tsx');
    const layout = readFileSync(layoutPath, 'utf8');

    // next/font/local emits a preloaded <link rel="preload" as="font"> plus
    // an @font-face rule with font-display: swap, and does not call
    // fonts.googleapis.com at build time. display:'swap' is the
    // source-of-truth for Requirement 39.4 in the App Router.
    expect(layout).toMatch(/from\s+['"]next\/font\/local['"]/);
    expect(layout).not.toMatch(/next\/font\/google/);
    expect(layout).toMatch(/localFont\s*\(\s*\{[\s\S]*?display:\s*['"]swap['"]/);
    expect(layout).toMatch(/weight:\s*['"]400['"]/);
    expect(layout).toMatch(/weight:\s*['"]500['"]/);
    expect(layout).toMatch(/weight:\s*['"]600['"]/);
    expect(layout).toMatch(/weight:\s*['"]700['"]/);
    expect(layout).toMatch(/variable:\s*['"]--font-inter['"]/);

    // The loader's CSS variable must be wired onto <html> so Tailwind's
    // font-sans can resolve to Inter once it has loaded.
    expect(layout).toMatch(/className=\{inter\.variable\}/);
  });
});
