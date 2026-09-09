/**
 * G-811 — every dashboard page.tsx must expose a visible page title:
 * either an `<h1` / `PageHeader` in the page file, or an ancestor segment
 * `layout.tsx` that contains `<h1` / `PageHeader`. Redirect-only pages are skipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const DASHBOARD_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
);

function walkPages(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkPages(full));
    } else if (entry.name === 'page.tsx') {
      out.push(full);
    }
  }
  return out;
}

function isRedirectOnly(source: string): boolean {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  if (!withoutComments.includes('redirect(')) return false;
  // No meaningful UI markup beyond the redirect shell.
  const hasUi =
    /<(section|div|main|h1|PageHeader|Card|form)\b/.test(withoutComments) ||
    /return\s*\(\s*<>/.test(withoutComments);
  return !hasUi;
}

function hasHeadingMarker(source: string): boolean {
  return source.includes('<h1') || source.includes('PageHeader');
}

function ancestorLayoutHasHeading(pageFile: string): boolean {
  let dir = path.dirname(pageFile);
  while (dir.startsWith(DASHBOARD_ROOT)) {
    if (dir === DASHBOARD_ROOT) {
      // route-group layout does not provide an h1 by design
      break;
    }
    const layout = path.join(dir, 'layout.tsx');
    if (fs.existsSync(layout) && hasHeadingMarker(fs.readFileSync(layout, 'utf8'))) {
      return true;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return false;
}

describe('dashboard page h1 presence (G-811)', () => {
  const pages = walkPages(DASHBOARD_ROOT);

  it('discovers dashboard page.tsx files', () => {
    expect(pages.length).toBeGreaterThan(20);
  });

  it.each(pages.map((p) => [path.relative(DASHBOARD_ROOT, p), p] as const))(
    '%s has h1, PageHeader, or layout h1 (or is redirect-only)',
    (_rel, pageFile) => {
      const source = fs.readFileSync(pageFile, 'utf8');
      if (isRedirectOnly(source)) return;
      const ok = hasHeadingMarker(source) || ancestorLayoutHasHeading(pageFile);
      expect(ok, `${_rel} missing <h1 / PageHeader and no layout heading`).toBe(true);
    },
  );
});
