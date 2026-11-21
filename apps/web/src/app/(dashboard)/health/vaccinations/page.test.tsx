/**
 * /health/vaccinations register.
 * HL-O1: a refused or failed read is not rendered as "No vaccinations recorded yet".
 * HL-O5: more than 100 doses says how many are shown instead of truncating silently.
 * HN-F1 / HN-R5 / HN-R6: unresolved students get the localized unknown label (never an
 * id fragment) and links that screen readers can tell apart.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthVaccinationsPage from './page';

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GatewayError: class GatewayError extends Error {},
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    user: { sub: 'ha-1', roles: [{ roleName: 'health_admin' }] },
  })),
}));
const students = vi.hoisted(() => ({ listStudents: vi.fn(), getStudent: vi.fn() }));
vi.mock('@/lib/api/students', () => students);
vi.mock('@/lib/api/staff', () => ({ listStaff: vi.fn(), getStaff: vi.fn() }));
vi.mock('@/lib/api/institutions', () => ({ listInstitutions: vi.fn(async () => []) }));
const intl = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('next-intl/server', async () => {
  const catalogues = {
    en: (await import('@/messages/en.json')).default,
    hi: (await import('@/messages/hi.json')).default,
  } as unknown as Record<string, Record<string, Record<string, string>>>;
  return {
    getTranslations: vi.fn(
      async (ns: string) => (key: string) => catalogues[intl.locale]![ns]![key] ?? key,
    ),
  };
});

const OWN = '00000000-0000-4000-8000-0000000000c1';
const FOREIGN_1 = '00000000-0000-4000-8000-0000000000d1';
const FOREIGN_2 = '00000000-0000-4000-8000-0000000000d2';

function dose(studentId: string, i: number) {
  return {
    id: `v-${studentId}-${i}`,
    tenantId: 't',
    studentId,
    vaccineName: `Vaccine ${i}`,
    doseNumber: 1,
    dateAdministered: '2026-11-01',
  };
}
function okRows(rows: unknown[]) {
  return { ok: true, status: 200, data: { data: rows } };
}
function failed(status: number) {
  return { ok: false, status, data: null, error: { code: 'X', message: 'raw server text' } };
}

beforeEach(() => {
  intl.locale = 'en';
  gatewayFetch.mockReset();
  students.listStudents.mockReset();
  students.getStudent.mockReset();
  students.listStudents.mockResolvedValue({
    data: [{ id: OWN, firstName: 'Asha', lastName: 'Rao', customData: {} }],
    meta: { totalItems: 1, totalPages: 1 },
  });
  students.getStudent.mockResolvedValue(null);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('/health/vaccinations failed reads (HL-O1)', () => {
  it('a 403 shows the access panel, not the empty state, and no create button', async () => {
    gatewayFetch.mockResolvedValue(failed(403));
    render(await HealthVaccinationsPage());
    expect(screen.getByTestId('list-load-failure')).toHaveAttribute('data-failure-kind', 'denied');
    expect(screen.getByText('You do not have access to this list')).toBeInTheDocument();
    expect(screen.queryByText(/No vaccinations recorded yet/)).toBeNull();
    expect(screen.queryByRole('link', { name: /New vaccination/ })).toBeNull();
    expect(document.body.textContent).not.toContain('raw server text');
  });

  it('a 500 shows the unavailable panel with the status reference', async () => {
    gatewayFetch.mockResolvedValue(failed(500));
    render(await HealthVaccinationsPage());
    expect(screen.getByTestId('list-load-failure')).toHaveAttribute(
      'data-failure-kind',
      'unavailable',
    );
    expect(screen.getByText('Reference: HTTP 500')).toBeInTheDocument();
    expect(screen.queryByText(/No vaccinations recorded yet/)).toBeNull();
    expect(screen.queryByRole('link', { name: /New vaccination/ })).toBeNull();
  });

  it('an empty 200 keeps the empty state and the create button', async () => {
    gatewayFetch.mockResolvedValue(okRows([]));
    render(await HealthVaccinationsPage());
    expect(screen.getByText(/No vaccinations recorded yet/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /New vaccination/ })).toBeInTheDocument();
  });
});

describe('/health/vaccinations truncation (HL-O5)', () => {
  it('more than 100 doses shows "Showing 100 of N"', async () => {
    gatewayFetch.mockResolvedValue(okRows(Array.from({ length: 150 }, (_, i) => dose(OWN, i + 1))));
    render(await HealthVaccinationsPage());
    expect(screen.getAllByRole('listitem')).toHaveLength(100);
    expect(screen.getByText('Showing 100 of 150 vaccinations.')).toBeInTheDocument();
  });

  it('100 or fewer doses show no truncation note', async () => {
    gatewayFetch.mockResolvedValue(okRows([dose(OWN, 1)]));
    render(await HealthVaccinationsPage());
    expect(screen.queryByText(/^Showing \d+ of \d+/)).toBeNull();
  });
});

describe('/health/vaccinations student labels (HN-F1, HN-R5, HN-R6)', () => {
  it('names resolved students and never shows an id fragment for the rest', async () => {
    gatewayFetch.mockResolvedValue(okRows([dose(OWN, 1), dose(FOREIGN_1, 2)]));
    render(await HealthVaccinationsPage());
    expect(screen.getByRole('link', { name: 'Asha Rao' })).toHaveAttribute(
      'href',
      `/health/${OWN}`,
    );
    const unknown = document.querySelector(`a[href="/health/${FOREIGN_1}"]`);
    expect(unknown?.textContent).toBe('Unknown student');
    expect(document.body.textContent).not.toMatch(/Student [0-9a-f]{8}/);
    expect(students.getStudent).toHaveBeenCalledWith(FOREIGN_1);
  });

  it('unresolved rows get distinct accessible link names', async () => {
    gatewayFetch.mockResolvedValue(okRows([dose(FOREIGN_1, 1), dose(FOREIGN_2, 1)]));
    render(await HealthVaccinationsPage());
    // Same vaccine, same date: only a row qualifier can tell the two links apart.
    const accessible = [FOREIGN_1, FOREIGN_2].map((id) =>
      document.querySelector(`a[href="/health/${id}"]`)?.getAttribute('aria-label'),
    );
    for (const name of accessible) expect(name).toMatch(/^Unknown student\b/);
    expect(new Set(accessible).size).toBe(2);
    for (const name of accessible) {
      expect(screen.getByRole('link', { name: name! })).toBeInTheDocument();
    }
  });

  it('the unknown label comes from the health messages', async () => {
    intl.locale = 'hi';
    gatewayFetch.mockResolvedValue(okRows([dose(FOREIGN_1, 1)]));
    render(await HealthVaccinationsPage());
    expect(document.querySelector(`a[href="/health/${FOREIGN_1}"]`)?.textContent).toBe(
      'अज्ञात छात्र',
    );
  });
});
