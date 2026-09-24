/**
 * W2-STATE-01 — route groups must ship error + loading boundaries.
 */
import { readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const APP_DIR = dirname(fileURLToPath(import.meta.url));

function hasFile(dir: string, name: string): boolean {
  try {
    return statSync(join(dir, name)).isFile();
  } catch {
    return false;
  }
}

describe('W2-STATE-01 route error/loading boundaries', () => {
  /**
   * V15 — the floor below could be met while four route groups had no boundary at all.
   *
   * `(public)` (the anonymous `/track` admission tracker), `(student)` (nine portal
   * routes), `(marketing)` and `app/legal` shipped a `layout.tsx` and nothing else, and
   * there was no root `error.tsx` or `global-error.tsx` above them — so a render error on
   * any of those 12 pages reached Next's unstyled built-in fallback with no retry. The
   * recursive `>= 8` assertion further down was satisfied the whole time, which is why it
   * never caught this: a count cannot see which subtree is uncovered.
   *
   * These two files are asserted by name because one root boundary is what covers all
   * four groups; if either is deleted the groups silently lose their only boundary again.
   */
  it('ships a root and a global error boundary', () => {
    expect(hasFile(APP_DIR, 'error.tsx'), 'app/error.tsx').toBe(true);
    expect(hasFile(APP_DIR, 'global-error.tsx'), 'app/global-error.tsx').toBe(true);
  });

  it('covers parent, auth, and dashboard shells', () => {
    for (const group of ['(dashboard)', '(parent)', '(auth)']) {
      const dir = join(APP_DIR, group);
      expect(hasFile(dir, 'error.tsx'), `${group}/error.tsx`).toBe(true);
      expect(hasFile(dir, 'loading.tsx'), `${group}/loading.tsx`).toBe(true);
    }
  });

  it('covers high-traffic dashboard segments', () => {
    for (const seg of ['students', 'fees', 'health', 'admissions', 'reports', 'staff', 'lms']) {
      const dir = join(APP_DIR, '(dashboard)', seg);
      expect(hasFile(dir, 'error.tsx'), `${seg}/error.tsx`).toBe(true);
      expect(hasFile(dir, 'loading.tsx'), `${seg}/loading.tsx`).toBe(true);
    }
  });

  it('ships more than the legacy single-shell pair', () => {
    const errors: string[] = [];
    const loadings: string[] = [];
    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (entry === 'error.tsx') errors.push(full);
        if (entry === 'loading.tsx') loadings.push(full);
      }
    }
    walk(APP_DIR);
    expect(errors.length).toBeGreaterThanOrEqual(9);
    expect(loadings.length).toBeGreaterThanOrEqual(9);
  });

  /**
   * Every route group must resolve to *some* error boundary, walking up as React does.
   *
   * This is the assertion that would have caught the gap, because it is structural rather
   * than numeric: it asks each group whether a boundary exists at or above it.
   */
  it('leaves no route group without a boundary at or above it', () => {
    const groups = readdirSync(APP_DIR).filter((entry) => {
      const full = join(APP_DIR, entry);
      return statSync(full).isDirectory() && hasFile(full, 'layout.tsx');
    });
    expect(groups.length).toBeGreaterThan(0);

    for (const group of groups) {
      const covered = hasFile(join(APP_DIR, group), 'error.tsx') || hasFile(APP_DIR, 'error.tsx');
      expect(covered, `${group} has no error.tsx and app/error.tsx is missing`).toBe(true);
    }
  });
});
