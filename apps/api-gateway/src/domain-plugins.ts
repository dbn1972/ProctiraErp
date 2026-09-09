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
 *    assessment / examination: Prisma-backed (Postgres + RLS) via their
 *    create*Repository factories when DATABASE_URL is set, else in-memory.
 *  - health counselling: raw SQL + `pg` when DATABASE_URL is set (no Prisma);
 *    other health entities + workflows seed in-memory.
 *  - notifications: in-memory delivery records; prefs/devices use raw SQL +
 *    `pg` when DATABASE_URL is set (db/sql/005_notifications_schema.sql).
 *  - transport: raw SQL + `pg` when DATABASE_URL is set
 *    (db/sql/006_transport_schema.sql); else in-memory.
 *  - communication / hostel / library / parent-portal / fees: raw SQL + `pg` when DATABASE_URL is set
 *    (db/sql/007–011_*.sql); else in-memory.
 *  - scholarships: raw SQL + `pg` when DATABASE_URL is set (db/sql/016_scholarships_schema.sql);
 *    else in-memory (+ demo seed).
 *  - registration / admissions: raw SQL + `pg` when DATABASE_URL is set
 *    (db/sql/014_admissions_crm_schema.sql); else in-memory.
 *  - timetable (bell schedules / periods / meetings / substitutions): raw SQL
 *    + `pg` when DATABASE_URL is set (db/sql/003_sis_timetable_schedule_schema.sql);
 *    else in-memory.
 *  - gradebook (entries / GPA / report cards / transcripts / board exports):
 *    raw SQL + `pg` when DATABASE_URL is set (003 + 004 indexes); else in-memory.
 *  - insights / platform-admin: UI aggregates; PG-backed when DATABASE_URL
 *    (020_insights_ui_schema.sql). Full report/data-warehouse packages unmounted.
 *  - assessment report-card repos wired (in-memory; no Prisma models yet).
 *    Durable HTML report cards also via gradebook `/gradebook/report-cards`.
 *
 * Adding/upgrading a domain is a single entry in DOMAIN_REGISTRARS.
 */
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
import { attendancePlugin, createAttendanceRepository } from '@proctira/backend-attendance';
import {
  communicationPlugin,
  createCommunicationRepository,
  createSandboxDeliveryAdapter,
} from '@proctira/backend-communication';
import {
  developerPortalPlugin,
  InMemoryDeveloperPortalRepository,
} from '@proctira/backend-developer-portal';
import {
  createDocumentRepository,
  createExaminationRepository,
  createResultRepository,
  examinationPlugin,
  SimplePdfGenerator,
} from '@proctira/backend-examination';
import { createFeesRepository, FeesService, feesPlugin } from '@proctira/backend-fees';
import { createCurriculumStore, curriculumPlugin } from '@proctira/backend-curriculum';
import { createGradebookRepository, gradebookPlugin } from '@proctira/backend-gradebook';
import {
  assertPhiKeyConfigured,
  createHealthRepository,
  healthPlugin,
} from '@proctira/backend-health';
import { createHostelRepository, hostelPlugin } from '@proctira/backend-hostel';
import { createInstitutionRepository, institutionPlugin } from '@proctira/backend-institution';
import { createLibraryRepository, libraryPlugin } from '@proctira/backend-library';
import { createNotificationStack, notificationPlugin } from '@proctira/backend-notification';
import { createParentPortalRepository, parentPortalPlugin } from '@proctira/backend-parent-portal';
import {
  createAdmissionsCrmStore,
  createRegistrationRepository,
  registrationPlugin,
} from '@proctira/backend-registration';
import { createLmsRepository, lmsPlugin } from '@proctira/backend-lms';
import { createScholarshipRepository, scholarshipPlugin } from '@proctira/backend-scholarship';
import {
  createAssignmentRepository,
  createStaffRepository,
  staffPlugin,
} from '@proctira/backend-staff';
import { createStudentRepository, studentPlugin } from '@proctira/backend-student';
import { createTimetableRepository, timetablePlugin } from '@proctira/backend-timetable';
import { createTransportRepository, transportPlugin } from '@proctira/backend-transport';
import { createWorkflowRepositories, workflowPlugin } from '@proctira/backend-workflow';
import type { FastifyInstance } from 'fastify';

