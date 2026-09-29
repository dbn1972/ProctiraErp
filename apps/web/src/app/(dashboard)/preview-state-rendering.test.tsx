/**
 * Dashboard home — preview-state rendering (Task 8.3 / Req 6.3-6.7).
 *
 * `resolveDashboardSources()` (Task 8.2, inside `page.tsx`) substitutes
 * fixture data from `@/lib/dashboard/previewStateFixtures` for the six real
 * gateway calls whenever `resolvePreviewOverride()` resolves a non-null
 * override. This suite mocks only the seam Task 8.2 actually introduced —
 * `resolvePreviewOverride` — plus the same session/gateway mocks the
 * sibling `approvals-category-badge.test.tsx` and
 * `students-kpi-subtext.test.tsx` already use for this same non-exported
 * `DashboardPage()` Server Component. `@/lib/dashboard/previewStateFixtures`
 * itself is deliberately left unmocked so these tests exercise the real
 * Task 8.1 fixtures together with the real Task 8.2 wiring, not a
 * hand-rolled stand-in for either.
 *
 * Per-state coverage (Requirement 6):
 *   - 'filled'       (AC3) — every source populated.
 *   - 'no-approvals' (AC4) — every source populated except the approvals
 *     panel's existing empty state ("All caught up").
 *   - 'degraded'      (AC5) — Institutions/Students/Staff KPI cards
 *     unavailable; approvals and the role dashboard stay populated
 *     (partial outage, distinct from total failure).
 *   - 'error'      (AC6/AC7) — every one of the six sources takes its
 *     failure/null branch.
 *   - 'loading'       (AC6) — the fetch promise never settles; asserted via
 *     a bounded race against a short timer rather than an `await` that
 *     could hang the suite.
 *
 * Every non-null-override test also asserts the six real gateway functions
 * (`listInstitutionsPage`, `listStudents`, `listStaff`, `listAcademicPeriods`,
 * `listPendingApprovals`, `getRoleDashboard`) are never called — the Req 6
 * AC1/AC8/AC11 isolation guarantee Task 8.2 implemented.
 */
import { cleanup, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/DocumentTitle', () => ({
  DocumentTitle: () => null,
}));

const getSession = vi.fn();
vi.mock('@/lib/auth/server', () => ({
  getSession: (...args: unknown[]) => getSession(...args),
}));

const listInstitutionsPage = vi.fn();
vi.mock('@/lib/api/institutions', () => ({
  listInstitutionsPage: (...args: unknown[]) => listInstitutionsPage(...args),
}));

const listStudents = vi.fn();
vi.mock('@/lib/api/students', () => ({
  listStudents: (...args: unknown[]) => listStudents(...args),
}));

const listStaff = vi.fn();
vi.mock('@/lib/api/staff', () => ({
  listStaff: (...args: unknown[]) => listStaff(...args),
}));

const listAcademicPeriods = vi.fn();
vi.mock('@/lib/institutions/api', () => ({
  listAcademicPeriods: (...args: unknown[]) => listAcademicPeriods(...args),
}));

const getRoleDashboard = vi.fn();
vi.mock('@/lib/api/reports', () => ({
  getRoleDashboard: (...args: unknown[]) => getRoleDashboard(...args),
}));

const listPendingApprovals = vi.fn();
vi.mock('@/lib/api/workflows', () => ({
  listPendingApprovals: (...args: unknown[]) => listPendingApprovals(...args),
}));

const resolvePreviewOverride = vi.fn();
vi.mock('@/lib/dashboard/resolvePreviewOverride', () => ({
  resolvePreviewOverride: (...args: unknown[]) => resolvePreviewOverride(...args),
}));

import DashboardPage from './page';

/**
 * Arbitrary but fixed epoch for every mocked override in this file.
 * `page.tsx` only ever inspects `previewOverride.state` /
 * `previewOverride === null` — `setAtEpochSeconds` is opaque to it (expiry
 * was already resolved inside the real `resolvePreviewOverride`, which
 * these tests replace wholesale with a mock).
 */
