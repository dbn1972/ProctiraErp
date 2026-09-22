/**
 * Drift guard for the gateway pagination ceiling.
 *
 * `MAX_PUBLIC_PAGE_SIZE` is a literal rather than an import because this app sets
 * `transpilePackages: ['@proctira/common']`, which makes webpack compile that
 * package's TypeScript source, and its barrel re-exports `./schemas/index.js` —
 * unresolvable from a `.ts` file. See the comment in `pagination.ts`.
 *
 * Vitest has no such problem, so the comparison the build cannot make is made here.
 * If the gateway's cap changes and this literal does not, this fails.
 */
import { PAGINATION_DEFAULTS } from '@proctira/common';
import { describe, expect, it } from 'vitest';

import { MAX_PUBLIC_PAGE_SIZE } from './pagination';

describe('MAX_PUBLIC_PAGE_SIZE', () => {
  it('equals the cap the gateway enforces', () => {
    expect(MAX_PUBLIC_PAGE_SIZE).toBe(PAGINATION_DEFAULTS.MAX_PAGE_SIZE);
  });

  it('is a value the gateway will accept', () => {
    // The cap is enforced as `maximum`, so the boundary itself must be valid.
    expect(MAX_PUBLIC_PAGE_SIZE).toBeGreaterThanOrEqual(1);
    expect(MAX_PUBLIC_PAGE_SIZE).toBeLessThanOrEqual(PAGINATION_DEFAULTS.MAX_PAGE_SIZE);
  });
});
