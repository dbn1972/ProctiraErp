import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({}));
vi.mock('@/lib/institutions/api', () => ({}));
vi.mock('@/lib/api/admin.server', () => ({ getTenantSettings: vi.fn() }));
vi.mock('@/lib/api/students', () => ({ deleteStudent: vi.fn(), submitBulkImport: vi.fn() }));
vi.mock('@/lib/api/timetable', () => ({ createBellSchedule: vi.fn() }));
vi.mock('@/lib/api/transport', () => ({
  createTransportRoute: vi.fn(),
  createTransportVehicle: vi.fn(),
  createDriverAssignment: vi.fn(),
  createStudentAssignment: vi.fn(),
}));
vi.mock('@/lib/transport/api', () => ({}));
vi.mock('@/lib/api/workflows', () => ({
  createWorkflowDefinition: vi.fn(),
  decideWorkflowApproval: vi.fn(),
}));

import { deleteStudent, submitBulkImport } from '@/lib/api/students';
import { createBellSchedule } from '@/lib/api/timetable';
import {
  createDriverAssignment,
  createTransportRoute,
  createTransportVehicle,
} from '@/lib/api/transport';
import { createWorkflowDefinition, decideWorkflowApproval } from '@/lib/api/workflows';
import { deleteStudentAction, submitBulkImportAction } from './students/actions';
import { createBellScheduleAction } from './timetable-actions';
import {
  createDriverAssignmentAction,
  createTransportRouteAction,
  createTransportVehicleAction,
} from './transport/actions';
import { createWorkflowDefinitionAction, decideWorkflowApprovalAction } from './workflows/actions';
import { base64DecodedBytes, BULK_IMPORT_MAX_BYTES } from '@/lib/validation/action-input-schema';

const ID = '11111111-1111-4111-8111-111111111111';

describe('server action input validation (PRC-L249)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deleteStudentAction rejects a non-uuid id without calling the gateway', async () => {
    expect((await deleteStudentAction('../../x')).status).toBe('error');
    expect(deleteStudent).not.toHaveBeenCalled();
  });

  it('submitBulkImportAction rejects bad enum, mime type and oversize files', async () => {
    const ok = {
      fileBase64: 'QUJD',
      fileName: 'students.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      duplicateResolution: 'skip' as const,
    };
    const bad = [
      { ...ok, duplicateResolution: 'overwrite' as never },
      { ...ok, mimeType: 'application/x-msdownload' },
      { ...ok, fileBase64: 'not base64!' },
      { ...ok, fileBase64: 'A'.repeat(Math.ceil((BULK_IMPORT_MAX_BYTES * 4) / 3) + 8) },
    ];
    for (const input of bad) {
      expect((await submitBulkImportAction(input)).status).toBe('error');
    }
    expect(submitBulkImport).not.toHaveBeenCalled();
  });

  it('base64DecodedBytes accounts for padding', () => {
    expect(base64DecodedBytes('QUJD')).toBe(3);
    expect(base64DecodedBytes('QUI=')).toBe(2);
    expect(base64DecodedBytes('QQ==')).toBe(1);
  });

  it('createBellScheduleAction rejects non-uuid ids', async () => {
    const result = await createBellScheduleAction({
      institutionId: 'x',
      academicPeriodId: ID,
      name: 'Default',
    });
    expect(result.ok).toBe(false);
    expect(createBellSchedule).not.toHaveBeenCalled();
  });

  it('transport actions reject invalid enums/ids', async () => {
    expect(
      (
        await createTransportRouteAction({
          name: 'R1',
          startLocation: 'A',
          endLocation: 'B',
          operatingDays: ['funday' as never],
        })
      ).status,
    ).toBe('error');
    expect(
      (await createTransportVehicleAction({ registrationNumber: 'KA01', capacity: -3 })).status,
    ).toBe('error');
    expect(
      (
        await createDriverAssignmentAction({
          vehicleId: 'v1',
          driverId: ID,
          startDate: '2026-01-01',
        })
      ).status,
    ).toBe('error');
    expect(createTransportRoute).not.toHaveBeenCalled();
    expect(createTransportVehicle).not.toHaveBeenCalled();
    expect(createDriverAssignment).not.toHaveBeenCalled();
  });

  it('workflow actions reject empty steps and invalid decisions', async () => {
    expect(
      (await createWorkflowDefinitionAction({ name: 'Leave', module: 'hr', steps: [] })).status,
    ).toBe('error');
    expect((await decideWorkflowApprovalAction('nope', 'approve')).status).toBe('error');
    expect((await decideWorkflowApprovalAction(ID, 'escalate' as never)).status).toBe('error');
    expect(createWorkflowDefinition).not.toHaveBeenCalled();
    expect(decideWorkflowApproval).not.toHaveBeenCalled();
  });

  it('forwards valid input', async () => {
    vi.mocked(createBellSchedule).mockResolvedValue({ id: ID } as never);
    const result = await createBellScheduleAction({
      institutionId: ID,
      academicPeriodId: ID,
      name: 'Default',
      dayPattern: '1,2,3,4,5',
    });
    expect(result).toEqual({ ok: true, id: ID });
  });
});
