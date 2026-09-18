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
 *  - health: raw SQL + `pg` when DATABASE_URL is set (no Prisma) for counselling
 *    (002), profile/screening PHI (012), special-needs (017), nurse incidents (046);
 *    else in-memory hybrid fallback.
 *  - notifications: in-memory delivery records; prefs/devices use raw SQL +
 *    `pg` when DATABASE_URL is set (db/sql/005_notifications_schema.sql).
 *  - transport: raw SQL + `pg` when DATABASE_URL is set
 *    (db/sql/006_transport_schema.sql + 045_transport_ops_schema.sql); else in-memory.
 *  - communication / hostel / library / parent-portal / fees: raw SQL + `pg` when DATABASE_URL is set
 *    (db/sql/007–011_*.sql); else in-memory.
 *  - scholarships: raw SQL + `pg` when DATABASE_URL is set (db/sql/016_scholarships_schema.sql);
 *    else in-memory (+ demo seed).
 *  - registration / admissions: raw SQL + `pg` when DATABASE_URL is set
 *    (db/sql/014_admissions_crm_schema.sql + 034 enquiry/merit/offer); else in-memory.
 *  - timetable (bell schedules / periods / meetings / substitutions): raw SQL
 *    + `pg` when DATABASE_URL is set (db/sql/003_sis_timetable_schedule_schema.sql);
 *    else in-memory.
 *  - gradebook (entries / GPA / report cards / transcripts / board exports):
 *    raw SQL + `pg` when DATABASE_URL is set (003 + 004 indexes); else in-memory.
 *  - insights / platform-admin: UI aggregates; PG-backed when DATABASE_URL
 *    (020_insights_ui_schema.sql). G-909 mounts `@proctira/backend-report`
 *    for real catalogue exports; insights keeps board summary + data-warehouse.
 *  - assessment report-card repos via createReportCard*Repository() — raw pg
 *    `024` when DATABASE_URL is set, else in-memory. Durable HTML also via
 *    gradebook `/gradebook/report-cards`.
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
  createReportCardPublisherFromEnv,
  createReportCardTemplateRepository,
  createTeacherCommentRepository,
} from '@proctira/backend-assessment';
import { attendancePlugin, createAttendanceRepository } from '@proctira/backend-attendance';
import {
  communicationPlugin,
  createCommunicationRepository,
  createDeliveryAdapterFromEnv,
} from '@proctira/backend-communication';
import { createCurriculumStore, curriculumPlugin } from '@proctira/backend-curriculum';
import {
  createDeveloperPortalRepository,
  createWebhookDeliveryPublisherFromEnv,
  createWebhookReplayStoreFromEnv,
  developerPortalPlugin,
  ensureDeveloperPortalPersistence,
  type RedisLikeForReplay,
} from '@proctira/backend-developer-portal';
import { createPipelineRepository, etlPlugin } from '@proctira/backend-etl';
import {
  createDocumentRepository,
  createDocumentOutboxFromEnv,
  createExamOpsStore,
  createExaminationRepository,
  createResultRepository,
  examinationPlugin,
  SimplePdfGenerator,
} from '@proctira/backend-examination';
import {
  createFeesRepository,
  FeesService,
  feesPlugin,
  majorUnitsToCents,
} from '@proctira/backend-fees';
import { createGradebookRepository, gradebookPlugin } from '@proctira/backend-gradebook';
import {
  assertPhiEnvelopeConfigured,
  createHealthRepository,
  createPhiKmsClientFromEnv,
  ensurePhiEnvelopeProvider,
  healthPlugin,
} from '@proctira/backend-health';
import { createHostelRepository, hostelPlugin } from '@proctira/backend-hostel';
import { createInstitutionRepository, institutionPlugin } from '@proctira/backend-institution';
import { createLibraryRepository, libraryPlugin } from '@proctira/backend-library';
import { createLmsRepository, lmsPlugin } from '@proctira/backend-lms';
import {
  createNotificationDeliveryPublisherFromEnv,
  createNotificationStack,
  notificationPlugin,
} from '@proctira/backend-notification';
import { createParentPortalRepository, parentPortalPlugin } from '@proctira/backend-parent-portal';
import {
  createPrivacyQueuePublishersFromEnv,
  createPrivacyRepository,
  PrivacyService,
  privacyPlugin,
} from '@proctira/backend-privacy';
import {
  AdmissionsPipelineService,
  createAdmissionsCrmStore,
  createAdmissionsPipelineStore,
  createRegistrationRepository,
  createRegistrationSessionStore,
  registrationPlugin,
} from '@proctira/backend-registration';
import { reportCataloguePlugin } from '@proctira/backend-report';
import { createScholarshipRepository, scholarshipPlugin } from '@proctira/backend-scholarship';
import {
  createAssignmentRepository,
  createStaffRepository,
  staffPlugin,
} from '@proctira/backend-staff';
import {
  bindAttendanceHeatmapSource,
  createStudentImportQueueFromEnv,
  createStudentRepository,
  studentPlugin,
} from '@proctira/backend-student';
import { createTimetableRepository, timetablePlugin } from '@proctira/backend-timetable';
import { createTransportRepository, transportPlugin } from '@proctira/backend-transport';
import {
  createEscalationPublisherFromEnv,
  createWorkflowRepositories,
  WorkflowService,
  workflowPlugin,
} from '@proctira/backend-workflow';
import { BusinessRuleError, ConflictError } from '@proctira/common';
import { getSharedPgPool, withPgTenant } from '@proctira/database';
import type { FastifyInstance } from 'fastify';

