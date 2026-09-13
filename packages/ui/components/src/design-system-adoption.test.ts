/**
 * W2-DS-01 — satellite apps must declare and bridge `@proctira/ui-components`.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../../..');

const APPS = [
  'public-website',
  'admin-console',
  'install-wizard',
  'registration-portal',
  'developer-portal',
] as const;

describe('W2-DS-01 design system adoption', () => {
  for (const app of APPS) {
    it(`${app} depends on @proctira/ui-components and re-exports Button`, () => {
      const root = resolve(repoRoot, 'apps', app);
      const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
      expect(pkg.dependencies?.['@proctira/ui-components']).toBe('workspace:*');

      const bridge = readFileSync(resolve(root, 'src/lib/design-system.ts'), 'utf8');
      expect(bridge).toMatch(/from '@proctira\/ui-components'/);
      expect(bridge).toMatch(/\bButton\b/);
    });
  }
});
