/**
 * D1-T1 (#728 review R2 side effect): every parent and student academic page that renders the
 * shared error frame shows the gateway correlation id as `Reference: <id>`, like
 * `/parent/report-cards`, and never the raw server text. The real `gatewayFetch` and
 * `fetchAcademic` run; only the network and session edges are mocked.
 */
import type { ReactElement } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('next/headers', () => ({
  cookies: () => ({ get: () => ({ value: 'eyJ.access.token' }) }),
  headers: () => ({ get: () => null }),
}));
vi.mock('@/lib/auth', () => ({
  AUTH_COOKIES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
    SESSION_ID: 'session_id',
  },
  decodeTokenPayload: () => ({
    sub: 'parent-1',
    tenantId: '11111111-1111-1111-1111-111111111111',
    email: 'parent@example.org',
    roles: [],
    iat: 1,
    exp: 9999999999,
  }),
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'parent-1' } })),
}));
vi.mock('@/lib/load-entity-labels', () => ({
  loadStudentLabelsForIds: vi.fn(async () => new Map()),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/parent/attendance',
  useSearchParams: () => new URLSearchParams(),
  redirect: vi.fn(),
}));
const fetchList = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/list-result', () => ({ fetchList: (...a: unknown[]) => fetchList(...a) }));
const fetchMock = vi.fn<(...args: [string, RequestInit?]) => Promise<Response>>();
vi.stubGlobal('fetch', fetchMock);
import ParentAttendancePage from '../attendance/page';
import ParentCalendarPage from '../calendar/page';
import ParentGradesPage from '../grades/page';
import ParentHomeworkPage from '../homework/page';
import ParentLmsPage from '../lms/page';
import ParentNoticesPage from '../notices/page';
import ParentPalPage from '../pal/page';
import ParentTimetablePage from '../timetable/page';
import StudentAttendancePage from '../../../(student)/student/attendance/page';
import StudentCalendarPage from '../../../(student)/student/calendar/page';
import StudentGradesPage from '../../../(student)/student/grades/page';
import StudentHomeworkPage from '../../../(student)/student/homework/page';
import StudentNoticesPage from '../../../(student)/student/notices/page';
import StudentPalPage from '../../../(student)/student/pal/page';
import StudentTimetablePage from '../../../(student)/student/timetable/page';
const RAW = 'current transaction is aborted, commands ignored until end of transaction block';
const CORRELATION_ID = '2ee7694a-4534-4ad0-a4bf-44cc3f17b9d7';
type ParentPage = (props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) => Promise<ReactElement>;
type StudentPage = () => Promise<ReactElement>;
const PAGES: Array<[string, () => Promise<ReactElement>]> = [
  ...(
    [
      ['parent attendance', ParentAttendancePage],
      ['parent calendar', ParentCalendarPage],
      ['parent grades', ParentGradesPage],
      ['parent homework', ParentHomeworkPage],
      ['parent lms', ParentLmsPage],
      ['parent notices', ParentNoticesPage],
      ['parent pal', ParentPalPage],
      ['parent timetable', ParentTimetablePage],
    ] as Array<[string, ParentPage]>
  ).map(([name, Page]): [string, () => Promise<ReactElement>] => [
    name,
    () => Page({ searchParams: Promise.resolve({}) }),
  ]),
  ...(
    [
      ['student attendance', StudentAttendancePage],
      ['student calendar', StudentCalendarPage],
      ['student grades', StudentGradesPage],
      ['student homework', StudentHomeworkPage],
      ['student notices', StudentNoticesPage],
      ['student pal', StudentPalPage],
      ['student timetable', StudentTimetablePage],
    ] as Array<[string, StudentPage]>
  ).map(([name, Page]): [string, () => Promise<ReactElement>] => [name, () => Page()]),
];
/** Resolve the page and its (async) AcademicFrame into a renderable tree. */
async function resolvePage(page: Promise<ReactElement>): Promise<ReactElement> {
  const el = await page;
  const type = el.type as (props: unknown) => Promise<ReactElement> | ReactElement;
  return typeof type === 'function' ? await type(el.props) : el;
}
beforeEach(() => {
  document.body.innerHTML = '';
  fetchMock.mockReset();
  fetchMock.mockImplementation(
    async () =>
      new Response(JSON.stringify({ code: '25P02', message: RAW, statusCode: 500 }), {
        status: 500,
        headers: { 'content-type': 'application/json', 'x-correlation-id': CORRELATION_ID },
      }),
  );
  fetchList.mockReset();
  fetchList.mockResolvedValue({
    ok: true,
    items: [
      {
        id: 'link-1',
        tenantId: '11111111-1111-1111-1111-111111111111',
        parentUserId: 'parent-1',
        studentId: '22222222-2222-4222-8222-222222222222',
        relationship: 'guardian',
        status: 'active',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
      },
    ],
  });
});
afterEach(() => {
  cleanup();
});
describe('academic error frames show the reference id (D1-T1)', () => {
  it.each(PAGES)('%s', async (_name, page) => {
    render(await resolvePage(page()));
    const text = document.body.textContent ?? '';
    expect(text).not.toContain(RAW);
    expect(text).toContain('Unable to load this page. Try again later.');
    expect(text).toContain(`Reference: ${CORRELATION_ID}`);
  });
});
