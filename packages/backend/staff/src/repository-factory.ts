/**
 * Staff repository composition.
 *
 *   - `DATABASE_URL` set → Prisma repositories (Postgres + RLS)
 *   - otherwise          → in-memory repositories (dev / tests)
 */
import { createPrismaClient } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type { AppraisalRepository, AppraisalTemplateRepository } from './appraisal-repository.js';
import type { StaffAssignmentRepository } from './assignment-repository.js';
import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';
import { InMemoryAssignmentRepository } from './in-memory-assignment-repository.js';
import { InMemoryStaffRepository } from './in-memory-repository.js';
import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import {
  PrismaAppraisalRepository,
  PrismaAppraisalTemplateRepository,
} from './prisma-appraisal-repository.js';
import { PrismaAssignmentRepository } from './prisma-assignment-repository.js';
import { PrismaStaffRepository } from './prisma-staff-repository.js';
import {
  PrismaCertificationRepository,
  PrismaTrainingAttendanceRepository,
  PrismaTrainingProgramRepository,
  PrismaTrainingSessionRepository,
} from './prisma-training-repository.js';
import type { StaffRepository } from './staff-repository.js';
import type {
  CertificationRepository,
  TrainingAttendanceRepository,
  TrainingProgramRepository,
  TrainingSessionRepository,
} from './training-repository.js';

export interface StaffRepositoryConfig {
  databaseUrl?: string;
  prismaClient?: PrismaClient;
}

function resolvePrismaClient(config: StaffRepositoryConfig): PrismaClient | null {
  if (config.prismaClient) return config.prismaClient;
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return null;
  return createPrismaClient({ datasourceUrl: databaseUrl });
}

export function createStaffRepository(
  config: StaffRepositoryConfig = {},
): StaffRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) {
    return new InMemoryStaffRepository();
  }
  return new PrismaStaffRepository(prisma);
}

export function createAssignmentRepository(
  config: StaffRepositoryConfig = {},
): StaffAssignmentRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) {
    return new InMemoryAssignmentRepository();
  }
  return new PrismaAssignmentRepository(prisma);
}

export function createAppraisalTemplateRepository(
  config: StaffRepositoryConfig = {},
): AppraisalTemplateRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryAppraisalTemplateRepository();
  return new PrismaAppraisalTemplateRepository(prisma);
}

export function createAppraisalRepository(
  config: StaffRepositoryConfig = {},
): AppraisalRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryAppraisalRepository();
  return new PrismaAppraisalRepository(prisma);
}

export function createTrainingProgramRepository(
  config: StaffRepositoryConfig = {},
): TrainingProgramRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryTrainingProgramRepository();
  return new PrismaTrainingProgramRepository(prisma);
}

export function createTrainingSessionRepository(
  config: StaffRepositoryConfig = {},
): TrainingSessionRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryTrainingSessionRepository();
  return new PrismaTrainingSessionRepository(prisma);
}

export function createTrainingAttendanceRepository(
  config: StaffRepositoryConfig = {},
): TrainingAttendanceRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryTrainingAttendanceRepository();
  return new PrismaTrainingAttendanceRepository(prisma);
}

export function createCertificationRepository(
  config: StaffRepositoryConfig = {},
): CertificationRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryCertificationRepository();
  return new PrismaCertificationRepository(prisma);
}
