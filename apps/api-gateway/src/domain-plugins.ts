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
 *  - student + enrollment / institution / staff (incl. assignments,
 *    appraisals, training) / attendance / assessment (incl. report-cards) /
 *    examination: Prisma-backed (Postgres + RLS) via their create*Repository
 *    factories when DATABASE_URL is set, else in-memory.
 *  - scholarship / transport / health / workflow / notification / report /
 *    survey / registration: Prisma-backed the same way (P9–P16).
 *  - report analytical ReportDataSource: cross-module composition via
 *    injected domain repositories (per-schema queries + in-memory UUID joins).
 *  - notification role/area/institution recipients: CrossModule lookup over
 *    auth `UserRoleAssignment` (sequential per-criterion queries + UUID merge).
 *  - student bulk-import: Prisma adapter when DATABASE_URL is set.
 *  - institution infrastructure + registration form configs: Prisma-backed.
 *
 * Adding/upgrading a domain is a single entry in DOMAIN_REGISTRARS.
 */
import type { FastifyInstance } from 'fastify';
import {
  assessmentPlugin,
  createAssessmentItemRepository,
  createAssessmentResultRepository,
  createGradingSchemeRepository,
  createInstitutionBrandingRepository,
  createOutcomeRepository,
  createReportCardJobRepository,
  createReportCardTemplateRepository,
  createTeacherCommentRepository,
} from '@proctira/backend-assessment';
import {
  attendancePlugin,
  createAttendanceRepository,
} from '@proctira/backend-attendance';
import {
  createDocumentRepository,
  createExaminationRepository,
  createResultRepository,
  examinationPlugin,
} from '@proctira/backend-examination';
import {
  createHealthRepository,
  healthPlugin,
} from '@proctira/backend-health';
import {
  createInstitutionRepository,
  institutionPlugin,
} from '@proctira/backend-institution';
import {
  createNotificationRepository,
  notificationPlugin,
} from '@proctira/backend-notification';
import {
  createRegistrationRepository,
  registrationPlugin,
} from '@proctira/backend-registration';
import {
  createReportRepository,
  createReportDataSource,
  reportPlugin,
} from '@proctira/backend-report';
import {
  createScholarshipRepository,
  scholarshipPlugin,
} from '@proctira/backend-scholarship';
import {
  createAppraisalRepository,
  createAppraisalTemplateRepository,
  createAssignmentRepository,
  createCertificationRepository,
  createStaffRepository,
  createTrainingAttendanceRepository,
  createTrainingProgramRepository,
  createTrainingSessionRepository,
  staffPlugin,
} from '@proctira/backend-staff';
import {
  createEnrollmentRepository,
  createStudentRepository,
  studentPlugin,
} from '@proctira/backend-student';
import {
  createDistributionRepository,
  createInstitutionLookup,
  createSubmissionRepository,
  createSurveyRepository,
  surveyPlugin,
} from '@proctira/backend-survey';
import {
  createTransportRepository,
  transportPlugin,
} from '@proctira/backend-transport';
import {
  createCaseRepository,
  createWorkflowRepository,
  workflowPlugin,
} from '@proctira/backend-workflow';

import type { GatewayConfig } from './config.js';

/**
 * Cross-module analytical ReportDataSource.
 *
 * Queries each domain repository/schema sequentially, then joins in memory
 * by bare UUID (no cross-schema SQL JOINs/FKs).
 */
function buildReportDataSource() {
  return createReportDataSource({
    students: createStudentRepository(),
    enrollments: createEnrollmentRepository(),
    institutions: createInstitutionRepository(),
    attendance: createAttendanceRepository(),
    examinations: createExaminationRepository(),
    examinationResults: createResultRepository(),
    scholarships: createScholarshipRepository(),
  });
}

/**
 * Notification recipient expansion uses the factory's default CrossModule
 * lookup over auth `UserRoleAssignment` (same sequential + UUID-merge pattern
 * as ReportDataSource). Override via createNotificationRepository({...}) when
 * custom ports are needed.
 */
