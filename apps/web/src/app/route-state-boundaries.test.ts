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
    expect(errors.length).toBeGreaterThanOrEqual(8);
    expect(loadings.length).toBeGreaterThanOrEqual(9);
  });
});
