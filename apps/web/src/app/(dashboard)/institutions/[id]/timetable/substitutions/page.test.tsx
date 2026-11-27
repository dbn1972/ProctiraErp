import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// UATENV-D37: the institution substitution desk uses the same assign form as
// /staff/substitutions and offered inactive or cancelled meetings that the
// gateway then refused with 400.

vi.mock('@/lib/auth/domain-route-access', () => ({
  hasDashboardDomainRouteAccess: vi.fn(async () => true),
}));
vi.mock('@/lib/api/staff', () => ({
  listAllStaffResult: vi.fn(async () => ({
    ok: true,
    items: [
      { id: 'staff-1', firstName: 'Asha', lastName: 'Rao' },
      { id: 'staff-2', firstName: 'Ravi', lastName: 'Menon' },
    ],
  })),
}));
vi.mock('@/lib/api/timetable', () => ({
  listSubstitutions: vi.fn(async () => ({ ok: true, data: [] })),
  listMeetings: vi.fn(async () => ({
    ok: true,
    data: [
      {
        id: 'meet-1',
        dayOfWeek: 1,
        periodId: 'p1',
        sectionId: 'sec-1',
        staffId: 'staff-1',
        status: 'active',
      },
      {
        id: 'meet-2',
        dayOfWeek: 2,
        periodId: 'p1',
        sectionId: 'sec-1',
        staffId: 'staff-1',
        status: 'inactive',
      },
      {
        id: 'meet-3',
        dayOfWeek: 3,
        periodId: 'p1',
        sectionId: 'sec-1',
        staffId: 'staff-2',
        status: 'cancelled',
      },
    ],
  })),
  listSections: vi.fn(async () => ({
    ok: true,
    data: [{ id: 'sec-1', code: '9A', name: 'Class 9-A' }],
  })),
  listRooms: vi.fn(async () => ({ ok: true, data: [] })),
  listBellSchedules: vi.fn(async () => ({ ok: true, data: [] })),
  listPeriods: vi.fn(async () => ({ ok: true, data: [] })),
  listAffectedPeriods: vi.fn(async () => ({ ok: true, data: [] })),
}));
vi.mock('@/app/(dashboard)/timetable-actions', () => ({
  createSubstitutionAction: vi.fn(),
  markTeacherAbsentAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import TimetableSubstitutionsPage from './page';

describe('TimetableSubstitutionsPage assign form (UATENV-D37)', () => {
  it('offers only active meetings', async () => {
    render(
      await TimetableSubstitutionsPage({
        params: Promise.resolve({ id: 'inst-1' }),
        searchParams: Promise.resolve({}),
      }),
    );
    const slot = screen.getByRole('combobox', { name: 'Meeting slot' }) as HTMLSelectElement;
    expect(Array.from(slot.options).map((o) => o.value)).toEqual(['meet-1']);
  });
});
