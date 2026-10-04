/**
 * Health redesign UI aggregate routes + access-context bridge.
 *
 * Mounts under `/api/v1` alongside the domain health plugin:
 *  - Aggregate list/detail endpoints consumed by App Router pages
 *  - Tenant-scoped seed filtering (cross-tenant deny)
 *  - onRequest hook that maps JWT roles → request.healthAccessContext
 *  - Every list merges UI seed (dev/test only) with live domain/PG rows
 *    (G-912): records ← allergies + conditions, special-needs ← diagnoses +
 *    accommodation plans, screenings ← screening programs, counselling ←
 *    sessions. Live rows win on id collisions.
 */
import {
  canReadCounsellingReason,
  effectiveInstitutionIds,
  hasHealthAccess,
  isTenantWideHealthActor,
  PhiAuditUnavailableError,
  recordPhiReadAudit,
  type AccommodationPlanEntity,
  type AllergyEntity,
  type CounsellingSessionEntity,
  type DiagnosisEntity,
  type HealthAccessContext,
  type HealthConditionEntity,
  type HealthRepository,
  type PhiAccessLogInput,
  type ScreeningProgramEntity,
} from '@proctira/backend-health';
import { AppError } from '@proctira/common';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

import {
  HEALTH_DEMO_TENANT_ID,
  createHealthUiSeed,
  type HealthUiSeed,
  type UiCounsellingSession,
  type UiHealthRecord,
  type UiScreeningProgram,
  type UiSpecialNeedRecord,
} from './health-ui-seed.js';

/** Roles allowed to view health PII via UI aggregates. */
const HEALTH_UI_ROLES = new Set([
  'HEALTH_OFFICER',
  'health_officer',
  'NURSE',
  'school_nurse',
  'HEALTH_ADMIN',
  'health_admin',
  'SUPER_ADMIN',
  'system_admin',
  'SYSTEM_ADMIN',
  'COUNSELLOR',
  'counsellor',
]);

interface JwtUserLike {
  sub?: string;
  userId?: string;
  tenantId?: string;
  institutions?: string[];
  roles?: Array<{ roleName?: string; roleId?: string } | string>;
  guardianOfStudentIds?: string[];
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function extractRoleNames(user: JwtUserLike | undefined): string[] {
  if (!user?.roles) return [];
  return user.roles
    .map((role) => {
      if (typeof role === 'string') return role;
      return role.roleName ?? role.roleId ?? '';
    })
    .filter(Boolean);
}

function hasHealthUiAccess(roles: string[]): boolean {
  return roles.some((role) => HEALTH_UI_ROLES.has(role) || HEALTH_UI_ROLES.has(role.toUpperCase()));
}

function resolveTenantId(request: FastifyRequest): string | null {
  const fromRequest = (request as FastifyRequest & { tenantId?: string }).tenantId;
  if (fromRequest) return fromRequest;
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  return user?.tenantId ?? null;
}

function deny(
  reply: { status: (code: number) => { send: (body: unknown) => unknown } },
  code: string,
  message: string,
  statusCode = 403,
) {
  return reply.status(statusCode).send({ code, message, statusCode });
}

function assertHealthAccess(
  request: FastifyRequest,
  reply: {
    status: (code: number) => { send: (body: unknown) => unknown };
  },
): string | null {
  const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
  if (!hasHealthUiAccess(extractRoleNames(user))) {
    deny(reply, 'HEALTH_ACCESS_DENIED', 'Not authorized to access health records');
    return null;
  }
  const tenantId = resolveTenantId(request);
  if (!tenantId) {
    deny(reply, 'TENANT_REQUIRED', 'Tenant context is required', 400);
    return null;
  }
  return tenantId;
}

function forTenant<T extends { tenantId: string }>(items: T[], tenantId: string): T[] {
  return items.filter((item) => item.tenantId === tenantId);
}

function mapDomainCounselling(
  entity: CounsellingSessionEntity,
  showTopic: boolean,
): UiCounsellingSession {
  const statusMap: Record<string, UiCounsellingSession['status']> = {
    scheduled: 'SCHEDULED',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED',
    'no-show': 'CANCELLED',
  };
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    studentName: entity.studentId.slice(0, 8),
    counsellorName: entity.counsellorId.slice(0, 8),
    sessionDate: entity.sessionDate,
    // Schedule metadata only for nurses/health officers; the reason is counselling PHI.
    topic: showTopic ? entity.reason : '',
    status: statusMap[entity.status] ?? 'SCHEDULED',
  };
}

