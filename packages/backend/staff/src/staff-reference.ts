/**
 * PRC-M374: verify a staff id belongs to the caller's tenant before any HR
 * sub-record (leave, assignment, appraisal, training attendance, certification)
 * references it. Misses are 404 so other tenants' ids are not disclosed.
 */
import { NotFoundError } from '@proctira/common';

export type StaffExistsCheck = (tenantId: string, staffId: string) => Promise<boolean>;

export async function assertStaffInTenant(
  check: StaffExistsCheck | undefined,
  tenantId: string,
  staffId: string,
): Promise<void> {
  if (!check) return;
  if (!(await check(tenantId, staffId))) {
    throw new NotFoundError(`Staff with id '${staffId}' not found`);
  }
}
