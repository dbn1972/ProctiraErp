/**
 * @vitest-environment jsdom
 *
 * PRC-M100 — a failed read on the timetable / substitution pages shows a
 * specific error with retry and hides the empty-state setup CTAs.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const ok = <T,>(data: T) => ({ ok: true as const, data });
const fail = (error: string) => ({ ok: false as const, error });

const tt = {
  listSubstitutions: vi.fn(),
  listMeetings: vi.fn(),
  listSections: vi.fn(),
  listRooms: vi.fn(),
  listBellSchedules: vi.fn(),
  listPeriods: vi.fn(),
  listAffectedPeriods: vi.fn(),
};
vi.mock('@/lib/api/timetable', () => tt);
const listAllStaffResult = vi.fn();
vi.mock('@/lib/api/staff', () => ({ listAllStaffResult }));
const listAcademicPeriods = vi.fn();
vi.mock('@/lib/institutions/api', () => ({ listAcademicPeriods }));
vi.mock('@/components/timetable/substitution-create-form', () => ({
  SubstitutionCreateForm: () => null,
}));
vi.mock('@/components/timetable/teacher-absence-form', () => ({ TeacherAbsenceForm: () => null }));
vi.mock('@/components/timetable/academic-period-select', () => ({
  AcademicPeriodSelect: () => null,
}));
vi.mock('@/components/timetable/class-band-select', () => ({ ClassBandSelect: () => null }));
vi.mock('@/components/timetable/institution-week-grid', () => ({
  InstitutionWeekGrid: () => null,
}));
vi.mock('@/components/timetable/meeting-create-form', () => ({ MeetingCreateForm: () => null }));

const params = Promise.resolve({ id: 'inst-1' });

function allOk() {
  tt.listSubstitutions.mockResolvedValue(ok([]));
  tt.listMeetings.mockResolvedValue(ok([]));
  tt.listSections.mockResolvedValue(ok([]));
  tt.listRooms.mockResolvedValue(ok([]));
  tt.listBellSchedules.mockResolvedValue(ok([]));
  tt.listPeriods.mockResolvedValue(ok([]));
  listAllStaffResult.mockResolvedValue({ ok: true, items: [], truncated: false, totalItems: 0 });
  listAcademicPeriods.mockResolvedValue([]);
}

describe('substitutions page (PRC-M100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allOk();
  });

  it('shows empty-state CTAs only when every read succeeded', async () => {
    const { default: Page } = await import('./substitutions/page');
    render(await Page({ params }));
    expect(screen.getByText(/Add staff members before marking absences/)).toBeTruthy();
    expect(screen.getByText('None recorded yet.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a staff read failure is an error, not "Add staff members"', async () => {
    listAllStaffResult.mockResolvedValue({ ok: false, kind: 'unavailable', status: 503 });
    const { default: Page } = await import('./substitutions/page');
    render(await Page({ params }));
    const alert = screen.getByTestId('timetable-load-errors');
    expect(alert.textContent).toContain('Staff:');
    expect(screen.getByRole('link', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText(/Add staff members/)).toBeNull();
  });

  it('a substitutions read failure is not "None recorded yet."', async () => {
    tt.listSubstitutions.mockResolvedValue(fail('Gateway timeout'));
    const { default: Page } = await import('./substitutions/page');
    render(await Page({ params }));
    expect(screen.getByTestId('substitutions-error').textContent).toContain('Gateway timeout');
    expect(screen.queryByText('None recorded yet.')).toBeNull();
  });

  it.each([
    ['listMeetings', 'Section meetings'],
    ['listSections', 'Sections'],
    ['listRooms', 'Rooms'],
    ['listBellSchedules', 'Bell schedules'],
  ] as const)('names a failed %s read and hides setup CTAs', async (fn, label) => {
    listAllStaffResult.mockResolvedValue({
      ok: true,
      items: [{ id: 's1', firstName: 'A', lastName: 'B' }],
      truncated: false,
      totalItems: 1,
    });
    tt[fn].mockResolvedValue(fail('boom'));
    const { default: Page } = await import('./substitutions/page');
    render(await Page({ params }));
    expect(screen.getByTestId('timetable-load-errors').textContent).toContain(`${label}: boom`);
    expect(screen.queryByText(/Generate a timetable first/)).toBeNull();
  });
});

describe('timetable page (PRC-M100)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allOk();
  });

  it('academic periods failure is an error, not "Create an academic period"', async () => {
    listAcademicPeriods.mockRejectedValue(new Error('Academic periods unavailable'));
    const { default: Page } = await import('./page');
    render(await Page({ params }));
    expect(screen.getByTestId('timetable-load-errors').textContent).toContain(
      'Academic periods: Academic periods unavailable',
    );
    expect(screen.queryByText(/Create an academic period/)).toBeNull();
  });

  it('shows the academic period CTA when the read succeeded with zero rows', async () => {
    const { default: Page } = await import('./page');
    render(await Page({ params }));
    expect(screen.getByText(/Create an academic period/)).toBeTruthy();
    expect(screen.queryByTestId('timetable-load-errors')).toBeNull();
  });

  it.each([
    ['listMeetings', 'Section meetings'],
    ['listSections', 'Sections'],
    ['listRooms', 'Rooms'],
    ['listBellSchedules', 'Bell schedules'],
  ] as const)('names a failed %s read', async (fn, label) => {
    tt[fn].mockResolvedValue(fail('boom'));
    const { default: Page } = await import('./page');
    render(await Page({ params }));
    expect(screen.getByTestId('timetable-load-errors').textContent).toContain(`${label}: boom`);
    expect(screen.queryByText(/Create an academic period/)).toBeNull();
  });

  it('names a failed staff read', async () => {
    listAllStaffResult.mockResolvedValue({ ok: false, kind: 'denied', status: 403 });
    const { default: Page } = await import('./page');
    render(await Page({ params }));
    expect(screen.getByTestId('timetable-load-errors').textContent).toContain(
      'Staff: Your role cannot view this.',
    );
  });
});

describe('staff picker cap (PRC-M102)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allOk();
  });

  it('shows a visible notice when the staff list was truncated', async () => {
    const items = Array.from({ length: 400 }, (_, i) => ({
      id: `s${i}`,
      firstName: 'T',
      lastName: String(i),
    }));
    listAllStaffResult.mockResolvedValue({ ok: true, items, truncated: true, totalItems: 450 });
    const { default: Page } = await import('./substitutions/page');
    render(await Page({ params }));
    expect(screen.getByTestId('staff-truncation-notice').textContent).toContain('400 of 450');
  });

  it('passes the institution to the staff loader', async () => {
    const { default: Page } = await import('./page');
    render(await Page({ params }));
    expect(listAllStaffResult).toHaveBeenCalledWith({ institutionId: 'inst-1' });
  });
});

describe('class filter (PRC-M103)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    allOk();
    listAcademicPeriods.mockResolvedValue([{ id: 'ap1', name: '2026', status: 'active' }]);
    tt.listSections.mockResolvedValue(
      ok([
        { id: 'sec9b', name: 'Class 9-B Maths', code: '9B', status: 'PUBLISHED' },
        { id: 'sec10a', name: 'Class 10-A English', code: '10A', status: 'PUBLISHED' },
        { id: 'club', name: 'Robotics Club', code: 'RC', status: 'PUBLISHED' },
      ]),
    );
    tt.listMeetings.mockResolvedValue(
      ok(
        ['sec9b', 'sec10a', 'club'].map((sectionId, i) => ({
          id: `m${i}`,
          sectionId,
          staffId: 's1',
          periodId: 'p1',
          roomId: null,
          dayOfWeek: 1,
          status: 'active',
        })),
      ),
    );
  });

  it('list view with class=9-B shows only 9-B meetings', async () => {
    const { default: Page } = await import('./page');
    render(await Page({ params, searchParams: Promise.resolve({ view: 'list', class: '9-B' }) }));
    const table = screen.getByRole('table', { name: 'Meetings' });
    expect(table.textContent).toContain('9B');
    expect(table.textContent).not.toContain('10A');
    expect(table.textContent).not.toContain('Robotics');
  });

  it('defaults to all classes and an unbanded section is selectable', async () => {
    const { default: Page } = await import('./page');
    render(await Page({ params, searchParams: Promise.resolve({ view: 'list' }) }));
    expect(
      screen.getByRole('table', { name: 'Meetings' }).querySelectorAll('tbody tr'),
    ).toHaveLength(3);
    render(
      await Page({
        params,
        searchParams: Promise.resolve({ view: 'list', class: 'section:club' }),
      }),
    );
    const tables = screen.getAllByRole('table', { name: 'Meetings' });
    expect(tables[1]!.querySelectorAll('tbody tr')).toHaveLength(1);
  });
});
