/**
 * PRC-L237 — web route guards use the shared gateway role table, with no
 * web-only duplicated grants.
 */
import { createCampusRoleDefinitions } from '@proctira/auth';
import { describe, expect, it } from 'vitest';
import { createWebRbacRegistry } from './web-rbac-registry';

describe('web RBAC registry', () => {
  it('matches the shared gateway role table exactly', () => {
    const registry = createWebRbacRegistry();
    expect(registry.getAllRoles()).toEqual(createCampusRoleDefinitions());
  });
});