/**
 * Fold per-student allergy + condition rows into one record row per student.
 * Names are not stored in the health schema (PHI minimisation) — the UI shows
 * the short student id until the roster join lands.
 */
function buildDomainRecords(
  tenantId: string,
  allergies: AllergyEntity[],
  conditions: HealthConditionEntity[],
): UiHealthRecord[] {
  const byStudent = new Map<string, UiHealthRecord>();
  const ensure = (studentId: string): UiHealthRecord => {
    let record = byStudent.get(studentId);
    if (!record) {
      record = {
        id: studentId,
        tenantId,
        studentId,
        studentName: studentId.slice(0, 8),
        bloodType: null,
        allergies: [],
        chronicConditions: [],
        emergencyContactName: null,
        emergencyContactPhone: null,
        lastUpdated: '',
      };
      byStudent.set(studentId, record);
    }
    return record;
  };
  const touch = (record: UiHealthRecord, at: Date) => {
    const iso = at.toISOString().slice(0, 10);
    if (iso > record.lastUpdated) record.lastUpdated = iso;
  };
  for (const a of allergies) {
    const record = ensure(a.studentId);
    record.allergies!.push(a.description || a.allergyType);
    touch(record, a.updatedAt);
  }
  for (const c of conditions) {
    const record = ensure(c.studentId);
    if (c.status !== 'resolved') record.chronicConditions!.push(c.conditionName);
    touch(record, c.updatedAt);
  }
  return Array.from(byStudent.values());
}

const SEVERITY_MAP: Record<string, UiSpecialNeedRecord['severity']> = {
  mild: 'MILD',
  low: 'MILD',
  moderate: 'MODERATE',
  medium: 'MODERATE',
  severe: 'SEVERE',
  high: 'SEVERE',
  profound: 'SEVERE',
};

/**
 * One special-needs row per student: category / severity from the latest
 * diagnosis, accommodations + IEP flag from the active accommodation plan.
 */
function buildDomainSpecialNeeds(
  tenantId: string,
  diagnoses: DiagnosisEntity[],
  plans: AccommodationPlanEntity[],
): UiSpecialNeedRecord[] {
  const byStudent = new Map<string, UiSpecialNeedRecord>();
  const ensure = (studentId: string): UiSpecialNeedRecord => {
    let row = byStudent.get(studentId);
    if (!row) {
      row = {
        id: studentId,
        tenantId,
        studentId,
        studentName: studentId.slice(0, 8),
        category: 'Unspecified',
        severity: 'MILD',
        accommodations: [],
        iepActive: false,
      };
      byStudent.set(studentId, row);
    }
    return row;
  };
  // Diagnoses arrive newest-first; the first seen per student wins.
  const seenDiagnosis = new Set<string>();
  for (const d of diagnoses) {
    const row = ensure(d.studentId);
    if (seenDiagnosis.has(d.studentId)) continue;
    seenDiagnosis.add(d.studentId);
    row.category = d.category || d.condition;
    row.severity = SEVERITY_MAP[d.severity.toLowerCase()] ?? 'MODERATE';
  }
  for (const p of plans) {
    const row = ensure(p.studentId);
    for (const item of p.accommodations) {
      const label = item.description || item.type;
      if (label && !row.accommodations.includes(label)) row.accommodations.push(label);
    }
    if (p.status === 'active') row.iepActive = true;
  }
  return Array.from(byStudent.values());
}

function mapDomainScreening(entity: ScreeningProgramEntity): UiScreeningProgram {
  return {
    id: entity.id,
    tenantId: entity.tenantId,
    name: entity.name,
    description: entity.description,
    gradeLevel: entity.gradeLevel,
    assessmentTypes: entity.assessmentTypes,
    scheduledDate: entity.scheduledDate,
    status: entity.status,
  };
}

/** Seed rows first, then live rows — live wins on id collisions. */
function mergeById<T extends { id: string }>(seeded: T[], live: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of seeded) byId.set(row.id, row);
  for (const row of live) byId.set(row.id, row);
  return Array.from(byId.values());
}