import type { GatewayConfig } from './config.js';
import { shouldSeedDemoData } from './demo-seed-policy.js';
import { healthUiPlugin } from './health-ui-plugin.js';
import { createHealthUiSeed } from './health-ui-seed.js';
import { insightsUiPlugin } from './insights-ui-plugin.js';
import { platformAdminUiPlugin } from './platform-admin-ui-plugin.js';
import { seedScholarshipDemoData } from './scholarship-demo-seed.js';
import { tenantAdminPlugin } from './tenant-admin-plugin.js';
import { EngineBackedWorkflowUiStore } from './workflow-ui-engine-store.js';
import { workflowUiPlugin } from './workflow-ui-plugin.js';

/** Single shared privacy repository for hold gates + /privacy HTTP (W1-SEC-06). */
const sharedPrivacyRepository = createPrivacyRepository();

/**
 * G-924: `/workflows` (UI aggregates) and `/workflow-engine` share one set of
 * repositories so the redesign UI and the engine see the same definitions,
 * instances and approvals.
 */
let workflowRepositoriesCache: ReturnType<typeof createWorkflowRepositories> | null = null;
function workflowRepositories(): ReturnType<typeof createWorkflowRepositories> {
  workflowRepositoriesCache ??= createWorkflowRepositories();
  return workflowRepositoriesCache;
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

/** Shared admissions offer fee + enrol hooks (staff accept + parent A2 accept). */
type AdmissionsStudentProfileInput = {
  tenantId: string;
  applicationId: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: string;
  guardianName: string;
  guardianPhone: string;
  guardianEmail: string | null;
};

/**
 * Materialize the applicant as a student master before creating a fee invoice.
 * A student record may legitimately predate enrollment; using applicationId as
 * the stable student id keeps the offer invoice and eventual enrollment bound
 * to the same person under the strict student foreign key.
 */
async function ensureAdmissionsStudentProfile(input: AdmissionsStudentProfileInput) {
  const repository = createStudentRepository();
  const existing = await repository.findById(input.applicationId, input.tenantId);
  if (existing) return existing;

  const guardianParts = input.guardianName.trim().split(/\s+/);
  const guardianFirst = guardianParts[0] ?? input.guardianName;
  const guardianLast = guardianParts.slice(1).join(' ') || guardianFirst;
  try {
    return await repository.create({
      id: input.applicationId,
      tenantId: input.tenantId,
      firstName: input.firstName,
      lastName: input.lastName,
      dateOfBirth: input.dateOfBirth,
      gender: input.gender,
      nationalId: null,
      nationality: null,
      contacts: [],
      guardians: [
        {
          id: input.applicationId,
          firstName: guardianFirst,
          lastName: guardianLast,
          relationship: 'guardian',
          contactPhone: input.guardianPhone,
          contactEmail: input.guardianEmail ?? undefined,
        },
      ],
      identityDocuments: [],
      customData: {
        admissionsApplicationId: input.applicationId,
        admissionsStatus: 'offered',
      },
    });
  } catch (error) {
    // Concurrent/retried offer sends converge on the application-derived id.
    const raced = await repository.findById(input.applicationId, input.tenantId);
    if (raced) return raced;
    throw error;
  }
}

function createOfferFeeInvoiceHook() {
  return async (
    input: AdmissionsStudentProfileInput & {
      offerId: string;
      feeAmount: number;
      feeCurrency: string;
    },
  ) => {
    const student = await ensureAdmissionsStudentProfile(input);
    const fees = new FeesService(createFeesRepository());
    const createOrFind = async () => {
      const amountCents = Math.max(Math.round(Number(input.feeAmount) * 100), 0);
      const currency = input.feeCurrency || 'INR';
      const existing = (await fees.listInvoicesForStudentIds(input.tenantId, [student.id])).find(
        (invoice) =>
          invoice.createdBy === 'admissions-offer' &&
          invoice.description === `Admission application ${input.applicationId}` &&
          invoice.status === 'open' &&
          invoice.amountCents === amountCents &&
          invoice.currency === currency,
      );
      if (existing) return { invoiceId: existing.id };

      const invoice = await fees.createInvoice(input.tenantId, 'admissions-offer', {
        studentId: student.id,
        title: `Admission offer fee — ${input.firstName} ${input.lastName}`,
        description: `Admission application ${input.applicationId}`,
        amountCents,
        currency,
      });
      return { invoiceId: invoice.id };
    };

    const pool = getSharedPgPool();
    if (!pool) return createOrFind();
    const lockClient = await pool.connect();
    try {
      await lockClient.query(`SELECT pg_advisory_lock(hashtext($1), hashtext($2))`, [
        input.tenantId,
        `admissions-offer:${input.applicationId}`,
      ]);
      return await createOrFind();
    } finally {
      await lockClient
        .query(`SELECT pg_advisory_unlock(hashtext($1), hashtext($2))`, [
          input.tenantId,
          `admissions-offer:${input.applicationId}`,
        ])
        .catch(() => undefined);
      lockClient.release();
    }
  };
}

function assertOfferFeePaidHook() {
  return async (input: { tenantId: string; invoiceId: string; paymentRef?: string | null }) => {
    const fees = new FeesService(createFeesRepository());
    const invoice = await fees.getInvoice(input.tenantId, input.invoiceId);
    if (invoice.status === 'paid') return;
    if (input.paymentRef) {
      await fees.recordPayment(input.tenantId, 'admissions-offer', {
        invoiceId: input.invoiceId,
        method: 'sandbox',
      });
      return;
    }
    throw new Error('Offer fee invoice must be paid before enrolment');
  };
}

function reconcileAdmissionsOfferResourcesHook() {
  return async (input: {
    tenantId: string;
    applicationId: string;
    invoiceId: string | null;
    status: 'declined' | 'expired';
  }) => {
    if (input.invoiceId) {
      const fees = new FeesService(createFeesRepository());
      const invoice = await fees.getInvoice(input.tenantId, input.invoiceId);
      const netCollected = await fees.getNetCollectedCents(input.tenantId, invoice.id);
      if (netCollected > 0) {
        throw new BusinessRuleError(
          `Admission offer has ${netCollected} cents of collected cash to refund before it can be ${input.status}`,
        );
      }
      if (invoice.status !== 'void') {
        await fees.voidInvoice(input.tenantId, invoice.id);
      }
    }

    const repository = createStudentRepository();
    const student = await repository.findById(input.applicationId, input.tenantId);
    if (student) {
      await repository.update(student.id, input.tenantId, {
        customData: {
          ...student.customData,
          admissionsApplicationId: input.applicationId,
          admissionsStatus: input.status,
        },
      });
    }
  };
}

async function createAdmissionsEnrollment(
  input: AdmissionsStudentProfileInput & {
    institutionId: string;
    gradeId: string;
    classId?: string | null;
    academicPeriodId: string;
  },
): Promise<{ studentId: string; enrollmentId: string }> {
  const student = await ensureAdmissionsStudentProfile(input);
  const pool = getSharedPgPool();
  if (!pool) {
    throw new BusinessRuleError('Admissions enrollment requires PostgreSQL class placement');
  }

  try {
    return await withPgTenant(pool, input.tenantId, async (client) => {
      const classResult = await client.query(
        `SELECT c.id, c.capacity
           FROM classes c
           JOIN institutions i
             ON i.id = c.institution_id
            AND i.tenant_id = c.tenant_id
          WHERE c.tenant_id = $1::uuid
            AND c.institution_id = $2::uuid
            AND c.grade_id = $3::uuid
            AND c.academic_period_id = $4::uuid
            AND c.deleted_at IS NULL
            AND i.deleted_at IS NULL
            AND lower(i.status) = 'active'
            AND ($5::uuid IS NULL OR c.id = $5::uuid)
          ORDER BY c.created_at, c.id
          LIMIT 2
          FOR UPDATE OF c`,
        [
          input.tenantId,
          input.institutionId,
          input.gradeId,
          input.academicPeriodId,
          input.classId ?? null,
        ],
      );
      const classes = classResult.rows as Array<{ id: string; capacity: number | null }>;
      if (classes.length === 0) {
        throw new BusinessRuleError(
          'Admissions enrollment requires a valid class for the selected institution, grade, and period',
        );
      }
      if (classes.length > 1) {
        throw new BusinessRuleError(
          'Admissions enrollment requires classId when multiple placements are available',
        );
      }
      const selected = classes[0]!;
      const existingEnrollment = await client.query(
        `SELECT id, institution_id, grade_id, class_id
           FROM enrollments
          WHERE tenant_id = $1::uuid
            AND student_id = $2::uuid
            AND academic_period_id = $3::uuid
            AND status = 'ENROLLED'::enrollment_status
          LIMIT 1`,
        [input.tenantId, student.id, input.academicPeriodId],
      );
      const existing = existingEnrollment.rows[0] as
        | { id: string; institution_id: string; grade_id: string; class_id: string | null }
        | undefined;
      if (existing) {
        if (
          existing.institution_id === input.institutionId &&
          existing.grade_id === input.gradeId &&
          existing.class_id === selected.id
        ) {
          return { studentId: student.id, enrollmentId: String(existing.id) };
        }
        throw new ConflictError(
          'Student already has an active enrollment in a different class for this academic period',
        );
      }

      const capacity = await client.query(
        `SELECT count(*)::int AS enrolled
           FROM enrollments
          WHERE tenant_id = $1::uuid
            AND class_id = $2::uuid
            AND academic_period_id = $3::uuid
            AND status = 'ENROLLED'::enrollment_status`,
        [input.tenantId, selected.id, input.academicPeriodId],
      );
      if (
        selected.capacity != null &&
        Number((capacity.rows[0] as { enrolled: number }).enrolled) >= Number(selected.capacity)
      ) {
        throw new ConflictError('Selected class has no remaining enrollment capacity');
      }

      const counter = await client.query(
        `INSERT INTO student_admission_counters (tenant_id, last_value, updated_at)
         VALUES ($1::uuid, 1, now())
         ON CONFLICT (tenant_id) DO UPDATE
           SET last_value = student_admission_counters.last_value + 1,
               updated_at = now()
         RETURNING last_value`,
        [input.tenantId],
      );
      const seq = Number((counter.rows[0] as { last_value: number }).last_value);
      const admissionNo = `ADM-${new Date().getUTCFullYear()}-${String(seq).padStart(4, '0')}`;
      await client.query(
        `UPDATE students
            SET admission_number = $3::text,
                custom_data = COALESCE(custom_data, '{}'::jsonb) ||
                  jsonb_build_object(
                    'admissionNo', $3::text,
                    'admissionNumber', $3::text,
                    'admissionsApplicationId', $2::text,
                    'admissionsStatus', 'enrolled'
                  ),
                updated_at = now()
          WHERE id = $2::uuid AND tenant_id = $1::uuid`,
        [input.tenantId, student.id, admissionNo],
      );

      const enrolledAt = new Date().toISOString().slice(0, 10);
      await client.query(`SELECT set_config('app.enrollment_history_reason', $1, true)`, [
        'Admission offer accepted',
      ]);
      await client.query(`SELECT set_config('app.enrollment_history_effective_date', $1, true)`, [
        enrolledAt,
      ]);
      const enrollment = await client.query(
        `INSERT INTO enrollments (
           id, tenant_id, student_id, institution_id, grade_id, class_id,
           academic_period_id, status, enrolled_at
         ) VALUES (
           gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
           $6::uuid, 'ENROLLED'::enrollment_status, $7::date
         )
         RETURNING id`,
        [
          input.tenantId,
          student.id,
          input.institutionId,
          input.gradeId,
          selected.id,
          input.academicPeriodId,
          enrolledAt,
        ],
      );
      return {
        studentId: student.id,
        enrollmentId: String((enrollment.rows[0] as { id: string }).id),
      };
    });
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new ConflictError('Student already has an active enrollment for this academic period');
    }
    throw error;
  }
}