function buildNotificationRepository() {
  return createNotificationRepository();
}

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
    proxyPrefixes: ['/students', '/enrollments'],
    register: async (scope) => {
      // Prisma (+ optional Redis cache) when DATABASE_URL is set, else in-memory.
      // Reads RLS-safely via withTenantTransaction using the request's tenantId.
      const repository = createStudentRepository();
      await scope.register(studentPlugin, {
        repository,
        prefix: '/students',
        enrollmentPrefix: '/enrollments',
      });
    },
  },
  {
    name: 'institution',
    // /subjects, /institution-subjects, /areas mount when DATABASE_URL is set
    // (plugin auto-wires Prisma for GeographicArea + Subject).
    proxyPrefixes: [
      '/institutions',
      '/boards',
      '/academic-periods',
      '/grades',
      '/classes',
      '/subjects',
      '/institution-subjects',
      '/areas',
      '/infrastructure',
    ],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      // Area hierarchy + subjects register inside the plugin when Prisma is available.
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
      // for staff profiles, assignments, appraisals, and training.
      await scope.register(staffPlugin, {
        repository: createStaffRepository(),
        assignmentRepository: createAssignmentRepository(),
        appraisalTemplateRepository: createAppraisalTemplateRepository(),
        appraisalRepository: createAppraisalRepository(),
        trainingProgramRepository: createTrainingProgramRepository(),
        trainingSessionRepository: createTrainingSessionRepository(),
        trainingAttendanceRepository: createTrainingAttendanceRepository(),
        certificationRepository: createCertificationRepository(),
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
    // (/grading-schemes, /assessment-items, /outcomes, /results,
    // /report-cards), so the legacy '/assessments' proxy is superseded.
    proxyPrefixes: ['/assessments', '/report-cards'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory —
      // including report-card repositories (templates, comments, branding, jobs).
      await scope.register(assessmentPlugin, {
        gradingSchemeRepository: createGradingSchemeRepository(),
        assessmentItemRepository: createAssessmentItemRepository(),
        outcomeRepository: createOutcomeRepository(),
        resultRepository: createAssessmentResultRepository(),
        reportCardTemplateRepository: createReportCardTemplateRepository(),
        teacherCommentRepository: createTeacherCommentRepository(),
        institutionBrandingRepository: createInstitutionBrandingRepository(),
        reportCardJobRepository: createReportCardJobRepository(),
      });
    },
  },
  {
    name: 'scholarship',
    proxyPrefixes: ['/scholarships'],
    register: async (scope) => {
      await scope.register(scholarshipPlugin, {
        repository: createScholarshipRepository(),
        prefix: '/scholarships',
      });
    },
  },
  {
    name: 'transport',
    proxyPrefixes: ['/transport'],
    register: async (scope) => {
      await scope.register(transportPlugin, {
        repository: createTransportRepository(),
        prefix: '/transport',
      });
    },
  },
  {
    name: 'health',
    proxyPrefixes: ['/health'],
    register: async (scope) => {
      // Mounted under /api/v1/health/* — does not collide with gateway /health.
      await scope.register(healthPlugin, {
        repository: createHealthRepository(),
        prefix: '/health',
      });
    },
  },
  {
    name: 'workflow',
    proxyPrefixes: ['/workflows'],
    register: async (scope) => {
      await scope.register(workflowPlugin, {
        repository: createWorkflowRepository(),
        caseRepository: createCaseRepository(),
        prefix: '/workflows',
      });
    },
  },
  {
    name: 'notification',
    proxyPrefixes: ['/notifications'],
    register: async (scope) => {
      await scope.register(notificationPlugin, {
        repository: buildNotificationRepository(),
        prefix: '/notifications',
      });
    },
  },
  {
    name: 'report',
    proxyPrefixes: ['/reports'],
    register: async (scope) => {
      await scope.register(reportPlugin, {
        repository: createReportRepository(),
        dataSource: buildReportDataSource(),
        prefix: '/reports',
      });
    },
  },
  {
    name: 'survey',
    proxyPrefixes: ['/surveys'],
    register: async (scope) => {
      await scope.register(surveyPlugin, {
        surveyRepository: createSurveyRepository(),
        distributionRepository: createDistributionRepository(),
        submissionRepository: createSubmissionRepository(),
        institutionLookup: createInstitutionLookup(),
        prefix: '/surveys',
      });
    },
  },
  {
    name: 'registration',
    proxyPrefixes: ['/registrations'],
    register: async (scope) => {
      await scope.register(registrationPlugin, {
        repository: createRegistrationRepository(),
        prefix: '/registrations',
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