function sourceMeta(
  repository: HealthRepository | undefined,
  liveCount: number,
  seedCount: number,
) {
  return { source: repository ? 'live+seed' : 'seed', liveCount, seedCount };
}

export interface HealthUiPluginOptions {
  seed?: HealthUiSeed;
  /** When provided, counselling list merges seed + live domain/PG sessions. */
  repository?: HealthRepository;
}

export const healthUiPlugin = fp(
  async function healthUiPluginImpl(fastify: FastifyInstance, options: HealthUiPluginOptions = {}) {
    const seed = options.seed ?? createHealthUiSeed();
    const repository = options.repository;

    // Bridge JWT → domain healthAccessContext for resource-scoped routes.
    // Keep mapping conservative: no PRINCIPAL/ADMIN elevation to full admin.
    fastify.addHook('onRequest', async (request) => {
      const user = (request as FastifyRequest & { user?: JwtUserLike }).user;
      const roles = extractRoleNames(user).map((role) => {
        const map: Record<string, string> = {
          HEALTH_OFFICER: 'health_officer',
          NURSE: 'school_nurse',
          HEALTH_ADMIN: 'health_admin',
          SUPER_ADMIN: 'system_admin',
          SYSTEM_ADMIN: 'system_admin',
          COUNSELLOR: 'counsellor',
        };
        return map[role] ?? map[role.toUpperCase()] ?? role.toLowerCase();
      });
      (
        request as FastifyRequest & {
          healthAccessContext?: {
            userId: string;
            roles: string[];
            guardianOfStudentIds: string[];
            institutionIds?: string[];
          };
        }
      ).healthAccessContext = {
        userId: user?.sub ?? user?.userId ?? '',
        roles,
        guardianOfStudentIds: user?.guardianOfStudentIds ?? [],
        institutionIds: user?.institutions ?? [],
      };
    });

    /**
     * PRC-H006: the aggregate routes read tenant-wide lists, so apply the same need-to-know rule
     * as HealthService (hasHealthAccess): tenant-wide health admins see all students; school-bound
     * roles only students whose active enrolment is in their (authoritative or JWT) institutions;
     * missing scope sees nothing. Every returned student is written to the PHI read audit, which
     * fails closed in production (503).
     */
    const accessContextOf = async (
      request: FastifyRequest,
      tenantId: string,
    ): Promise<HealthAccessContext> => {
      const base = (request as FastifyRequest & { healthAccessContext?: HealthAccessContext })
        .healthAccessContext ?? { userId: '', roles: [], guardianOfStudentIds: [] };
      if (isTenantWideHealthActor(base) || !repository?.findActorInstitutionAssignments)
        return base;
      if (!base.userId) return base;
      const assigned = await repository.findActorInstitutionAssignments(tenantId, base.userId);
      return assigned === null ? base : { ...base, authoritativeInstitutionIds: assigned };
    };

    /** Run `fn` over items with at most `limit` in flight (per-row DB calls on Postgres). */
    const mapLimited = async <T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) => {
      const out = new Array<R>(items.length);
      let next = 0;
      const worker = async () => {
        while (next < items.length) {
          const index = next++;
          out[index] = await fn(items[index]!);
        }
      };
      await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
      return out;
    };

    const filterByStudent = async <T extends { studentId: string }>(
      rows: T[],
      tenantId: string,
      context: HealthAccessContext,
    ): Promise<T[]> => {
      // Tenant-wide health admins see every student; a school-bound actor with no scope sees
      // none. Neither needs a per-student enrolment lookup.
      if (isTenantWideHealthActor(context)) return rows;
      if (effectiveInstitutionIds(context).length === 0) return [];
      const studentIds = [...new Set(rows.map((row) => row.studentId))];
      const verdicts = await mapLimited(studentIds, 8, async (studentId) => {
        const studentInstitutionId =
          (await repository?.findStudentInstitutionId?.(tenantId, studentId)) ?? null;
        return hasHealthAccess(context, studentId, { studentInstitutionId });
      });
      const allowed = new Set(studentIds.filter((_, i) => verdicts[i]));
      return rows.filter((row) => allowed.has(row.studentId));
    };

    const auditReads = async (
      tenantId: string,
      context: HealthAccessContext,
      studentIds: string[],
      resourceType: string,
    ) => {
      const auditor = (repository as { logPhiAccess?: (entry: PhiAccessLogInput) => Promise<void> })
        ?.logPhiAccess;
      const logPhiAccess =
        typeof auditor === 'function'
          ? (entry: PhiAccessLogInput) => auditor.call(repository, entry)
          : null;
      await mapLimited([...new Set(studentIds)], 8, (studentId) =>
        recordPhiReadAudit({
          logPhiAccess,
          entry: { tenantId, actorUserId: context.userId, studentId, resourceType },
        }),
      );
    };

    const sendError = (reply: FastifyReply, error: unknown) => {
      if (error instanceof PhiAuditUnavailableError) {
        // Keep auditor/driver detail in server logs, not in the client response.
        fastify.log.error({ err: error }, 'PHI read audit unavailable; refusing PHI response');
        return reply.status(503).send({
          code: 'PHI_AUDIT_UNAVAILABLE',
          message: 'Health records are temporarily unavailable. Please try again later.',
          statusCode: 503,
        });
      }
      if (error instanceof AppError) return reply.status(error.statusCode).send(error.toJSON());
      throw error;
    };

    const liveRecords = async (tenantId: string): Promise<UiHealthRecord[]> => {
      if (!repository?.listAllAllergies && !repository?.listAllConditions) return [];
      const [allergies, conditions] = await Promise.all([
        repository.listAllAllergies?.(tenantId) ?? Promise.resolve([]),
        repository.listAllConditions?.(tenantId) ?? Promise.resolve([]),
      ]);
      return buildDomainRecords(tenantId, allergies, conditions);
    };

    /**
     * PRC-M007: the detail route reads only this student's allergy / condition
     * rows (bounded, paged per-student repository queries) instead of loading
     * every tenant row and filtering in memory.
     */
    const PER_STUDENT_PAGE_SIZE = 200;
    const PER_STUDENT_MAX_PAGES = 10;
    const collectStudentRows = async <T>(
      list: (page: number) => Promise<{ data: T[]; meta: { totalPages: number } }>,
    ): Promise<T[]> => {
      const rows: T[] = [];
      for (let page = 1; page <= PER_STUDENT_MAX_PAGES; page += 1) {
        const result = await list(page);
        rows.push(...result.data);
        if (page >= result.meta.totalPages) break;
      }
      return rows;
    };
    const liveRecordForStudent = async (
      tenantId: string,
      studentId: string,
    ): Promise<UiHealthRecord | undefined> => {
      if (!repository) return undefined;
      if (
        typeof repository.listAllergiesByStudent !== 'function' ||
        typeof repository.listConditionsByStudent !== 'function'
      ) {
        return (await liveRecords(tenantId)).find((r) => r.studentId === studentId);
      }
      const [allergies, conditions] = await Promise.all([
        collectStudentRows((page) =>
          repository.listAllergiesByStudent(tenantId, studentId, {
            page,
            pageSize: PER_STUDENT_PAGE_SIZE,
          }),
        ),
        collectStudentRows((page) =>
          repository.listConditionsByStudent(tenantId, studentId, {
            page,
            pageSize: PER_STUDENT_PAGE_SIZE,
          }),
        ),
      ]);
      return buildDomainRecords(tenantId, allergies, conditions).find(
        (r) => r.studentId === studentId,
      );
    };

    fastify.get('/health/records', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      try {
        const context = await accessContextOf(request, tenantId);
        // Seed rows are dev/test demo data (empty in production, G-705); live rows are PHI.
        const seeded = forTenant(seed.records, tenantId);
        const live = await filterByStudent(await liveRecords(tenantId), tenantId, context);
        await auditReads(
          tenantId,
          context,
          live.map((r) => r.studentId),
          'health_record.list',
        );
        const data = mergeById(seeded, live).sort((a, b) =>
          b.lastUpdated.localeCompare(a.lastUpdated),
        );
        return reply.send({ data, meta: sourceMeta(repository, live.length, seeded.length) });
      } catch (error) {
        return sendError(reply, error);
      }
    });

    fastify.get<{ Params: { studentId: string } }>(
      '/health/records/:studentId',
      async (request, reply) => {
        const tenantId = assertHealthAccess(request, reply);
        if (!tenantId) return;
        const { studentId } = request.params;
        try {
          const context = await accessContextOf(request, tenantId);
          const live = await liveRecordForStudent(tenantId, studentId);
          if (live) {
            // Out-of-scope students are indistinguishable from missing ones.
            if ((await filterByStudent([live], tenantId, context)).length === 0) {
              return deny(reply, 'NOT_FOUND', 'Health record not found', 404);
            }
            await auditReads(tenantId, context, [studentId], 'health_record.detail');
            return reply.send(live);
          }
          const seeded = forTenant(seed.records, tenantId).find((r) => r.studentId === studentId);
          if (!seeded) return deny(reply, 'NOT_FOUND', 'Health record not found', 404);
          return reply.send(seeded);
        } catch (error) {
          return sendError(reply, error);
        }
      },
    );

    fastify.get('/health/special-needs', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      try {
        const context = await accessContextOf(request, tenantId);
        const seeded = forTenant(seed.specialNeeds, tenantId);
        let live: UiSpecialNeedRecord[] = [];
        if (repository?.listAllDiagnoses || repository?.listAllAccommodationPlans) {
          const [diagnoses, plans] = await Promise.all([
            repository.listAllDiagnoses?.(tenantId) ?? Promise.resolve([]),
            repository.listAllAccommodationPlans?.(tenantId) ?? Promise.resolve([]),
          ]);
          live = await filterByStudent(
            buildDomainSpecialNeeds(tenantId, diagnoses, plans),
            tenantId,
            context,
          );
        }
        await auditReads(
          tenantId,
          context,
          live.map((r) => r.studentId),
          'special_needs.list',
        );
        return reply.send({
          data: mergeById(seeded, live),
          meta: sourceMeta(repository, live.length, seeded.length),
        });
      } catch (error) {
        return sendError(reply, error);
      }
    });

    fastify.get('/health/counselling', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      try {
        const context = await accessContextOf(request, tenantId);
        const seeded = forTenant(seed.counselling, tenantId).map((row) =>
          canReadCounsellingReason(context, row.studentId) ? row : { ...row, topic: '' },
        );
        let live: UiCounsellingSession[] = [];
        if (repository?.listAllCounsellingSessions) {
          const entities = await filterByStudent(
            await repository.listAllCounsellingSessions(tenantId),
            tenantId,
            context,
          );
          live = entities.map((entity) =>
            mapDomainCounselling(entity, canReadCounsellingReason(context, entity.studentId)),
          );
        }
        await auditReads(
          tenantId,
          context,
          live.map((r) => r.studentId),
          'counselling_session.list',
        );
        const data = mergeById(seeded, live).sort((a, b) =>
          b.sessionDate.localeCompare(a.sessionDate),
        );
        return reply.send({ data, meta: sourceMeta(repository, live.length, seeded.length) });
      } catch (error) {
        return sendError(reply, error);
      }
    });

    // PRC-M007: paged (page / pageSize ≤ 500) with totals, instead of a silent
    // first-500 cap. `meta.truncated` is true whenever more pages exist.
    fastify.get<{ Querystring: { page?: string; pageSize?: string } }>(
      '/health/screenings',
      async (request, reply) => {
        const tenantId = assertHealthAccess(request, reply);
        if (!tenantId) return;
        const page = clampInt(request.query?.page, 1, 1, 100_000);
        const pageSize = clampInt(request.query?.pageSize, 100, 1, 500);
        const seeded = page === 1 ? forTenant(seed.screenings, tenantId) : [];
        let live: UiScreeningProgram[] = [];
        let totalItems = 0;
        let totalPages = 1;
        if (repository) {
          const result = await repository.listScreeningPrograms(tenantId, { page, pageSize });
          live = result.data.map(mapDomainScreening);
          totalItems = result.meta.totalItems;
          totalPages = result.meta.totalPages;
        }
        return reply.send({
          data: mergeById(seeded, live),
          meta: {
            ...sourceMeta(repository, live.length, seeded.length),
            page,
            pageSize,
            totalItems,
            totalPages,
            truncated: page < totalPages,
          },
        });
      },
    );
  },
  { name: 'health-ui-aggregates', fastify: '5.x' },
);

export const HEALTH_UI_DEMO_TENANT_ID = HEALTH_DEMO_TENANT_ID;
