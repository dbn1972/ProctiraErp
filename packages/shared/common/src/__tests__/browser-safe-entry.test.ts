import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The package main entry is imported by browser bundles (apps/web). It must not
 * re-export modules that import Node builtins — webpack fails the client build
 * with UnhandledSchemeError for `node:` schemes (seen on PR #590). Server-only
 * helpers are exposed via subpath exports instead (e.g. `./safe-fetch`).
 */
describe('@proctira/common main entry is browser-safe', () => {
  it('does not re-export safe-fetch (node:dns)', () => {
    const index = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');
    expect(index).not.toMatch(/from '\.\/safe-fetch(\.js)?'/);
  });
});
