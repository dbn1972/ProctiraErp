import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// S-D3: the page loaded the staff directory for table labels but never passed
// it to the assign form, so the form said "Staff directory is unavailable"
// and Assign substitute stayed disabled.

vi.mock('@/lib/auth/domain-route-access', () => ({
  hasDashboardDomainRouteAccess: vi.fn(async () => true),
}));
vi.mock('@/lib/api/timetable', () => ({
  listSubstitutions: vi.fn(async () => ({ ok: true, data: [] })),
  listMeetings: vi.fn(async () => ({
    ok: true,
    data: [
      { id: 'meet-1', dayOfWeek: 1, sectionId: 'sec-1', staffId: 'staff-1', status: 'active' },
      { id: 'meet-2', dayOfWeek: 2, sectionId: 'sec-1', staffId: 'staff-1', status: 'inactive' },
      { id: 'meet-3', dayOfWeek: 3, sectionId: 'sec-1', staffId: 'staff-2', status: 'cancelled' },
    ],
  })),
}));
vi.mock('@/lib/load-entity-labels', () => {
  const options = [
    { id: 'staff-1', label: 'Asha Rao (Teacher)', searchText: 'Asha Rao Teacher' },
    { id: 'staff-2', label: 'Ravi Menon (Teacher)', searchText: 'Ravi Menon Teacher' },
  ];
  return {
    loadStaffOptions: vi.fn(async () => options),
    loadStaffLabelMap: vi.fn(async () => new Map(options.map((o) => [o.id, o.label]))),
  };
});
vi.mock('@/app/(dashboard)/timetable-actions', () => ({
  createSubstitutionAction: vi.fn(),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import StaffSubstitutionsPage from './page';

describe('StaffSubstitutionsPage assign form (S-D3)', () => {
  it('lists the staff directory in the substitute picker and enables Assign', async () => {
    render(await StaffSubstitutionsPage());

    const picker = screen.getByTestId('substitute-staff');
    expect(within(picker).getByRole('option', { name: 'Asha Rao (Teacher)' })).toBeTruthy();
    expect(within(picker).getByRole('option', { name: 'Ravi Menon (Teacher)' })).toBeTruthy();
    expect(screen.queryByText(/Staff directory is unavailable/i)).toBeNull();
    expect(
      (screen.getByRole('button', { name: 'Assign substitute' }) as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('offers only active meetings, since the gateway refuses the others (UATENV-D37)', async () => {
    render(await StaffSubstitutionsPage());
    const slot = screen.getByRole('combobox', { name: 'Meeting slot' }) as HTMLSelectElement;
    expect(Array.from(slot.options).map((o) => o.value)).toEqual(['meet-1']);
  });
});
