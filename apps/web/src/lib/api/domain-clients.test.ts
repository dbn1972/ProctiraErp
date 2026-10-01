/**
 * PRC-L075: mocked-gateway tests for scholarships, transport, workflows and
 * parent-portal fee clients — mappers, request shape and error propagation.
 * A change to the staff scope query or payment method payload fails here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const gatewayFetch = vi.fn();
vi.mock('./gateway', async () => {
  const actual = await vi.importActual<typeof import('./gateway')>('./gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import { GatewayError } from './gateway';
import { listInvoices, listReceipts, payInvoice } from './parent-portal';
import {
  approveScholarshipApplication,
  createScholarshipProgram,
  listScholarshipApplications,
  listScholarshipDisbursements,
  listScholarshipPrograms,
  rejectScholarshipApplication,
  updateDisbursement,
} from './scholarships';
import { createTransportRoute, getTransportRoute, listTransportRoutes } from './transport';
import { decideWorkflowApproval } from './workflows';

function ok<T>(data: T) {
  return { ok: true, status: 200, data };
}
function fail(status: number, code: string, message: string) {
  return { ok: false, status, data: null, error: { code, message } };
}

beforeEach(() => {
  gatewayFetch.mockReset();
});

describe('scholarships client', () => {
  it('maps programs, deriving code from description and amountPerRecipient', async () => {
    gatewayFetch.mockResolvedValue(
      ok({
        data: [
          {
            id: 'p1',
            name: 'Merit Award',
            description: 'Code: MERIT-24\nTop rankers',
            totalSlots: '5',
            amountPerRecipient: 1000,
            applicationStartDate: '2025-01-01T00:00:00Z',
            applicationEndDate: '2025-02-01T00:00:00Z',
            status: 'open',
          },
        ],
      }),
    );
    const [program] = await listScholarshipPrograms();
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/scholarships/programs');
    expect(program).toMatchObject({
      id: 'p1',
      code: 'MERIT-24',
      totalSlots: 5,
      awardAmount: 1000,
      currency: 'INR',
      applicationStartDate: '2025-01-01',
      status: 'OPEN',
    });
  });

  it('maps application statuses and nullable review fields', async () => {
    gatewayFetch.mockResolvedValue(
      ok({
        data: [
          { id: 'a1', status: 'submitted', studentId: 's1', studentName: 'Asha', totalScore: 0 },
          { id: 'a2', status: 'approved', reviewerId: 'r1', reviewNotes: 'ok' },
          { id: 'a3', status: 'weird' },
        ],
      }),
    );
    const apps = await listScholarshipApplications();
    expect(apps.map((a) => a.status)).toEqual(['UNDER_REVIEW', 'APPROVED', 'PENDING']);
    expect(apps[0]).toMatchObject({ applicantId: 's1', applicantName: 'Asha', totalScore: 0 });
    expect(apps[2]).toMatchObject({ totalScore: null, reviewerId: null, reviewNotes: null });
  });

  it('maps disbursement statuses', async () => {
    gatewayFetch.mockResolvedValue(
      ok({
        data: [
          { id: 'd1', status: 'paid', amount: '250' },
          { id: 'd2', paymentStatus: 'failed' },
        ],
      }),
    );
    const rows = await listScholarshipDisbursements();
    expect(rows.map((r) => r.status)).toEqual(['PROCESSED', 'FAILED']);
    expect(rows[0]!.amount).toBe(250);
    expect(rows[0]!.paymentMethod).toBe('BANK_TRANSFER');
  });

  it('sends the documented create payload', async () => {
    gatewayFetch.mockResolvedValue(ok({ id: 'p9', name: 'Need Based' }));
    await createScholarshipProgram({
      name: 'Need Based',
      code: 'NEED',
      applicationStartDate: '2025-01-01',
      applicationEndDate: '2025-03-01',
      totalSlots: 3,
      awardAmount: 500,
    });
    const [path, init] = gatewayFetch.mock.calls[0] as [string, { method: string; json: unknown }];
    expect(path).toBe('/scholarships/programs');
    expect(init.method).toBe('POST');
    expect(init.json).toEqual({
      name: 'Need Based',
      description: 'Code: NEED',
      applicationStartDate: '2025-01-01',
      applicationEndDate: '2025-03-01',
      totalSlots: 3,
      amountPerRecipient: 500,
      currency: 'INR',
      eligibility: {},
    });
  });

  it('posts approve/reject to encoded paths and propagates gateway errors', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'a/1', status: 'approved' }));
    await approveScholarshipApplication('a/1', { notes: 'fine' } as never);
    expect(gatewayFetch.mock.calls[0]![0]).toBe('/scholarships/applications/a%2F1/approve');
    expect(gatewayFetch.mock.calls[0]![1]).toMatchObject({
      method: 'POST',
      json: { notes: 'fine' },
    });

    gatewayFetch.mockResolvedValueOnce(fail(409, 'ALREADY_DECIDED', 'Already decided'));
    const err = await rejectScholarshipApplication('a1').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GatewayError);
    expect(err).toMatchObject({ status: 409, code: 'ALREADY_DECIDED' });
  });

  it('updates disbursements with PUT and throws on empty response', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'd1', status: 'processed' }));
    await updateDisbursement('d1', { status: 'PROCESSED' } as never);
    expect(gatewayFetch.mock.calls[0]).toEqual([
      '/scholarships/disbursements/d1',
      { method: 'PUT', json: { status: 'PROCESSED' } },
    ]);
    gatewayFetch.mockResolvedValueOnce(fail(500, 'BOOM', 'Server error'));
    await expect(updateDisbursement('d1', {} as never)).rejects.toMatchObject({ code: 'BOOM' });
  });
});

describe('transport client', () => {
  it('maps routes with null-safe optional fields', async () => {
    gatewayFetch.mockResolvedValue(
      ok({ data: [{ id: 'r1', name: 'North', operatingDays: 'mon', distanceKm: 12 }] }),
    );
    const [route] = await listTransportRoutes();
    expect(route).toMatchObject({
      id: 'r1',
      name: 'North',
      status: 'active',
      operatingDays: [],
      distanceKm: 12,
      description: null,
      institutionId: null,
    });
  });

  it('returns null for a missing route and throws on failed create', async () => {
    gatewayFetch.mockResolvedValueOnce(fail(404, 'NOT_FOUND', 'Not found'));
    await expect(getTransportRoute('r404')).resolves.toBeNull();
    gatewayFetch.mockResolvedValueOnce(fail(400, 'VALIDATION_ERROR', 'bad'));
    await expect(
      createTransportRoute({
        name: 'x',
        startLocation: 'a',
        endLocation: 'b',
        operatingDays: [],
      } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(gatewayFetch.mock.calls[1]![1]).toMatchObject({ method: 'POST' });
  });
});

describe('workflows client', () => {
  it('posts decisions with an empty body and propagates errors', async () => {
    gatewayFetch.mockResolvedValueOnce(ok({ id: 'ap1', instanceId: 'i1', status: 'approved' }));
    await expect(decideWorkflowApproval('ap1', 'approve')).resolves.toMatchObject({
      status: 'approved',
    });
    expect(gatewayFetch.mock.calls[0]).toEqual([
      '/workflows/approvals/ap1/approve',
      { method: 'POST', json: {} },
    ]);
    gatewayFetch.mockResolvedValueOnce(fail(403, 'FORBIDDEN', 'Not your approval'));
    await expect(decideWorkflowApproval('ap1', 'reject')).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
  });
});

describe('parent-portal fee client', () => {
  it('uses scope=staff only for staff listings', async () => {
    gatewayFetch.mockResolvedValue(ok({ data: [] }));
    await listInvoices();
    await listInvoices('staff');
    await listReceipts('staff');
    expect(gatewayFetch.mock.calls.map((c) => c[0])).toEqual([
      '/parent-portal/fees/invoices',
      '/parent-portal/fees/invoices?scope=staff',
      '/parent-portal/fees/receipts?scope=staff',
    ]);
  });

  it('falls back to [] when the fee API is unavailable', async () => {
    gatewayFetch.mockResolvedValue(fail(503, 'UNAVAILABLE', 'down'));
    await expect(listInvoices()).resolves.toEqual([]);
  });

  it('pays with the documented method payload and propagates failures', async () => {
    const data = { invoice: { id: 'inv1' }, payment: { id: 'pay1' }, receipt: { id: 'rc1' } };
    gatewayFetch.mockResolvedValueOnce(ok(data));
    await expect(payInvoice('inv1', 'upi')).resolves.toEqual(data);
    expect(gatewayFetch.mock.calls[0]).toEqual([
      '/parent-portal/fees/invoices/inv1/pay',
      { method: 'POST', json: { method: 'upi' } },
    ]);
    gatewayFetch.mockResolvedValueOnce(ok(data));
    await payInvoice('inv1');
    expect(gatewayFetch.mock.calls[1]![1]).toEqual({ method: 'POST', json: { method: 'sandbox' } });
    gatewayFetch.mockResolvedValueOnce(fail(409, 'ALREADY_PAID', 'Invoice already paid'));
    await expect(payInvoice('inv1', 'card')).rejects.toMatchObject({ code: 'ALREADY_PAID' });
  });
});
