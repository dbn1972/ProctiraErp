/**
 * Test-only TenantAdminProvisioner that records requests and returns a
 * deterministic admin id. Not exported from the package entry point.
 */
import type { TenantAdminProvisioner, TenantAdminProvisioningRequest } from './tenant-service.js';

export class RecordingAdminProvisioner implements TenantAdminProvisioner {
  readonly requests: TenantAdminProvisioningRequest[] = [];

  constructor(private readonly failWith?: Error) {}

  provisionTenantAdmin(request: TenantAdminProvisioningRequest): Promise<{ adminUserId: string }> {
    this.requests.push(request);
    if (this.failWith) return Promise.reject(this.failWith);
    return Promise.resolve({ adminUserId: `admin-of-${request.tenantId}` });
  }
}
