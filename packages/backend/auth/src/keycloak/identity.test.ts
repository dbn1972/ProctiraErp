import { describe, expect, it, vi } from 'vitest';

import {
  KeycloakIdentityError,
  identityInputFromClaims,
  linkKeycloakIdentity,
  type KeycloakIdentityStore,
} from './identity.js';

function createStore(overrides: Partial<KeycloakIdentityStore> = {}): KeycloakIdentityStore {
  return {
    findIdentity: vi.fn().mockResolvedValue(null),
    touchIdentity: vi.fn().mockResolvedValue(undefined),
    findUserByEmail: vi.fn().mockResolvedValue(null),
    findTenantById: vi.fn().mockResolvedValue(null),
    findTenantBySlug: vi.fn().mockResolvedValue({ id: 'tenant-india' }),
    createUser: vi.fn().mockResolvedValue({
      id: 'user-new',
      tenantId: 'tenant-india',
      email: 'teacher@school.in',
      displayName: 'New Teacher',
      countryCode: 'IN',
    }),
    createIdentity: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe('linkKeycloakIdentity', () => {
  it('reuses an existing Keycloak identity and touches last-used', async () => {
    const store = createStore({
      findIdentity: vi.fn().mockResolvedValue({
        id: 'ident-1',
        userId: 'user-1',
        tenantId: 'tenant-india',
        email: 'admin@proctira.in',
      }),
      findUserByEmail: vi.fn().mockResolvedValue({
        id: 'user-1',
        tenantId: 'tenant-india',
        email: 'admin@proctira.in',
        displayName: 'India Admin',
        countryCode: 'IN',
      }),
    });

    const linked = await linkKeycloakIdentity(
      {
        externalId: 'kc-1',
        email: 'admin@proctira.in',
        displayName: 'India Admin',
        realm: 'proctira',
      },
      store,
    );

    expect(linked.userId).toBe('user-1');
    expect(store.touchIdentity).toHaveBeenCalledWith('ident-1');
    expect(store.createUser).not.toHaveBeenCalled();
  });

  it('links a provisioned tenant admin by email on first Keycloak login', async () => {
    const store = createStore({
      findUserByEmail: vi.fn().mockResolvedValue({
        id: 'user-admin',
        tenantId: 'tenant-india',
        email: 'admin@proctira.in',
        displayName: 'India Admin',
        countryCode: 'IN',
      }),
    });

    const linked = await linkKeycloakIdentity(
      {
        externalId: 'kc-admin',
        email: 'Admin@proctira.in',
        displayName: 'India Admin',
        tenantSlug: 'india',
        realm: 'proctira',
      },
      store,
    );

    expect(linked.userId).toBe('user-admin');
    expect(store.createIdentity).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-admin',
        externalId: 'kc-admin',
        email: 'admin@proctira.in',
      }),
    );
    expect(store.createUser).not.toHaveBeenCalled();
  });

  it('creates a user when Keycloak sends a known tenant_slug', async () => {
    const store = createStore();
    const linked = await linkKeycloakIdentity(
      {
        externalId: 'kc-teacher',
        email: 'teacher@school.in',
        displayName: 'New Teacher',
        firstName: 'New',
        lastName: 'Teacher',
        tenantSlug: 'india',
        countryCode: 'IN',
        realm: 'proctira',
      },
      store,
    );

    expect(linked.userId).toBe('user-new');
    expect(store.findTenantBySlug).toHaveBeenCalledWith('india');
    expect(store.createUser).toHaveBeenCalled();
    expect(store.createIdentity).toHaveBeenCalled();
  });

  it('rejects a Keycloak user that cannot be mapped to a tenant', async () => {
    const store = createStore({
      findTenantBySlug: vi.fn().mockResolvedValue(null),
    });

    await expect(
      linkKeycloakIdentity(
        {
          externalId: 'kc-orphan',
          email: 'orphan@proctira.in',
          displayName: 'Orphan',
          realm: 'proctira',
        },
        store,
      ),
    ).rejects.toBeInstanceOf(KeycloakIdentityError);
  });
});

describe('identityInputFromClaims', () => {
  it('reads tenant_slug and country from Keycloak claims', () => {
    const input = identityInputFromClaims(
      {
        sub: 'kc-1',
        iss: 'http://127.0.0.1:8180/realms/proctira',
        exp: 1,
        email: 'admin@proctira.in',
        given_name: 'India',
        family_name: 'Admin',
        tenant_slug: 'india',
        country: 'IN',
      },
      'proctira',
    );

    expect(input.externalId).toBe('kc-1');
    expect(input.tenantSlug).toBe('india');
    expect(input.countryCode).toBe('IN');
    expect(input.displayName).toBe('India Admin');
  });

  it('falls back to preferred_username when Keycloak omitted sub', () => {
    const input = identityInputFromClaims(
      {
        sub: '',
        iss: 'http://127.0.0.1:8180/realms/proctira',
        exp: 1,
        preferred_username: 'india-admin',
        email: 'admin@proctira.in',
      },
      'proctira',
    );
    expect(input.externalId).toBe('india-admin');
  });
});
