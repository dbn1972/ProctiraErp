/**
 * Prisma-backed OTP challenge store (auth.otp_challenges).
 */
import { getPrismaClient, type PrismaClient } from '@proctira/database';

import type { OtpChallengeRecord, OtpChallengeStore } from './otp-service.js';

type OtpRow = {
  id: string;
  mfaToken: string;
  userId: string;
  tenantId: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  consumedAt: Date | null;
  attemptCount: number;
  createdAt: Date;
};

function toRecord(row: OtpRow): OtpChallengeRecord {
  return {
    id: row.id,
    mfaToken: row.mfaToken,
    userId: row.userId,
    tenantId: row.tenantId,
    phone: row.phone,
    codeHash: row.codeHash,
    expiresAt: row.expiresAt,
    consumedAt: row.consumedAt,
    attemptCount: row.attemptCount,
    createdAt: row.createdAt,
  };
}

export class PrismaOtpChallengeStore implements OtpChallengeStore {
  constructor(private readonly prisma: PrismaClient = getPrismaClient()) {}

  async create(record: OtpChallengeRecord): Promise<OtpChallengeRecord> {
    const row = (await this.prisma.otpChallenge.create({
      data: {
        id: record.id,
        mfaToken: record.mfaToken,
        userId: record.userId,
        tenantId: record.tenantId,
        phone: record.phone,
        codeHash: record.codeHash,
        expiresAt: record.expiresAt,
        consumedAt: record.consumedAt,
        attemptCount: record.attemptCount,
        createdAt: record.createdAt,
      },
    })) as OtpRow;
    return toRecord(row);
  }

  async findByToken(mfaToken: string): Promise<OtpChallengeRecord | null> {
    const row = (await this.prisma.otpChallenge.findUnique({
      where: { mfaToken },
    })) as OtpRow | null;
    return row ? toRecord(row) : null;
  }

  async incrementAttempts(id: string): Promise<void> {
    await this.prisma.otpChallenge.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  async consume(id: string): Promise<void> {
    await this.prisma.otpChallenge.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }
}
