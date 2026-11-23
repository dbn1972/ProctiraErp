/**
 * DR4-1 / PRC-M027 / PRC-L298 — credential-principal authorization is a
 * complete decision: no early "allow" exit (unguarded mutation, gateway
 * utility, self-service read, unmapped path) applies to SCIM tokens or API keys.
 */
import { describe, expect, it } from 'vitest';

import {
  authorizeCredentialPrincipal,
  CREDENTIAL_HARD_DENY_RESOURCES,
  SHIPPED_API_KEY_SCOPE_TABLE,
  type ApiKeyScopeGrant,
} from './credential-principals.js';

const table: Record<string, ApiKeyScopeGrant> = {
  'institutions:read': { resource: 'institution', action: 'read' },
  'notifications:read': { resource: 'notification', action: 'read' },
};
const apiKey = (scopes: string[]) => ({ credential: 'apikey' as const, scopes });
const scim = { credential: 'scim' as const };

describe('authorizeCredentialPrincipal (DR4-1)', () => {
  it('the shipped API-key scope table is empty', () => {
    expect(Object.keys(SHIPPED_API_KEY_SCOPE_TABLE)).toEqual([]);
    expect(
      authorizeCredentialPrincipal({
        principal: apiKey(['institutions:read']),
        method: 'GET',
        path: '/api/v1/institutions',
        apiKeyScopeTable: SHIPPED_API_KEY_SCOPE_TABLE,
      }).ok,
    ).toBe(false);
  });

  it.each([
    ['GET', '/api/v1/meta/error-codes'],
    ['GET', '/api/v1/services'],
    ['POST', '/api/v1/storage/presign'],
    ['GET', '/api/v1/billing/me/entitlements'],
    ['GET', '/api/v1/parent-portal/children'],
    ['GET', '/api/v1/__unmapped__/x'],
    ['POST', '/api/v1/__no_such_domain__/mutate'],
  ] as const)('%s %s is denied for SCIM tokens and API keys', (method, path) => {
    for (const principal of [scim, apiKey(['institutions:read', 'notifications:read'])]) {
      expect(
        authorizeCredentialPrincipal({ principal, method, path, apiKeyScopeTable: table }).ok,
      ).toBe(false);
    }
  });

  it('a mapped self-service resource is still only what the table grants (read)', () => {
    expect(
      authorizeCredentialPrincipal({
        principal: apiKey(['notifications:read']),
        method: 'GET',
        path: '/api/v1/notifications',
        apiKeyScopeTable: table,
      }).ok,
    ).toBe(true);
    expect(
      authorizeCredentialPrincipal({
        principal: apiKey(['notifications:read']),
        method: 'POST',
        path: '/api/v1/notifications',
        apiKeyScopeTable: table,
      }).ok,
    ).toBe(false);
  });

  it('SCIM: user:manage covers every SCIM verb on /scim/v2 and nothing elsewhere', () => {
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(
        authorizeCredentialPrincipal({
          principal: scim,
          method,
          path: '/api/v1/scim/v2/Users/abc',
          apiKeyScopeTable: table,
        }).ok,
        method,
      ).toBe(true);
    }
    expect(
      authorizeCredentialPrincipal({
        principal: scim,
        method: 'GET',
        path: '/api/v1/tenant/users',
        apiKeyScopeTable: table,
      }).ok,
    ).toBe(false);
  });

  it('the hard-deny list wins over any table entry', () => {
    for (const resource of CREDENTIAL_HARD_DENY_RESOURCES) {
      const injected = { x: { resource, action: 'read' as const } };
      const path =
        resource === 'case'
          ? '/api/v1/workflow-engine/cases'
          : resource === 'platform'
            ? '/api/v1/tenants'
            : resource === 'user'
              ? '/api/v1/tenant/users'
              : resource === 'billing-self'
                ? '/api/v1/billing/me/entitlements'
                : `/api/v1/${resource}`;
      expect(
        authorizeCredentialPrincipal({
          principal: apiKey(['x']),
          method: 'GET',
          path,
          apiKeyScopeTable: injected,
        }).ok,
        resource,
      ).toBe(false);
    }
  });
});
