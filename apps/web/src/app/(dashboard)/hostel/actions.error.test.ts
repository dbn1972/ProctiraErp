/**
 * H-D1 (T-D3 pattern) — a refused or failed hostel save never shows server text.
 *
 * The hostel actions in campus-actions.ts / campus-ops-actions.ts used to
 * return `GatewayError.message` (and any `Error.message`) to the form. That
 * leaks the gateway RBAC reason ("No role assignment grants 'read' on
 * 'hostel' …"), the hostel package reason ("Forbidden: role cannot perform
 * hostel action …") and raw database text in 500 bodies (constraint names,
 * H-D4). Hostel forms now show fixed copy plus a reference.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const hostelApi = vi.hoisted(() => ({
  createHostel: vi.fn(),
  createHostelAssignment: vi.fn(),
  createHostelBed: vi.fn(),
  createHostelBlock: vi.fn(),
  createHostelLeave: vi.fn(),
  createHostelRoom: vi.fn(),
  createHostelVisitor: vi.fn(),
  decideHostelLeave: vi.fn(),
  updateHostelVisitorStatus: vi.fn(),
  addHostelMessMenuItem: vi.fn(),
  createHostelFeeStructure: vi.fn(),
  createHostelGatePass: vi.fn(),
  createHostelMessPlan: vi.fn(),
  subscribeHostelMess: vi.fn(),
  transitionHostelGatePass: vi.fn(),
  upsertHostelAttendance: vi.fn(),
}));
vi.mock('@/lib/api/hostel', () => hostelApi);

const libraryApi = vi.hoisted(() => ({
  checkoutLibraryItem: vi.fn(),
  createLibraryItem: vi.fn(),
  getLibraryClearance: vi.fn(),
  renewLibraryLoan: vi.fn(),
  returnLibraryLoan: vi.fn(),
  assessLibraryFine: vi.fn(),
  checkoutLibraryByBarcode: vi.fn(),
  importLibraryIsbn: vi.fn(),
  lookupIsbn: vi.fn(),
  payLibraryFine: vi.fn(),
  placeLibraryHold: vi.fn(),
  returnLibraryByBarcode: vi.fn(),
}));
vi.mock('@/lib/api/library', () => libraryApi);
vi.mock('@/lib/load-entity-labels', () => ({ loadStudentOptions: vi.fn() }));

import { GatewayError } from '@/lib/api/gateway';
import {
  createHostelAction,
  createHostelAssignmentAction,
  createHostelBedAction,
  createHostelBlockAction,
  createHostelLeaveAction,
  createHostelRoomAction,
  createHostelVisitorAction,
  createLibraryItemAction,
  decideHostelLeaveAction,
  updateHostelVisitorStatusAction,
} from '../campus-actions';
import {
  addMessMenuAction,
  createHostelFeeStructureAction,
  createMessPlanAction,
  decideGatePassAction,
  recordHostelAttendanceAction,
  requestGatePassAction,
  scanGatePassAction,
  subscribeMessAction,
} from '../campus-ops-actions';

const ID = '3f2b8c1e-4a5d-4e6f-8a7b-9c0d1e2f3a4b';
const ID2 = '00000000-0000-4000-8000-0000000000b1';
const CORRELATION_ID = '2ee7694a-4534-4ad0-a4bf-44cc3f17b9d7';
const RAW_GATEWAY =
  "No role assignment grants 'create' on 'hostel' within the requested area scope";
const RAW_PACKAGE = 'Forbidden: role cannot perform hostel action facility.write';
const RAW_DB =
  'insert or update on table "hostel_visitors" violates foreign key constraint "hostel_visitors_hostel_id_fkey"';
const RAW_TEXT =
  /No role assignment grants|Forbidden:|within the requested area scope|facility\.write|violates|constraint|hostel_/;
const PERMISSION =
  'You do not have permission to make this change. Contact your administrator if you need access.';
const CONFLICT = 'This conflicts with an existing record. Check the details and try again.';

type ApiName = keyof typeof hostelApi;
interface HostelActionCase {
  name: string;
  api: ApiName;
  fallback: string;
  run: () => Promise<{ status: string; message?: string }>;
}

const CASES: HostelActionCase[] = [
  {
    name: 'createHostelAction',
    api: 'createHostel',
    fallback: 'Failed to create hostel',
    run: () => createHostelAction({ name: 'North', code: 'NH' }),
  },
  {
    name: 'createHostelAssignmentAction',
    api: 'createHostelAssignment',
    fallback: 'Failed to create assignment',
    run: () => createHostelAssignmentAction({ studentId: ID, bedId: ID2, startDate: '2026-11-01' }),
  },
  {
    name: 'createHostelLeaveAction',
    api: 'createHostelLeave',
    fallback: 'Failed to create leave',
    run: () =>
      createHostelLeaveAction({
        studentId: ID,
        hostelId: ID2,
        startDate: '2026-11-01',
        endDate: '2026-11-02',
      }),
  },
  {
    name: 'decideHostelLeaveAction',
    api: 'decideHostelLeave',
    fallback: 'Failed to decide leave',
    run: () => decideHostelLeaveAction(ID, 'approved'),
  },
  {
    name: 'updateHostelVisitorStatusAction',
    api: 'updateHostelVisitorStatus',
    fallback: 'Failed to update visitor status',
    run: () => updateHostelVisitorStatusAction(ID, 'checked_in'),
  },
  {
    name: 'createHostelVisitorAction',
    api: 'createHostelVisitor',
    fallback: 'Failed to create visitor',
    run: () =>
      createHostelVisitorAction({
        hostelId: ID2,
        visitorName: 'Ravi',
        studentId: ID,
        visitDate: '2026-11-01',
      }),
  },
  {
    name: 'createHostelBlockAction',
    api: 'createHostelBlock',
    fallback: 'Failed to create block',
    run: () => createHostelBlockAction({ hostelId: ID2, name: 'Block A' }),
  },
  {
    name: 'createHostelRoomAction',
    api: 'createHostelRoom',
    fallback: 'Failed to create room',
    run: () => createHostelRoomAction({ blockId: ID2, roomNumber: '101' }),
  },
  {
    name: 'createHostelBedAction',
    api: 'createHostelBed',
    fallback: 'Failed to create bed',
    run: () => createHostelBedAction({ roomId: ID2, bedLabel: 'B1' }),
  },
  {
    name: 'createMessPlanAction',
    api: 'createHostelMessPlan',
    fallback: 'Failed to create mess plan',
    run: () => createMessPlanAction({ hostelId: ID2, name: 'Veg' }),
  },
  {
    name: 'addMessMenuAction',
    api: 'addHostelMessMenuItem',
    fallback: 'Failed to add menu item',
    run: () => addMessMenuAction({ planId: ID2, weekday: 1, meal: 'lunch', itemName: 'Rice' }),
  },
  {
    name: 'subscribeMessAction',
    api: 'subscribeHostelMess',
    fallback: 'Failed to subscribe',
    run: () => subscribeMessAction({ planId: ID2, studentId: ID, startDate: '2026-11-01' }),
  },
  {
    name: 'requestGatePassAction',
    api: 'createHostelGatePass',
    fallback: 'Failed to request gate pass',
    run: () =>
      requestGatePassAction({
        hostelId: ID2,
        studentId: ID,
        expectedOutAt: '2026-11-01T10:00:00+05:30',
        expectedInAt: '2026-11-01T18:00:00+05:30',
      }),
  },
  {
    name: 'decideGatePassAction',
    api: 'transitionHostelGatePass',
    fallback: 'Failed to decide gate pass',
    run: () => decideGatePassAction(ID, 'approved'),
  },
  {
    name: 'scanGatePassAction',
    api: 'transitionHostelGatePass',
    fallback: 'Failed to scan gate pass',
    run: () => scanGatePassAction(ID, 'out'),
  },
  {
    name: 'createHostelFeeStructureAction',
    api: 'createHostelFeeStructure',
    fallback: 'Failed to save fee structure',
    run: () =>
      createHostelFeeStructureAction({
        hostelId: ID2,
        roomType: 'single',
        termLabel: 'Term 1',
        amount: '5000.00',
      }),
  },
  {
    name: 'recordHostelAttendanceAction',
    api: 'upsertHostelAttendance',
    fallback: 'Failed to record attendance',
    run: () =>
      recordHostelAttendanceAction({
        blockId: ID2,
        studentId: ID,
        onDate: '2026-11-01',
        status: 'present',
      }),
  },
];

function gatewayError(status: number, message: string, correlationId?: string): GatewayError {
  return new GatewayError({
    status,
    code: status === 403 ? 'FORBIDDEN' : status === 409 ? 'CONFLICT' : 'INTERNAL_ERROR',
    message,
    ...(correlationId ? { correlationId } : {}),
  });
}

let consoleError: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  for (const fn of [...Object.values(hostelApi), ...Object.values(libraryApi)]) fn.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  consoleError.mockRestore();
});

describe('hostel denied-save copy (H-D1, T-D3 pattern)', () => {
  describe.each(CASES)('$name', (c) => {
    it('a gateway RBAC refusal shows permission copy and the gateway reference', async () => {
      hostelApi[c.api].mockRejectedValue(gatewayError(403, RAW_GATEWAY, CORRELATION_ID));
      const result = await c.run();
      expect(hostelApi[c.api]).toHaveBeenCalled();
      expect(result.status).toBe('error');
      expect(result.message).not.toMatch(RAW_TEXT);
      expect(result.message).toBe(`${PERMISSION} (ref ${CORRELATION_ID})`);
    });

    it('a hostel package refusal is hidden the same way', async () => {
      hostelApi[c.api].mockRejectedValue(gatewayError(403, RAW_PACKAGE));
      const result = await c.run();
      expect(result.message).not.toMatch(RAW_TEXT);
      expect(result.message).toMatch(/\(ref [0-9a-z-]{8}\)$/);
      expect(result.message?.startsWith(PERMISSION)).toBe(true);
    });

    it('a 500 with database text shows the form fallback, never the server text', async () => {
      hostelApi[c.api].mockRejectedValue(gatewayError(500, RAW_DB, CORRELATION_ID));
      const result = await c.run();
      expect(result.message).toBe(`${c.fallback} (ref ${CORRELATION_ID})`);
    });

    it('a non-gateway error never reaches the form', async () => {
      hostelApi[c.api].mockRejectedValue(
        new TypeError('fetch failed http://gateway.internal:4000'),
      );
      const result = await c.run();
      expect(result.message).not.toContain('gateway.internal');
      expect(result.message).toMatch(new RegExp(`^${c.fallback} \\(ref [0-9a-z-]{8}\\)$`));
    });
  });

  it('a conflicting save shows fixed conflict copy', async () => {
    hostelApi.createHostelAssignment.mockRejectedValue(
      gatewayError(409, 'Bed already has an active assignment', CORRELATION_ID),
    );
    const result = await createHostelAssignmentAction({
      studentId: ID,
      bedId: ID2,
      startDate: '2026-11-01',
    });
    expect(result.message).toBe(`${CONFLICT} (ref ${CORRELATION_ID})`);
  });

  it('logs the server reason server-side with the reference', async () => {
    hostelApi.createHostelVisitor.mockRejectedValue(gatewayError(500, RAW_DB, CORRELATION_ID));
    await createHostelVisitorAction({
      hostelId: ID2,
      visitorName: 'Ravi',
      studentId: ID,
      visitDate: '2026-11-01',
    });
    expect(consoleError).toHaveBeenCalled();
    expect(String(consoleError.mock.calls[0]?.[0])).toContain(CORRELATION_ID);
  });

  it('library actions in the same file also hide server text (RAW-WEB)', async () => {
    libraryApi.createLibraryItem.mockRejectedValue(gatewayError(400, 'title is required'));
    const result = await createLibraryItemAction({ title: 'Atlas' } as never);
    expect(result.message).toMatch(/^Failed to create library item \(ref /);
    expect(result.message).not.toContain('title is required');
  });
});
