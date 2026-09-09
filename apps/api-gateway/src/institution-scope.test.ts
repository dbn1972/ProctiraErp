import { afterEach, describe, expect, it } from 'vitest';
import {
  decideInstitutionScope,
  extractInstitutionId,
  isBoardOrTenantAdmin,
  isSchoolBound,
} from './institution-scope.js';
import {
  clearTenantFeaturesForTests,
  featureRequiredForPath,
  missingFeatureForRequest,
  resolveTenantFeatures,
  setTenantFeaturesForTests,
} from './tenant-features.js';

describe('G-805 institution scope', () => {
  const schoolPrincipal = {
    institutions: ['school-a', 'school-b'],
    roles: [{ roleId: 'principal' }],
  };
  const boardAdmin = {
    institutions: ['school-a'],
    roles: [{ roleId: 'board_admin' }],
  };

  it('treats principals with institutions as school-bound', () => {
    expect(isSchoolBound(schoolPrincipal)).toBe(true);
    expect(isBoardOrTenantAdmin(boardAdmin)).toBe(true);
    expect(isSchoolBound(boardAdmin)).toBe(false);
  });

  it('injects primary institutionId on scoped list routes', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/students', undefined)).toEqual({
      action: 'inject',
      institutionId: 'school-a',
    });
  });

  it('denies institutionId outside the caller set', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/fees/invoices', 'school-z')).toEqual({
      action: 'deny',
      institutionId: 'school-z',
    });
  });

  it('allows board admins to cross schools', () => {
    expect(decideInstitutionScope(boardAdmin, '/api/v1/students', 'school-z')).toEqual({
      action: 'allow',
    });
  });

  it('ignores unscoped prefixes', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/billing/plans', 'school-z')).toEqual({
      action: 'allow',
    });
  });

  it('extracts institutionId from query/params/body', () => {
    expect(extractInstitutionId({ query: { institutionId: 'a' } })).toBe('a');
    expect(extractInstitutionId({ params: { institution_id: 'b' } })).toBe('b');
    expect(extractInstitutionId({ body: { institutionId: 'c' } })).toBe('c');
  });
});

describe('G-810 feature entitlements', () => {
  afterEach(() => clearTenantFeaturesForTests());

  it('maps optional prefixes to feature keys', () => {
    expect(featureRequiredForPath('/api/v1/lms/assignments')).toBe('lms');
    expect(featureRequiredForPath('/api/v1/hostel')).toBe('hostel');
    expect(featureRequiredForPath('/api/v1/students')).toBeUndefined();
  });

  it('default-allows when no feature map is configured', () => {
    expect(missingFeatureForRequest('t1', null, '/api/v1/lms')).toBeNull();
  });

  it('denies when feature is explicitly false', () => {
    setTenantFeaturesForTests('t1', { lms: false, hostel: true });
    expect(missingFeatureForRequest('t1', null, '/api/v1/lms/pal')).toBe('lms');
    expect(missingFeatureForRequest('t1', null, '/api/v1/hostel')).toBeNull();
  });

  it('honours JWT features claim over env map', () => {
    setTenantFeaturesForTests('t1', { lms: false });
    expect(missingFeatureForRequest('t1', { features: { lms: true } }, '/api/v1/lms')).toBeNull();
    expect(resolveTenantFeatures('t1', { entitlements: ['hostel'] })).toEqual({ hostel: true });
  });

  it('closed-world: missing key in a declared map is denied', () => {
    expect(missingFeatureForRequest('t1', { features: { hostel: true } }, '/api/v1/lms')).toBe('lms');
  });
});
