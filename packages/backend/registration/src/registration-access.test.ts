/**
 * W1-SEC-02 — registration / admissions domain RBAC unit tests.
 */
import { describe, expect, it } from 'vitest';

import {
  assertRegistrationAccess,
  hasRegistrationAccess,
  isPublicRegistrationPath,
  normalizeRegistrationRoles,
  registrationStaffActionForMethod,
} from './registration-access.js';

describe('registration-access (W1-SEC-02)', () => {
  it('normalizes string and object roles', () => {
    expect(normalizeRegistrationRoles(['Admin', { roleName: 'Registrar' }])).toEqual([
      'admin',
      'registrar',
    ]);
  });

  it('allows admissions staff to write', () => {
    expect(hasRegistrationAccess(['registrar'], 'registration.staff.write')).toBe(true);
    expect(hasRegistrationAccess(['admissions_officer'], 'admissions.staff.write')).toBe(
      true,
    );
    expect(hasRegistrationAccess(['admin'], 'admissions.staff.read')).toBe(true);
  });

  it('denies teachers/parents/empty on staff actions (fail closed)', () => {
    expect(hasRegistrationAccess(['teacher'], 'registration.staff.write')).toBe(false);
    expect(hasRegistrationAccess(['parent'], 'admissions.staff.write')).toBe(false);
    expect(hasRegistrationAccess([], 'registration.staff.read')).toBe(false);
    expect(() =>
      assertRegistrationAccess(['viewer'], 'registration.staff.write'),
    ).toThrow(/Forbidden/);
  });

  it('classifies public registration paths', () => {
    expect(isPublicRegistrationPath('/registrations')).toBe(true);
    expect(isPublicRegistrationPath('/registrations/REG-ABC12345/status')).toBe(true);
    expect(isPublicRegistrationPath('/registrations/institutions')).toBe(true);
    expect(isPublicRegistrationPath('/registrations/schools/search')).toBe(true);
    expect(isPublicRegistrationPath('/registrations/form-config/inst-1')).toBe(true);
    expect(isPublicRegistrationPath('/registrations/language')).toBe(true);
    expect(isPublicRegistrationPath('/api/v1/registrations')).toBe(true);
    expect(isPublicRegistrationPath('/api/v1/institutions')).toBe(false);
    expect(isPublicRegistrationPath('/api/v1/language')).toBe(false);
    expect(isPublicRegistrationPath('/registrations/applications')).toBe(false);
    expect(isPublicRegistrationPath('/registrations/interview-slots')).toBe(false);
  });

  it('maps staff methods', () => {
    expect(registrationStaffActionForMethod('GET')).toBe('registration.staff.read');
    expect(registrationStaffActionForMethod('POST')).toBe('registration.staff.write');
  });
});
