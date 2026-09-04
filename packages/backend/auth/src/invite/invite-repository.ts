/**
 * User invite repository contract (auth schema).
 */
export type InviteStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface UserInviteEntity {
  id: string;
  tenantId: string;
  email: string;
  displayName: string | null;
  roleId: string | null;
  token: string;
  status: InviteStatus;
  invitedBy: string | null;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UserInviteRepository {
  create(entity: Omit<UserInviteEntity, 'createdAt' | 'updatedAt'>): Promise<UserInviteEntity>;
  findByToken(tenantId: string, token: string): Promise<UserInviteEntity | null>;
  findPendingByEmail(tenantId: string, email: string): Promise<UserInviteEntity | null>;
  listByTenant(tenantId: string): Promise<UserInviteEntity[]>;
}

/**
 * Optional email sender. When missing, invites still persist and return inviteUrl.
 */
export interface InviteEmailSender {
  sendInviteEmail(input: {
    to: string;
    displayName: string | null;
    inviteUrl: string;
    tenantId: string;
  }): Promise<void>;
}
