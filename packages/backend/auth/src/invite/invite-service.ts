/**
 * Invite repository factory + invite service.
 */
import { ConflictError, ValidationError } from '@proctira/common';
import { createPrismaClient, getPrismaClient, withTenantTransaction } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';
import { randomBytes } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

import { InMemoryUserInviteRepository } from './in-memory-invite-repository.js';
import type {
  InviteEmailSender,
  UserInviteEntity,
  UserInviteRepository,
} from './invite-repository.js';
import { PrismaUserInviteRepository } from './prisma-invite-repository.js';
import type { InviteUserInput, InviteUserResponse } from './schemas.js';

export interface InviteRepositoryConfig {
  databaseUrl?: string;
  prisma?: PrismaClient;
}

export function createUserInviteRepository(
  config: InviteRepositoryConfig = {},
): UserInviteRepository {
  const prisma =
    config.prisma ??
    (config.databaseUrl
      ? createPrismaClient({ datasourceUrl: config.databaseUrl })
      : process.env['DATABASE_URL']
        ? getPrismaClient()
        : undefined);

  if (!prisma) return new InMemoryUserInviteRepository();
  return new PrismaUserInviteRepository(prisma);
}

export interface InviteServiceOptions {
  repository: UserInviteRepository;
  emailSender?: InviteEmailSender;
  /** Optional Prisma client for creating pending auth.users rows. */
  prisma?: PrismaClient;
  /** Public web base URL used to build invite links. */
  inviteBaseUrl?: string;
  /** Invite TTL in days (default 7). */
  expiresInDays?: number;
}

export class InviteService {
  private readonly repository: UserInviteRepository;
  private readonly emailSender?: InviteEmailSender;
  private readonly prisma?: PrismaClient;
  private readonly inviteBaseUrl: string;
  private readonly expiresInDays: number;

  constructor(options: InviteServiceOptions) {
    this.repository = options.repository;
    this.emailSender = options.emailSender;
    this.prisma =
      options.prisma ??
      (process.env['DATABASE_URL'] ? getPrismaClient() : undefined);
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
      throw new ValidationError('A valid email address is required', [
        { field: 'email', rule: 'format', message: 'Must be a valid email' },
      ]);
    }

    const existing = await this.repository.findPendingByEmail(tenantId, email);
    if (existing && existing.expiresAt > new Date()) {
      throw new ConflictError(`A pending invite already exists for ${email}`);
    }

    const displayName = input.displayName?.trim() || email.split('@')[0] || email;
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + this.expiresInDays);

    // Best-effort pending user projection (status=pending) in auth.users.
    if (this.prisma) {
      const existingUser = await withTenantTransaction(this.prisma, tenantId, async (tx) =>
        tx.user.findFirst({ where: { tenantId, email } }),
      );
      if (existingUser?.status === 'active') {
        throw new ConflictError(`User with email ${email} already exists`);
      }

      await withTenantTransaction(this.prisma, tenantId, async (tx) => {
        let user = await tx.user.findFirst({ where: { tenantId, email } });
        if (!user) {
          const nameParts = displayName.split(/\s+/);
          user = await tx.user.create({
            data: {
              id: uuidv4(),
              tenantId,
              email,
              displayName,
              firstName: nameParts[0] ?? displayName,
              lastName: nameParts.slice(1).join(' ') || displayName,
              status: 'pending',
            },
          });
        }

        if (input.roleId) {
          const assignment = await tx.userRoleAssignment.findFirst({
            where: { tenantId, userId: user.id, roleId: input.roleId },
          });
          if (!assignment) {
            await tx.userRoleAssignment.create({
              data: {
                id: uuidv4(),
                tenantId,
                userId: user.id,
                roleId: input.roleId,
              },
            });
          }
        }
      });
    }

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
