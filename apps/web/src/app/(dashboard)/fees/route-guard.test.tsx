/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/fees/**` route is gated on fees
 * access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no form, and no fee, institution or student reads.
 *
 * The client workspaces and forms are stubbed (the structures and reports
 * stubs render the page's `header`, which holds the h1): this file tests the
 * page-level check, and the components have their own tests.
 */
import type { ReactElement, ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({ roles: [] as string[] }));

vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    accessToken: 'test-token',
    refreshToken: null,
    isExpired: false,
    user: {
      sub: 'user-1',
      tenantId: 'tenant-a',
      email: 'user@tenant-a.test',
      roles: auth.roles.map((roleId) => ({ roleId, roleName: roleId, areaId: 'area-1' })),
      iat: 0,
      exp: 9999999999,
    },
  })),
}));

const feesApi = vi.hoisted(() => ({
  listOverdueReminders: vi.fn(),
  listReminderSendAudits: vi.fn(),
  listReminderSuppressions: vi.fn(),
  listFeePlansResult: vi.fn(),
  listInvoicesPageResult: vi.fn(),
  listInvoicesResult: vi.fn(),
  listReceiptsResult: vi.fn(),
  listReceiptsPageResult: vi.fn(),
  listReconciliationBatches: vi.fn(),
  listReconciliationRows: vi.fn(),
  fetchDuesReportResult: vi.fn(),
  listNettableScholarshipDisbursementsResult: vi.fn(),
  listFeeStructuresResult: vi.fn(),
}));
vi.mock('@/lib/api/fees', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...feesApi,
}));

const institutionsApi = vi.hoisted(() => ({ listInstitutions: vi.fn() }));
vi.mock('@/lib/api/institutions', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...institutionsApi,
}));

const institutionLookups = vi.hoisted(() => ({
  listGrades: vi.fn(),
  listClassesByInstitution: vi.fn(),
}));
vi.mock('@/lib/institutions/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ...institutionLookups,
}));

const directory = vi.hoisted(() => ({ loadStudentOptions: vi.fn() }));
vi.mock('@/lib/load-entity-labels', () => directory);

const classLabels = vi.hoisted(() => ({ loadFeeClassLabels: vi.fn() }));
vi.mock('./_components/load-fee-class-labels', () => classLabels);

const withHeader = ({ header }: { header: ReactNode }) => <div>{header}</div>;
vi.mock('./_components/structures-workspace', () => ({ StructuresWorkspace: withHeader }));
vi.mock('./_components/fees-reports-panel', () => ({ FeesReportsPanel: withHeader }));
vi.mock('./_components/dunning-console', () => ({ DunningConsole: () => null }));
vi.mock('./_components/reconciliation-workspace', () => ({ ReconciliationWorkspace: () => null }));
vi.mock('./_components/scholarship-netting-form', () => ({ ScholarshipNettingForm: () => null }));
vi.mock('./_components/new-fee-plan-form', () => ({ NewFeePlanForm: () => null }));
vi.mock('./_components/new-invoice-form', () => ({ NewInvoiceForm: () => null }));
vi.mock('./_components/concession-dialog', () => ({ ConcessionDialog: () => null }));
vi.mock('./_components/pay-invoice-staff-button', () => ({ PayInvoiceStaffButton: () => null }));
vi.mock('./_components/refund-dialog', () => ({ RefundDialog: () => null }));

