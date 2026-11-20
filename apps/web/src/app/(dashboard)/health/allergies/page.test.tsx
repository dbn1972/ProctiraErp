/**
 * D1 (PRC-M088) — the allergy register names each student. Live health records
 * carry studentName '' by contract; the page must resolve the name from the
 * caller's (tenant-scoped) student directory and never render an empty link.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthAllergiesPage from './page';

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GatewayError: class GatewayError extends Error {},
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({ user: { sub: 'nurse-1', roles: [{ roleName: 'nurse' }] } })),
}));
const students = vi.hoisted(() => ({ listStudents: vi.fn(), getStudent: vi.fn() }));
vi.mock('@/lib/api/students', () => students);
vi.mock('@/lib/api/staff', () => ({ listStaff: vi.fn(), getStaff: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: vi.fn(async () => []) }));

const OWN = '00000000-0000-4000-8000-0000000000a1';
/** A student id that is not in this tenant: the gateway's /students/:id answers 404. */
const FOREIGN = '00000000-0000-4000-8000-0000000000b1';
const OTHER_TENANT_NAME = 'Other Tenant Kid';

function liveRecord(studentId: string, allergy: string) {
  return {
    id: studentId,
    studentId,
    studentName: '',
    allergies: [allergy],
    chronicConditions: [],
    lastUpdated: '2026-11-20',
  };
}

describe('/health/allergies student names (D1)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    students.listStudents.mockReset();
    students.getStudent.mockReset();
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [liveRecord(OWN, 'Peanuts'), liveRecord(FOREIGN, 'Penicillin')] },
    });
    // The caller's directory is this tenant's only (gateway + RLS scoped).
    students.listStudents.mockResolvedValue({
      data: [{ id: OWN, firstName: 'Asha', lastName: 'Rao', customData: {} }],
      meta: { totalItems: 1, totalPages: 1 },
    });
    // Emulates GET /students/:id under the caller's tenant (RLS): the other tenant's
    // student exists, but this caller's lookup answers 404 (null).
    const directories: Record<string, Map<string, { firstName: string; lastName: string }>> = {
      A: new Map([[OWN, { firstName: 'Asha', lastName: 'Rao' }]]),
      B: new Map([[FOREIGN, { firstName: 'Other Tenant', lastName: 'Kid' }]]),
    };
    students.getStudent.mockImplementation(async (id: string) => {
      const hit = directories.A!.get(id);
      return hit ? { id, ...hit, customData: {} } : null;
    });
  });

  it("links each allergy to the student by this tenant's directory name", async () => {
    render(await HealthAllergiesPage());
    const link = screen.getByRole('link', { name: 'Asha Rao' });
    expect(link).toHaveAttribute('href', `/health/${OWN}`);
    expect(within(link.closest('li')!).getByText('Peanuts')).toBeInTheDocument();
  });

  it('never renders an empty link name; an unresolved student gets a fixed label', async () => {
    render(await HealthAllergiesPage());
    const links = screen
      .getAllByRole('link')
      .filter((a) => /^\/health\/[0-9a-f-]{36}$/.test(a.getAttribute('href') ?? ''));
    expect(links).toHaveLength(2);
    for (const a of links) expect(a.textContent?.trim()).not.toBe('');
    // Cross-tenant negative: an id outside this tenant resolves to the fallback,
    // never to another tenant's name and never to an id fragment.
    const foreign = screen.getByRole('link', { name: 'Unknown student' });
    expect(foreign).toHaveAttribute('href', `/health/${FOREIGN}`);
    expect(document.body.innerHTML).not.toContain(OTHER_TENANT_NAME);
    expect(screen.queryByText(new RegExp(FOREIGN.slice(0, 8)))).toBeNull();
  });
});
