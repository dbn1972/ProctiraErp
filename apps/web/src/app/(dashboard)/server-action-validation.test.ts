/**
 * PRC-L232: server actions reject malformed ids/enums/arrays before any
 * gateway call, and lib helpers encode ids in gateway paths.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api/gateway')>('@/lib/api/gateway');
  return { ...actual, gatewayFetch: (...args: unknown[]) => gatewayFetch(...args) };
});

import {
  bookInterviewAction,
  convertEnquiryAction,
  declineOfferAction,
  sendOfferAction,
  updateApplicationStatusAction,
} from './admissions-actions';
import { setUserRolesAction, setUserStatusAction } from './admin/actions';
import { importResultsFromExcelAction, submitBulkResultsAction } from './assessments/actions';

const ID = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  gatewayFetch.mockReset();
  gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { id: ID } });
});

describe('admissions actions', () => {
  it.each(['../tenant/users', 'not-a-uuid', ''])(
    'updateApplicationStatusAction rejects id %j without a gateway call',
    async (id) => {
      const res = await updateApplicationStatusAction({ id, status: 'approved' });
      expect(res.status).toBe('error');
      expect(gatewayFetch).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown status enum', async () => {
    const res = await updateApplicationStatusAction({
      id: ID,
      status: 'enrolled' as unknown as 'approved',
    });
    expect(res.status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('calls the gateway with an encoded path for a valid id', async () => {
    const res = await updateApplicationStatusAction({ id: ID, status: 'approved' });
    expect(res.status).toBe('success');
    expect(gatewayFetch.mock.calls[0]![0]).toBe(`/registrations/applications/${ID}/status`);
  });

  it('validates interview booking, conversion and offer ids', async () => {
    expect((await bookInterviewAction({ slotId: 'x', applicationId: ID })).status).toBe('error');
    expect((await convertEnquiryAction('x/../y')).status).toBe('error');
    expect((await sendOfferAction('bad', ID)).status).toBe('error');
    expect((await declineOfferAction(ID, 'bad')).status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});

describe('admin actions', () => {
  it('rejects path-like user ids and oversized role arrays', async () => {
    expect((await setUserRolesAction('a/b', [])).status).toBe('error');
    expect(
      (
        await setUserRolesAction(
          ID,
          Array.from({ length: 51 }, (_, i) => `r${i}`),
        )
      ).status,
    ).toBe('error');
    expect((await setUserRolesAction(ID, ['ok', '../x'])).status).toBe('error');
    expect((await setUserStatusAction(ID, 'DELETED' as unknown as 'ACTIVE')).status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });

  it('accepts valid ids and de-duplicates roles', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { id: ID, roles: [] } });
    const res = await setUserRolesAction(ID, ['admin', 'admin', 'teacher']);
    expect(res.status).toBe('success');
    const [path, init] = gatewayFetch.mock.calls[0] as [string, { json: unknown }];
    expect(path).toBe(`/tenant/users/${ID}/roles`);
    expect(init.json).toEqual({ roleIds: ['admin', 'teacher'] });
  });
});

describe('assessment bulk result actions', () => {
  const base = { subjectId: ID, academicPeriodId: ID2 };
  const row = { studentId: ID, assessmentItemId: ID2, score: 10 };

  it.each([
    ['malformed subject', { ...base, subjectId: 'x', results: [row] }],
    ['malformed student id', { ...base, results: [{ ...row, studentId: 'x' }] }],
    ['non-finite score', { ...base, results: [{ ...row, score: Number.POSITIVE_INFINITY }] }],
    ['NaN score', { ...base, results: [{ ...row, score: Number.NaN }] }],
    ['oversized array', { ...base, results: Array.from({ length: 5001 }, () => row) }],
    ['empty array', { ...base, results: [] }],
  ])('rejects %s without a gateway call', async (_label, input) => {
    expect((await submitBulkResultsAction(input)).status).toBe('error');
    expect((await importResultsFromExcelAction(input)).status).toBe('error');
    expect(gatewayFetch).not.toHaveBeenCalled();
  });
});
