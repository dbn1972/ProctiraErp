/**
 * G-804 — Page-wise functional / regression matrix gate.
 *
 * Every App Router page under `src/app` must be exercised by at least one
 * Playwright spec under `apps/web/e2e` (functional smoke, write flow, axe,
 * dark-mode, touch-target or visual regression). A page that ships without an
 * e2e reference fails this test, so the regression matrix can never drift
 * behind the route inventory again.
 *
 * Dynamic segments (`[id]`) match any concrete or templated value in the spec
 * (`/lms/assignments/${id}`, `/scholarships/programs/1111-…`).
 *
 * Companion: `docs/testing/PAGE_REGRESSION_MATRIX.md` (generated view of the
 * same data — keep both in sync via `pnpm --filter @proctira/web test`).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const E2E_DIR = join(APP_DIR, '../../e2e');

function collectPages(dir: string, acc: Set<string>): Set<string> {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectPages(full, acc);
      continue;
    }
    if (entry !== 'page.tsx') continue;
    const segments = relative(APP_DIR, dirname(full))
      .split(sep)
      .filter((seg) => seg.length > 0 && !(seg.startsWith('(') && seg.endsWith(')')));
    acc.add(segments.length ? `/${segments.join('/')}` : '/');
  }
  return acc;
}

function collectSpecs(dir: string, acc: string[]): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectSpecs(full, acc);
      continue;
    }
    if (entry.endsWith('.spec.ts')) acc.push(full);
  }
  return acc;
}

const PAGES = [...collectPages(APP_DIR, new Set<string>())].sort();
const SPEC_FILES = collectSpecs(E2E_DIR, []);
const SPEC_SOURCE = SPEC_FILES.map((f) => readFileSync(f, 'utf8')).join('\n');

/** Pages that are intentionally reached only through in-app navigation. */
const ALLOWLIST = new Set<string>([]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when some spec references the route (static or with a param value). */
export function isCoveredByE2E(route: string, specSource: string = SPEC_SOURCE): boolean {
  if (route === '/') return true;
  const pattern = route
    .split('/')
    .map((seg) => (seg.startsWith('[') && seg.endsWith(']') ? '[^/\'"`?]+' : escapeRegExp(seg)))
    .join('/');
  return new RegExp(`['"\`]${pattern}(?:[?'"\`]|\\$\\{)`).test(specSource);
}

describe('G-804 page-wise regression matrix', () => {
  it('discovers the App Router page inventory', () => {
    expect(PAGES.length).toBeGreaterThan(100);
    for (const required of ['/lms', '/lms/assignments/new', '/lms/assignments/[id]', '/lms/pal']) {
      expect(PAGES, `${required} missing from src/app`).toContain(required);
    }
  });

  it('has Playwright specs to match against', () => {
    expect(SPEC_FILES.length).toBeGreaterThan(20);
  });

  for (const page of PAGES) {
    it(`${page} is referenced by at least one e2e spec`, () => {
      if (ALLOWLIST.has(page)) return;
      expect(isCoveredByE2E(page), `${page} has no e2e coverage — add it to a spec`).toBe(true);
    });
  }

  it('allowlist only contains pages that still exist and are still uncovered', () => {
    for (const page of ALLOWLIST) {
      expect(PAGES, `${page} no longer exists — drop it from ALLOWLIST`).toContain(page);
      expect(isCoveredByE2E(page), `${page} is now covered — drop it from ALLOWLIST`).toBe(false);
    }
  });

  it('matcher handles templated and concrete dynamic segments', () => {
    const src =
      "page.goto(`/lms/assignments/${id}`); page.goto('/x/11111111-1111-4111-8111-111111111111/edit')";
    expect(isCoveredByE2E('/lms/assignments/[id]', src)).toBe(true);
    expect(isCoveredByE2E('/x/[id]/edit', src)).toBe(true);
    expect(isCoveredByE2E('/x/[id]', src)).toBe(false);
    expect(isCoveredByE2E('/lms', src)).toBe(false);
  });
});
