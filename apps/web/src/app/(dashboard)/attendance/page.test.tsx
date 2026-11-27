import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// UAT E3 (Mark attendance): academic periods are tenant-scoped and the
// gateway mounts them only at `/academic-periods`. The page used to call the
// non-existent `/institutions/:id/academic-periods`, got a 404, rendered
// "No academic periods" and so could never load a class roster.

const mocks = vi.hoisted(() => ({
  formProps: [] as Array<Record<string, unknown>>,
  nestedPeriods: vi.fn(async (_institutionId: string) => [] as unknown[]),
  tenantPeriods: vi.fn(async () => [
    {
      id: 'p1',
      tenantId: 't1',
      name: 'AY 2026-27',
      code: 'AY2627',
      startDate: '2026-04-01',
      endDate: '2027-03-31',
      status: 'active',
      kind: 'year',
      parentId: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    },
  ]),
}));

vi.mock('@/lib/api/institutions', () => ({
  listInstitutions: vi.fn(async () => [{ id: 'inst-1', name: 'Sunrise Primary' }]),
  // What the nested 404 route yields today.
  listAcademicPeriods: mocks.nestedPeriods,
}));
vi.mock('@/lib/institutions/api', () => ({
  listClassesByInstitution: vi.fn(async () => [{ id: 'class-1', name: '5-A' }]),
  listAcademicPeriods: mocks.tenantPeriods,
}));
vi.mock('@/lib/api/attendance', () => ({
  getClassRoster: vi.fn(async () => ({ ok: true, items: [] })),
}));
vi.mock('@/lib/api/timetable', () => ({
  listAttendancePeriods: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock('@/lib/auth/server', () => ({
  getSession: vi.fn(async () => ({ user: { tenantId: 't1', sub: 'u1' } })),
}));
vi.mock('@/lib/datetime/tenant-timezone.server', () => ({
  resolveTenantTimezone: vi.fn(async () => 'Asia/Kolkata'),
}));
vi.mock('./_components/attendance-marking-form', () => ({
  AttendanceMarkingForm: (props: Record<string, unknown>) => {
    mocks.formProps.push(props);
    return <div data-testid="attendance-marking-form" />;
  },
}));

import AttendancePage from './page';

describe('AttendancePage academic periods (UAT E3 Mark attendance)', () => {
  beforeEach(() => {
    mocks.formProps.length = 0;
    mocks.nestedPeriods.mockClear();
    mocks.tenantPeriods.mockClear();
  });

  it('offers the tenant academic periods once an institution is chosen', async () => {
    render(await AttendancePage({ searchParams: Promise.resolve({ institutionId: 'inst-1' }) }));

    expect(mocks.tenantPeriods).toHaveBeenCalledTimes(1);
    expect(mocks.formProps.at(-1)?.['academicPeriods']).toEqual([
      { id: 'p1', name: 'AY 2026-27', isActive: true },
    ]);
  });

  it('does not read periods before an institution is chosen', async () => {
    render(await AttendancePage({ searchParams: Promise.resolve({}) }));

    expect(mocks.tenantPeriods).not.toHaveBeenCalled();
    expect(mocks.formProps.at(-1)?.['academicPeriods']).toEqual([]);
  });
});
