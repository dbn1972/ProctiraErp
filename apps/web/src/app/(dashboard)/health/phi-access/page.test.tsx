/**
 * /health/phi-access.
 * HL-O1: a failed read (5xx, network) was rendered as "No PHI access events yet.".
 * HN-F1 / HN-R6: unresolved students get the localized unknown label, never an id fragment.
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PhiAccessPage from './page';

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

const OWN = '00000000-0000-4000-8000-0000000000c4';
const FOREIGN = '00000000-0000-4000-8000-0000000000d4';

function logRow(studentId: string, resourceType: string) {
  return {
    id: `l-${studentId}`,
    tenantId: 't',
    actorUserId: 'ha-1',
    studentId,
    resourceType,
    resourceId: null,
    action: 'READ',
    createdAt: '2026-11-01T09:30:00.000Z',
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

describe('/health/phi-access failed reads (HL-O1)', () => {
  it('a 500 shows the unavailable panel, not "No PHI access events yet."', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, status: 500, data: null, error: { code: 'X' } });
    render(await PhiAccessPage());
    expect(screen.getByTestId('list-load-failure')).toHaveAttribute(
      'data-failure-kind',
      'unavailable',
    );
    expect(screen.queryByText('No PHI access events yet.')).toBeNull();
  });

  it('a 403 keeps the health-service denial alert', async () => {
    gatewayFetch.mockResolvedValue({ ok: false, status: 403, data: null, error: { code: 'X' } });
    render(await PhiAccessPage());
    expect(screen.getByRole('alert')).toHaveTextContent(/Access denied by the health service/);
    expect(screen.queryByText('No PHI access events yet.')).toBeNull();
  });
});

describe('/health/phi-access student labels (HN-F1, HN-R6)', () => {
  it('names resolved students and never shows an id fragment for the rest', async () => {
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [logRow(OWN, 'allergy'), logRow(FOREIGN, 'vaccination.list')] },
    });
    render(await PhiAccessPage());
    expect(screen.getByText('allergy').closest('tr')).toHaveTextContent('Asha Rao');
    expect(screen.getByText('vaccination.list').closest('tr')).toHaveTextContent('Unknown student');
    expect(document.body.textContent).not.toMatch(/Student [0-9a-f]{8}/);
    expect(students.getStudent).toHaveBeenCalledWith(FOREIGN);
  });

  it('the unknown label comes from the health messages', async () => {
    intl.locale = 'hi';
    gatewayFetch.mockResolvedValue({
      ok: true,
      status: 200,
      data: { data: [logRow(FOREIGN, 'vaccination.list')] },
    });
    render(await PhiAccessPage());
    expect(screen.getByText('vaccination.list').closest('tr')).toHaveTextContent('अज्ञात छात्र');
  });
});
