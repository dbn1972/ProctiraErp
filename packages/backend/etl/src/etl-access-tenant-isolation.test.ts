/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant ETL pipeline access. system_admin, the per-tenant admin, keeps it.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasEtlAccess } from './etl-access.js';
describe('etl-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED ETL access; system_admin keeps it', () => {
    expect(hasEtlAccess(['platform_admin'])).toBe(false);
    expect(hasEtlAccess(['system_admin'])).toBe(true);
  });
});
