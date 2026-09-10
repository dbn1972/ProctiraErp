/**
 * Factories for appraisal + training stores (G-717): Postgres when
 * DATABASE_URL is set, otherwise in-memory (refused in production by the
 * persistence policy).
 */
import { assertInMemoryFallbackAllowed, getSharedPgPool } from '@proctira/database';

import type { AppraisalRepository, AppraisalTemplateRepository } from './appraisal-repository.js';
import {
  InMemoryAppraisalRepository,
  InMemoryAppraisalTemplateRepository,
} from './in-memory-appraisal-repository.js';
import {
  InMemoryCertificationRepository,
  InMemoryTrainingAttendanceRepository,
  InMemoryTrainingProgramRepository,
  InMemoryTrainingSessionRepository,
} from './in-memory-training-repository.js';
import { PgAppraisalRepository, PgAppraisalTemplateRepository } from './pg-appraisal-repository.js';
import {
  PgCertificationRepository,
  PgTrainingAttendanceRepository,
  PgTrainingProgramRepository,
  PgTrainingSessionRepository,
} from './pg-training-repository.js';
import type {
  CertificationRepository,
  TrainingAttendanceRepository,
  TrainingProgramRepository,
  TrainingSessionRepository,
} from './training-repository.js';

export interface AppraisalRepositories {
  templateRepository: AppraisalTemplateRepository;
  appraisalRepository: AppraisalRepository;
}

export interface TrainingRepositories {
  programRepository: TrainingProgramRepository;
  sessionRepository: TrainingSessionRepository;
  attendanceRepository: TrainingAttendanceRepository;
  certificationRepository: CertificationRepository;
}

export function createAppraisalRepositories(): AppraisalRepositories {
  const pool = getSharedPgPool();
  if (pool) {
    return {
      templateRepository: new PgAppraisalTemplateRepository(pool),
      appraisalRepository: new PgAppraisalRepository(pool),
    };
  }
  assertInMemoryFallbackAllowed('staff-appraisals');
  return {
    templateRepository: new InMemoryAppraisalTemplateRepository(),
    appraisalRepository: new InMemoryAppraisalRepository(),
  };
}

export function createTrainingRepositories(): TrainingRepositories {
  const pool = getSharedPgPool();
  if (pool) {
    return {
      programRepository: new PgTrainingProgramRepository(pool),
      sessionRepository: new PgTrainingSessionRepository(pool),
      attendanceRepository: new PgTrainingAttendanceRepository(pool),
      certificationRepository: new PgCertificationRepository(pool),
    };
  }
  assertInMemoryFallbackAllowed('staff-training');
  return {
    programRepository: new InMemoryTrainingProgramRepository(),
    sessionRepository: new InMemoryTrainingSessionRepository(),
    attendanceRepository: new InMemoryTrainingAttendanceRepository(),
    certificationRepository: new InMemoryCertificationRepository(),
  };
}
