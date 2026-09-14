/**
 * W1-SEC-02 — transport domain RBAC unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertTransportAccess,
  hasTransportAccess,
  normalizeTransportRoles,
} from './transport-access.js';

describe('transport-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeTransportRoles(['Admin', { roleName: 'Transport_Officer' }])).toEqual([
      'admin',
      'transport_officer',
    ]);
  });

  it('allows transport staff to write', () => {
    expect(hasTransportAccess(['transport_manager'], 'transport.write')).toBe(true);
    expect(hasTransportAccess(['admin'], 'transport.read')).toBe(true);
  });

  it('denies parents/teachers/empty roles (fail closed)', () => {
    expect(hasTransportAccess(['parent'], 'transport.write')).toBe(false);
    expect(hasTransportAccess(['teacher'], 'transport.read')).toBe(false);
    expect(hasTransportAccess([], 'transport.write')).toBe(false);
    expect(() => assertTransportAccess(['viewer'], 'transport.write')).toThrow(/Forbidden/);
  });
});
