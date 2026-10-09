/**
 * PRC-M418 / PRC-M420 — the `migrate:*` runbook scripts must target standalone
 * entrypoints that actually invoke a step at the top level, not library modules
 * that only export functions (which would run as a silent no-op / false-green).
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const pkgRoot = join(here, '..');

const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

/** Map `node dist/foo.js` → source file `src/foo.ts`. */
function scriptSource(script: string): string | null {
  const m = script.match(/node\s+dist\/([\w-]+)\.js/);
  return m ? join(pkgRoot, 'src', `${m[1]}.ts`) : null;
}

/**
 * A real entrypoint invokes a step at module top level — not merely declaring
 * exported functions. We detect a top-level `await <fn>(` or `.then(`/`main()`
 * call that is not inside an `export function`/`export const` declaration.
 */
function hasTopLevelInvocation(src: string): boolean {
  // Top-level `await something(` (the run-* files use top-level await).
  if (/^\s*(?:const\s+\w+\s*=\s*)?await\s+\w+\(/m.test(src)) return true;
  // Or an explicit main()/run() call at column 0.
  if (/^(?:main|run)\(\)/m.test(src)) return true;
  return false;
}

describe('migrate:* scripts target real entrypoints (PRC-M418/M420)', () => {
  const migrateScripts = Object.entries(pkg.scripts).filter(([name]) =>
    name.startsWith('migrate:'),
  );

  it('has migrate scripts', () => {
    expect(migrateScripts.length).toBeGreaterThan(0);
  });

  for (const [name, script] of migrateScripts) {
    it(`${name} points at a top-level-invoking entrypoint`, () => {
      const sourcePath = scriptSource(script);
      expect(sourcePath, `${name} must run a dist/*.js file`).not.toBeNull();
      const src = readFileSync(sourcePath as string, 'utf8');
      expect(
        hasTopLevelInvocation(src),
        `${name} → ${script} targets a module with no top-level invocation (silent no-op)`,
      ).toBe(true);
    });
  }

  it('does not target the bare library modules that caused the no-op bug', () => {
    const targets = migrateScripts.map(([, s]) => s);
    for (const bad of [
      'node dist/transform-schema.js',
      'node dist/generate-uuids.js',
      'node dist/assign-tenant.js',
      'node dist/validate-migration.js',
    ]) {
      expect(targets).not.toContain(bad);
    }
  });
});
