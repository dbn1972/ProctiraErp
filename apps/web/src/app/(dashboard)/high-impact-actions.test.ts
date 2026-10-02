/**
 * PRC-L060 — happy / validation / GatewayError paths for high-impact server
 * actions: bulk graduate, bulk import, workflow approval, transport route
 * creation and timetable writes. `@/lib/api/*` is mocked; GatewayError is real.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayError } from '@/lib/api/gateway';

const revalidatePath = vi.hoisted(() => vi.fn());
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const students = vi.hoisted(() => ({
  getStudentEnrollments: vi.fn(),
  // PRC-L247 (#532): bulk graduate distinguishes lookup failure from "none".
  getStudentEnrollmentsResult: vi.fn(),
  bulkUpdateEnrollmentStatus: vi.fn(),
  submitBulkImport: vi.fn(),
}));
vi.mock('@/lib/api/students', async (orig) => ({ ...(await orig<object>()), ...students }));

const workflows = vi.hoisted(() => ({ decideWorkflowApproval: vi.fn() }));
vi.mock('@/lib/api/workflows', async (orig) => ({ ...(await orig<object>()), ...workflows }));

const transport = vi.hoisted(() => ({ createTransportRoute: vi.fn() }));
vi.mock('@/lib/api/transport', async (orig) => ({ ...(await orig<object>()), ...transport }));

const timetable = vi.hoisted(() => ({
  createMeeting: vi.fn(),
  publishSection: vi.fn(),
  bulkEnrollStudents: vi.fn(),
}));
vi.mock('@/lib/api/timetable', async (orig) => ({ ...(await orig<object>()), ...timetable }));

import { bulkGraduateStudentsAction, submitBulkImportAction } from './students/actions';
import { decideWorkflowApprovalAction } from './workflows/actions';
import { createTransportRouteAction } from './transport/actions';
import {
  bulkEnrollStudentsAction,
  createMeetingAction,
  publishSectionAction,
} from './timetable-actions';

const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
// PRC-L24x (#532): action ids are validated as UUIDs before the gateway.
const APPROVAL = '33333333-3333-4333-8333-333333333333';
// PRC-L232: timetable actions validate every id as a UUID before the gateway.
const I1 = '44444444-4444-4444-8444-444444444441';
const P1 = '44444444-4444-4444-8444-444444444442';
const SEC1 = '44444444-4444-4444-8444-444444444443';
const T1 = '44444444-4444-4444-8444-444444444444';
const PD1 = '44444444-4444-4444-8444-444444444445';
const gwError = (status: number, code: string, message: string, details?: unknown) =>
  new GatewayError({ status, code, message, details });

beforeEach(() => {
  vi.clearAllMocks();
});

describe('bulkGraduateStudentsAction', () => {
  it('graduates ENROLLED enrollments only and revalidates', async () => {
    students.getStudentEnrollmentsResult.mockImplementation(async (id: string) => ({
      ok: true,
      enrollments:
        id === S1
          ? [
              { id: 'e1', status: 'ENROLLED' },
              { id: 'e0', status: 'WITHDRAWN' },
            ]
          : [{ id: 'e2', status: 'ENROLLED' }],
    }));
    students.bulkUpdateEnrollmentStatus.mockResolvedValue({ updated: ['e1', 'e2'], failed: [] });
    const result = await bulkGraduateStudentsAction([S1, S2, S1]);
    expect(result).toMatchObject({ status: 'success', data: { graduated: 2, failed: 0 } });
    expect(students.bulkUpdateEnrollmentStatus).toHaveBeenCalledWith(
      expect.objectContaining({ enrollmentIds: ['e1', 'e2'], status: 'GRADUATED' }),
    );
    expect(revalidatePath).toHaveBeenCalledWith('/students');
  });

  it('rejects empty / non-UUID selections without calling the API', async () => {
    const result = await bulkGraduateStudentsAction(['not-a-uuid']);
    expect(result).toEqual({ status: 'error', message: 'Select at least one student.' });
    expect(students.getStudentEnrollmentsResult).not.toHaveBeenCalled();
  });

  it('reports partial failure as an error state', async () => {
    students.getStudentEnrollmentsResult.mockResolvedValue({
      ok: true,
      enrollments: [{ id: 'e1', status: 'ENROLLED' }],
    });
    students.bulkUpdateEnrollmentStatus.mockResolvedValue({ updated: [], failed: ['e1'] });
    const result = await bulkGraduateStudentsAction([S1]);
    expect(result).toMatchObject({ status: 'error', message: 'Graduated 0; 1 failed.' });
  });

  it('maps GatewayError to its message', async () => {
    students.getStudentEnrollmentsResult.mockRejectedValue(
      gwError(403, 'FORBIDDEN', 'Not allowed'),
    );
    const result = await bulkGraduateStudentsAction([S1]);
    expect(result).toEqual({ status: 'error', message: 'Not allowed' });
    expect(students.bulkUpdateEnrollmentStatus).not.toHaveBeenCalled();
  });
});

describe('submitBulkImportAction', () => {
  const input = {
    fileBase64: 'eA==',
    fileName: 'students.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    duplicateResolution: 'skip',
  } as Parameters<typeof submitBulkImportAction>[0];

  it('returns the sync result summary', async () => {
    students.submitBulkImport.mockResolvedValue({ successCount: 3, totalRows: 4 });
    const result = await submitBulkImportAction(input);
    expect(result).toMatchObject({ status: 'success', message: 'Imported 3 of 4 rows.' });
    expect(students.submitBulkImport).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'students.xlsx', async: false }),
    );
  });

  it('requires a file', async () => {
    const result = await submitBulkImportAction({ ...input, fileBase64: '' });
    expect(result.status).toBe('error');
    expect(students.submitBulkImport).not.toHaveBeenCalled();
  });

  it('maps GatewayError', async () => {
    students.submitBulkImport.mockRejectedValue(gwError(413, 'PAYLOAD_TOO_LARGE', 'File too big'));
    expect(await submitBulkImportAction(input)).toEqual({
      status: 'error',
      message: 'File too big',
    });
  });
});

describe('decideWorkflowApprovalAction', () => {
  it('approves and revalidates approvals + instances', async () => {
    workflows.decideWorkflowApproval.mockResolvedValue({});
    const result = await decideWorkflowApprovalAction(APPROVAL, 'approve');
    expect(result).toEqual({ status: 'success', message: 'Approved.' });
    expect(workflows.decideWorkflowApproval).toHaveBeenCalledWith(APPROVAL, 'approve');
    expect(revalidatePath).toHaveBeenCalledWith('/workflows/approvals');
    expect(revalidatePath).toHaveBeenCalledWith('/workflows/instances');
  });

  it('maps GatewayError (e.g. already decided)', async () => {
    workflows.decideWorkflowApproval.mockRejectedValue(gwError(409, 'CONFLICT', 'Already decided'));
    expect(await decideWorkflowApprovalAction(APPROVAL, 'reject')).toEqual({
      status: 'error',
      message: 'Already decided',
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

const VALID_ROUTE: Parameters<typeof createTransportRouteAction>[0] = {
  name: 'Route A',
  startLocation: 'Depot',
  endLocation: 'School',
  operatingDays: ['monday'],
} as Parameters<typeof createTransportRouteAction>[0];

describe('createTransportRouteAction', () => {
  it('returns the created route id', async () => {
    transport.createTransportRoute.mockResolvedValue({ id: 'r1' });
    const result = await createTransportRouteAction(VALID_ROUTE);
    expect(result).toEqual({ status: 'success', message: 'Route created.', routeId: 'r1' });
    expect(revalidatePath).toHaveBeenCalledWith('/transport/routes/r1');
  });

  it('surfaces gateway validation errors', async () => {
    transport.createTransportRoute.mockRejectedValue(
      gwError(400, 'VALIDATION_ERROR', 'name is required'),
    );
    expect(await createTransportRouteAction(VALID_ROUTE)).toEqual({
      status: 'error',
      message: 'name is required',
    });
    // PRC-L24x (#532): obviously invalid input is rejected before the gateway.
    transport.createTransportRoute.mockClear();
    expect((await createTransportRouteAction({ ...VALID_ROUTE, name: '' })).status).toBe('error');
    expect(transport.createTransportRoute).not.toHaveBeenCalled();
  });
});

describe('timetable actions', () => {
  const meeting = {
    institutionId: I1,
    academicPeriodId: P1,
    sectionId: SEC1,
    staffId: T1,
    periodId: PD1,
    dayOfWeek: 1,
  };

  it('createMeetingAction returns the new id', async () => {
    timetable.createMeeting.mockResolvedValue({ id: 'm1' });
    expect(await createMeetingAction(meeting)).toEqual({ ok: true, id: 'm1' });
    expect(revalidatePath).toHaveBeenCalledWith(`/institutions/${I1}/schedule/${SEC1}`);
  });

  it('createMeetingAction returns clash details from a 409', async () => {
    const conflicts = [{ kind: 'teacher', meetingId: 'm0' }];
    timetable.createMeeting.mockRejectedValue(
      gwError(409, 'MEETING_CONFLICT', 'Clash', { conflicts }),
    );
    expect(await createMeetingAction(meeting)).toEqual({
      ok: false,
      error: 'Clash',
      code: 'MEETING_CONFLICT',
      status: 409,
      conflicts,
    });
  });

  it('publishSectionAction maps non-gateway errors', async () => {
    timetable.publishSection.mockRejectedValue(new Error('boom'));
    // PRC-L24x (#532): non-gateway errors return a generic message with a
    // correlation ref instead of leaking the raw error text.
    const result = await publishSectionAction({ institutionId: I1, sectionId: SEC1 });
    expect(result.ok).toBe(false);
    expect(result).not.toMatchObject({ error: 'boom' });
    expect((result as { error: string }).error).toMatch(/\(ref [0-9a-f]{8}\)$/);
  });

  it('bulkEnrollStudentsAction reports enrolled + failed rows', async () => {
    timetable.bulkEnrollStudents.mockResolvedValue({
      summary: { enrolled: 1 },
      failed: [{ studentId: S2, message: 'Section full', extra: 'x' }],
    });
    expect(
      await bulkEnrollStudentsAction({
        institutionId: I1,
        sectionId: SEC1,
        studentIds: [S1, S2],
      }),
    ).toEqual({ ok: true, enrolled: 1, failed: [{ studentId: S2, message: 'Section full' }] });
  });
});
