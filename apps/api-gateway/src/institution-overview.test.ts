import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { createGatewayRbacRegistry } from './rbac-registry.js';
import {
  loadInstitutionOverview,
  registerInstitutionOverviewRoutes,
  type InstitutionOverview,
} from './institution-overview.js';

const TENANT = '00000000-0000-4000-8000-00000000a501';
const OTHER = '00000000-0000-4000-8000-00000000a502';
const SCHOOL = '00000000-0000-4000-8000-00000000a551';

function db(rowsFor: (sql: string, params?: unknown[]) => { rows: unknown[] }) {
  return {
    async query(sql: string, params?: unknown[]) {
      return rowsFor(sql, params);
    },
  };
}

describe('loadInstitutionOverview', () => {
  it('returns null when the institution is outside the tenant', async () => {
    const client = db((sql, params) => {
      if (sql.includes('to_regclass')) return { rows: [{ reg: 'public.institutions' }] };
      expect(params).toEqual([OTHER, SCHOOL]);
      return { rows: [] };
    });
    await expect(loadInstitutionOverview(OTHER, SCHOOL, client)).resolves.toBeNull();
  });

  it('counts enrolled students, staff, attendance, rooms, and activity for this tenant only', async () => {
    const seen: unknown[][] = [];
    const client = db((sql, params) => {
      seen.push(params ?? []);
      if (sql.includes('to_regclass')) {
        const name = String(params?.[0] ?? '');
        return { rows: [{ reg: name }] };
      }
      if (sql.includes('FROM institutions')) {
        return {
          rows: [
            {
              custom_data: {
                medium: 'English',
                established: 1998,
                shift: 'Morning (07:30–13:30)',
                headmaster: 'Priya Sharma',
              },
            },
          ],
        };
      }
      if (sql.includes('FROM enrollments') && sql.includes('COUNT(DISTINCT student_id)')) {
        return { rows: [{ value: 1240 }] };
      }
      if (sql.includes('JOIN grades')) {
        return {
          rows: [{ grade_id: 'g9', code: 'G9', name: 'Grade 9', count: 116 }],
        };
      }
      if (sql.includes('FROM staff_assignments')) return { rows: [{ value: 84 }] };
      if (sql.includes('FROM student_attendance')) return { rows: [{ value: 94 }] };
      if (sql.includes('FROM rooms')) return { rows: [{ value: 46 }] };
      if (sql.includes('FROM audit_log_entries')) {
        return {
          rows: [
            {
              user_name: 'Priya Sharma',
              occurred_at: new Date('2026-09-24T04:12:00.000Z'),
              metadata: { title: 'Term 2 timetable published', tone: 'brand' },
            },
          ],
        };
      }
      return { rows: [] };
    });

    const overview = await loadInstitutionOverview(TENANT, SCHOOL, client);
    expect(overview).toMatchObject({
      students: 1240,
      staff: 84,
      attendancePercent: 94,
      classrooms: 46,
      facts: {
        medium: 'English',
        established: '1998',
        shift: 'Morning (07:30–13:30)',
        headmaster: 'Priya Sharma',
      },
    } satisfies Partial<InstitutionOverview>);
    expect(overview?.enrollmentByGrade[0]?.name).toBe('Grade 9');
    expect(overview?.activity[0]?.title).toBe('Term 2 timetable published');
    for (const params of seen) {
      if (params.length >= 2) {
        expect(params[0]).toBe(TENANT);
        expect(params[1]).toBe(SCHOOL);
      }
    }
  });
});

describe('GET /institutions/:id/overview', () => {
  it('404s a cross-tenant id and 403s a role that cannot read institutions', async () => {
    const registry = createGatewayRbacRegistry();
    expect(registry.roleHasPermission('principal', 'institution', 'read')).toBe(true);
    expect(registry.roleHasPermission('parent', 'institution', 'read')).toBe(false);

    const app = Fastify();
    app.addHook('onRequest', async (request) => {
      const role = request.headers['x-test-role'];
      const scoped = request as {
        tenantId?: string;
        user?: { roles?: { roleId: string }[] };
      };
      scoped.tenantId = String(request.headers['x-test-tenant'] ?? TENANT);
      if (typeof role === 'string' && role.length > 0) {
        scoped.user = { roles: [{ roleId: role }] };
      }
    });
    registerInstitutionOverviewRoutes(app, {
      run: async (_tenantId, fn) =>
        fn(
          db((sql) => {
            if (sql.includes('to_regclass')) return { rows: [{ reg: 'public.institutions' }] };
            return { rows: [] };
          }),
        ),
    });

    const missing = await app.inject({
      method: 'GET',
      url: `/institutions/${SCHOOL}/overview`,
      headers: { 'x-test-tenant': OTHER },
    });
    expect(missing.statusCode).toBe(404);

    const denied = await app.inject({
      method: 'GET',
      url: `/institutions/${SCHOOL}/overview`,
      headers: { 'x-test-role': 'parent' },
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });
});
