/**
 * @vitest-environment jsdom
 *
 * PRC-M111 — cancelled disbursements are counted separately and totals are
 * shown per currency.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// A-batch: pages check domain access before any read (route-guard.test.tsx
// covers that); this file tests the screen an allowed user sees.
vi.mock('@/lib/auth/domain-route-access', () => ({
  hasDashboardDomainRouteAccess: vi.fn(async () => true),
}));

const rows = [
  { id: '1', status: 'PROCESSED', amount: 1000, currency: 'INR' },
  { id: '2', status: 'PROCESSED', amount: 10, currency: 'USD' },
  { id: '3', status: 'CANCELLED', amount: 500, currency: 'INR' },
  { id: '4', status: 'PROCESSING', amount: 200, currency: 'INR' },
].map((r) => ({
  ...r,
  applicationId: `app-${r.id}`,
  applicantName: `Student ${r.id}`,
  programName: 'Merit',
  paymentDate: '2026-01-01',
  paymentMethod: 'BANK_TRANSFER',
}));

const listScholarshipDisbursements = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/scholarships', async (orig) => ({
  ...(await orig<typeof import('@/lib/api/scholarships')>()),
  listScholarshipDisbursements,
}));
vi.mock('../_components/retry-failed-transfers-button', () => ({
  RetryFailedTransfersButton: () => null,
}));

const resolveTenantTimezone = vi.hoisted(() => vi.fn(async () => 'Asia/Kolkata'));
vi.mock('@/lib/datetime/tenant-timezone.server', () => ({ resolveTenantTimezone }));
import Page from './page';
import { mapDisbursement } from '@/lib/api/scholarships';
vi.mock('next/navigation', () => ({
  usePathname: () => '/scholarships/disbursements',
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe('disbursements page (PRC-M111)', () => {
  it('PRC-M113: a gateway 500 shows the failure panel, not "No disbursements"', async () => {
    listScholarshipDisbursements.mockResolvedValueOnce({
      ok: false,
      kind: 'unavailable',
      status: 500,
    });
    render(await Page({}));
    expect(screen.getByText('This list could not be loaded')).toBeTruthy();
    expect(screen.queryByText('No disbursements scheduled.')).toBeNull();
  });

  it('shows a cancelled count, processing status and per-currency totals', async () => {
    listScholarshipDisbursements.mockResolvedValueOnce({ ok: true, items: rows });
    render(await Page({}));
    // KPI label + the row's status pill.
    expect(screen.getAllByText('Cancelled').length).toBe(2);
    expect(screen.getByText(/₹500 not paid/)).toBeTruthy();
    expect(screen.getByText(/1 processing now/)).toBeTruthy();
    expect(screen.getAllByText('Processing').length).toBeGreaterThan(0);
    const disbursed = screen.getByText(/₹1,000 \+ (US\$|\$)10/);
    expect(disbursed).toBeTruthy();
  });

  it('PRC-L435: paid date renders in the tenant timezone and the reference is a column', async () => {
    listScholarshipDisbursements.mockResolvedValueOnce({
      ok: true,
      items: [
        {
          ...rows[0]!,
          // 20:00 UTC on 31 Jan is 01:30 on 1 Feb in Asia/Kolkata.
          paidDate: '2026-01-31T20:00:00.000Z',
          transactionReference: 'UTR-778899',
        },
        { ...rows[3]!, paymentDate: '2026-03-05', paidDate: null, transactionReference: null },
      ],
    });
    render(await Page({}));
    expect(screen.getByRole('columnheader', { name: 'Reference' })).toBeTruthy();
    expect(screen.getByText('UTR-778899')).toBeTruthy();
    expect(screen.getByText('01 Feb 2026')).toBeTruthy();
    expect(screen.queryByText('31 Jan 2026')).toBeNull();
    // A calendar date is shown as that date whatever the zone.
    expect(screen.getByText('05 Mar 2026')).toBeTruthy();
  });
  it('PRC-L435: the mapper keeps paidDate and the transaction reference', () => {
    const mapped = mapDisbursement({
      id: 'd1',
      applicationId: 'a1',
      amount: 10,
      scheduledDate: '2026-01-01',
      paidDate: '2026-01-31T20:00:00.000Z',
      paymentStatus: 'paid',
      transactionReference: ' UTR-1 ',
    });
    expect(mapped).toMatchObject({
      paidDate: '2026-01-31T20:00:00.000Z',
      transactionReference: 'UTR-1',
    });
    expect(mapDisbursement({ id: 'd2', transactionReference: '' }).transactionReference).toBeNull();
  });
  it('PRC-M114: requests a page and shows page controls', async () => {
    listScholarshipDisbursements.mockResolvedValueOnce({
      ok: true,
      items: rows,
      meta: { page: 2, pageSize: 50, totalItems: 500, totalPages: 10 },
    });
    render(await Page({ searchParams: Promise.resolve({ page: '2' }) }));
    expect(listScholarshipDisbursements).toHaveBeenLastCalledWith({ page: 2, pageSize: 50 });
    expect(screen.getAllByRole('navigation', { name: 'Pagination' }).length).toBeGreaterThan(0);
    expect(screen.getAllByTestId('disbursement-kpi-scope').length).toBeGreaterThan(0);
  });
});