vi.mock('next-intl/server', () => ({
  getLocale: vi.fn(async () => 'en'),
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = {
  ...feesApi,
  ...institutionsApi,
  ...institutionLookups,
  ...directory,
  ...classLabels,
  fetchSpy,
};

const EMPTY_PAGE = {
  ok: true,
  items: [],
  meta: { page: 1, pageSize: 50, totalItems: 0, totalPages: 1 },
};

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  feesApi.listOverdueReminders.mockResolvedValue({ data: [], asOf: '2026-11-01' });
  feesApi.listReminderSendAudits.mockResolvedValue({ data: [], honestyNote: '' });
  feesApi.listReminderSuppressions.mockResolvedValue([]);
  feesApi.listFeePlansResult.mockResolvedValue({ ok: true, items: [] });
  feesApi.listInvoicesPageResult.mockResolvedValue(EMPTY_PAGE);
  feesApi.listInvoicesResult.mockResolvedValue({ ok: true, items: [] });
  feesApi.listReceiptsResult.mockResolvedValue({ ok: true, items: [] });
  feesApi.listReceiptsPageResult.mockResolvedValue(EMPTY_PAGE);
  feesApi.listReconciliationBatches.mockResolvedValue([]);
  feesApi.listReconciliationRows.mockResolvedValue([]);
  feesApi.fetchDuesReportResult.mockResolvedValue({
    ok: true,
    report: { asOf: '2026-11-01', byClass: [], byStatus: [], overdue: [] },
  });
  feesApi.listNettableScholarshipDisbursementsResult.mockResolvedValue({ ok: true, items: [] });
  feesApi.listFeeStructuresResult.mockResolvedValue({ ok: true, items: [] });
  institutionsApi.listInstitutions.mockResolvedValue([]);
  institutionLookups.listGrades.mockResolvedValue([]);
  institutionLookups.listClassesByInstitution.mockResolvedValue([]);
  directory.loadStudentOptions.mockResolvedValue([]);
  classLabels.loadFeeClassLabels.mockResolvedValue({});
  fetchSpy.mockRejectedValue(new Error('unexpected network read'));
}

type PageComponent = (props: never) => Promise<ReactElement> | ReactElement;

const PAGES = import.meta.glob<{ default: PageComponent }>('./**/page.tsx');

interface RouteCase {
  path: string;
  file: string;
  props?: Record<string, unknown>;
}

const NO_SEARCH = { searchParams: Promise.resolve({}) };

const ROUTES: RouteCase[] = [
  { path: '/fees', file: './page.tsx' },
  { path: '/fees/dunning', file: './dunning/page.tsx' },
  { path: '/fees/invoices', file: './invoices/page.tsx', props: NO_SEARCH },
  { path: '/fees/plans', file: './plans/page.tsx' },
  { path: '/fees/receipts', file: './receipts/page.tsx', props: NO_SEARCH },
  { path: '/fees/reconciliation', file: './reconciliation/page.tsx', props: NO_SEARCH },
  { path: '/fees/reports', file: './reports/page.tsx' },
  { path: '/fees/scholarship-netting', file: './scholarship-netting/page.tsx' },
  { path: '/fees/structures', file: './structures/page.tsx' },
];

async function renderRoute(route: RouteCase) {
  const { default: Page } = await PAGES[route.file]!();
  render(await Page((route.props ?? {}) as never));
}

beforeEach(() => {
  resetFetches();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Teaching, office, platform and portal roles hold no staff fees read. */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['registrar'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  ['parent'],
  [],
];

const ALLOWED_ROLE_SETS = [['admin'], ['principal']];

describe('fees route guard (A-batch)', () => {
  it('covers every page under /fees', () => {
    expect(ROUTES.map((r) => r.file).sort()).toEqual(Object.keys(PAGES).sort());
  });

  describe.each(ROUTES)('$path', (route) => {
    it.each(DENIED_ROLE_SETS.map((roles) => [roles.join('+') || 'no roles', roles]))(
      'renders access denied with no UI or reads for %s',
      async (_label, roles) => {
        auth.roles = roles as string[];
        await renderRoute(route);
        expect(screen.getByTestId('route-access-denied')).toBeInTheDocument();
        expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
        expect(document.querySelector('form')).toBeNull();
        for (const [name, fn] of Object.entries(allFetches)) {
          expect(fn, `${name} must not be called`).not.toHaveBeenCalled();
        }
      },
    );

    it.each(ALLOWED_ROLE_SETS.map((roles) => [roles.join('+'), roles]))(
      'renders the screen for %s',
      async (_label, roles) => {
        auth.roles = roles as string[];
        await renderRoute(route);
        expect(screen.queryByTestId('route-access-denied')).toBeNull();
        expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
      },
    );
  });
});
