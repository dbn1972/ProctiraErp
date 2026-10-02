/**
 * PRC-L237 — the gateway enforces exactly the shared `@proctira/auth` role
 * table that the web BFF gates UI with; no gateway-only grants.
 */
import { createCampusRoleDefinitions } from '@proctira/auth';
import { describe, expect, it } from 'vitest';
import { createGatewayRbacRegistry } from './rbac-registry.js';

describe('gateway RBAC registry', () => {
  it('is the shared campus role table, role for role', () => {
    const registry = createGatewayRbacRegistry();
    expect(registry.getAllRoles()).toEqual(createCampusRoleDefinitions());
  });
});
