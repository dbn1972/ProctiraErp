/**
 * W2-A11Y-01 — authenticated axe inventory must stay a superset of the
 * touch-target / dark-mode route sweeps so the a11y gate cannot silently
 * shrink while those matrices grow.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..'); // apps/web

function extractRootedPaths(file: string): string[] {
  const src = readFileSync(join(ROOT, file), 'utf8');
  const paths = Array.from(
    src.matchAll(/['"`](\/(?:[A-Za-z0-9._~!$&'()*+,;=:@\/\-]|\$\{[^}]+\})+)['"`]/g),
    (m) => m[1] ?? '',
  )
    .filter((p) => p.startsWith('/') && !p.includes('${') && !p.includes(' '))
    .filter((p) => !p.startsWith('//'))
    // Legacy `/mobile/*` SPA routes are entitlement-gated and out of the
    // authenticated App Router axe matrix (Task 53.5).
    .filter((p) => !p.startsWith('/mobile'));
  return [...new Set(paths)].sort();
}

describe('W2-A11Y-01 a11y gate coverage', () => {
  const a11y = extractRootedPaths('e2e/a11y-axe.spec.ts');
  const touch = extractRootedPaths('e2e/touch-target-minimum.spec.ts');
  const dark = extractRootedPaths('e2e/dark-mode-parity.spec.ts');

  it('keeps a large authenticated axe inventory (not gated off the repo)', () => {
    expect(a11y.length).toBeGreaterThanOrEqual(120);
  });

  it('covers every static touch-target route', () => {
    const missing = touch.filter((p) => !a11y.includes(p));
    expect(missing, `a11y missing touch routes: ${missing.join(', ')}`).toEqual([]);
  });

  it('covers every static dark-mode route', () => {
    const missing = dark.filter((p) => !a11y.includes(p));
    expect(missing, `a11y missing dark routes: ${missing.join(', ')}`).toEqual([]);
  });

  it('keeps the authenticated axe matrix on the e2e-backend-ready PR gate', () => {
    const src = readFileSync(join(ROOT, 'e2e/a11y-axe.spec.ts'), 'utf8');
    expect(src).toMatch(/E2E_BACKEND_READY/);
    expect(src).toMatch(/authenticated surfaces/);
    const workflow = readFileSync(
      join(ROOT, '../../.github/workflows/e2e-backend-ready.yml'),
      'utf8',
    );
    expect(workflow).toMatch(/e2e\/a11y-axe\.spec\.ts/);
    expect(workflow).toMatch(/PR_SPECS/);
  });
});
