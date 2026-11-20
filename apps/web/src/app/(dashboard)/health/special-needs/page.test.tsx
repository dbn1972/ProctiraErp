/**
 * D2 (PRC-M088) — the special-needs register names each student, and the row's
 * "View" link has a non-empty accessible name. Live rows carry studentName '' by
 * contract; the page resolves the name from the caller's student directory.
 */
import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SpecialNeedsPage from './page';

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

const OWN = '00000000-0000-4000-8000-0000000000a2';
/** A student id that is not in this tenant: the gateway's /students/:id answers 404. */
const FOREIGN = '00000000-0000-4000-8000-0000000000b2';
const OTHER_TENANT_NAME = 'Other Tenant Kid';

function liveRow(studentId: string, category: string) {
  return {
    id: studentId,
    studentId,
    studentName: '',
    category,
    severity: 'MODERATE',
    accommodations: ['Extra time on exams'],
    iepActive: true,
  };
}

describe('/health/special-needs student names (D2)', () => {
  beforeEach(() => {
    gatewayFetch.mockReset();
    students.listStudents.mockReset();
    students.getStudent.mockReset();
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [liveRow(OWN, 'Learning support'), liveRow(FOREIGN, 'Speech')] },
    });
    students.listStudents.mockResolvedValue({
      data: [{ id: OWN, firstName: 'Ravi', lastName: 'Kumar', customData: {} }],
      meta: { totalItems: 1, totalPages: 1 },
    });
    // Emulates GET /students/:id under the caller's tenant (RLS): the other tenant's
    // student exists, but this caller's lookup answers 404 (null).
    const directories: Record<string, Map<string, { firstName: string; lastName: string }>> = {
      A: new Map([[OWN, { firstName: 'Ravi', lastName: 'Kumar' }]]),
      B: new Map([[FOREIGN, { firstName: 'Other Tenant', lastName: 'Kid' }]]),
    };
    students.getStudent.mockImplementation(async (id: string) => {
      const hit = directories.A!.get(id);
      return hit ? { id, ...hit, customData: {} } : null;
    });
  });

  it("names the student in the row and in the View link's accessible name", async () => {
    render(await SpecialNeedsPage());
    const view = screen.getByRole('link', { name: 'View Ravi Kumar' });
    expect(view).toHaveAttribute('href', `/students/${OWN}`);
    const row = view.closest('tr')!;
    expect(within(row).getByText('Ravi Kumar')).toBeInTheDocument();
    expect(within(row).getByText('Learning support')).toBeInTheDocument();
  });

  it('never leaves a View link nameless; an unresolved student gets a fixed label', async () => {
    render(await SpecialNeedsPage());
    const views = screen
      .getAllByRole('link')
      .filter((a) => (a.getAttribute('href') ?? '').startsWith('/students/'));
    expect(views).toHaveLength(2);
    for (const a of views) expect(a.getAttribute('aria-label')?.trim()).not.toBe('View');
    // Cross-tenant negative: an id outside this tenant resolves to the fallback.
    const foreign = screen.getByRole('link', { name: 'View Unknown student' });
    expect(foreign).toHaveAttribute('href', `/students/${FOREIGN}`);
    expect(document.body.innerHTML).not.toContain(OTHER_TENANT_NAME);
    expect(screen.queryByText(new RegExp(FOREIGN.slice(0, 8)))).toBeNull();
  });
});
