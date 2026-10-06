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
import { appendAuditEntryOnClient, toCreateAuditLogInput } from '@proctira/backend-audit';
import {
  communicationPlugin,
  createCommunicationRepository,
  createDeliveryAdapterFromEnv,
  type CircularAuditEvent,
} from '@proctira/backend-communication';
import { createCurriculumStore, curriculumPlugin } from '@proctira/backend-curriculum';
import {
  createDeveloperPortalRepository,
  createWebhookDeliveryPublisherFromEnv,
  createWebhookReplayStoreFromEnv,
  developerPortalPlugin,
  ensureDeveloperPortalPersistence,
  parseWebhookFanOutEvents,
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
  buildSystemMoneyAuditSink,
  createFeesRepository,
  FeesService,
  feesPlugin,
  majorUnitsToCents,
} from '@proctira/backend-fees';
import {
  createGradebookRepository,
  gradebookPlugin,
  type GradebookAuditEntry,
} from '@proctira/backend-gradebook';
import {
  assertPhiEnvelopeConfigured,
  createHealthRepository,
  createPhiKmsClientFromEnv,
  ensurePhiEnvelopeProvider,
  healthPlugin,
} from '@proctira/backend-health';
import { createHostelRepository, hostelPlugin } from '@proctira/backend-hostel';
import {
  createAreaHierarchyDb,
  createInstitutionRepository,
  institutionPlugin,
  type RolloverExtras,
  type RolloverSummary,
} from '@proctira/backend-institution';
import { createLibraryRepository, libraryPlugin } from '@proctira/backend-library';
import {
  createLmsRepository,
  LmsService,
  lmsPlugin,
  type LmsRepository,
} from '@proctira/backend-lms';
import {
  createNotificationDeliveryPublisherFromEnv,
  createNotificationStack,
  notificationPlugin,
} from '@proctira/backend-notification';
import { createParentPortalRepository, parentPortalPlugin } from '@proctira/backend-parent-portal';
import {
  createPrivacyQueuePublishersFromEnv,
  createPrivacyRepository,
  PgDomainSubjectAnonymizer,
  PgTenantWipeExecutor,
  PrivacyService,
  privacyPlugin,
  readFinanceHealthErasureMode,
} from '@proctira/backend-privacy';
import {
  AdmissionsPipelineService,
  createAdmissionsCrmStore,
  createAdmissionsPipelineStore,
  createRegistrationRepository,
  createRegistrationSessionStore,
  registrationPlugin,
  type PublicTenantResolver,
} from '@proctira/backend-registration';
import { reportCataloguePlugin } from '@proctira/backend-report';
import {
  createScholarshipDocumentStore,
  createScholarshipFeeOutbox,
  createScholarshipRepository,
  isPgScholarshipEnabled,
  linkedStudentIdsForParent,
  scholarshipPlugin,
  parentScholarshipPlugin,
  type RedisLikeForDownloadReplay,
  type ScholarshipRepository,
} from '@proctira/backend-scholarship';
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
import {
  createTimetableRepository,
  createTimetableOpsStore,
  type TimetableRepository,
  TimetableService,
  timetablePlugin,
} from '@proctira/backend-timetable';
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

import {
  formatAdmissionNumber,
  loadAdmissionsTimeZone,
  offerFeeAmountCents,
  tenantLocalDate,
} from './admissions-offer-policy.js';
import type { GatewayConfig } from './config.js';
import { shouldSeedDemoData } from './demo-seed-policy.js';
import { healthUiPlugin } from './health-ui-plugin.js';
import { createHealthUiSeed } from './health-ui-seed.js';
import { insightsUiPlugin } from './insights-ui-plugin.js';
import { registerInstitutionDirectoryRoutes } from './institution-directory.js';
import { registerInstitutionOverviewRoutes } from './institution-overview.js';
import { platformAdminUiPlugin } from './platform-admin-ui-plugin.js';
import { seedScholarshipDemoData } from './scholarship-demo-seed.js';
import { createScholarshipDisbursementLookup } from './scholarship-disbursement-lookup.js';
import { createScholarshipDownloadReplayGuard } from './scholarship-download-controls.js';
import { tenantAdminPlugin } from './tenant-admin-plugin.js';
import { createTenantTimeZoneResolver, pgTenantTimeZoneSources } from './tenant-timezone.js';
import { createWebhookSigningSecretsFromEnv } from './webhook-signing-secrets-wiring.js';
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

