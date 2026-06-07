/**
 * Integration tests for the server-side dashboard endpoints.
 *
 * These tests cover Task 52.6 — RBAC + Area_Hierarchy scoping at the
 * query layer (Requirement 40 AC 9). They exercise the routes through
 * `app.inject()` so the auth middleware, scope derivation, and
 * repository scope filter are all wired together as in production.
 *
 * Auth is mocked via an `onRequest` hook that attaches a JWT-shaped
 * payload to the request. The dashboards plugin reads `request.user`
 * exactly as it would after a real `@fastify/jwt` verification.
 */

import {
  type AreaHierarchyResolver,
  InMemoryAreaHierarchyResolver,
  type JwtPayload,
} from '@proctira/auth';
import Fastify, { type FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import { InMemoryDashboardRepository } from './in-memory-repository.js';
import { registerDashboardRoutes } from './routes.js';
import { DashboardService } from './dashboard-service.js';

const TENANT_ID = '00000000-0000-4000-8000-000000000001';

function jwtFor(overrides: Partial<JwtPayload>): JwtPayload {
  return {
    sub: 'user-1',
    tenantId: TENANT_ID,
    email: 'user@example.com',
    displayName: 'Test User',
    roles: [],
    areas: [],
    institutions: [],
    iat: 0,
    exp: 9_999_999_999,
    jti: 'test-jti',
    sessionId: 'test-session',
    ...overrides,
  };
}

/**
 * The hierarchy used across these tests.
 *
 *   country (root)
 *     ├─ state-MH
 *     │   └─ district-MH-PUN
 *     ├─ state-KA
 *     │   └─ district-KA-BLR
 */
function buildHierarchyResolver(): AreaHierarchyResolver {
  return new InMemoryAreaHierarchyResolver([
    { id: 'country', parentId: null, level: 0, path: '/country' },
    { id: 'state-MH', parentId: 'country', level: 1, path: '/country/state-MH' },
    {
      id: 'district-MH-PUN',
      parentId: 'state-MH',
      level: 2,
      path: '/country/state-MH/district-MH-PUN',
    },
    { id: 'state-KA', parentId: 'country', level: 1, path: '/country/state-KA' },
    {
      id: 'district-KA-BLR',
      parentId: 'state-KA',
      level: 2,
      path: '/country/state-KA/district-KA-BLR',
    },
  ]);
}

interface Harness {
  app: FastifyInstance;
  repository: InMemoryDashboardRepository;
  /** Set to non-null to attach `request.user` for the next request. */
  authJwt: { value: JwtPayload | null };
}

async function buildHarness(): Promise<Harness> {
  const app = Fastify();
  const repository = new InMemoryDashboardRepository();
  const areaResolver = buildHierarchyResolver();
  const service = new DashboardService({ repository, areaResolver });
  const authJwt = { value: null as JwtPayload | null };

  app.addHook('onRequest', async (request) => {
    if (authJwt.value) {
      (request as unknown as { user: JwtPayload }).user = authJwt.value;
    }
  });

  await registerDashboardRoutes(app, { service });
  await app.ready();

  return { app, repository, authJwt };
}

function seedFixtures(repository: InMemoryDashboardRepository): void {
  repository.setCountryAggregate(TENANT_ID, {
    kpis: [
      { id: 'schools', label: 'Schools', value: '12' },
      { id: 'students', label: 'Students', value: '4500' },
    ],
    boards: [],
    states: [
      {
        id: 'state-MH',
        name: 'Maharashtra',
        schools: 6,
        students: 2500,
        attendancePercent: 91,
        passRatePercent: 88,
      },
      {
        id: 'state-KA',
        name: 'Karnataka',
        schools: 6,
        students: 2000,
        attendancePercent: 89,
        passRatePercent: 85,
      },
    ],
    enrollmentTrend: [],
  });

  repository.setStateAggregate(TENANT_ID, 'state-MH', {
    stateId: 'state-MH',
    stateName: 'Maharashtra',
    stateCode: 'MH',
    kpis: [{ id: 'students', label: 'Students', value: '2500' }],
    boards: [],
    districts: [],
    districtRanking: [],
  });

  repository.setStateAggregate(TENANT_ID, 'state-KA', {
    stateId: 'state-KA',
    stateName: 'Karnataka',
    stateCode: 'KA',
    kpis: [{ id: 'students', label: 'Students', value: '2000' }],
    boards: [],
    districts: [],
    districtRanking: [],
  });

  repository.setBoardAggregate(TENANT_ID, 'board-cbse', {
    boardId: 'board-cbse',
    boardName: 'CBSE',
    boardCode: 'CBSE',
    kpis: [],
    regions: [],
    affiliations: [],
    enrollmentGrowth: [],
    actionItems: [],
  });

  repository.setBoardAggregate(TENANT_ID, 'board-icse', {
    boardId: 'board-icse',
    boardName: 'ICSE',
    boardCode: 'ICSE',
    kpis: [],
    regions: [],
    affiliations: [],
    enrollmentGrowth: [],
    actionItems: [],
  });

  repository.setSchoolAggregate(TENANT_ID, 'inst-MH-001', 'state-MH', {
    institutionId: 'inst-MH-001',
    institutionName: 'MH School 1',
    kpis: {
      totalStudents: 200,
      attendanceRatePercent: 92,
      staffOnDuty: 18,
      totalStaff: 20,
      pendingApprovals: 1,
    },
    recentActivity: [],
    pendingTasks: [],
  });

  repository.setSchoolAggregate(TENANT_ID, 'inst-KA-001', 'state-KA', {
    institutionId: 'inst-KA-001',
    institutionName: 'KA School 1',
    kpis: {
      totalStudents: 180,
      attendanceRatePercent: 90,
      staffOnDuty: 16,
      totalStaff: 18,
      pendingApprovals: 0,
    },
    recentActivity: [],
    pendingTasks: [],
  });

  repository.setTeacherAggregate(
    TENANT_ID,
    'teacher-1',
    'inst-MH-001',
    'state-MH',
    {
      staffId: 'teacher-1',
      assignedClasses: [],
      todaySchedule: [],
      attendancePending: [],
      pendingAssessments: [],
    },
  );

  repository.setParentStudentAggregate(TENANT_ID, 'parent-1', 'inst-MH-001', {
    studentId: 'student-1',
    studentName: 'Test Student',
    gradeLabel: 'Grade 5',
    institutionId: 'inst-MH-001',
    attendance: {
      ratePercent: 95,
      daysPresent: 19,
      daysAbsent: 1,
      daysLate: 0,
    },
    recentResults: [],
    schedule: [],
    notifications: [],
  });
}

describe('Dashboard routes — RBAC + Area_Hierarchy scoping (Task 52.6)', () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await buildHarness();
    seedFixtures(harness.repository);
  });

  describe('GET /dashboards/country', () => {
    it('returns 200 for a country admin', async () => {
      harness.authJwt.value = jwtFor({
        sub: 'admin-1',
        roles: [
          { roleId: 'system_admin', roleName: 'System Admin', areaId: 'country' },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/country',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.kpis).toBeDefined();
      expect(body.states).toHaveLength(2);
    });

    it('returns 403 when a state-scoped user requests the country dashboard', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/country',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('returns 401 when the request is unauthenticated', async () => {
      harness.authJwt.value = null;

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/country',
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /dashboards/state/:stateId', () => {
    it('lets a state director read their own state', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/state/state-MH',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().stateId).toBe('state-MH');
    });

    it('blocks a state director from reading another state with 403', async () => {
      // A user with State scope cannot see another state's data — this
      // is the headline acceptance test from the task description.
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/state/state-KA',
      });

      expect(response.statusCode).toBe(403);
      const body = response.json();
      expect(body.code).toBe('FORBIDDEN');
      expect(body.message).toContain('state-KA');
    });

    it('lets a country admin read any state (country subsumes state)', async () => {
      harness.authJwt.value = jwtFor({
        sub: 'admin-1',
        roles: [
          { roleId: 'system_admin', roleName: 'System Admin', areaId: 'country' },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/state/state-KA',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().stateId).toBe('state-KA');
    });

    it('returns 404 when the state exists in scope but has no aggregate', async () => {
      // Seed an empty resolver entry — but no aggregate.
      harness.authJwt.value = jwtFor({
        sub: 'admin-1',
        roles: [
          { roleId: 'system_admin', roleName: 'System Admin', areaId: 'country' },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/state/state-NONEXISTENT',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /dashboards/board-admin/:boardId', () => {
    it('lets a board admin read their own board', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'board_admin',
            roleName: 'Board Admin',
            // By convention the role's `areaId` carries the board ID.
            areaId: 'board-cbse',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/board-admin/board-cbse',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().boardId).toBe('board-cbse');
    });

    it('blocks a board admin from reading another board', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'board_admin',
            roleName: 'Board Admin',
            areaId: 'board-cbse',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/board-admin/board-icse',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('blocks a school principal from reading the board admin dashboard with 403', async () => {
      // School Principal hitting Board Admin endpoint → 403 (acceptance
      // criterion from the task description).
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'principal',
            roleName: 'Principal',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        institutions: ['inst-MH-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/board-admin/board-cbse',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /dashboards/school/:institutionId', () => {
    it('lets a principal read their own school', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'principal',
            roleName: 'Principal',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        institutions: ['inst-MH-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/school/inst-MH-001',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().institutionId).toBe('inst-MH-001');
    });

    it("blocks a principal from reading another school's data", async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'principal',
            roleName: 'Principal',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        institutions: ['inst-MH-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/school/inst-KA-001',
      });

      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('FORBIDDEN');
    });

    it('lets a state director read any school inside their state', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/school/inst-MH-001',
      });

      expect(response.statusCode).toBe(200);
    });

    it('blocks a state director from reading a school in another state', async () => {
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/school/inst-KA-001',
      });

      expect(response.statusCode).toBe(403);
    });

    it('lets a state director read a school tagged at a district inside their state', async () => {
      // Schools may be tagged at any level of the Area_Hierarchy. A
      // state-scoped user MUST be able to read aggregates whose own
      // areaId is a *descendant* of their state — that's what the
      // hierarchy resolver buys us. Without descendant traversal the
      // policy filter would deny this read and silently break Req 40 AC 9.
      harness.repository.setSchoolAggregate(
        TENANT_ID,
        'inst-MH-DIST-001',
        'district-MH-PUN',
        {
          institutionId: 'inst-MH-DIST-001',
          institutionName: 'Pune District School',
          kpis: {
            totalStudents: 150,
            attendanceRatePercent: 88,
            staffOnDuty: 14,
            totalStaff: 16,
            pendingApprovals: 0,
          },
          recentActivity: [],
          pendingTasks: [],
        },
      );

      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/school/inst-MH-DIST-001',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().institutionId).toBe('inst-MH-DIST-001');
    });

    it("blocks a state director from reading a district school in another state", async () => {
      harness.repository.setSchoolAggregate(
        TENANT_ID,
        'inst-KA-DIST-001',
        'district-KA-BLR',
        {
          institutionId: 'inst-KA-DIST-001',
          institutionName: 'Bangalore District School',
          kpis: {
            totalStudents: 120,
            attendanceRatePercent: 85,
            staffOnDuty: 12,
            totalStaff: 14,
            pendingApprovals: 0,
          },
          recentActivity: [],
          pendingTasks: [],
        },
      );

      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/school/inst-KA-DIST-001',
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /dashboards/teacher', () => {
    it('returns the teacher dashboard for the authenticated teacher', async () => {
      harness.authJwt.value = jwtFor({
        sub: 'teacher-1',
        roles: [
          {
            roleId: 'teacher',
            roleName: 'Teacher',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        institutions: ['inst-MH-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/teacher',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().staffId).toBe('teacher-1');
    });

    it('returns 403 when a parent hits the teacher dashboard', async () => {
      harness.authJwt.value = jwtFor({
        sub: 'parent-1',
        roles: [
          {
            roleId: 'parent',
            roleName: 'Parent',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        institutions: ['inst-MH-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/teacher',
      });

      expect(response.statusCode).toBe(403);
    });

    it('returns 404 when the teacher has no aggregate yet', async () => {
      harness.authJwt.value = jwtFor({
        sub: 'teacher-2',
        roles: [
          {
            roleId: 'teacher',
            roleName: 'Teacher',
            areaId: 'state-KA',
            institutionId: 'inst-KA-001',
          },
        ],
        institutions: ['inst-KA-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/teacher',
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /dashboards/me', () => {
    it('returns the parent / student dashboard for the authenticated user', async () => {
      harness.authJwt.value = jwtFor({
        sub: 'parent-1',
        roles: [
          {
            roleId: 'parent',
            roleName: 'Parent',
            areaId: 'state-MH',
            institutionId: 'inst-MH-001',
          },
        ],
        institutions: ['inst-MH-001'],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/me',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().studentId).toBe('student-1');
    });

    it('returns 403 when a state director hits /me', async () => {
      // /me is reserved for parent/student roles (and country admins).
      harness.authJwt.value = jwtFor({
        roles: [
          {
            roleId: 'state_director',
            roleName: 'State Director',
            areaId: 'state-MH',
          },
        ],
      });

      const response = await harness.app.inject({
        method: 'GET',
        url: '/dashboards/me',
      });

      expect(response.statusCode).toBe(403);
    });
  });
});
