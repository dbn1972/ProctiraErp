/**
 * In-process domain plugins (monolith mode).
 *
 * The platform's intended topology runs the backend domain logic *inside* the
 * gateway as Fastify plugins (see docker-compose header). This module registers
 * those domain plugins under the `/api/v1` version prefix and returns the proxy
 * prefixes it supersedes, so the service-router skips them (only proxying
 * domains that are deployed as separate services).
 *
 * Persistence status (current schema):
 *  - student / institution / staff (incl. assignments) / attendance /
 *    assessment / examination / scholarship: Prisma-backed (Postgres + RLS)
 *    via their create*Repository factories when DATABASE_URL is set, else
 *    in-memory (scholarship currently seeds an in-memory demo repository).
 *  - assessment report-card repositories are not wired yet (no Prisma
 *    implementation); report-card routes stay disabled.
 *
 * Adding/upgrading a domain is a single entry in DOMAIN_REGISTRARS.
 */
import type { FastifyInstance } from 'fastify';
import {
  assessmentPlugin,
  createAssessmentItemRepository,
  createAssessmentResultRepository,
  createGradingSchemeRepository,
  createOutcomeRepository,
} from '@proctira/backend-assessment';
import { attendancePlugin, createAttendanceRepository } from '@proctira/backend-attendance';
import {
  createDocumentRepository,
  createExaminationRepository,
  createResultRepository,
  examinationPlugin,
} from '@proctira/backend-examination';
import { createInstitutionRepository, institutionPlugin } from '@proctira/backend-institution';
import { InMemoryScholarshipRepository, scholarshipPlugin } from '@proctira/backend-scholarship';
import {
  createAssignmentRepository,
  createStaffRepository,
  staffPlugin,
} from '@proctira/backend-staff';
import { createStudentRepository, studentPlugin } from '@proctira/backend-student';

import type { GatewayConfig } from './config.js';
import { seedScholarshipDemoData } from './scholarship-demo-seed.js';

/** A registrar mounts one domain's plugin and declares the proxy prefixes it supersedes. */
interface DomainRegistrar {
  /** Logical name (for logging). */
  name: string;
  /** Proxy prefix(es) this domain serves in-process — excluded from the router. */
  proxyPrefixes: string[];
  /** Mounts the domain plugin onto an `/api/v1`-scoped instance. */
  register: (scope: FastifyInstance, config: GatewayConfig) => Promise<void>;
}

/**
 * Domains served in-process. Domains NOT listed fall through to the
 * service-router, which proxies them to a standalone service (via SERVICE_ROUTES).
 */
const DOMAIN_REGISTRARS: DomainRegistrar[] = [
  {
    name: 'student',
    proxyPrefixes: ['/students'],
    register: async (scope) => {
      // Prisma (+ optional Redis cache) when DATABASE_URL is set, else in-memory.
      // Reads RLS-safely via withTenantTransaction using the request's tenantId.
      const repository = createStudentRepository();
      await scope.register(studentPlugin, { repository, prefix: '/students' });
    },
  },
  {
    name: 'institution',
    proxyPrefixes: ['/institutions'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      await scope.register(institutionPlugin, {
        repository: createInstitutionRepository(),
        prefix: '/institutions',
      });
    },
  },
  {
    name: 'staff',
    proxyPrefixes: ['/staff'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory —
      // for both staff profiles and assignments.
      await scope.register(staffPlugin, {
        repository: createStaffRepository(),
        assignmentRepository: createAssignmentRepository(),
        prefix: '/staff',
      });
    },
  },
  {
    name: 'attendance',
    proxyPrefixes: ['/attendance'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      await scope.register(attendancePlugin, {
        repository: createAttendanceRepository(),
        prefix: '/attendance',
      });
    },
  },
  {
    name: 'examination',
    proxyPrefixes: ['/examinations'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      await scope.register(examinationPlugin, {
        repository: createExaminationRepository(),
        resultRepository: createResultRepository(),
        documentRepository: createDocumentRepository(),
        prefix: '/examinations',
      });
    },
  },
  {
    name: 'assessment',
    // The assessment plugin mounts under its own native prefixes
    // (/grading-schemes, /assessment-items, /outcomes, /results, ...), so the
    // legacy '/assessments' proxy is superseded and excluded.
    proxyPrefixes: ['/assessments'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      // Report-card repositories are intentionally not wired (no Prisma
      // implementation yet) — report-card routes stay disabled.
      await scope.register(assessmentPlugin, {
        gradingSchemeRepository: createGradingSchemeRepository(),
        assessmentItemRepository: createAssessmentItemRepository(),
        outcomeRepository: createOutcomeRepository(),
        resultRepository: createAssessmentResultRepository(),
      });
    },
  },
  {
    name: 'scholarship',
    proxyPrefixes: ['/scholarships'],
    register: async (scope) => {
      // In-memory repository with demo seed until Prisma scholarship schema
      // is wired through createScholarshipRepository.
      const repository = new InMemoryScholarshipRepository();
      await seedScholarshipDemoData(repository);
      await scope.register(scholarshipPlugin, {
        repository,
        prefix: '/scholarships',
      });
    },
  },
];

/**
 * Registers all in-process domain plugins and returns the proxy prefixes
 * handled, so the caller can exclude them from the proxy router.
 */
export async function registerDomainPlugins(
  app: FastifyInstance,
  config: GatewayConfig,
  versionPrefix = '/api/v1',
): Promise<string[]> {
  const handled: string[] = [];

  for (const domain of DOMAIN_REGISTRARS) {
    // Encapsulate each domain under the version prefix so its routes resolve at
    // `/api/v1<prefix>` while inheriting the root auth + tenant hooks.
    await app.register(
      async (scope) => {
        await domain.register(scope, config);
      },
      { prefix: versionPrefix },
    );
    handled.push(...domain.proxyPrefixes);
    app.log.info({ domain: domain.name }, 'Registered in-process domain plugin');
  }

  return handled;
}
