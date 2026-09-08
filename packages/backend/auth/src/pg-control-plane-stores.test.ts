/**
 * Live smoke for the auth control-plane Postgres stores (G-704): invites,
 * OTP challenges and Keycloak identities. Skipped without DATABASE_URL.
 */
import { randomUUID } from 'node:crypto';

import { getSharedPgPool } from '@proctira/database';
import { describe, expect, it } from 'vitest';

import { PgUserInviteRepository } from './invite/pg-invite-repository.js';
import { linkKeycloakIdentity } from './keycloak/identity.js';
import { PgKeycloakIdentityStore } from './keycloak/pg-identity-store.js';
import { hashOtpCode } from './otp-service.js';
import { PgOtpChallengeStore } from './pg-otp-store.js';

const pool = getSharedPgPool();

describe('auth control-plane Postgres stores (live)', () => {
  it.skipIf(!pool)('invites are tenant-scoped and token lookups stay in-tenant', async () => {
    const repo = new PgUserInviteRepository(pool!);
    const tenantId = randomUUID();
    const token = randomUUID();
    await repo.create({
      id: randomUUID(),
      tenantId,
      email: 'invitee@example.edu',
      displayName: 'Invitee',
      roleId: 'teacher',
      token,
      status: 'pending',
      invitedBy: 'admin',
      expiresAt: new Date(Date.now() + 86_400_000),
      acceptedAt: null,
    });
    expect((await repo.findByToken(tenantId, token))?.email).toBe('invitee@example.edu');
    expect(await repo.findByToken(randomUUID(), token)).toBeNull();
    expect((await repo.findPendingByEmail(tenantId, 'INVITEE@example.edu '))?.token).toBe(token);
    expect(await repo.listByTenant(tenantId)).toHaveLength(1);
  });

  it.skipIf(!pool)('OTP challenges survive across store instances', async () => {
    const tenantId = randomUUID();
    const mfaToken = randomUUID();
    const id = randomUUID();
    await new PgOtpChallengeStore(pool!).create({
      id,
      mfaToken,
      userId: randomUUID(),
      tenantId,
      phone: '+911234567890',
      codeHash: hashOtpCode('123456'),
      expiresAt: new Date(Date.now() + 300_000),
      consumedAt: null,
      attemptCount: 0,
      createdAt: new Date(),
    });

    const second = new PgOtpChallengeStore(pool!);
    await second.incrementAttempts(id);
    await second.consume(id);
    const row = await second.findByToken(mfaToken);
    expect(row?.attemptCount).toBe(1);
    expect(row?.consumedAt).toBeInstanceOf(Date);
    expect(row?.expiresAt).toBeInstanceOf(Date);
  });

  it.skipIf(!pool)('Keycloak identities link once and are found on re-login', async () => {
    const store = new PgKeycloakIdentityStore(pool!);
    const tenantId = randomUUID();
    await store.seedTenant({ id: tenantId, slug: `kc-${tenantId.slice(0, 8)}` });
    const externalId = `kc-sub-${randomUUID()}`;

    const first = await linkKeycloakIdentity(
      {
        externalId,
        email: 'Teacher@Example.edu',
        displayName: 'Kc Teacher',
        tenantSlug: `kc-${tenantId.slice(0, 8)}`,
        realm: 'proctira',
      },
      store,
    );
    expect(first.tenantId).toBe(tenantId);
    expect(first.email).toBe('teacher@example.edu');

    const again = await linkKeycloakIdentity(
      { externalId, email: 'teacher@example.edu', displayName: 'Renamed', realm: 'proctira' },
      new PgKeycloakIdentityStore(pool!),
    );
    expect(again.userId).toBe(first.userId);
    expect(again.displayName).toBe('Kc Teacher');

    const strict = new PgKeycloakIdentityStore(pool!, { strictTenants: true });
    expect(await strict.findTenantById(randomUUID())).toBeNull();
  });
});
