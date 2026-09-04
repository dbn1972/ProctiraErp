/**
 * In-memory invite repository (tests / no DATABASE_URL).
 */
import type { UserInviteEntity, UserInviteRepository } from './invite-repository.js';

export class InMemoryUserInviteRepository implements UserInviteRepository {
  private invites: UserInviteEntity[] = [];

  async create(
    entity: Omit<UserInviteEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<UserInviteEntity> {
    const now = new Date();
    const record: UserInviteEntity = { ...entity, createdAt: now, updatedAt: now };
    this.invites.push(record);
    return { ...record };
  }

  async findByToken(tenantId: string, token: string): Promise<UserInviteEntity | null> {
    return this.invites.find((i) => i.tenantId === tenantId && i.token === token) ?? null;
  }

  async findPendingByEmail(tenantId: string, email: string): Promise<UserInviteEntity | null> {
    const normalized = email.trim().toLowerCase();
    return (
      this.invites.find(
        (i) =>
          i.tenantId === tenantId &&
          i.email === normalized &&
          i.status === 'pending',
      ) ?? null
    );
  }

  async listByTenant(tenantId: string): Promise<UserInviteEntity[]> {
    return this.invites.filter((i) => i.tenantId === tenantId).map((i) => ({ ...i }));
  }

  clear(): void {
    this.invites = [];
  }
}