const FIXED_SET_AT_EPOCH_SECONDS = 1_800_000_000;

function cardFor(label: string): HTMLElement {
  const el = screen.getByText(label).closest('a');
  expect(el).not.toBeNull();
  return el as HTMLElement;
}

/** Count of "Currently unavailable" markers anywhere on the rendered page. */
function currentlyUnavailableCount(): number {
  return screen.queryAllByText('Currently unavailable').length;
}

/**
 * Locates the approvals panel's own container by walking up from its
 * heading, rather than by a Tailwind class (which several other sections
 * on this page also share). Mirrors the panel's actual JSX nesting:
 * `<h2>Pending approvals</h2>` -> header row `<div>` -> panel `<div>`.
 */
function approvalsPanelContainer(): HTMLElement {
  const heading = screen.getByText('Pending approvals');
  const panel = heading.closest('div')?.parentElement ?? null;
  expect(panel).not.toBeNull();
  return panel as HTMLElement;
}

function expectRealGatewayFunctionsNeverCalled(): void {
  expect(listInstitutionsPage).not.toHaveBeenCalled();
  expect(listStudents).not.toHaveBeenCalled();
  expect(listStaff).not.toHaveBeenCalled();
  expect(listAcademicPeriods).not.toHaveBeenCalled();
  expect(listPendingApprovals).not.toHaveBeenCalled();
  expect(getRoleDashboard).not.toHaveBeenCalled();
}

/**
 * Races `promise` against a short real timer to prove it has settled
 * (resolved OR rejected) — or not — within `timeoutMs`. Used only for the
 * `'loading'` state test: `DashboardPage()`'s returned promise never
 * settles while that override is active (it is built from six calls to
 * `createNeverResolvingDashboardFetch()`), so awaiting it directly would
 * hang this test, and the whole suite, forever.
 */
async function hasSettledWithin(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  const PENDING = Symbol('pending');
  const outcome = await Promise.race([
    promise.then(
      () => 'resolved' as const,
      () => 'rejected' as const,
    ),
    new Promise<typeof PENDING>((resolve) => {
      setTimeout(() => resolve(PENDING), timeoutMs);
    }),
  ]);
  return outcome !== PENDING;
}

beforeEach(() => {
  getSession.mockReset();
  listInstitutionsPage.mockReset();
  listStudents.mockReset();
  listStaff.mockReset();
  listAcademicPeriods.mockReset();
  getRoleDashboard.mockReset();
  listPendingApprovals.mockReset();
  resolvePreviewOverride.mockReset();

  getSession.mockResolvedValue({
    user: { roles: [{ roleId: 'principal', roleName: 'Principal' }] },
  });

  // Defaults for the real gateway functions. Every override test below
  // asserts these are never called at all — these resolved values exist
  // only so a regression that DOES call them fails on a clear assertion
  // rather than an unhandled rejection.
  listInstitutionsPage.mockResolvedValue({ data: [], totalItems: 999 });
  listStudents.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 1, totalItems: 999, totalPages: 1 },
  });
  listStaff.mockResolvedValue({
    data: [],
    meta: { page: 1, pageSize: 1, totalItems: 999, totalPages: 1 },
  });
  listAcademicPeriods.mockResolvedValue([]);
  listPendingApprovals.mockResolvedValue([]);
  getRoleDashboard.mockResolvedValue({ dashboard: null, source: 'scaffold', status: 503 });
});

