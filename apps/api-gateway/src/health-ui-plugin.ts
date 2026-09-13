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
import type {
  AccommodationPlanEntity,
  AllergyEntity,
  CounsellingSessionEntity,
  DiagnosisEntity,
  HealthConditionEntity,
  HealthRepository,
  ScreeningProgramEntity,
} from '@proctira/backend-health';
import type { FastifyInstance, FastifyRequest } from 'fastify';
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
  roles?: Array<{ roleName?: string; roleId?: string } | string>;
  guardianOfStudentIds?: string[];
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

function mapDomainCounselling(entity: CounsellingSessionEntity): UiCounsellingSession {
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
    topic: entity.reason,
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
          };
        }
      ).healthAccessContext = {
        userId: user?.sub ?? user?.userId ?? '',
        roles,
        guardianOfStudentIds: user?.guardianOfStudentIds ?? [],
      };
    });

    const liveRecords = async (tenantId: string): Promise<UiHealthRecord[]> => {
      if (!repository?.listAllAllergies && !repository?.listAllConditions) return [];
      const [allergies, conditions] = await Promise.all([
        repository.listAllAllergies?.(tenantId) ?? Promise.resolve([]),
        repository.listAllConditions?.(tenantId) ?? Promise.resolve([]),
      ]);
      return buildDomainRecords(tenantId, allergies, conditions);
    };

    fastify.get('/health/records', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      const seeded = forTenant(seed.records, tenantId);
      const live = await liveRecords(tenantId);
      const data = mergeById(seeded, live).sort((a, b) =>
        b.lastUpdated.localeCompare(a.lastUpdated),
      );
      return reply.send({ data, meta: sourceMeta(repository, live.length, seeded.length) });
    });

    fastify.get<{ Params: { studentId: string } }>(
      '/health/records/:studentId',
      async (request, reply) => {
        const tenantId = assertHealthAccess(request, reply);
        if (!tenantId) return;
        const { studentId } = request.params;
        const live = (await liveRecords(tenantId)).find((r) => r.studentId === studentId);
        const record =
          live ?? forTenant(seed.records, tenantId).find((r) => r.studentId === studentId);
        if (!record) {
          return deny(reply, 'NOT_FOUND', 'Health record not found', 404);
        }
        return reply.send(record);
      },
    );

    fastify.get('/health/special-needs', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      const seeded = forTenant(seed.specialNeeds, tenantId);
      let live: UiSpecialNeedRecord[] = [];
      if (repository?.listAllDiagnoses || repository?.listAllAccommodationPlans) {
        const [diagnoses, plans] = await Promise.all([
          repository.listAllDiagnoses?.(tenantId) ?? Promise.resolve([]),
          repository.listAllAccommodationPlans?.(tenantId) ?? Promise.resolve([]),
        ]);
        live = buildDomainSpecialNeeds(tenantId, diagnoses, plans);
      }
      return reply.send({
        data: mergeById(seeded, live),
        meta: sourceMeta(repository, live.length, seeded.length),
      });
    });

    fastify.get('/health/counselling', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      const seeded = forTenant(seed.counselling, tenantId);
      let live: UiCounsellingSession[] = [];
      if (repository?.listAllCounsellingSessions) {
        const entities = await repository.listAllCounsellingSessions(tenantId);
        live = entities.map(mapDomainCounselling);
      }
      const data = mergeById(seeded, live).sort((a, b) =>
        b.sessionDate.localeCompare(a.sessionDate),
      );
      return reply.send({ data, meta: sourceMeta(repository, live.length, seeded.length) });
    });

    fastify.get('/health/screenings', async (request, reply) => {
      const tenantId = assertHealthAccess(request, reply);
      if (!tenantId) return;
      const seeded = forTenant(seed.screenings, tenantId);
      let live: UiScreeningProgram[] = [];
      if (repository) {
        const page = await repository.listScreeningPrograms(tenantId, { page: 1, pageSize: 500 });
        live = page.data.map(mapDomainScreening);
      }
      return reply.send({
        data: mergeById(seeded, live),
        meta: sourceMeta(repository, live.length, seeded.length),
      });
    });
  },
  { name: 'health-ui-aggregates', fastify: '5.x' },
);

export const HEALTH_UI_DEMO_TENANT_ID = HEALTH_DEMO_TENANT_ID;
