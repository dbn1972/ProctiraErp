/**
 * HN-R6: /health/counselling's unknown-student fallback was hard-coded English; it now
 * comes from the health messages. The row never shows an id fragment (PRC-M088).
 */
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import CounsellingPage from './page';

const gatewayFetch = vi.fn();
vi.mock('@/lib/api/gateway', () => ({
  gatewayFetch: (...args: unknown[]) => gatewayFetch(...args),
  GatewayError: class GatewayError extends Error {},
}));
vi.mock('@/lib/auth/server', () => ({
  requireSession: vi.fn(async () => ({
    user: { sub: 'c-1', roles: [{ roleName: 'counsellor' }] },
  })),
}));
vi.mock('@/lib/tenant-today', () => ({ getTenantToday: vi.fn(async () => '2026-11-01') }));
const students = vi.hoisted(() => ({ listStudents: vi.fn(), getStudent: vi.fn() }));
vi.mock('@/lib/api/students', () => students);
vi.mock('@/lib/api/staff', () => ({
  listStaff: vi.fn(async () => ({ data: [] })),
  getStaff: vi.fn(async () => null),
}));
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

const FOREIGN = '00000000-0000-4000-8000-0000000000d5';

beforeEach(() => {
  gatewayFetch.mockReset();
  students.listStudents.mockReset();
  students.getStudent.mockReset();
  students.listStudents.mockResolvedValue({ data: [], meta: { totalItems: 0, totalPages: 0 } });
  students.getStudent.mockResolvedValue(null);
  gatewayFetch.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      data: [
        {
          id: 'cs-1',
          studentId: FOREIGN,
          studentName: '',
          counsellorId: 'st-9',
          counsellorName: '',
          sessionType: 'individual',
          sessionDate: '2026-11-01',
          topic: '',
          status: 'SCHEDULED',
        },
      ],
    },
  });
});

describe('/health/counselling unknown student label (HN-R6)', () => {
  it.each([
    ['en', 'Unknown student'],
    ['hi', 'अज्ञात छात्र'],
  ])('%s: an unresolved student shows the localized label', async (locale, label) => {
    intl.locale = locale;
    render(await CounsellingPage());
    const table = screen.getByRole('table', { name: 'Counselling sessions' });
    expect(table).toHaveTextContent(label);
    expect(table.textContent).not.toContain(FOREIGN.slice(0, 8));
  });
});
