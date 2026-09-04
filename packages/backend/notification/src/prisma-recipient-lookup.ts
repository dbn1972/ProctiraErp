/**
 * Prisma-backed recipient membership ports.
 *
 * Reads `auth.user_role_assignments` sequentially per criterion (role / area /
 * institution) under RLS via {@link withTenantTransaction}. Results are merged
 * by the CrossModule lookup — no cross-schema SQL JOINs.
 */
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  RecipientAreaPort,
  RecipientInstitutionPort,
  RecipientRolePort,
} from './cross-module-recipient-lookup.js';

/**
 * Single Prisma adapter implementing all three recipient membership ports
 * against the auth-schema `UserRoleAssignment` projection.
 */
export class PrismaRecipientMembershipPorts
  implements RecipientRolePort, RecipientAreaPort, RecipientInstitutionPort
{
  constructor(private readonly prisma: PrismaClient) {}

  async findUserIdsByRoleIds(
    tenantId: string,
    roleIds: string[],
  ): Promise<string[]> {
    if (roleIds.length === 0) return [];
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.userRoleAssignment.findMany({
        where: { tenantId, roleId: { in: roleIds } },
        select: { userId: true },
      });
      return [...new Set(rows.map((r) => r.userId))];
    });
  }

  async findUserIdsByAreaIds(
    tenantId: string,
    areaIds: string[],
  ): Promise<string[]> {
    if (areaIds.length === 0) return [];
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.userRoleAssignment.findMany({
        where: { tenantId, areaId: { in: areaIds } },
        select: { userId: true },
      });
      return [...new Set(rows.map((r) => r.userId))];
    });
  }

  async findUserIdsByInstitutionIds(
    tenantId: string,
    institutionIds: string[],
  ): Promise<string[]> {
    if (institutionIds.length === 0) return [];
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = await tx.userRoleAssignment.findMany({
        where: { tenantId, institutionId: { in: institutionIds } },
        select: { userId: true },
      });
      return [...new Set(rows.map((r) => r.userId))];
    });
  }
}
