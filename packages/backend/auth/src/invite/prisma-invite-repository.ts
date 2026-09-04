/**
 * Prisma-backed user invite repository (auth.user_invites).
 */
import { withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  InviteStatus,
  UserInviteEntity,
  UserInviteRepository,
} from './invite-repository.js';

interface InviteRow {
  id: string;
  tenantId: string;
  email: string;
  displayName: string | null;
  roleId: string | null;
  token: string;
  status: string;
  invitedBy: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toEntity(row: InviteRow): UserInviteEntity {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    displayName: row.displayName,
    roleId: row.roleId,
    token: row.token,
    status: row.status as InviteStatus,
    invitedBy: row.invitedBy,
    expiresAt: row.expiresAt,
    acceptedAt: row.acceptedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaUserInviteRepository implements UserInviteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    entity: Omit<UserInviteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<UserInviteEntity> {
    return withTenantTransaction(this.prisma, entity.tenantId, async (tx) => {
      const row = (await tx.userInvite.create({
        data: {
          id: entity.id,
          tenantId: entity.tenantId,
          email: entity.email,
          displayName: entity.displayName,
          roleId: entity.roleId,
          token: entity.token,
          status: entity.status,
          invitedBy: entity.invitedBy,
          expiresAt: entity.expiresAt,
          acceptedAt: entity.acceptedAt,
        },
      })) as InviteRow;
      return toEntity(row);
    });
  }

  async findByToken(tenantId: string, token: string): Promise<UserInviteEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.userInvite.findFirst({
        where: { tenantId, token },
      })) as InviteRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async findPendingByEmail(tenantId: string, email: string): Promise<UserInviteEntity | null> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const row = (await tx.userInvite.findFirst({
        where: { tenantId, email: email.trim().toLowerCase(), status: 'pending' },
        orderBy: { createdAt: 'desc' },
      })) as InviteRow | null;
      return row ? toEntity(row) : null;
    });
  }

  async listByTenant(tenantId: string): Promise<UserInviteEntity[]> {
    return withTenantTransaction(this.prisma, tenantId, async (tx) => {
      const rows = (await tx.userInvite.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
      })) as InviteRow[];
      return rows.map(toEntity);
    });
  }
}
