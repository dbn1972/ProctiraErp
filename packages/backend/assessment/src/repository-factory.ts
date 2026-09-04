/**
 * Assessment repository composition.
 *
 *   - `DATABASE_URL` set → Prisma repositories (Postgres + RLS)
 *   - otherwise          → in-memory repositories (dev / tests)
 *
 * Mirrors the staff/attendance repository factories so the standalone
 * service and the API gateway compose persistence identically.
 */
import { createPrismaClient } from '@proctira/database';
import type { PrismaClient } from '@proctira/database';

import type {
  GradingSchemeRepository,
  AssessmentItemRepository,
  OutcomeRepository,
} from './assessment-repository.js';
import type { AssessmentResultRepository } from './result-repository.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import {
  PrismaGradingSchemeRepository,
  PrismaAssessmentItemRepository,
  PrismaOutcomeRepository,
} from './prisma-repository.js';
import { PrismaAssessmentResultRepository } from './prisma-result-repository.js';
import {
  PrismaInstitutionBrandingRepository,
  PrismaReportCardJobRepository,
  PrismaReportCardTemplateRepository,
  PrismaTeacherCommentRepository,
} from './prisma-report-card-repository.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import type {
  InstitutionBrandingRepository,
  ReportCardJobRepository,
  ReportCardTemplateRepository,
  TeacherCommentRepository,
} from './report-card-repository.js';

export interface AssessmentRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /** Reuse an existing Prisma client instead of creating a new one. */
  prismaClient?: PrismaClient;
}

function resolvePrismaClient(
  config: AssessmentRepositoryConfig,
): PrismaClient | null {
  if (config.prismaClient) return config.prismaClient;
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) return null;
  return createPrismaClient({ datasourceUrl: databaseUrl });
}

export function createGradingSchemeRepository(
  config: AssessmentRepositoryConfig = {},
): GradingSchemeRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryGradingSchemeRepository();
  return new PrismaGradingSchemeRepository(prisma);
}

export function createAssessmentItemRepository(
  config: AssessmentRepositoryConfig = {},
): AssessmentItemRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryAssessmentItemRepository();
  return new PrismaAssessmentItemRepository(prisma);
}

export function createOutcomeRepository(
  config: AssessmentRepositoryConfig = {},
): OutcomeRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryOutcomeRepository();
  return new PrismaOutcomeRepository(prisma);
}

export function createAssessmentResultRepository(
  config: AssessmentRepositoryConfig = {},
): AssessmentResultRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryAssessmentResultRepository();
  return new PrismaAssessmentResultRepository(prisma);
}

export function createReportCardTemplateRepository(
  config: AssessmentRepositoryConfig = {},
): ReportCardTemplateRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryReportCardTemplateRepository();
  return new PrismaReportCardTemplateRepository(prisma);
}

export function createTeacherCommentRepository(
  config: AssessmentRepositoryConfig = {},
): TeacherCommentRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryTeacherCommentRepository();
  return new PrismaTeacherCommentRepository(prisma);
}

export function createInstitutionBrandingRepository(
  config: AssessmentRepositoryConfig = {},
): InstitutionBrandingRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryInstitutionBrandingRepository();
  return new PrismaInstitutionBrandingRepository(prisma);
}

export function createReportCardJobRepository(
  config: AssessmentRepositoryConfig = {},
): ReportCardJobRepository {
  const prisma = resolvePrismaClient(config);
  if (!prisma) return new InMemoryReportCardJobRepository();
  return new PrismaReportCardJobRepository(prisma);
}