/**
 * PRC-H020: the fees netting routes verify disbursements against the repository
 * mounted by the scholarship registrar (same instance in in-memory mode).
 */
/**
 * PRC-L320: one Timetable/LMS service instance per gateway app, shared by the
 * mounted domain plugin and the institution rollover clone hooks (keyed on the
 * per-app dependencies object so separate test apps never share state).
 */
const sharedDomainServices = new WeakMap<
  DomainPluginDependencies,
  {
    timetable?: { service: TimetableService; repository: TimetableRepository };
    lms?: { service: LmsService; repository: LmsRepository };
  }
>();
function sharedServicesFor(dependencies: DomainPluginDependencies) {
  let entry = sharedDomainServices.get(dependencies);
  if (!entry) {
    entry = {};
    sharedDomainServices.set(dependencies, entry);
  }
  return entry;
}
export function sharedTimetableService(dependencies: DomainPluginDependencies): {
  service: TimetableService;
  repository: TimetableRepository;
} {
  const entry = sharedServicesFor(dependencies);
  if (!entry.timetable) {
    const repository = createTimetableRepository();
    entry.timetable = {
      repository,
      service: new TimetableService(repository, createTimetableOpsStore(), {
        // PRC-M101: a meeting/substitution may only use staff with an active
        // assignment at the meeting's institution (same tenant).
        staffBelongsToInstitution: (tenantId, staffId, institutionId) =>
          sharedAssignmentRepository().hasActiveAssignmentAt(staffId, tenantId, institutionId),
      }),
    };
  }
  return entry.timetable;
}
export function sharedLmsService(dependencies: DomainPluginDependencies): {
  service: LmsService;
  repository: LmsRepository;
} {
  const entry = sharedServicesFor(dependencies);
  if (!entry.lms) {
    const repository = createLmsRepository();
    entry.lms = { repository, service: new LmsService(repository) };
  }
  return entry.lms;
}
/**
 * PRC-L318: claim-first rollover ledger hooks over `academic_rollover_runs`.
 * The claim is a single INSERT … ON CONFLICT so exactly one concurrent
 * same-key request wins; a previously `failed` row may be re-claimed.
 */
export function createRolloverClaimHooks(
  pool: NonNullable<ReturnType<typeof getSharedPgPool>>,
): Pick<RolloverExtras, 'claimRolloverRun' | 'finishRolloverRun'> {
  return {
    claimRolloverRun: (input) =>
      withPgTenant(pool, input.tenantId, async (client) => {
        const claimed = await client.query(
          `INSERT INTO academic_rollover_runs (
             id, tenant_id, source_period_id, target_period_id, actor_id,
             dry_run, idempotency_key, request, summary, status
           ) VALUES (
             gen_random_uuid(), $1::uuid, $2::uuid, $3::uuid, $4,
             false, $5, $6::jsonb, '{}'::jsonb, 'running'
           )
           ON CONFLICT (tenant_id, idempotency_key) WHERE idempotency_key IS NOT NULL
           DO UPDATE SET status = 'running',
                         actor_id = EXCLUDED.actor_id,
                         source_period_id = EXCLUDED.source_period_id,
                         target_period_id = EXCLUDED.target_period_id,
                         request = EXCLUDED.request
             WHERE academic_rollover_runs.status = 'failed'
           RETURNING id`,
          [
            input.tenantId,
            input.sourcePeriodId,
            input.targetPeriodId,
            input.actorId,
            input.idempotencyKey,
            JSON.stringify(input.request),
          ],
        );
        const claimedRow = claimed.rows[0] as { id: string } | undefined;
        if (claimedRow) return { state: 'claimed' as const, runId: claimedRow.id };
        const existing = await client.query(
          `SELECT status, summary FROM academic_rollover_runs
            WHERE tenant_id = $1::uuid AND idempotency_key = $2
            LIMIT 1`,
          [input.tenantId, input.idempotencyKey],
        );
        const row = existing.rows[0] as { status: string; summary: RolloverSummary } | undefined;
        return row?.status === 'completed'
          ? { state: 'completed' as const, summary: row.summary }
          : { state: 'running' as const };
      }),
    finishRolloverRun: async (input) => {
      await withPgTenant(pool, input.tenantId, async (client) => {
        await client.query(
          `UPDATE academic_rollover_runs
              SET status = $3,
                  summary = COALESCE($4::jsonb, summary)
            WHERE id = $1::uuid AND tenant_id = $2::uuid`,
          [
            input.runId,
            input.tenantId,
            input.status,
            input.summary ? JSON.stringify(input.summary) : null,
          ],
        );
      });
    },
  };
}
let mountedScholarshipRepository: ScholarshipRepository | null = null;
function scholarshipRepositoryForFees(): ScholarshipRepository {
  mountedScholarshipRepository ??= createScholarshipRepository();
  return mountedScholarshipRepository;
}
/**
 * PRC-M101: one staff-assignment repository per process, shared by the staff
 * routes and the timetable staff-membership check (the in-memory fallback must
 * see the same rows the staff routes wrote).
 */
