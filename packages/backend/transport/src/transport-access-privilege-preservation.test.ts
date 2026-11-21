/**
 * D2 role-catalogue normalization (PRC-M015, PRC-L391) — transport privilege-preservation.
 *
 * Only change: system_admin -> platform_admin ADD in ADMIN_ROLES. Proves platform_admin is now
 * admitted for every transport action and system_admin retains its grants.
 */
import { describe, expect, it } from 'vitest';

import { hasTransportAccess, type TransportAction } from './transport-access.js';

const ALL_ACTIONS: TransportAction[] = ['transport.read', 'transport.write', 'transport.ops'];

describe('transport-access privilege preservation (D2)', () => {
  it('admits platform_admin alongside system_admin for every action', () => {
    for (const action of ALL_ACTIONS) {
      expect(hasTransportAccess(['platform_admin'], action), `platform_admin -> ${action}`).toBe(
        true,
      );
      expect(hasTransportAccess(['system_admin'], action), `system_admin -> ${action}`).toBe(true);
    }
  });

  it('every previously-admitted transport/admin role still has every action', () => {
    for (const role of ['transport_officer', 'fleet_manager', 'registrar', 'admin', 'principal']) {
      for (const action of ALL_ACTIONS) {
        expect(hasTransportAccess([role], action), `${role} -> ${action}`).toBe(true);
      }
    }
  });

  it('teacher/parent/viewer remain denied (fail-closed unchanged)', () => {
    expect(hasTransportAccess(['teacher'], 'transport.read')).toBe(false);
    expect(hasTransportAccess(['parent'], 'transport.write')).toBe(false);
    expect(hasTransportAccess(['viewer'], 'transport.ops')).toBe(false);
  });
});
