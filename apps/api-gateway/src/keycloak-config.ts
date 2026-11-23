/**
 * Gateway Keycloak configuration (UATENV-D07).
 *
 * `loadKeycloakAuthConfig` alone keeps only the six realm roles, which dropped
 * every other gateway catalogue role (warden, bursar, registrar, nurse,
 * transport_officer, student, ...) from Keycloak tokens. The gateway passes its
 * own RBAC registry roles as the catalogue, so a realm role is kept exactly when
 * the registry grants it something. Roles the registry does not define still
 * map to nothing.
 */
import { loadKeycloakAuthConfig, type KeycloakAuthConfig } from '@proctira/backend-auth';

import { createGatewayRbacRegistry } from './rbac-registry.js';

export function loadGatewayKeycloakConfig(
  env: NodeJS.ProcessEnv = process.env,
): KeycloakAuthConfig | undefined {
  const config = loadKeycloakAuthConfig(env);
  if (!config) return undefined;
  const roleCatalog = createGatewayRbacRegistry()
    .getAllRoles()
    .map(({ roleId, roleName }) => ({ roleId, roleName }));
  return { ...config, roleCatalog };
}
