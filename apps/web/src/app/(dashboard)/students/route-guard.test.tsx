/// <reference types="vite/client" />
/**
 * A-batch (PRC-L034 pattern) — every `/students/**` route is gated on student
 * access.
 *
 * The layout guard alone is not enough: Next.js renders each page segment
 * independently of its layout (the page's RSC is part of the flight payload
 * even when the layout does not render `children`), so every page must check
 * access itself, before it fetches anything. A denied role gets the
 * access-denied card, no student form, no student name, and no student,
 * institution, gradebook or fee reads.
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

const STUDENT = {
  id: '00000000-0000-4000-8000-0000000000c1',
  firstName: 'Asha',
  lastName: 'Rao',
  dateOfBirth: '2014-06-01',
  gender: 'female',
  nationalId: null,
  nationality: null,
  contacts: [],
  guardians: [],
  identityDocuments: [],
  customData: {},
  createdAt: '2026-11-01',
  updatedAt: '2026-11-01',
};

const STUDENT_NAME = 'Asha Rao';

const studentsApi = vi.hoisted(() => ({
  getStudent: vi.fn(),
  getStudentCustomFields: vi.fn(),
  getStudentEnrollments: vi.fn(),
  getEnrollmentHistory: vi.fn(),
  getStudentAttendanceHeatmap: vi.fn(),
  getTransferRecords: vi.fn(),
  listStudentConsents: vi.fn(),
  listStudentDiscipline: vi.fn(),
  listStudentDisciplineIfPermitted: vi.fn(),
  listStudentSiblings: vi.fn(),
  studentHasPhoto: vi.fn(),
  readStudentConsents: vi.fn(),
  readStudentDiscipline: vi.fn(),
  listStudents: vi.fn(),
}));

vi.mock('@/lib/api/students', () => studentsApi);

const institutionsApi = vi.hoisted(() => ({
  listAreas: vi.fn(),
  listInstitutions: vi.fn(),
  listInstitutionClasses: vi.fn(),
  listInstitutionGrades: vi.fn(),
}));

vi.mock('@/lib/api/institutions', () => institutionsApi);

const academicsApi = vi.hoisted(() => ({ listGrades: vi.fn() }));

vi.mock('@/lib/institutions/api', () => academicsApi);

const gradebookApi = vi.hoisted(() => ({
  listGradeEntries: vi.fn(),
  listGpaSnapshots: vi.fn(),
  listReportCardJobs: vi.fn(),
  listTranscripts: vi.fn(),
}));

vi.mock('@/lib/api/gradebook', () => gradebookApi);

const feesApi = vi.hoisted(() => ({ listInvoicesResult: vi.fn(), listInvoices: vi.fn() }));

vi.mock('@/lib/api/fees', () => feesApi);

// The profile's health / fees / LMS tabs are async server components with their
// own reads (health, fees, LMS); RTL cannot render them, so they are stubbed.
vi.mock('./_components/student-360-live-panels', () => ({
  StudentHealthTab: () => null,
  StudentFeesTab: () => null,
  StudentLmsTab: () => null,
}));

// Both forms import `@proctira/ui/area-picker`, which the web vitest config does
// not alias; the guard test only needs to know whether the page reached them.
vi.mock('./[id]/enroll/_components/enroll-form', () => ({
  EnrollForm: () => <form data-testid="enroll-form" />,
}));

vi.mock('./[id]/transfer/_components/transfer-form', () => ({
  TransferForm: () => <form data-testid="transfer-form" />,
}));

vi.mock('@/providers/AuthProvider', () => ({
  useAuth: () => ({ user: null }),
  useOptionalAuth: () => null,
}));

const actions = vi.hoisted(() => ({
  createStudentAction: vi.fn(),
  updateStudentAction: vi.fn(),
  deleteStudentAction: vi.fn(),
  transferStudentAction: vi.fn(),
  submitBulkImportAction: vi.fn(),
  enrollStudentAction: vi.fn(),
  uploadStudentPhotoAction: vi.fn(),
  addStudentSiblingAction: vi.fn(),
  setStudentConsentAction: vi.fn(),
  addStudentDisciplineAction: vi.fn(),
  removeStudentDisciplineAction: vi.fn(),
  getInstitutionGradesAction: vi.fn(),
  getInstitutionPeriodsAction: vi.fn(),
  getInstitutionClassesAction: vi.fn(),
  graduateEnrollmentAction: vi.fn(),
  bulkGraduateStudentsAction: vi.fn(),
}));

vi.mock('./actions', () => actions);

const gradebookActions = vi.hoisted(() => ({ issueTranscriptAction: vi.fn() }));

vi.mock('../gradebook-actions', () => gradebookActions);

vi.mock('next-intl/server', () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
}));

const fetchSpy = vi.fn(async () => {
  throw new Error('unexpected network read');
});

const allFetches = {
  ...studentsApi,
  ...institutionsApi,
  ...academicsApi,
  ...gradebookApi,
  ...feesApi,
  ...actions,
  ...gradebookActions,
  fetchSpy,
};

function resetFetches() {
  for (const fn of Object.values(allFetches)) fn.mockReset();
  studentsApi.getStudent.mockResolvedValue(STUDENT);
  studentsApi.listStudents.mockResolvedValue({
    data: [STUDENT],
    meta: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
  });
  for (const name of [
    'getStudentCustomFields',
    'getStudentEnrollments',
    'getEnrollmentHistory',
    'getTransferRecords',
    'listStudentConsents',
    'listStudentDiscipline',
    'listStudentDisciplineIfPermitted',
    'listStudentSiblings',
    'readStudentConsents',
    'readStudentDiscipline',
  ] as const) {
    studentsApi[name].mockResolvedValue([]);
  }
  studentsApi.getStudentAttendanceHeatmap.mockResolvedValue(null);
  studentsApi.studentHasPhoto.mockResolvedValue(false);
  institutionsApi.listAreas.mockResolvedValue([]);
  institutionsApi.listInstitutions.mockResolvedValue([]);
  institutionsApi.listInstitutionClasses.mockResolvedValue([]);
  institutionsApi.listInstitutionGrades.mockResolvedValue([]);
  academicsApi.listGrades.mockResolvedValue([]);
  gradebookApi.listGradeEntries.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listGpaSnapshots.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listReportCardJobs.mockResolvedValue({ ok: true, data: [] });
  gradebookApi.listTranscripts.mockResolvedValue({ ok: true, data: [] });
  feesApi.listInvoicesResult.mockResolvedValue({ ok: true, items: [] });
  feesApi.listInvoices.mockResolvedValue([]);
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

const ID_PARAMS = { params: Promise.resolve({ id: STUDENT.id }) };

const ROUTES: RouteCase[] = [
  { path: '/students', file: './page.tsx', props: NO_SEARCH },
  { path: '/students/new', file: './new/page.tsx' },
  { path: '/students/enroll', file: './enroll/page.tsx' },
  { path: '/students/import', file: './import/page.tsx' },
  { path: '/students/records', file: './records/page.tsx', props: NO_SEARCH },
  { path: '/students/[id]', file: './[id]/page.tsx', props: { ...ID_PARAMS, ...NO_SEARCH } },
  { path: '/students/[id]/edit', file: './[id]/edit/page.tsx', props: ID_PARAMS },
  { path: '/students/[id]/enroll', file: './[id]/enroll/page.tsx', props: ID_PARAMS },
  { path: '/students/[id]/transfer', file: './[id]/transfer/page.tsx', props: ID_PARAMS },
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

/** Registrar, HR, platform and portal roles are outside the student read set. */
const DENIED_ROLE_SETS = [
  ['registrar'],
  ['hr_officer'],
  ['platform_admin'],
  ['student'],
  ['guardian'],
  ['parent'],
  [],
];

const ALLOWED_ROLE_SETS = [['principal'], ['nurse']];

describe('students route guard (A-batch)', () => {
  it('covers every page under /students', () => {
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
        expect(screen.queryByText(STUDENT_NAME)).toBeNull();
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
