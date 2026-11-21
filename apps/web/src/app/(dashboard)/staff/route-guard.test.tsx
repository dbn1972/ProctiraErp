/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/staff/**` route is gated on staff
 * (HR) access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no staff/HR form, no staff name, and no staff,
 * timetable, institution or staff-directory reads.
 */
import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

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

const STAFF = {
  id: '00000000-0000-4000-8000-0000000000b1',
  firstName: 'Meera',
  lastName: 'Iyer',
  dateOfBirth: '1988-02-01',
  identityNumber: 'ID-1',
  contactPhone: '+910000000000',
  contactEmail: null,
  position: 'Teacher',
  status: 'ACTIVE',
  customData: {},
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const STAFF_NAME = 'Meera Iyer';

const staffApi = vi.hoisted(() => ({
  getStaff: vi.fn(),
  listAppraisalTemplates: vi.fn(),
  listStaffAssignmentsResult: vi.fn(),
  listStaffAppraisals: vi.fn(),
  listStaffAssignments: vi.fn(),
  listStaffCertifications: vi.fn(),
  listStaffLeavesResult: vi.fn(),
  listTrainingPrograms: vi.fn(),
  listStaff: vi.fn(),
  listStaffAttendance: vi.fn(),
  listStaffAttendanceSummary: vi.fn(),
  listStaffContracts: vi.fn(),
  listStaffQualifications: vi.fn(),
  listStaffLeaves: vi.fn(),
  exportStaffPayroll: vi.fn(),
}));

vi.mock('@/lib/api/staff', () => staffApi);

const institutionsApi = vi.hoisted(() => ({ listInstitutions: vi.fn() }));

vi.mock('@/lib/api/institutions', () => institutionsApi);

const academicsApi = vi.hoisted(() => ({
  listClassesByInstitution: vi.fn(),
  listSubjects: vi.fn(),
}));

vi.mock('@/lib/institutions/api', () => academicsApi);

const timetableApi = vi.hoisted(() => ({
  listMeetings: vi.fn(),
  listSubstitutions: vi.fn(),
}));

vi.mock('@/lib/api/timetable', () => timetableApi);

const directory = vi.hoisted(() => ({
  loadStaffOptions: vi.fn(),
  loadStaffLabelMap: vi.fn(),
}));

vi.mock('@/lib/load-entity-labels', () => directory);

const actions = vi.hoisted(() => ({
  createStaffAction: vi.fn(),
  updateStaffAction: vi.fn(),
  deleteStaffAction: vi.fn(),
  createAssignmentAction: vi.fn(),
  createAppraisalAction: vi.fn(),
}));

vi.mock('./actions', () => actions);

const hrActions = vi.hoisted(() => ({
  createContractAction: vi.fn(),
  createQualificationAction: vi.fn(),
  saveAttendanceAction: vi.fn(),
  dryRunImportAction: vi.fn(),
  commitImportAction: vi.fn(),
  exportPayrollAction: vi.fn(),
}));

vi.mock('./hr-actions', () => hrActions);

const coverageActions = vi.hoisted(() => ({ loadSectionCoverageAction: vi.fn() }));

vi.mock('./coverage-actions', () => coverageActions);

const leaveActions = vi.hoisted(() => ({
  createStaffLeaveAction: vi.fn(),
  decideStaffLeaveAction: vi.fn(),
}));

vi.mock('../staff-leave-actions', () => leaveActions);

const timetableActions = vi.hoisted(() => ({ createSubstitutionAction: vi.fn() }));

vi.mock('../timetable-actions', () => timetableActions);

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = {
  ...staffApi,
  ...institutionsApi,
  ...academicsApi,
  ...timetableApi,
  ...directory,
  ...actions,
  ...hrActions,
  ...coverageActions,
  ...leaveActions,
  ...timetableActions,
  fetchSpy,
};

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  staffApi.getStaff.mockResolvedValue(STAFF);
  staffApi.listStaff.mockResolvedValue({
    data: [STAFF],
    meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  });
  for (const name of [
    'listAppraisalTemplates',
    'listStaffAppraisals',
    'listStaffAssignments',
    'listStaffCertifications',
    'listStaffAttendance',
    'listStaffAttendanceSummary',
    'listStaffContracts',
    'listStaffQualifications',
    'listStaffLeaves',
  ] as const) {
    staffApi[name].mockResolvedValue([]);
  }
  staffApi.listStaffAssignmentsResult.mockResolvedValue({ ok: true, items: [] });
  staffApi.listStaffLeavesResult.mockResolvedValue({ ok: true, items: [] });
  staffApi.listTrainingPrograms.mockResolvedValue({ ok: true, items: [] });
  staffApi.exportStaffPayroll.mockRejectedValue(new Error('payroll unavailable'));
  institutionsApi.listInstitutions.mockResolvedValue([]);
  academicsApi.listClassesByInstitution.mockResolvedValue([]);
  academicsApi.listSubjects.mockResolvedValue([]);
  timetableApi.listMeetings.mockResolvedValue({ ok: true, data: [] });
  timetableApi.listSubstitutions.mockResolvedValue({ ok: true, data: [] });
  directory.loadStaffOptions.mockResolvedValue([{ id: STAFF.id, label: STAFF_NAME }]);
  directory.loadStaffLabelMap.mockResolvedValue(new Map([[STAFF.id, STAFF_NAME]]));
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

const ID_PARAMS = { params: Promise.resolve({ id: STAFF.id }) };

const ROUTES: RouteCase[] = [
  { path: '/staff', file: './page.tsx', props: NO_SEARCH },
  { path: '/staff/new', file: './new/page.tsx' },
  { path: '/staff/import', file: './import/page.tsx' },
  { path: '/staff/attendance', file: './attendance/page.tsx', props: NO_SEARCH },
  { path: '/staff/contracts', file: './contracts/page.tsx' },
  { path: '/staff/leaves', file: './leaves/page.tsx', props: NO_SEARCH },
  { path: '/staff/payroll', file: './payroll/page.tsx' },
  { path: '/staff/substitutions', file: './substitutions/page.tsx' },
  { path: '/staff/[id]', file: './[id]/page.tsx', props: { ...ID_PARAMS, ...NO_SEARCH } },
  { path: '/staff/[id]/edit', file: './[id]/edit/page.tsx', props: ID_PARAMS },
  { path: '/staff/[id]/appraisals/new', file: './[id]/appraisals/new/page.tsx', props: ID_PARAMS },
  {
    path: '/staff/[id]/assignments/new',
    file: './[id]/assignments/new/page.tsx',
    props: { ...ID_PARAMS, ...NO_SEARCH },
  },
];

async function renderRoute(route: RouteCase) {
  const { default: Page } = await PAGES[route.file]!();
  render(await Page((route.props ?? {}) as never));
}

// Load every page module once up front: the first cold import of a page and
// its dependency graph can exceed the per-test timeout on a busy runner.
beforeAll(async () => {
  await Promise.all(Object.values(PAGES).map((load) => load()));
}, 60_000);

beforeEach(() => {
  resetFetches();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Teachers, plain staff, health, platform and portal roles have no HR read. */
const DENIED_ROLE_SETS = [
  ['teacher'],
  ['staff'],
  ['nurse'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  [],
];

const ALLOWED_ROLE_SETS = [['principal'], ['hr_officer']];

describe('staff route guard (A-batch)', () => {
  it('covers every page under /staff', () => {
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
        expect(screen.queryByText(STAFF_NAME)).toBeNull();
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
