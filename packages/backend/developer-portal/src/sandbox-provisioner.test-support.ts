/**
 * PRC-M218 test support: a recording sandbox tenant provisioner (stands in for the tenant
 * lifecycle service the gateway adapts).
 */
import { randomUUID } from 'node:crypto';

import type { SandboxTenantProvisioner } from './developer-portal-service.js';

export interface RecordingSandboxProvisioner extends SandboxTenantProvisioner {
  provisioned: string[];
  tornDown: string[];
}

export function recordingSandboxProvisioner(
  overrides: Partial<SandboxTenantProvisioner> = {},
): RecordingSandboxProvisioner {
  const provisioned: string[] = [];
  const tornDown: string[] = [];
  return {
    provisioned,
    tornDown,
    provisionSandboxTenant:
      overrides.provisionSandboxTenant ??
      (async () => {
        const tenantId = randomUUID();
        provisioned.push(tenantId);
        return { tenantId };
      }),
    teardownSandboxTenant:
      overrides.teardownSandboxTenant ??
      (async (tenantId) => {
        tornDown.push(tenantId);
      }),
  };
}
