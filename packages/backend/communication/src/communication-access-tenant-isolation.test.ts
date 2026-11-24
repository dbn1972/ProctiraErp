/**
 * D2 CORRECTION (PRC-M015): platform_admin is the cross-tenant control-plane operator and
 * holds no tenant communication staff or admin access. system_admin, the per-tenant admin,
 * keeps both.
 *
 * Failing-first: fails while platform_admin is in ADMIN_ROLES, passes once it is removed.
 */
import { describe, expect, it } from 'vitest';
import { hasCommunicationAccess } from './communication-access.js';
describe('communication-access tenant isolation (D2 CORRECTION)', () => {
  it('platform_admin is DENIED staff and admin actions; system_admin keeps them', () => {
    for (const action of ['communication.staff', 'communication.admin'] as const) {
      expect(hasCommunicationAccess(['platform_admin'], action), action).toBe(false);
      expect(hasCommunicationAccess(['system_admin'], action), action).toBe(true);
    }
  });
});
