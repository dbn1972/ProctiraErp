/**
 * Invite repository factory + invite service.
 *
 * Persistence is in-memory by default. Prisma User / UserInvite models are not
 * on main; do not auto-select Prisma when DATABASE_URL is set.
 */
import { ConflictError, ValidationError } from '@proctira/common';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

import { InMemoryUserInviteRepository } from './in-memory-invite-repository.js';
import type {
  InviteEmailSender,
  UserInviteEntity,
  UserInviteRepository,
} from './invite-repository.js';
import type { InviteUserInput, InviteUserResponse } from './schemas.js';

export interface InviteRepositoryConfig {
  /** Optional explicit repository (tests). */
  repository?: UserInviteRepository;
}

export function createUserInviteRepository(
  config: InviteRepositoryConfig = {},
): UserInviteRepository {
  return config.repository ?? new InMemoryUserInviteRepository();
}

export interface InviteServiceOptions {
  repository: UserInviteRepository;
  emailSender?: InviteEmailSender;
  /** Public web base URL used to build invite links. */
  inviteBaseUrl?: string;
  /** Invite TTL in days (default 7). */
  expiresInDays?: number;
}

export class InviteService {
  private readonly repository: UserInviteRepository;
  private readonly emailSender?: InviteEmailSender;
  private readonly inviteBaseUrl: string;
  private readonly expiresInDays: number;

  constructor(options: InviteServiceOptions) {
    this.repository = options.repository;
    this.emailSender = options.emailSender;
    this.inviteBaseUrl =
      options.inviteBaseUrl ??
      process.env['NEXT_PUBLIC_WEB_URL'] ??
      process.env['WEB_URL'] ??
      'http://localhost:3201';
    this.expiresInDays = options.expiresInDays ?? 7;
  }

  async inviteUser(
    tenantId: string,
    input: InviteUserInput,
    invitedBy?: string | null,
  ): Promise<InviteUserResponse> {
    const email = input.email.trim().toLowerCase();
    if (!email.includes('@')) {
      throw new ValidationError('A valid email address is required');
    }

    const existing = await this.repository.findPendingByEmail(tenantId, email);
    if (existing && existing.expiresAt > new Date()) {
      throw new ConflictError(`A pending invite already exists for ${email}`);
    }

    const displayName = input.displayName?.trim() || email.split('@')[0] || email;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.expiresInDays);

    const invite = await this.repository.create({
      id: uuidv4(),
      tenantId,
      email,
      displayName,
      roleId: input.roleId ?? null,
      token,
      status: 'pending',
      invitedBy: invitedBy ?? null,
      expiresAt,
      acceptedAt: null,
    });

    const inviteUrl = `${this.inviteBaseUrl.replace(/\/$/, '')}/auth/invite?token=${encodeURIComponent(token)}&tenantId=${encodeURIComponent(tenantId)}`;

    let emailSent = false;
    if (this.emailSender) {
      try {
        await this.emailSender.sendInviteEmail({
          to: email,
          displayName: invite.displayName,
          inviteUrl,
          tenantId,
        });
        emailSent = true;
      } catch {
        emailSent = false;
      }
    }

    return formatInviteResponse(invite, inviteUrl, emailSent);
  }
}

function formatInviteResponse(
  invite: UserInviteEntity,
  inviteUrl: string,
  emailSent: boolean,
): InviteUserResponse {
  return {
    id: invite.id,
    email: invite.email,
    displayName: invite.displayName,
    roleId: invite.roleId,
    status: invite.status,
    inviteUrl,
    expiresAt: invite.expiresAt.toISOString(),
    emailSent,
    createdAt: invite.createdAt.toISOString(),
  };
}
