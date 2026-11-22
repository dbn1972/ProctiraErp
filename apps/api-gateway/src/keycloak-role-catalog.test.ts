/**
 * UATENV-D07: in Keycloak mode the gateway kept only the six realm roles
 * (super-admin, admin, principal, teacher, staff, guardian) and dropped every
 * other gateway catalogue role, so a Keycloak-issued token for a warden,
 * bursar, registrar, transport officer, nurse or student reached RBAC with
 * `roles: []` and got 403 everywhere.
 *
 * The gateway now hands its RBAC registry roles to the Keycloak verifier, so a
 * realm role is kept exactly when the gateway registry defines it. Keycloak's
 * own roles (offline_access, default-roles-*) and roles the registry does not
 * define still map to nothing.
 */
import { generateKeyPairSync, sign } from 'node:crypto';
import { KeycloakJwksClient, verifyKeycloakAccessToken } from '@proctira/backend-auth';
import { describe, expect, it } from 'vitest';
import { loadGatewayKeycloakConfig } from './keycloak-config.js';
import { createGatewayRbacRegistry } from './rbac-registry.js';

const ISSUER = 'https://keycloak.test/realms/proctira';
const ENV = {
  KEYCLOAK_ISSUER: ISSUER,
  KEYCLOAK_CLIENT_ID: 'proctira-gateway',
} as NodeJS.ProcessEnv;

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();

function signRs256(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k1' })).toString(
    'base64url',
  );
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signed = `${header}.${body}`;
  return `${signed}.${sign('RSA-SHA256', Buffer.from(signed), pem).toString('base64url')}`;
}

const jwks = new KeycloakJwksClient(
  `${ISSUER}/protocol/openid-connect/certs`,
  async () => new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'k1', kty: 'RSA' }] })),
);

async function rolesFor(realmRoles: string[]): Promise<string[]> {
  const config = loadGatewayKeycloakConfig(ENV);
  if (!config) throw new Error('Keycloak config expected');
  const now = 1_700_000_000;
  const token = signRs256({
    sub: 'kc-user',
    iss: ISSUER,
    exp: now + 300,
    iat: now,
    azp: 'proctira-gateway',
    tenant_id: '11111111-1111-1111-1111-111111111111',
    realm_access: { roles: realmRoles },
  });
  const payload = await verifyKeycloakAccessToken(token, config, jwks, now);
  return payload.roles.map((role) => role.roleId);
}

describe('gateway Keycloak role catalogue (UATENV-D07)', () => {
  it('keeps the UAT catalogue roles the six realm roles used to drop', async () => {
    const roles = ['bursar', 'registrar', 'warden', 'transport_officer', 'nurse', 'student'];
    expect(await rolesFor(roles)).toEqual(roles);
  });

  it('keeps every role the gateway RBAC registry defines', async () => {
    const registryRoleIds = createGatewayRbacRegistry()
      .getAllRoles()
      .map((role) => role.roleId);
    expect(await rolesFor(registryRoleIds)).toEqual(registryRoleIds);
  });

  it('still drops Keycloak-only roles and roles the registry does not define', async () => {
    expect(
      await rolesFor(['offline_access', 'uma_authorization', 'default-roles-proctira', 'teacher']),
    ).toEqual(['teacher']);
    expect(await rolesFor(['not-a-platform-role'])).toEqual([]);
  });

  it('is undefined when Keycloak is not configured', () => {
    expect(loadGatewayKeycloakConfig({} as NodeJS.ProcessEnv)).toBeUndefined();
  });
});
