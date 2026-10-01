/**
 * PRC-L237 — examination server actions deny read-only roles before any
 * gateway request; the schedule page denies them too.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const roles = vi.hoisted(() => ({ ids: ['student'] as string[] }));
const api = vi.hoisted(() => ({
  createExamination: vi.fn(),
  registerExaminationCandidate: vi.fn(),
  publishExaminationResults: vi.fn(),
  createBoardExportJob: vi.fn(),
}));

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/auth/server', () => ({
  getSession: vi.fn(async () => ({
    accessToken: 't',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'u1',
      tenantId: 'tenant-a',
      email: 'u@t.test',
      roles: roles.ids.map((roleId) => ({ roleId, roleName: roleId, areaId: 'a1' })),
    },
  })),
}));
vi.mock('@/lib/api/examinations', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/examinations')>()),
  createExamination: api.createExamination,
  registerExaminationCandidate: api.registerExaminationCandidate,
  publishExaminationResults: api.publishExaminationResults,
}));
vi.mock('@/lib/api/gradebook', () => ({ createBoardExportJob: api.createBoardExportJob }));

import { createExaminationAction, publishResultsAction, registerCandidateAction } from './actions';
import { createBoardExportJobAction } from './board-exports/actions';

const ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.clearAllMocks();
  roles.ids = ['student'];
});

describe('examination action authz (PRC-L237)', () => {
  it.each(['student', 'teacher', 'staff'])(
    'createExaminationAction as %s returns forbidden without a gateway call',
    async (role) => {
      roles.ids = [role];
      const result = await createExaminationAction({} as never);
      expect(result).toEqual({ status: 'error', message: expect.stringMatching(/permission/) });
      expect(api.createExamination).not.toHaveBeenCalled();
    },
  );

  it('other write actions are gated too', async () => {
    expect((await publishResultsAction(ID)).status).toBe('error');
    expect(
      (
        await registerCandidateAction({
          examinationId: ID,
          studentId: ID,
          centerId: ID,
          subjectIds: [ID],
        })
      ).status,
    ).toBe('error');
    expect(api.publishExaminationResults).not.toHaveBeenCalled();
    expect(api.registerExaminationCandidate).not.toHaveBeenCalled();
  });

  it('admin passes the gate and reaches validation/gateway', async () => {
    roles.ids = ['admin'];
    api.registerExaminationCandidate.mockResolvedValue({ id: 'c1' });
    const result = await registerCandidateAction({
      examinationId: ID,
      studentId: ID,
      centerId: ID,
      subjectIds: [ID],
    });
    expect(api.registerExaminationCandidate).toHaveBeenCalled();
    expect(result.status).toBe('success');
  });

  it('board export action denies non-registrar roles before the gateway', async () => {
    roles.ids = ['teacher'];
    const result = await createBoardExportJobAction({ institutionId: ID });
    expect(result).toMatchObject({ ok: false, code: 'FORBIDDEN', status: 403 });
    expect(api.createBoardExportJob).not.toHaveBeenCalled();
  });

  it('/examinations/new renders RouteAccessDenied without examination write', () => {
    const src = readFileSync(resolve(__dirname, 'new/page.tsx'), 'utf8');
    expect(src).toMatch(/hasSessionPermission\('examination', 'create'\)/);
    expect(src).toContain('<RouteAccessDenied');
  });
});
