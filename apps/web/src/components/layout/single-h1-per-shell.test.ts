/**
 * @vitest-environment node
 *
 * Persistent chrome must not render an `<h1>`.
 *
 * `MobileShell` rendered its route label as `<h1>`, while the routed page below rendered its
 * own. Two level-1 headings on one document is an accessibility defect — a screen-reader user
 * asking "what page is this?" gets two conflicting answers — and it made
 * `getByRole('heading', { level: 1 })` ambiguous, so E2E specs asserting a single level-1
 * heading failed on mobile viewports with a Playwright strict-mode violation:
 *
 *     strict mode violation: getByRole('heading', { level: 1 }) resolved to 2 elements
 *       1) <h1 data-testid="mobile-shell-title">ProctiraERP</h1>
 *       2) <h1 id="role-dashboard-heading">Dashboard</h1>
 *
 * Found while fixing an unrelated branch, where the mobile and tablet Playwright projects ran.
 * It is invisible on desktop because `DesktopShell` has no title of its own.
 *
 * The rule asserted here is narrow on purpose: the *shell* owns no `h1`, because the page it
 * wraps always does. `page-h1-presence.test.ts` covers the other half — that every routed page
 * has one.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const LAYOUT_DIR = __dirname;

/** Chrome that wraps a routed page and is therefore never the page heading. */
const SHELLS = [
  'MobileShell.tsx',
  'DesktopShell.tsx',
  'AppShell.tsx',
  'header.tsx',
  'sidebar.tsx',
  'ParentPortalShell.tsx',
  'StudentPortalShell.tsx',
] as const;

describe('persistent chrome renders no h1', () => {
  for (const file of SHELLS) {
    it(`${file} has no <h1>`, () => {
      const src = readFileSync(join(LAYOUT_DIR, file), 'utf8');
      // Strip block comments so the explanation above a fix cannot trip its own gate.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const matches = [...code.matchAll(/<h1[\s>]/g)];
      expect(
        matches.length,
        `${file} renders ${matches.length} <h1> element(s). A shell wraps a page that already ` +
          `has one, so this produces two level-1 headings and makes ` +
          `getByRole('heading', { level: 1 }) ambiguous. Use a <p> for chrome titles.`,
      ).toBe(0);
    });
  }

  it('MobileShell still shows the route title, just not as a heading', () => {
    // The fix must not delete the title — it is useful, it simply is not structure.
    const src = readFileSync(join(LAYOUT_DIR, 'MobileShell.tsx'), 'utf8');
    expect(src).toContain('data-testid="mobile-shell-title"');
    expect(src).toMatch(/<p\b[^>]*data-testid="mobile-shell-title"/);
  });
});