let assignmentRepositorySingleton: ReturnType<typeof createAssignmentRepository> | undefined;
function sharedAssignmentRepository(): ReturnType<typeof createAssignmentRepository> {
  assignmentRepositorySingleton ??= createAssignmentRepository();
  return assignmentRepositorySingleton;
}
/** Trusted dependencies composed once by the gateway root. */
export interface DomainPluginDependencies {
  publicTenantResolver: PublicTenantResolver;
}

/** A registrar mounts one domain's plugin and declares the proxy prefixes it supersedes. */
interface DomainRegistrar {
  /** Logical name (for logging). */
  name: string;
  /** Proxy prefix(es) this domain serves in-process — excluded from the router. */
  proxyPrefixes: string[];
  /** Mounts the domain plugin onto an `/api/v1`-scoped instance. */
  register: (
    scope: FastifyInstance,
    config: GatewayConfig,
    dependencies: DomainPluginDependencies,
  ) => Promise<void>;
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
      // PRC-L002: shared cents conversion rejects sub-cent / negative / non-finite amounts.
      const amountCents = offerFeeAmountCents(input.feeAmount);
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

/** PRC-M266: persist gradebook audit events to audit_log_entries when Postgres is configured. */
function gradebookAuditSink() {
  const pool = getSharedPgPool();
  if (!pool) return null;
  return async (entry: GradebookAuditEntry) => {
    await withPgTenant(pool, entry.tenantId, async (client) => {
      await appendAuditEntryOnClient(
        client,
        toCreateAuditLogInput({
          tenantId: entry.tenantId,
          entityType: entry.entityType,
          entityId: entry.entityId,
          operation: 'CREATE',
          userId: entry.actorId ?? 'unknown',
          userName: entry.actorId ?? 'unknown',
          ipAddress: 'unknown',
          afterValues: entry.details,
          metadata: {
            regulated: `gradebook.${entry.action}`,
            action: entry.action,
            gradebookAuditId: entry.id,
          },
          timestamp: new Date(entry.at),
        }),
      );
    });
  };
}

/**
 * Owner decision (PR #548): admin-recorded (on-behalf) circular
 * acknowledgements are written to the hash-chained `audit_log_entries` with
 * the acting staff member, recipient, circular and reason. Null without a
 * shared Pg pool (in-memory dev) — the package keeps its in-process log.
 */
function circularAuditSink() {
  const pool = getSharedPgPool();
  if (!pool) return null;
  return async (event: CircularAuditEvent) => {
    await withPgTenant(pool, event.tenantId, async (client) => {
      await appendAuditEntryOnClient(
        client,
        toCreateAuditLogInput({
          tenantId: event.tenantId,
          entityType: 'circular_ack',
          entityId: event.resourceId,
          operation: 'UPDATE',
          userId: event.actorId,
          userName: event.actorId,
          ipAddress: 'unknown',
          afterValues: {
            circularId: event.resourceId,
            recipientId: event.recipientId,
            recordedBy: event.actorId,
            reason: event.reason,
            onBehalf: true,
          },
          metadata: {
            regulated: `communication.${event.action}`,
            action: event.action,
          },
          timestamp: event.at,
        }),
      );
    });
  };
}

/**
 * PRC-C002: decide whether an admission offer may be accepted, given the offer-fee invoice's
 * current status. A client-supplied paymentRef is NOT evidence of settlement — previously any
 * non-empty string caused a fabricated sandbox payment, letting a guardian accept without
 * paying. The invoice must already be genuinely paid (verified PSP/webhook settlement or a
 * staff-recorded receipt on the fee ledger). Extracted as a pure function so the decision is
 * directly unit-tested (see domain-plugins.test.ts) rather than only via an injected fake.
 */
export function assertOfferFeeInvoicePaid(invoiceStatus: string): void {
  if (invoiceStatus === 'paid') return;
  throw new BusinessRuleError(
    'Offer fee invoice must be paid through a verified payment before enrolment',
  );
}

/**
 * PRC-M327: the invoice used to accept an offer must be the server-raised
 * admissions invoice for that application, for exactly the offer fee.
 */
export function assertOfferFeeInvoiceMatchesOffer(
  invoice: {
    createdBy?: string | null;
    description?: string | null;
    amountCents: number;
    currency: string;
  },
  offer: { applicationId: string; expectedAmount: number; expectedCurrency: string },
): void {
  if (
    invoice.createdBy !== 'admissions-offer' ||
    invoice.description !== `Admission application ${offer.applicationId}` ||
    invoice.amountCents !== offerFeeAmountCents(offer.expectedAmount) ||
    invoice.currency !== (offer.expectedCurrency || 'INR')
  ) {
    throw new BusinessRuleError('Offer fee invoice does not match this offer');
  }
}
type OfferFeeInvoiceReader = Pick<FeesService, 'getInvoice'>;

const defaultOfferFeeInvoiceReader = (): OfferFeeInvoiceReader =>
  new FeesService(createFeesRepository());

export function assertOfferFeePaidHook(
  createReader: () => OfferFeeInvoiceReader = defaultOfferFeeInvoiceReader,
) {
  // PRC-H079 / PRC-C002: read-only verification. Payment is recorded only by the verified
  // PSP webhook / callback path; a client paymentRef is never payment proof. The reader is
  // read-only by type (getInvoice only), so this hook cannot record a payment.
  return async (input: {
    tenantId: string;
    invoiceId: string;
    applicationId: string;
    offerId: string;
    expectedAmount: number;
    expectedCurrency: string;
    paymentRef?: string | null;
  }) => {
    // paymentRef is intentionally ignored: it is not evidence of settlement.
    const invoice = await createReader().getInvoice(input.tenantId, input.invoiceId);
    // PRC-M327: the invoice must be the admissions invoice for THIS application
    // and match the offer fee exactly (no swapping in a cheaper/foreign invoice).
    assertOfferFeeInvoiceMatchesOffer(invoice, input);
    assertOfferFeeInvoicePaid(invoice.status);
  };
}

/**
 * PRC-H079: a staff-supplied offerFeeInvoiceId at offer creation must be this application's
 * own admissions offer-fee invoice (same identity markers as createOfferFeeInvoiceHook,
 * including the offer's amount and currency) and not void/written off. Unknown or foreign
 * invoices (getInvoice 404 under tenant RLS) or an invalid fee amount -> false.
 */
export function verifyOfferFeeInvoiceOwnershipHook(
  createReader: () => OfferFeeInvoiceReader = defaultOfferFeeInvoiceReader,
) {
  return async (input: {
    tenantId: string;
    applicationId: string;
    invoiceId: string;
    feeAmount: number;
    feeCurrency: string;
  }): Promise<boolean> => {
    let invoice: Awaited<ReturnType<OfferFeeInvoiceReader['getInvoice']>>;
    let amountCents: number;
    try {
      amountCents = offerFeeAmountCents(input.feeAmount);
      invoice = await createReader().getInvoice(input.tenantId, input.invoiceId);
    } catch {
      return false;
    }
    return (
      invoice.tenantId === input.tenantId &&
      invoice.createdBy === 'admissions-offer' &&
      invoice.description === `Admission application ${input.applicationId}` &&
      invoice.amountCents === amountCents &&
      invoice.currency === (input.feeCurrency || 'INR') &&
      invoice.status !== 'void' &&
      invoice.status !== 'written_off'
    );
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
      // PRC-L002: admission-number year and enrolment date follow the tenant's local calendar.
      const timeZone = await loadAdmissionsTimeZone(client, input.tenantId);
      const acceptedAt = new Date();
      const admissionNo = formatAdmissionNumber(acceptedAt, timeZone, seq);
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

      const enrolledAt = tenantLocalDate(acceptedAt, timeZone);
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
    proxyPrefixes: ['/students', '/enrollments', '/transfers'],
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
      // PRC-C010/C011: bind portal readers to the students they may see — guardians/parents to
      // their linked children (parent-portal child-link table, same source as fees/gradebook),
      // and a student to their own JWT subject. Without this, portal roles are denied.
      const studentParentRepo = createParentPortalRepository();
      await scope.register(studentPlugin, {
        repository,
        importQueue: importHandle?.importQueue,
        // PRC-H092: in-process consumer (dedicated connection) for queued imports.
        importWorkerQueue: importHandle?.createConsumerAdapter(),
        prefix: '/students',
        assertDestructiveDeleteAllowed: ({ tenantId, subjectId }) =>
          privacyService.assertDestructiveDeleteAllowed(tenantId, subjectId),
        studentBinding: {
          listReadableStudentIds: async (tenantId, actorUserId) => {
            // Guardians/parents → their linked children. A student's own-record read is served
            // by the student portal (JWT sub) and is tracked as a follow-up; the child-link
            // table is the authoritative ownership source here.
            const links = await studentParentRepo.listChildLinksForParent(tenantId, actorUserId);
            return links.map((link) => link.studentId);
          },
        },
      });
    },
  },
  {
    name: 'institution',
    // G-901: academics sub-domains (academic periods / grades / classes /
    // subjects / infrastructure) are served by the same plugin.
    proxyPrefixes: [
      '/institutions',
      '/areas',
      '/academic-periods',
      '/grades',
      '/classes',
      '/subjects',
      '/institution-subjects',
      '/infrastructure',
    ],
    register: async (scope, _config, dependencies) => {
      // Prisma (Postgres + RLS) when DATABASE_URL is set, else in-memory.
      // G-901: academics = Prisma (+ raw-pg infrastructure on db/sql/027) when
      // DATABASE_URL is set, else in-memory Prisma look-alike.
      const feesForRollover = new FeesService(createFeesRepository());
      // PRC-L320: timetable/LMS clone hooks are wired directly (no catch-and-zero
      // fallback) and reuse the SAME service instances the timetable/LMS domain
      // plugins mount, rather than constructing private copies.
      const timetableForRollover = sharedTimetableService(dependencies).service;
      const lmsForRollover = sharedLmsService(dependencies).service;
      const copyTimetable = (
        tenantId: string,
        _actorId: string,
        sourcePeriodId: string,
        targetPeriodId: string,
        options?: { dryRun?: boolean },
      ) =>
        timetableForRollover.cloneForAcademicPeriod(
          tenantId,
          sourcePeriodId,
          targetPeriodId,
          options,
        );
      const copyLmsAssignments = (
        tenantId: string,
        actorId: string,
        sourcePeriodId: string,
        targetPeriodId: string,
        options?: { dryRun?: boolean },
      ) =>
        lmsForRollover.cloneAssignmentsForPeriod(
          tenantId,
          actorId,
          sourcePeriodId,
          targetPeriodId,
          options,
        );
      const pgPool = getSharedPgPool();
      await scope.register(institutionPlugin, {
        repository: createInstitutionRepository(),
        areaHierarchyDb: createAreaHierarchyDb(),
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
          // PRC-L318: replayed real runs return the stored summary (dry-runs use a
          // namespaced key, so they never consume the real run's key).
          findCompletedRolloverRun: pgPool
            ? async ({ tenantId, idempotencyKey }) =>
                withPgTenant(pgPool, tenantId, async (client) => {
                  const { rows } = await client.query(
                    `SELECT summary FROM academic_rollover_runs
                      WHERE tenant_id = $1::uuid AND idempotency_key = $2
                        AND dry_run = false AND status = 'completed'
                      LIMIT 1`,
                    [tenantId, idempotencyKey],
                  );
                  const row = rows[0] as { summary?: RolloverSummary } | undefined;
                  return row?.summary ?? null;
                })
            : undefined,
          // PRC-L318: claim-first ledger (insert `running` before executing, then
          // complete/fail). Needs the `running` status in the ledger CHECK, so it
          // is opt-in until that migration is applied everywhere.
          ...(pgPool && process.env['ROLLOVER_LEDGER_CLAIM_FIRST'] === 'true'
            ? createRolloverClaimHooks(pgPool)
            : {}),
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
      registerInstitutionDirectoryRoutes(scope);
      registerInstitutionOverviewRoutes(scope);
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
        assignmentRepository: sharedAssignmentRepository(),
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
        // PRC-L104: exam calendar-date rules run in the tenant's configured timezone.
        timeZone: createTenantTimeZoneResolver({ sources: pgTenantTimeZoneSources() }),
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
        // PRC-H039: in-process consumer so queued jobs reach 'completed'.
        reportCardWorkerQueue: reportCardQueueHandle?.createConsumerAdapter(),
      });
    },
  },
  {
    name: 'timetable',
    proxyPrefixes: ['/timetable'],
    register: async (scope, _config, dependencies) => {
      // Raw pg against 003_sis_timetable_schedule_schema.sql when DATABASE_URL
      // is set; in-memory otherwise. No Prisma on this path.
      // PRC-L320: mount the shared instance (also used by institution rollover).
      const shared = sharedTimetableService(dependencies);
      await scope.register(timetablePlugin, {
        repository: shared.repository,
        // PRC-M101 staff-institution check is wired into the shared service.
        service: shared.service,
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
      // PRC-C006: bind portal readers (guardian/parent) to their linked children so portal
      // gradebook reads are self-scoped, not fail-closed. Uses the same child-link source as
      // the fees parentBinding. A student reading their own grades is served via the guardian
      // link table when present; direct student-self resolution is a tracked follow-up.
      const gradebookParentRepo = createParentPortalRepository();
      await scope.register(gradebookPlugin, {
        repository: createGradebookRepository(),
        prefix: '/gradebook',
        // PRC-M266: transcript / board-export / report-card audit events go to the shared,
        // hash-chained audit log (durable across restarts). No pool -> in-process only (dev).
        auditSink: gradebookAuditSink(),
        studentBinding: {
          listReadableStudentIds: async (tenantId, actorUserId) => {
            const links = await gradebookParentRepo.listChildLinksForParent(tenantId, actorUserId);
            return links.map((link) => link.studentId);
          },
        },
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
    register: async (scope, _config, dependencies) => {
      // G-801/G-802/G-915: Pg when DATABASE_URL (026 + 038); else in-memory.
      // PRC-L320: mount the shared instance (also used by institution rollover).
      const shared = sharedLmsService(dependencies);
      await scope.register(lmsPlugin, {
        repository: shared.repository,
        service: shared.service,
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
      mountedScholarshipRepository = repository;
      // G-705: demo rows only when explicitly requested or in dev/test without
      // a database; never seed into a production Postgres.
      if (shouldSeedDemoData()) {
        await seedScholarshipDemoData(repository);
      }
      const feesForScholarships = new FeesService(createFeesRepository());
      const documentStore = isPgScholarshipEnabled() ? createScholarshipDocumentStore() : undefined;
      const resolveLinkedStudentIds = isPgScholarshipEnabled()
        ? linkedStudentIdsForParent
        : undefined;
      // PRC-L344: single-use download links are enforced through shared Redis (REDIS_URL) so
      // they hold across replicas. Every served download writes one hash-chained access row
      // through the scholarship document store (PRC-M353) before any bytes are sent.
      let downloadReplayRedis: RedisLikeForDownloadReplay | undefined;
      const scholarshipRedisUrl = process.env['REDIS_URL']?.trim();
      if (scholarshipRedisUrl) {
        const { default: Redis } = await import('ioredis');
        const redis = new Redis(scholarshipRedisUrl, {
          maxRetriesPerRequest: 3,
          lazyConnect: true,
        });
        downloadReplayRedis = redis;
        scope.addHook('onClose', async () => {
          await redis.quit();
        });
      }
      const downloadReplayGuard = createScholarshipDownloadReplayGuard({
        redis: downloadReplayRedis,
        NODE_ENV: process.env['NODE_ENV'],
      });
      await scope.register(scholarshipPlugin, {
        downloadReplayGuard,
        repository,
        prefix: '/scholarships',
        documentStore,
        resolveLinkedStudentIds,
        // PRC-H030: with Postgres, applicants must be real students of the tenant.
        applicantExists: isPgScholarshipEnabled()
          ? async (tenantId: string, studentId: string) =>
              (await createStudentRepository().findById(studentId, tenantId)) !== null
          : undefined,
        serviceOptions: {
          // PRC-H084: status + outbox row in one txn; hooks delivered/retried from the outbox.
          feeOutbox: createScholarshipFeeOutbox(),
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
              // PRC-L306: netting audit is written inside the netting money transaction.
              buildSystemMoneyAuditSink(input.tenantId, {
                userId: 'scholarship-netting',
                source: 'scholarship.disbursement.paid',
              }),
            );
          },
          onDisbursementReversed: async (input) => {
            await feesForScholarships.reverseScholarshipNetting(
              input.tenantId,
              'scholarship-netting',
              { disbursementId: input.disbursementId },
              buildSystemMoneyAuditSink(input.tenantId, {
                userId: 'scholarship-netting',
                source: 'scholarship.disbursement.reversed',
              }),
            );
          },
        },
      });
      await scope.register(parentScholarshipPlugin, {
        repository,
        prefix: '/parent-portal/scholarships',
        documentStore,
        resolveLinkedStudentIds,
        downloadReplayGuard,
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
        // PRC-H110: in-process escalation consumer (dedicated connection).
        escalationWorkerQueue: escalationHandle?.createConsumerAdapter(),
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
          // PRC-M466: a missing sink is a failed write, not a silent no-op.
          if (!auditService) throw new Error('auditService is not registered');
          await auditService.recordAudit({
            tenantId: event.tenantId,
            entityType: event.entityType,
            entityId: event.entityId,
            operation: event.operation,
            // PRC-L205: real caller from the tenant admin request context; 'system' / 0.0.0.0
            // only for events raised outside an authenticated request.
            userId: event.actorId ?? 'system',
            userName: event.actorId ?? 'system',
            ipAddress: event.ipAddress ?? '0.0.0.0',
            beforeValues: event.beforeValues,
            afterValues: event.afterValues,
            metadata: event.requestId
              ? { ...event.metadata, requestId: event.requestId }
              : event.metadata,
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
      const commsParentRepo = createParentPortalRepository();
      await scope.register(communicationPlugin, {
        repository,
        deliveryAdapter: createDeliveryAdapterFromEnv(),
        prefix: '/communication',
        // Owner decision (PR #548): durable audit for admin on-behalf acks.
        circularAuditSink: circularAuditSink(),
        // PRC-M188: guardians may acknowledge circulars only for linked students.
        recipientBinding: {
          listLinkedRecipientIds: async (tenantId, actorId) => {
            const links = await commsParentRepo.listChildLinksForParent(tenantId, actorId);
            return links.map((link) => link.studentId);
          },
        },
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
        scholarshipDisbursements: createScholarshipDisbursementLookup(scholarshipRepositoryForFees),
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
        verifyOfferFeeInvoiceOwnershipHook(),
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
    register: async (scope, _config, dependencies) => {
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
        publicTenantResolver: dependencies.publicTenantResolver,
        createOfferFeeInvoice: createOfferFeeInvoiceHook(),
        assertOfferFeePaid: assertOfferFeePaidHook(),
        reconcileOfferResources: reconcileAdmissionsOfferResourcesHook(),
        verifyOfferFeeInvoiceOwnership: verifyOfferFeeInvoiceOwnershipHook(),
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
      // PRC-M211: envelope-encrypted signing secrets (113) — mandatory signing, fail closed.
      const webhookSigningSecrets = await createWebhookSigningSecretsFromEnv(process.env, {
        warn: (message) => scope.log.warn(message),
      });
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
        // PRC-H046: in-process delivery consumer + opt-in event fan-out
        // (WEBHOOK_FANOUT_EVENTS=student.enrolled,... ; empty → no fan-out).
        deliveryWorkerQueue: webhookDelivery?.createConsumerAdapter(),
        fanOutEvents: webhookDelivery
          ? parseWebhookFanOutEvents(process.env['WEBHOOK_FANOUT_EVENTS'])
          : [],
        createFanOutQueue: webhookDelivery
          ? () => webhookDelivery.createConsumerAdapter()
          : undefined,
        replayStore: webhookReplayStore,
        signingSecretResolver: webhookSigningSecrets,
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
      // PRC-H077: real per-domain anonymizers + tenant wipe on Postgres. Without
      // a pool, erasure/offboard stay 'not implemented' (501) — never faked.
      const privacyPool = getSharedPgPool();
      const financeHealthMode = readFinanceHealthErasureMode();
      await scope.register(privacyPlugin, {
        repository: sharedPrivacyRepository,
        prefix: '/privacy',
        ...(privacyPool
          ? {
              anonymizer: new PgDomainSubjectAnonymizer(privacyPool, { financeHealthMode }),
              tenantWipeExecutor: new PgTenantWipeExecutor(privacyPool, { financeHealthMode }),
            }
          : {}),
        // PRC-M323: privacy lifecycle writes land in the platform audit trail.
        audit: {
          record: async (event) => {
            const auditService = (
              scope as unknown as {
                auditService?: {
                  recordAudit: (input: Record<string, unknown>) => Promise<unknown>;
                };
              }
            ).auditService;
            if (!auditService) {
              scope.log.warn(
                { entityType: event.entityType, entityId: event.entityId },
                'privacy audit event dropped: auditService not registered',
              );
              return;
            }
            await auditService.recordAudit({ ...event });
          },
        },
        anonymizationPublisher: queueHandle?.anonymizationPublisher,
        offboardPublisher: queueHandle?.offboardPublisher,
        // PRC-H078: in-process consumers (dedicated connections) for both job types.
        anonymizationWorkerQueue: queueHandle?.createConsumerAdapter(),
        offboardWorkerQueue: queueHandle?.createConsumerAdapter(),
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
  dependencies: DomainPluginDependencies,
): Promise<string[]> {
  const handled: string[] = [];

  for (const domain of DOMAIN_REGISTRARS) {
    // Encapsulate each domain under the version prefix so its routes resolve at
    // `/api/v1<prefix>` while inheriting the root auth + tenant hooks.
    await app.register(
      async (scope) => {
        await domain.register(scope, config, dependencies);
      },
      { prefix: versionPrefix },
    );
    handled.push(...domain.proxyPrefixes);
    app.log.info({ domain: domain.name }, 'Registered in-process domain plugin');
  }

  return handled;
}
