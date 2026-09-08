/**
 * Postgres invite repository (G-704) on `control_plane_documents`.
 * Invites are tenant-scoped documents; token lookups are exact-match on the
 * JSONB payload so the invite token never leaves the tenant boundary.
 */
import { PgDocumentCollection, type PgPoolWithConnect, type PgQueryable } from '@proctira/database';

import type { UserInviteEntity, UserInviteRepository } from './invite-repository.js';

export class PgUserInviteRepository implements UserInviteRepository {
  private readonly invites: PgDocumentCollection<UserInviteEntity>;

  constructor(pool: PgPoolWithConnect | PgQueryable) {
    this.invites = new PgDocumentCollection<UserInviteEntity>(pool, 'auth.invites');
  }

  async create(
    entity: Omit<UserInviteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<UserInviteEntity> {
    const now = new Date();
    const record: UserInviteEntity = { ...entity, createdAt: now, updatedAt: now };
    return this.invites.put(record.id, record, record.tenantId);
  }

  findByToken(tenantId: string, token: string): Promise<UserInviteEntity | null> {
    return this.invites.first({ token } as Partial<UserInviteEntity>, tenantId);
  }

  findPendingByEmail(tenantId: string, email: string): Promise<UserInviteEntity | null> {
    const normalized = email.trim().toLowerCase();
    return this.invites.first(
      { email: normalized, status: 'pending' } as Partial<UserInviteEntity>,
      tenantId,
    );
  }

  listByTenant(tenantId: string): Promise<UserInviteEntity[]> {
    return this.invites.byTenant(tenantId);
  }
}
