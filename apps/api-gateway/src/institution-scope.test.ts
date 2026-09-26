import { afterEach, describe, expect, it } from 'vitest';
import {
  decideInstitutionScope,
  extractInstitutionId,
  isBoardOrTenantAdmin,
  isInstitutionInjectionMethod,
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

  it('injects primary institutionId on scoped GET list routes', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/students', undefined, 'GET')).toEqual({
      action: 'inject',
      institutionId: 'school-a',
    });
  });

  it('injects on HEAD the same as GET', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/students', undefined, 'HEAD')).toEqual({
      action: 'inject',
      institutionId: 'school-a',
    });
  });

  it('is case-insensitive on method', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/students', undefined, 'get')).toEqual({
      action: 'inject',
      institutionId: 'school-a',
    });
  });

  it('does NOT inject on mutating methods (G-805-FIX-1) — no route reads query.institutionId on a write, so a missing institutionId should pass through untouched rather than default to the primary school', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        decideInstitutionScope(schoolPrincipal, '/api/v1/students', undefined, method),
      ).toEqual({ action: 'allow' });
    }
  });

  it('treats an omitted method the same as a mutating method (defensive default: no method means no injection)', () => {
    expect(decideInstitutionScope(schoolPrincipal, '/api/v1/students', undefined)).toEqual({
      action: 'allow',
    });
  });

  it('still denies an out-of-scope explicit institutionId on a mutating method — the deny check is not method-scoped', () => {
    expect(
      decideInstitutionScope(schoolPrincipal, '/api/v1/fees/invoices', 'school-z', 'POST'),
    ).toEqual({
      action: 'deny',
      institutionId: 'school-z',
    });
  });

  it('still allows an explicit in-scope institutionId on a mutating method', () => {
    expect(
      decideInstitutionScope(schoolPrincipal, '/api/v1/fees/invoices', 'school-b', 'PUT'),
    ).toEqual({ action: 'allow' });
  });

  it('denies institutionId outside the caller set (GET)', () => {
    expect(
      decideInstitutionScope(schoolPrincipal, '/api/v1/fees/invoices', 'school-z', 'GET'),
    ).toEqual({
      action: 'deny',
      institutionId: 'school-z',
    });
  });

  it('allows board admins to cross schools regardless of method', () => {
    expect(decideInstitutionScope(boardAdmin, '/api/v1/students', 'school-z', 'POST')).toEqual({
      action: 'allow',
    });
  });

  it('ignores unscoped prefixes regardless of method', () => {
    expect(
      decideInstitutionScope(schoolPrincipal, '/api/v1/billing/plans', 'school-z', 'POST'),
    ).toEqual({
      action: 'allow',
    });
  });

  it('isInstitutionInjectionMethod is true for GET and HEAD, case-insensitively', () => {
    expect(isInstitutionInjectionMethod('GET')).toBe(true);
    expect(isInstitutionInjectionMethod('get')).toBe(true);
    expect(isInstitutionInjectionMethod('HEAD')).toBe(true);
    expect(isInstitutionInjectionMethod('head')).toBe(true);
  });

  it('isInstitutionInjectionMethod is false for mutating methods', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(isInstitutionInjectionMethod(method)).toBe(false);
    }
  });

  it('isInstitutionInjectionMethod is false for undefined', () => {
    expect(isInstitutionInjectionMethod(undefined)).toBe(false);
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
    expect(missingFeatureForRequest('t1', { features: { hostel: true } }, '/api/v1/lms')).toBe(
      'lms',
    );
  });
});