function createAdmissionsEnrolOnAccept() {
  return (
    input: AdmissionsStudentProfileInput & {
      institutionId: string;
      gradeId: string;
      classId?: string | null;
      academicPeriodId: string;
    },
  ) => createAdmissionsEnrollment(input);
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
      // G-914 360 routes share the /students prefix (photo, id-card, siblings,
      // consents, discipline, attendance-heatmap).
      // W2-JOB-06: durable import queue when QUEUE_BACKEND / RABBITMQ_URL set.
      const repository = createStudentRepository();
      const importHandle = await createStudentImportQueueFromEnv();
      if (importHandle) {
        scope.addHook('onClose', async () => {
          await importHandle.disconnect();
        });
      }
      // W1-SEC-06: legal-hold gate on student soft-delete / merge — shared store
      // with /privacy plugin + tenant lifecycle delete guard.
      const privacyService = new PrivacyService(sharedPrivacyRepository);
      await scope.register(studentPlugin, {
        repository,
        importQueue: importHandle?.importQueue,
        prefix: '/students',
        assertDestructiveDeleteAllowed: ({ tenantId, subjectId }) =>
          privacyService.assertDestructiveDeleteAllowed(tenantId, subjectId),
      });
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
      const feesForRollover = new FeesService(createFeesRepository());
      // Timetable + LMS clones are best-effort — packages may be memory or PG.
      type Dry = { dryRun?: boolean };
      let copyTimetable:
        | undefined
        | ((
            tenantId: string,
            actorId: string,
            sourcePeriodId: string,
            targetPeriodId: string,
            options?: Dry,
          ) => Promise<{ sectionsCloned: number; meetingsCloned: number }>);
      let copyLmsAssignments:
        | undefined
        | ((
            tenantId: string,
            actorId: string,
            sourcePeriodId: string,
            targetPeriodId: string,
            options?: Dry,
          ) => Promise<{ cloned: number; source: number }>);
      try {
        const { createTimetableRepository, TimetableService } =
          await import('@proctira/backend-timetable');
        const tt = new TimetableService(createTimetableRepository());
        copyTimetable = (tenantId, _actor, sourcePeriodId, targetPeriodId, options) =>
          tt.cloneForAcademicPeriod(tenantId, sourcePeriodId, targetPeriodId, options);
      } catch {
        copyTimetable = async () => ({ sectionsCloned: 0, meetingsCloned: 0 });
      }
      try {
        const { createLmsRepository, LmsService } = await import('@proctira/backend-lms');
        const lms = new LmsService(createLmsRepository());
        copyLmsAssignments = (tenantId, actorId, sourcePeriodId, targetPeriodId, options) =>
          lms.cloneAssignmentsForPeriod(tenantId, actorId, sourcePeriodId, targetPeriodId, options);
      } catch {
        copyLmsAssignments = async () => ({ cloned: 0, source: 0 });
      }
      const pgPool = getSharedPgPool();
      await scope.register(institutionPlugin, {
        repository: createInstitutionRepository(),
        prefix: '/institutions',
        academics: true,
        rolloverExtras: {
          copyFeeStructures: (tenantId, actorId, sourcePeriodId, targetPeriodId, options) =>
            feesForRollover.cloneStructuresForPeriod(
              tenantId,
              actorId,
              sourcePeriodId,
              targetPeriodId,
              options,
            ),
          copyTimetable,
          copyLmsAssignments,
          recordRolloverRun: pgPool
            ? async (input) => {
                await withPgTenant(pgPool, input.tenantId, async (client) => {
                  await client.query(
                    `INSERT INTO academic_rollover_runs (
                       id, tenant_id, source_period_id, target_period_id, actor_id,
                       dry_run, idempotency_key, request, summary, status
                     ) VALUES (
                       gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4,
                       $5, $6, $7::jsonb, $8::jsonb, $9
                     )
                     ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
                     DO NOTHING`,
                    [
                      input.tenantId,
                      input.sourcePeriodId,
                      input.targetPeriodId,
                      input.actorId,
                      input.dryRun,
                      input.idempotencyKey,
                      JSON.stringify(input.request),
                      JSON.stringify(input.summary),
                      input.status,
                    ],
                  );
                });
              }
            : undefined,
        },
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
      type HeatmapDay = { date: string; status: string };
      type HeatmapBinder = (source: {
        listStudentAttendanceInRange: (
          tenantId: string,
          studentId: string,
          startDate: string,
          endDate: string,
        ) => Promise<HeatmapDay[]>;
      }) => void;
      const bindHeatmap = bindAttendanceHeatmapSource as unknown as HeatmapBinder;
      const attendance = scope.attendanceService as unknown as {
        listStudentAttendanceInRange: (
          tenantId: string,
          studentId: string,
          startDate: string,
          endDate: string,
        ) => Promise<Array<{ date: string; status: unknown }>>;
      };
      bindHeatmap({
        listStudentAttendanceInRange: async (tenantId, studentId, startDate, endDate) => {
          const rows = await attendance.listStudentAttendanceInRange(
            tenantId,
            studentId,
            startDate,
            endDate,
          );
          return rows.map((row) => ({ date: row.date, status: String(row.status) }));
        },
      });
    },
  },
  {
    name: 'examination',
    proxyPrefixes: ['/examinations'],
    register: async (scope) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      const examOpsStore = createExamOpsStore();
      // W2-JOB-04: transactional outbox + relay when QUEUE_BACKEND / RABBITMQ_URL set.
      const documentOutboxHandle = await createDocumentOutboxFromEnv();
      if (documentOutboxHandle) {
        scope.addHook('onClose', async () => {
          await documentOutboxHandle.disconnect();
        });
      }
      await scope.register(examinationPlugin, {
        repository: createExaminationRepository(),
        resultRepository: createResultRepository(),
        documentRepository: createDocumentRepository({}, examOpsStore),
        // G-902: document routes (/documents/generate, /documents/jobs) only
        // register when a PdfGenerator is supplied.
        pdfGenerator: new SimplePdfGenerator(),
        outboxStore: documentOutboxHandle?.outboxStore,
        examOpsStore,
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
      // G-210: report-card factories use pg `024` when DATABASE_URL is set.
      // Durable board HTML report cards also live at `/gradebook/report-cards`.
      // W2-JOB-02: durable queue publisher when QUEUE_BACKEND / RABBITMQ_URL set.
      const reportCardQueueHandle = await createReportCardPublisherFromEnv();
      if (reportCardQueueHandle) {
        scope.addHook('onClose', async () => {
          await reportCardQueueHandle.disconnect();
        });
      }
      await scope.register(assessmentPlugin, {
        gradingSchemeRepository: createGradingSchemeRepository(),
        assessmentItemRepository: createAssessmentItemRepository(),
        outcomeRepository: createOutcomeRepository(),
        resultRepository: createAssessmentResultRepository(),
        reportCardTemplateRepository: createReportCardTemplateRepository(),
        teacherCommentRepository: createTeacherCommentRepository(),
        institutionBrandingRepository: createInstitutionBrandingRepository(),
        reportCardJobRepository: createReportCardJobRepository(),
        taskQueuePublisher: reportCardQueueHandle?.publisher,
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
      // G-801/G-802/G-915: Pg when DATABASE_URL (026 + 038); else in-memory.
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
      const feesForScholarships = new FeesService(createFeesRepository());
      await scope.register(scholarshipPlugin, {
        repository,
        prefix: '/scholarships',
        serviceOptions: {
          onDisbursementPaid: async (input) => {
            // W2-FIN-08: prefer reconciled amountCents from scholarship domain.
            const amountCents = input.amountCents ?? majorUnitsToCents(input.amount);
            if (amountCents <= 0) return;
            await feesForScholarships.applyScholarshipNetting(
              input.tenantId,
              'scholarship-netting',
              {
                studentId: input.applicantId,
                disbursementId: input.disbursementId,
                amountCents,
                currency: input.currency,
              },
            );
          },
          onDisbursementReversed: async (input) => {
            await feesForScholarships.reverseScholarshipNetting(
              input.tenantId,
              'scholarship-netting',
              { disbursementId: input.disbursementId },
            );
          },
        },
      });
    },
  },
  {
    name: 'health',
    proxyPrefixes: ['/health'],
    register: async (scope) => {
      // Postgres counselling + PHI + special-needs + nurse incidents when
      // DATABASE_URL is set (raw pg — SQL 002 + 012 + 017 + 046); else memory.
      // UI aggregates merge seed + live counselling writes for list sync.
      // W1-SEC-04 / G-711: production requires KMS envelope (or explicit stub/opt-out).
      // Inject AWS KMS (or ALLOW_PHI_KMS_STUB local-stub) — createPhiEnvelopeProvider
      // fail-closes when PHI_ENVELOPE_PROVIDER=kms without a client.
      assertPhiEnvelopeConfigured();
      const phiKmsClient = await createPhiKmsClientFromEnv();
      await ensurePhiEnvelopeProvider(process.env, { kmsClient: phiKmsClient });
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
      // Board rollup + DW indicators/import/map (G-209 / G-809). Catalogue
      // generate / schedules / dashboards are backend-report (G-909).
      await scope.register(insightsUiPlugin);
    },
  },
  {
    name: 'report',
    proxyPrefixes: ['/reports'],
    register: async (scope) => {
      await scope.register(reportCataloguePlugin);
    },
  },
  {
    name: 'etl',
    proxyPrefixes: ['/pipelines'],
    register: async (scope) => {
      // Wave 10 Option C — unpark ETL. PG document store when DATABASE_URL (046).
      const repository = createPipelineRepository();
      await scope.register(etlPlugin, {
        repository,
        config: {
          defaultRetryPolicy: { maxRetries: 3, backoffMs: 1000 },
        },
        prefix: '/pipelines',
      });
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
      // Redesign UI aggregates (definitions / instances / approvals) keep the
      // `/workflows/*` shapes App Router pages expect, but since G-924 they are
      // served by the real engine (same repositories as `/workflow-engine`), so
      // there is one workflow store and one audited transition path.
      const { repository, persistence } = workflowRepositories();
      await scope.register(workflowUiPlugin, {
        store: new EngineBackedWorkflowUiStore(
          repository,
          new WorkflowService(repository),
          persistence === 'postgres' ? 'postgres' : 'memory',
        ),
      });
    },
  },
  {
    name: 'workflow-engine',
    proxyPrefixes: ['/workflow-engine'],
    register: async (scope) => {
      // G-715: real @proctira/backend-workflow engine (definitions, instances,
      // transitions + audit, cases). Pg on db/sql/025 when DATABASE_URL is set.
      // P1-WF: durable escalation publisher when QUEUE_BACKEND / RABBITMQ_URL set.
      const { repository, caseRepository } = workflowRepositories();
      const escalationHandle = await createEscalationPublisherFromEnv();
      if (escalationHandle) {
        scope.addHook('onClose', async () => {
          await escalationHandle.disconnect();
        });
      }
      await scope.register(workflowPlugin, {
        repository,
        caseRepository,
        escalationPublisher: escalationHandle?.publisher,
        prefix: '/workflow-engine',
      });
    },
  },
  {
    name: 'tenant-admin',
    proxyPrefixes: ['/tenant', '/scim'],
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
      // W2-JOB-01: durable delivery publisher when QUEUE_BACKEND / RABBITMQ_URL set.
      const { repository, prefsStore } = createNotificationStack();
      const deliveryHandle = await createNotificationDeliveryPublisherFromEnv();
      if (deliveryHandle) {
        scope.addHook('onClose', async () => {
          await deliveryHandle.disconnect();
        });
      }
      await scope.register(notificationPlugin, {
        repository,
        prefsStore,
        queuePublisher: deliveryHandle?.publisher,
        prefix: '/notifications',
      });
    },
  },
  {
    name: 'transport',
    proxyPrefixes: ['/transport'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/006 + 045_transport_ops_schema.sql); else in-memory.
      // G-920: GPS ingest + live map, trip attendance, alerts, fees via FeesService (G-903).
      const repository = createTransportRepository();
      const feesService = new FeesService(createFeesRepository());
      await scope.register(transportPlugin, {
        repository,
        feesService: {
          createFeeStructure: (tenantId, actorId, input) =>
            feesService.createFeeStructure(tenantId, actorId, input),
          createInvoice: (tenantId, actorId, input) =>
            feesService.createInvoice(tenantId, actorId, input),
          bulkInvoiceClass: (tenantId, actorId, input) =>
            feesService.bulkInvoiceClass(tenantId, actorId, input),
        },
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
        deliveryAdapter: createDeliveryAdapterFromEnv(),
        prefix: '/communication',
      });
    },
  },
  {
    name: 'hostel',
    proxyPrefixes: ['/hostel'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/008 + 040_hostel_ops_schema.sql); else in-memory.
      // G-921: allocation invoices post to fees ledger via shared FeesService.
      const repository = createHostelRepository();
      const feesService = new FeesService(createFeesRepository());
      await scope.register(hostelPlugin, {
        repository,
        feesLedger: {
          postAllocationInvoice: async (tenantId, actorId, input) => {
            const invoice = await feesService.createInvoice(tenantId, actorId, {
              studentId: input.studentId,
              title: input.title,
              description: input.description,
              amountCents: input.amountCents,
              currency: input.currency,
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
        prefix: '/hostel',
      });
    },
  },
  {
    name: 'fees',
    proxyPrefixes: ['/fees'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/010 + 011_fees_finance_schema.sql + 031); else in-memory.
      // Sandbox PaymentAdapter only — live PSP waived (G-202).
      // Registered before library so fines can share createFeesRepository().
      const repository = createFeesRepository();
      const parentRepo = createParentPortalRepository();
      await scope.register(feesPlugin, {
        repository,
        prefix: '/fees',
        parentBinding: {
          listLinkedStudentIds: async (tenantId, parentUserId) => {
            const links = await parentRepo.listChildLinksForParent(tenantId, parentUserId);
            return links.map((link) => link.studentId);
          },
          isLinked: (tenantId, parentUserId, studentId) =>
            parentRepo.hasActiveLink(tenantId, parentUserId, studentId),
        },
      });
    },
  },
  {
    name: 'library',
    proxyPrefixes: ['/library'],
    register: async (scope) => {
      // Pg when DATABASE_URL (db/sql/009 + 039_library_ops_schema.sql); else in-memory.
      // G-603: fines post to fees ledger via shared createFeesRepository().
      const repository = createLibraryRepository();
      const feesService = new FeesService(createFeesRepository());
      // G-916: parent/guardian OPAC reads of loans/holds are bound to linked children;
      // students are pinned to their JWT subject. Staff principals are unaffected.
      const libraryParentRepo = createParentPortalRepository();
      await scope.register(libraryPlugin, {
        repository,
        patronBinding: {
          isLinked: (tenantId, parentUserId, studentId) =>
            libraryParentRepo.hasActiveLink(tenantId, parentUserId, studentId),
        },
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
    proxyPrefixes: ['/parent-portal', '/student-portal'],
    register: async (scope) => {
      const repository = createParentPortalRepository();
      // A2: same pipeline store + fee/enrol hooks as staff admissions so parent
      // accept enrols against durable offers (PG when DATABASE_URL).
      const pipelineService = new AdmissionsPipelineService(
        createAdmissionsPipelineStore(),
        createRegistrationRepository(),
        createAdmissionsEnrolOnAccept(),
        createOfferFeeInvoiceHook(),
        assertOfferFeePaidHook(),
        undefined,
        reconcileAdmissionsOfferResourcesHook(),
      );
      await scope.register(parentPortalPlugin, {
        repository,
        feesService: new FeesService(createFeesRepository()),
        admissionsOffers: {
          listGuardianOffers: (tenantId, guardianEmail) =>
            pipelineService.listGuardianOffers(tenantId, guardianEmail),
          acceptOfferForGuardian: (tenantId, offerId, guardianEmail, input) =>
            pipelineService.acceptOfferForGuardian(tenantId, offerId, guardianEmail, input),
        },
        prefix: '/parent-portal',
        studentPrefix: '/student-portal',
      });
    },
  },
  {
    name: 'registration',
    proxyPrefixes: ['/registrations', '/admissions'],
    register: async (scope) => {
      // Pg when DATABASE_URL (014 waitlist/interview + 034 enquiry/merit/offer); else in-memory.
      const repository = createRegistrationRepository();
      const crmStore = createAdmissionsCrmStore();
      const pipelineStore = createAdmissionsPipelineStore();
      // W1-SEC-05: Redis when REDIS_URL (shared across replicas); else in-memory
      // only when assertInMemoryFallbackAllowed permits (never production).
      const sessionStore = createRegistrationSessionStore();
      await scope.register(registrationPlugin, {
        repository,
        sessionStore,
        crmStore,
        pipelineStore,
        prefix: '/registrations',
        admissionsPrefix: '/admissions',
        createOfferFeeInvoice: createOfferFeeInvoiceHook(),
        assertOfferFeePaid: assertOfferFeePaidHook(),
        reconcileOfferResources: reconcileAdmissionsOfferResourcesHook(),
        enrolOnAccept: createAdmissionsEnrolOnAccept(),
      });
    },
  },
  {
    name: 'developer',
    proxyPrefixes: ['/developer'],
    register: async (scope) => {
      // G-607 / W1-ARCH-01 COMPLETE: AuthZ via gateway RBAC; Postgres for API keys,
      // accounts, webhooks, deliveries when DATABASE_URL is set (fail-closed otherwise
      // in production). Marketplace/docs/analytics remain in-memory residuals.
      // W2-JOB-07: durable webhook delivery publisher when QUEUE_BACKEND / RABBITMQ_URL set.
      // W1-SEC-08: inject webhook nonce replay store (Redis when REDIS_URL set) so
      // POST /developer/webhooks/verify is fail-closed for skew + replay.
      await ensureDeveloperPortalPersistence();
      const webhookDelivery = await createWebhookDeliveryPublisherFromEnv();
      if (webhookDelivery) {
        scope.addHook('onClose', async () => {
          await webhookDelivery.disconnect();
        });
      }

      let webhookReplayRedis: RedisLikeForReplay | undefined;
      const redisUrl = process.env['REDIS_URL']?.trim();
      if (redisUrl) {
        const { default: Redis } = await import('ioredis');
        const redis = new Redis(redisUrl, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });
        webhookReplayRedis = redis;
        scope.addHook('onClose', async () => {
          await redis.quit();
        });
      }
      const webhookReplayStore = createWebhookReplayStoreFromEnv({
        NODE_ENV: process.env['NODE_ENV'],
        redis: webhookReplayRedis,
      });

      await scope.register(developerPortalPlugin, {
        repository: createDeveloperPortalRepository(),
        deliveryPublisher: webhookDelivery?.publisher,
        replayStore: webhookReplayStore,
        prefix: '/developer',
      });
    },
  },
  {
    name: 'privacy',
    proxyPrefixes: ['/privacy'],
    register: async (scope) => {
      // W1-ARCH-05 / W1-SEC-06: compose privacy HTTP. Shared createPrivacyRepository()
      // with student/tenant destructive gates (Pg when DATABASE_URL; else shared memory).
      // Durable anonymization/offboard publishers when QUEUE_BACKEND / RABBITMQ_URL set.
      const queueHandle = await createPrivacyQueuePublishersFromEnv();
      if (queueHandle) {
        scope.addHook('onClose', async () => {
          await queueHandle.disconnect();
        });
      }
      await scope.register(privacyPlugin, {
        repository: sharedPrivacyRepository,
        prefix: '/privacy',
        anonymizationPublisher: queueHandle?.anonymizationPublisher,
        offboardPublisher: queueHandle?.offboardPublisher,
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
 * W1-ARCH-06 — live composition snapshot (name + proxy prefixes) from the
 * executable registrar table. Prefer this over scraping `domain-plugins.ts`.
 */
export interface DomainRegistrarComposition {
  readonly name: string;
  readonly proxyPrefixes: readonly string[];
}

export const DOMAIN_REGISTRAR_COMPOSITION: readonly DomainRegistrarComposition[] =
  DOMAIN_REGISTRARS.map((domain) => ({
    name: domain.name,
    proxyPrefixes: domain.proxyPrefixes,
  }));

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
