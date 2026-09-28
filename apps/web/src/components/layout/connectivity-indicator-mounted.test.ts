/**
 * V15-14 — the connectivity indicator stays mounted in both shells.
 *
 * The widget was built, tested and localised in task 54.3 and then mounted by exactly one
 * screen (`SchoolDashboard`). Every other App Router route showed either nothing or, on
 * mobile, an `aria-hidden` grey dot that never changed colour. A user whose connection
 * dropped mid-form had no signal.
 *
 * `MobileShell.test.tsx` renders the mobile header and asserts the live component. This file
 * covers the regression that a render test cannot: someone deleting the indicator from the
 * *desktop* header, which has no render test of its own, or re-introducing the dead
 * placeholder alongside the live one.
 *
 * Source-scanning rather than rendering, matching the existing convention in
 * `page-h1-presence.test.ts` and `no-inert-primary-cta.test.ts`. It is a weaker check than a
 * render and is only used for the surfaces a render cannot reach cheaply.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const LAYOUT_DIR = path.join(process.cwd(), 'src/components/layout');

/** Both persistent chrome surfaces a signed-in user sees on an App Router route. */
const SHELL_SURFACES = [
  { file: 'MobileShell.tsx', why: 'mobile header (iconOnly — no room for a label)' },
  { file: 'header.tsx', why: 'desktop header (label visible)' },
] as const;

function read(file: string): string {
  return readFileSync(path.join(LAYOUT_DIR, file), 'utf8');
}

describe('V15-14 connectivity indicator is mounted in the persistent chrome', () => {
  for (const surface of SHELL_SURFACES) {
    it(`${surface.file} renders <ConnectivityIndicator> — ${surface.why}`, () => {
      const source = read(surface.file);
      expect(
        source.includes('<ConnectivityIndicator'),
        `${surface.file} no longer renders <ConnectivityIndicator>. Requirement 38.1 asks for ` +
          `a persistent indicator; without it a user on a dropping connection gets no signal ` +
          `on this surface.`,
      ).toBe(true);
      // Rendering it without importing it would not compile, but asserting the import keeps
      // the failure message pointing at the right line if the tag survives inside a comment.
      expect(source).toMatch(/import\s*\{[^}]*ConnectivityIndicator[^}]*\}/);
    });
  }

  it('the dead placeholder is gone and does not creep back', () => {
    // The 53.2 placeholder was `aria-hidden` and static. Shipping it beside the live widget
    // would show two dots, one of which is always grey.
    for (const surface of SHELL_SURFACES) {
      expect(
        read(surface.file),
        `${surface.file} still contains the pre-V15-14 placeholder`,
      ).not.toContain('connectivity-indicator-placeholder');
    }
  });
});