import type { GatewayConfig } from './config.js';
import { shouldSeedDemoData } from './demo-seed-policy.js';
import { healthUiPlugin } from './health-ui-plugin.js';
import { createHealthUiSeed } from './health-ui-seed.js';
import { insightsUiPlugin } from './insights-ui-plugin.js';
import { platformAdminUiPlugin } from './platform-admin-ui-plugin.js';
import { seedScholarshipDemoData } from './scholarship-demo-seed.js';
import { tenantAdminPlugin } from './tenant-admin-plugin.js';
import { workflowUiPlugin } from './workflow-ui-plugin.js';
import { createWorkflowUiSeed } from './workflow-ui-seed.js';
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
      // G-701: studentPlugin also mounts /enrollments and /students/import
      // (Pg enrollment repository on db/sql/001 + 021 when DATABASE_URL set).
      const repository = createStudentRepository();
      await scope.register(studentPlugin, { repository, prefix: '/students' });
    },
  },
  {
    name: 'institution',
    // G-901: academics sub-domains (academic periods / grades / classes /
    // subjects / infrastructure) are served by the same plugin.
    proxyPrefixes: [
      '/institutions',
      '/academic-periods',
      '/grades',
      '/classes',
      '/subjects',
      '/institution-subjects',
      '/infrastructure',
    ],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      // G-901: academics = Prisma (+ raw-pg infrastructure on db/sql/027) when
      // DATABASE_URL is set, else in-memory Prisma look-alike.
      await scope.register(institutionPlugin, {
        repository: createInstitutionRepository(),
        prefix: '/institutions',
        academics: true,
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
        // G-902: document routes (/documents/generate, /documents/jobs) only
        // register when a PdfGenerator is supplied.
        pdfGenerator: new SimplePdfGenerator(),
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
      // G-210: wire in-memory report-card repos so `/report-cards` routes enable.
      // Durable board HTML report cards also live at `/gradebook/report-cards`.
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
    name: 'timetable',
    proxyPrefixes: ['/timetable'],
    register: async (scope) => {
      // Raw pg against 003_sis_timetable_schedule_schema.sql when DATABASE_URL
      // is set; in-memory otherwise. No Prisma on this path.
      await scope.register(timetablePlugin, {
        repository: createTimetableRepository(),
        prefix: '/timetable',
      });
    },
  },
  {
    name: 'gradebook',
    proxyPrefixes: ['/gradebook'],
    register: async (scope) => {
      // Raw pg against 003/004 gradebook tables when DATABASE_URL is set;
      // in-memory otherwise. No Prisma on this path.
      await scope.register(gradebookPlugin, {
        repository: createGradebookRepository(),
        prefix: '/gradebook',
      });
    },
  },
  {
    name: 'curriculum',
    proxyPrefixes: ['/curriculum'],
    register: async (scope) => {
      // Raw pg against 033_curriculum_schema.sql when DATABASE_URL is set;
      // in-memory otherwise. No Prisma on this path.
      await scope.register(curriculumPlugin, {
        store: createCurriculumStore(),
        prefix: '/curriculum',
      });
    },
  },
  {
    name: 'lms',
    proxyPrefixes: ['/lms'],
    register: async (scope) => {
      // G-801/G-802: Pg when DATABASE_URL (db/sql/026_lms_schema.sql); else in-memory.
      await scope.register(lmsPlugin, {
        repository: createLmsRepository(),
        prefix: '/lms',
      });
    },
  },
  {
    name: 'scholarship',
    proxyPrefixes: ['/scholarships'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/016_scholarships_schema.sql); else in-memory.
      const repository = createScholarshipRepository();
      // G-705: demo rows only when explicitly requested or in dev/test without
      // a database; never seed into a production Postgres.
      if (shouldSeedDemoData()) {
        await seedScholarshipDemoData(repository);
      }
      await scope.register(scholarshipPlugin, {
        repository,
        prefix: '/scholarships',
      });
    },
  },
  {
    name: 'health',
    proxyPrefixes: ['/health'],
    register: async (scope) => {
      // Postgres counselling + profile/screening PHI when DATABASE_URL is set
      // (raw pg, no Prisma — SQL 002 + 012). Special-needs stays in-memory.
      // UI aggregates merge seed + live counselling writes for list sync.
      // G-711: production must not boot without a PHI key (or explicit opt-out).
      assertPhiKeyConfigured();
      const repository = createHealthRepository();
      await scope.register(healthUiPlugin, {
        // G-705: production serves only live repository rows; the demo seed is
        // limited to dev/test or explicit SEED_DEMO_DATA=1.
        seed: shouldSeedDemoData()
          ? createHealthUiSeed()
          : { records: [], specialNeeds: [], counselling: [], screenings: [] },
        repository,
      });
      await scope.register(healthPlugin, {
        repository,
        prefix: '/health',
      });
    },
  },
  {
    name: 'insights',
    proxyPrefixes: ['/reports', '/data-warehouse'],
    register: async (scope) => {
      // Redesign Insights UI aggregates (templates / runs / DW indicators /
      // import jobs / map features). PG-backed when DATABASE_URL (G-209);
      // App Router banners hide when the gateway responds.
      await scope.register(insightsUiPlugin);
    },
  },
  {
    name: 'platform-admin',
    proxyPrefixes: [
      '/tenants',
      '/plugins',
      '/break-glass',
      '/plans',
      '/themes',
      '/platform',
      '/audit',
    ],
    register: async (scope) => {
      // Prefer live gateway responses for Platform Admin Console clients.
      await scope.register(platformAdminUiPlugin);
    },
  },
  {
    name: 'workflow',
    proxyPrefixes: ['/workflows'],
    register: async (scope) => {
      // Redesign UI aggregates (definitions / instances / approvals). UI routes
      // own the `/workflows/*` list shapes expected by App Router pages; the
      // real engine lives under `/workflow-engine` (registrar below).
      await scope.register(workflowUiPlugin, {
        seed: createWorkflowUiSeed(),
      });
    },
  },
  {
    name: 'workflow-engine',
    proxyPrefixes: ['/workflow-engine'],
    register: async (scope) => {
      // G-715: real @proctira/backend-workflow engine (definitions, instances,
      // transitions + audit, cases). Pg on db/sql/025 when DATABASE_URL is set.
      const { repository, caseRepository } = createWorkflowRepositories();
      await scope.register(workflowPlugin, {
        repository,
        caseRepository,
        prefix: '/workflow-engine',
      });
    },
  },
  {
    name: 'tenant-admin',
    proxyPrefixes: ['/tenant'],
    register: async (scope) => {
      // G-910: tenant-scoped roles/users/settings for the web /admin console.
      // Postgres (control_plane_documents, RLS) when DATABASE_URL, else in-memory.
      await scope.register(tenantAdminPlugin, {
        prefix: '/tenant',
        onAudit: async (event) => {
          const auditService = (
            scope as unknown as {
              auditService?: { recordAudit: (input: Record<string, unknown>) => Promise<unknown> };
            }
          ).auditService;
          if (!auditService) return;
          await auditService.recordAudit({
            tenantId: event.tenantId,
            entityType: event.entityType,
            entityId: event.entityId,
            operation: event.operation,
            userId: event.actorId ?? 'system',
            userName: event.actorId ?? 'system',
            ipAddress: '0.0.0.0',
            beforeValues: event.beforeValues,
            afterValues: event.afterValues,
            metadata: event.metadata,
          });
        },
      });
    },
  },
  {
    name: 'notification',
    proxyPrefixes: ['/notifications'],
    register: async (scope) => {
      // In-memory notification records + prefs/devices (PG when DATABASE_URL).
      const { repository, prefsStore } = createNotificationStack();
      await scope.register(notificationPlugin, {
        repository,
        prefsStore,
        prefix: '/notifications',
      });
    },
  },
  {
    name: 'transport',
    proxyPrefixes: ['/transport'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/006_transport_schema.sql); else in-memory.
      const repository = createTransportRepository();
      await scope.register(transportPlugin, {
        repository,
        prefix: '/transport',
      });
    },
  },
  {
    name: 'communication',
    proxyPrefixes: ['/communication'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/007_communication_schema.sql); else in-memory.
      // G-604: sandbox delivery adapter + local audit trail on send/dispatch.
      const repository = createCommunicationRepository();
      await scope.register(communicationPlugin, {
        repository,
        deliveryAdapter: createSandboxDeliveryAdapter(),
        prefix: '/communication',
      });
    },
  },
  {
    name: 'hostel',
    proxyPrefixes: ['/hostel'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/008_hostel_schema.sql); else in-memory.
      const repository = createHostelRepository();
      await scope.register(hostelPlugin, {
        repository,
        prefix: '/hostel',
      });
    },
  },
  {
    name: 'fees',
    proxyPrefixes: ['/fees'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/010 + 011_fees_finance_schema.sql); else in-memory.
      // Sandbox PaymentAdapter only — live PSP waived (G-202).
      // Registered before library so fines can share createFeesRepository().
      const repository = createFeesRepository();
      await scope.register(feesPlugin, {
        repository,
        prefix: '/fees',
      });
    },
  },
  {
    name: 'library',
    proxyPrefixes: ['/library'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/009_library_schema.sql); else in-memory.
      // G-603: fines post to fees ledger via shared createFeesRepository().
      const repository = createLibraryRepository();
      const feesService = new FeesService(createFeesRepository());
      await scope.register(libraryPlugin, {
        repository,
        feesLedger: {
          postFineInvoice: async (tenantId, actorId, input) => {
            const invoice = await feesService.createInvoice(tenantId, actorId, {
              studentId: input.studentId,
              title: input.title,
              description: input.description,
              amountCents: input.amountCents,
              currency: input.currency,
              dueAt: input.dueAt,
            });
            return {
              id: invoice.id,
              studentId: invoice.studentId,
              title: invoice.title,
              amountCents: invoice.amountCents,
              currency: invoice.currency,
              status: invoice.status,
            };
          },
        },
        prefix: '/library',
      });
    },
  },
  {
    name: 'parent-portal',
    proxyPrefixes: ['/parent-portal'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/010_parent_portal_schema.sql); else in-memory.
      const repository = createParentPortalRepository();
      await scope.register(parentPortalPlugin, {
        repository,
        prefix: '/parent-portal',
      });
    },
  },
  {
    name: 'registration',
    proxyPrefixes: ['/registrations'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/014_admissions_crm_schema.sql); else in-memory.
      // G-717: waitlist/interview CRM store also on 014 under RLS; OCR waived.
      const repository = createRegistrationRepository();
      const crmStore = createAdmissionsCrmStore();
      await scope.register(registrationPlugin, {
        repository,
        crmStore,
        prefix: '/registrations',
      });
    },
  },
  {
    name: 'developer',
    proxyPrefixes: ['/developer'],
    register: async (scope) => {
      // G-607: AuthZ via gateway RBAC; in-memory API keys/docs; rate limits via
      // global gateway rate-limit plugin. Live IdP key mint residual.
      await scope.register(developerPortalPlugin, {
        repository: new InMemoryDeveloperPortalRepository(),
        prefix: '/developer',
      });
    },
  },
];

/**
 * Logical names of in-process domain registrars (G-003 mount matrix).
 * Keep in sync with `mount-matrix.ts` / `docs/audits/GATEWAY_MOUNT_MATRIX.md`.
 */
export const DOMAIN_REGISTRAR_NAMES: readonly string[] = DOMAIN_REGISTRARS.map(
  (domain) => domain.name,
);

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
