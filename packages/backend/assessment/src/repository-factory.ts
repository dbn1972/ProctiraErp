/**
 * Assessment repository composition.
 *
 *   - `DATABASE_URL` set → Prisma repositories (Postgres + RLS)
 *   - otherwise          → in-memory repositories (dev / tests)
 *
 * Mirrors the staff/attendance repository factories so the standalone
 * service and the API gateway compose persistence identically.
 */
import { assertInMemoryFallbackAllowed, createPrismaClient, getSharedPgPool } from '@proctira/database';
import type { PgPool, PrismaClient } from '@proctira/database';

import type {
  GradingSchemeRepository,
  AssessmentItemRepository,
  OutcomeRepository,
} from './assessment-repository.js';
import {
  InMemoryInstitutionBrandingRepository,
  InMemoryReportCardJobRepository,
  InMemoryReportCardTemplateRepository,
  InMemoryTeacherCommentRepository,
} from './in-memory-report-card-repository.js';
import {
  InMemoryGradingSchemeRepository,
  InMemoryAssessmentItemRepository,
  InMemoryOutcomeRepository,
} from './in-memory-repository.js';
import { InMemoryAssessmentResultRepository } from './in-memory-result-repository.js';
import {
  PgInstitutionBrandingRepository,
  PgReportCardJobRepository,
  PgReportCardTemplateRepository,
  PgTeacherCommentRepository,
} from './pg-report-card-repository.js';
import {
  PrismaGradingSchemeRepository,
  PrismaAssessmentItemRepository,
  PrismaOutcomeRepository,
} from './prisma-repository.js';
import { PrismaAssessmentResultRepository } from './prisma-result-repository.js';
import type {
  InstitutionBrandingRepository,
  ReportCardJobRepository,
  ReportCardTemplateRepository,
  TeacherCommentRepository,
} from './report-card-repository.js';
import type { AssessmentResultRepository } from './result-repository.js';

export interface AssessmentRepositoryConfig {
  /** PostgreSQL connection string. Defaults to `process.env.DATABASE_URL`. */
  databaseUrl?: string;
  /** Reuse an existing Prisma client instead of creating a new one. */
  prismaClient?: PrismaClient;
}

function resolvePrismaClient(config: AssessmentRepositoryConfig): PrismaClient | null {
  if (config.prismaClient) return config.prismaClient;
  const databaseUrl = config.databaseUrl ?? process.env['DATABASE_URL'];
  if (!databaseUrl) {
    assertInMemoryFallbackAllowed('assessment');
    return null;
  }
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

/**
 * Report-card repositories (G-210 / G-717).
 *
 * Templates, comments, branding and jobs persist to the `report_card_*` tables
 * (db/sql/024) through raw pg + RLS when `DATABASE_URL` is set; otherwise the
 * in-memory implementations back dev / unit tests (subject to the shared
 * fallback policy).
 */
function resolveReportCardPool(config: AssessmentRepositoryConfig): PgPool | null {
  const pool = getSharedPgPool(config.databaseUrl);
  if (!pool) assertInMemoryFallbackAllowed('assessment-report-cards');
  return pool;
}

export function createReportCardTemplateRepository(
  config: AssessmentRepositoryConfig = {},
): ReportCardTemplateRepository {
  const pool = resolveReportCardPool(config);
  return pool ? new PgReportCardTemplateRepository(pool) : new InMemoryReportCardTemplateRepository();
}

export function createTeacherCommentRepository(
  config: AssessmentRepositoryConfig = {},
): TeacherCommentRepository {
  const pool = resolveReportCardPool(config);
  return pool ? new PgTeacherCommentRepository(pool) : new InMemoryTeacherCommentRepository();
}

export function createInstitutionBrandingRepository(
  config: AssessmentRepositoryConfig = {},
): InstitutionBrandingRepository {
  const pool = resolveReportCardPool(config);
  return pool
    ? new PgInstitutionBrandingRepository(pool)
    : new InMemoryInstitutionBrandingRepository();
}

export function createReportCardJobRepository(
  config: AssessmentRepositoryConfig = {},
): ReportCardJobRepository {
  const pool = resolveReportCardPool(config);
  return pool ? new PgReportCardJobRepository(pool) : new InMemoryReportCardJobRepository();
}