describe('<DashboardPage> preview-state rendering', () => {
  describe('baseline (resolvePreviewOverride resolves null)', () => {
    it('runs the real six-source fetch, unaffected by the override mechanism', async () => {
      resolvePreviewOverride.mockResolvedValue(null);

      render(await DashboardPage());

      expect(listInstitutionsPage).toHaveBeenCalledTimes(1);
      expect(listStudents).toHaveBeenCalledTimes(1);
      expect(listStaff).toHaveBeenCalledTimes(1);
      expect(listAcademicPeriods).toHaveBeenCalledTimes(1);
      expect(listPendingApprovals).toHaveBeenCalledTimes(1);
      expect(getRoleDashboard).toHaveBeenCalledTimes(1);
    });
  });

  describe("'filled' state (Req 6.3)", () => {
    it('renders non-empty KPIs, a populated approvals list, and a populated role snapshot, without calling any real gateway function', async () => {
      resolvePreviewOverride.mockResolvedValue({
        state: 'filled',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });

      render(await DashboardPage());

      // Non-empty KPI values (the fixture's FIXTURE_COUNTS).
      expect(within(cardFor('Institutions')).getByText('3')).toBeInTheDocument();
      expect(within(cardFor('Students')).getByText('620')).toBeInTheDocument();
      expect(within(cardFor('Staff')).getByText('71')).toBeInTheDocument();

      // Populated approvals list — at least one approval row by definitionName.
      expect(screen.getByText('Student transfer approval')).toBeInTheDocument();

      // Populated role-dashboard snapshot: the real RoleDashboardPanel
      // content, not the ScaffoldModeBanner fallback.
      expect(screen.getByTestId('dashboard-role-title')).toHaveTextContent('Principal dashboard');
      expect(screen.getByTestId('dashboard-card-principal-attendance')).toHaveTextContent('94.2%');
      expect(screen.queryByTestId('scaffold-mode-banner')).toBeNull();

      expect(currentlyUnavailableCount()).toBe(0);

      expectRealGatewayFunctionsNeverCalled();
    });
  });

  describe("'no-approvals' state (Req 6.4)", () => {
    it('keeps KPI cards and the role dashboard populated but renders the approvals empty state, never "Currently unavailable"', async () => {
      resolvePreviewOverride.mockResolvedValue({
        state: 'no-approvals',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });

      render(await DashboardPage());

      expect(within(cardFor('Institutions')).getByText('3')).toBeInTheDocument();
      expect(within(cardFor('Students')).getByText('620')).toBeInTheDocument();
      expect(within(cardFor('Staff')).getByText('71')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-role-title')).toHaveTextContent('Principal dashboard');

      // The approvals panel's EXISTING empty state — not a failure state.
      expect(screen.getByText('All caught up')).toBeInTheDocument();
      expect(screen.getByText('No approvals waiting on you.')).toBeInTheDocument();

      // Distinguishes this from a genuine service failure (Req 6.4's own
      // wording): no "Currently unavailable" anywhere on the page.
      expect(currentlyUnavailableCount()).toBe(0);

      expectRealGatewayFunctionsNeverCalled();
    });
  });

  describe("'degraded' state (Req 6.5)", () => {
    it('shows the Institutions/Students/Staff KPI cards unavailable while approvals and the role dashboard stay populated', async () => {
      resolvePreviewOverride.mockResolvedValue({
        state: 'degraded',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });

      render(await DashboardPage());

      expect(
        within(cardFor('Institutions')).getByText('Currently unavailable'),
      ).toBeInTheDocument();
      expect(within(cardFor('Students')).getByText('Currently unavailable')).toBeInTheDocument();
      expect(within(cardFor('Staff')).getByText('Currently unavailable')).toBeInTheDocument();

      // A populated section coexists with the unavailable KPI cards — the
      // key distinguishing assertion vs 'error', which fails everything.
      expect(screen.getByText('Student transfer approval')).toBeInTheDocument();
      expect(screen.getByTestId('dashboard-role-title')).toHaveTextContent('Principal dashboard');
      expect(screen.getByTestId('dashboard-card-principal-attendance')).toHaveTextContent('94.2%');
      expect(screen.queryByTestId('scaffold-mode-banner')).toBeNull();

      // Exactly the three KPI cards are unavailable — not the approvals
      // panel, not the Academic period card, not the role dashboard.
      expect(currentlyUnavailableCount()).toBe(3);

      expectRealGatewayFunctionsNeverCalled();
    });
  });

  describe("'error' state (Req 6.6, 6.7)", () => {
    it('shows every section in its unavailable/error presentation, distinct from degraded and no-approvals', async () => {
      resolvePreviewOverride.mockResolvedValue({
        state: 'error',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });

      render(await DashboardPage());

      expect(
        within(cardFor('Institutions')).getByText('Currently unavailable'),
      ).toBeInTheDocument();
      expect(within(cardFor('Students')).getByText('Currently unavailable')).toBeInTheDocument();
      expect(within(cardFor('Staff')).getByText('Currently unavailable')).toBeInTheDocument();
      expect(
        within(cardFor('Academic period')).getByText('Currently unavailable'),
      ).toBeInTheDocument();

      // The fixture sets `approvals: null`, not `approvals: []` — this must
      // take the panel's `approvals === null` branch ("Currently
      // unavailable"), NOT the `top.length === 0` empty-list branch ("All
      // caught up"). These are different branches in `page.tsx`.
      expect(screen.queryByText('All caught up')).toBeNull();
      expect(
        within(approvalsPanelContainer()).getByText('Currently unavailable'),
      ).toBeInTheDocument();

      // roleDashboardResult.dashboard is null -> the ScaffoldModeBanner
      // fallback, not RoleDashboardPanel.
      expect(screen.queryByTestId('dashboard-role-title')).toBeNull();
      expect(screen.getByTestId('scaffold-mode-banner')).toBeInTheDocument();
      expect(screen.getByTestId('scaffold-mode-banner')).toHaveTextContent('Principal dashboard');

      // Maximum failure surface: all four KPI cards plus the approvals
      // panel — more than 'degraded' (3) and none of 'no-approvals' (0).
      expect(currentlyUnavailableCount()).toBe(5);

      expectRealGatewayFunctionsNeverCalled();
    });
  });

  describe("'loading' state (Req 6.6)", () => {
    it('never settles while the loading override remains active, and calls no real gateway function', async () => {
      resolvePreviewOverride.mockResolvedValue({
        state: 'loading',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });

      // Deliberately not awaited directly: this promise is built from six
      // `createNeverResolvingDashboardFetch()` calls and will never settle
      // on its own for as long as the 'loading' override is active.
      const pagePromise = DashboardPage();

      const settledQuickly = await hasSettledWithin(pagePromise, 75);

      expect(settledQuickly).toBe(false);
      expectRealGatewayFunctionsNeverCalled();
    });
  });

  describe('distinguishability: no-approvals vs degraded vs error', () => {
    it('produces a strictly increasing "Currently unavailable" surface, with structurally distinct signals at each state', async () => {
      resolvePreviewOverride.mockResolvedValue({
        state: 'no-approvals',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });
      render(await DashboardPage());
      const noApprovalsUnavailableCount = currentlyUnavailableCount();
      const noApprovalsHasEmptyState = screen.queryByText('All caught up') !== null;
      cleanup();

      resolvePreviewOverride.mockResolvedValue({
        state: 'degraded',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });
      render(await DashboardPage());
      const degradedUnavailableCount = currentlyUnavailableCount();
      const degradedHasPopulatedApproval = screen.queryByText('Student transfer approval') !== null;
      cleanup();

      resolvePreviewOverride.mockResolvedValue({
        state: 'error',
        setAtEpochSeconds: FIXED_SET_AT_EPOCH_SECONDS,
      });
      render(await DashboardPage());
      const errorUnavailableCount = currentlyUnavailableCount();
      const errorHasPopulatedApproval = screen.queryByText('Student transfer approval') !== null;

      // 'no-approvals' has zero "Currently unavailable" markers and shows
      // the empty-list state.
      expect(noApprovalsUnavailableCount).toBe(0);
      expect(noApprovalsHasEmptyState).toBe(true);

      // 'degraded' has some (but not all) unavailable markers, and its
      // approvals section is still genuinely populated.
      expect(degradedUnavailableCount).toBeGreaterThan(noApprovalsUnavailableCount);
      expect(degradedHasPopulatedApproval).toBe(true);

      // 'error' has the maximum failure surface, and nothing is populated.
      expect(errorUnavailableCount).toBeGreaterThan(degradedUnavailableCount);
      expect(errorHasPopulatedApproval).toBe(false);

      expectRealGatewayFunctionsNeverCalled();
    });
  });
});
