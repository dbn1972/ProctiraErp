/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant library staff access (borrower records). system_admin, the per-tenant
 * admin, keeps it.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasLibraryAccess } from './library-access.js';
describe('library-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED library read/write; system_admin keeps them', () => {
    for (const action of ['library.read', 'library.write'] as const) {
      expect(hasLibraryAccess(['platform_admin'], action), action).toBe(false);
      expect(hasLibraryAccess(['system_admin'], action), action).toBe(true);
    }
  });
});
