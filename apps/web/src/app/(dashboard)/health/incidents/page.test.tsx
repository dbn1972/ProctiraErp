/**
 * /health/incidents register.
 * HL-O1: a refused or failed read is not rendered as "No incidents yet".
 * HN-F1 / HN-R6: unresolved students get the localized unknown label, never an id fragment.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HealthIncidentsPage from './page';

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

const OWN = '00000000-0000-4000-8000-0000000000c3';
const FOREIGN = '00000000-0000-4000-8000-0000000000d3';

function visit(studentId: string, category: string) {
  return {
    id: `i-${studentId}`,
    tenantId: 't',
    studentId,
    institutionId: null,
    incidentAt: '2026-11-01T09:30:00.000Z',
    category,
    severity: 'low',
    notes: '',
    reportedBy: 'nurse-sub',
    createdAt: '2026-11-01T09:30:00.000Z',
    updatedAt: '2026-11-01T09:30:00.000Z',
  };
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

describe('/health/incidents failed reads (HL-O1)', () => {
  it.each([
    [403, 'denied'],
    [503, 'unavailable'],
  ])(
    'a %i shows the %s panel, not "No incidents yet", and no Log visit button',
    async (status, kind) => {
      gatewayFetch.mockResolvedValue({ ok: false, status, data: null, error: { code: 'X' } });
      render(await HealthIncidentsPage());
      expect(screen.getByTestId('list-load-failure')).toHaveAttribute('data-failure-kind', kind);
      expect(screen.getByText(`Reference: HTTP ${status}`)).toBeInTheDocument();
      expect(screen.queryByText('No incidents yet.')).toBeNull();
      expect(screen.queryByRole('link', { name: /Log visit/ })).toBeNull();
    },
  );

  it('an empty 200 keeps the empty state and the Log visit button', async () => {
    gatewayFetch.mockResolvedValue({ ok: true, status: 200, data: { data: [] } });
    render(await HealthIncidentsPage());
    expect(screen.getByText('No incidents yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Log visit/ })).toBeInTheDocument();
  });
});

describe('/health/incidents student labels (HN-F1, HN-R6)', () => {
  it('names resolved students and never shows an id fragment for the rest', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [visit(OWN, 'Headache'), visit(FOREIGN, 'Sprain')] },
    });
    render(await HealthIncidentsPage());
    expect(screen.getByText(/Headache/).closest('li')).toHaveTextContent('Asha Rao');
    expect(screen.getByText(/Sprain/).closest('li')).toHaveTextContent('Unknown student');
    expect(document.body.textContent).not.toMatch(/Student [0-9a-f]{8}/);
    expect(students.getStudent).toHaveBeenCalledWith(FOREIGN);
  });

  it('the unknown label comes from the health messages', async () => {
    intl.locale = 'hi';
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [visit(FOREIGN, 'Sprain')] },
    });
    render(await HealthIncidentsPage());
    expect(screen.getByText(/Sprain/).closest('li')).toHaveTextContent('अज्ञात छात्र');
  });
});
