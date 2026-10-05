/**
 * PRC-M577 — dashboard hooks surface API failures (401/403/5xx) as `error`
 * and never substitute hard-coded sample data.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/dashboards', () => {
  const forbidden = () => Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 }));
  return {
    fetchCountryDashboard: vi.fn(forbidden),
    fetchStateDashboard: vi.fn(forbidden),
    fetchBoardAdminDashboard: vi.fn(forbidden),
    fetchBoardComparison: vi.fn(forbidden),
    fetchCrossBoardTransfer: vi.fn(forbidden),
    fetchSchoolDashboard: vi.fn(forbidden),
    fetchTeacherDashboard: vi.fn(forbidden),
    fetchParentStudentDashboard: vi.fn(forbidden),
  };
});

import {
  useBoardAdminDashboardData,
  useBoardComparisonData,
  useCountryDashboardData,
  useParentStudentDashboard,
  useSchoolDashboard,
  useStateDashboardData,
  useTeacherDashboard,
} from '../api';

afterEach(() => {
  vi.clearAllMocks();
});

const hooks: Array<[string, () => { data: unknown; isLoading: boolean; error: Error | null }]> = [
  ['country', () => useCountryDashboardData()],
  ['state', () => useStateDashboardData('KA')],
  ['board admin', () => useBoardAdminDashboardData('cbse')],
  ['board comparison', () => useBoardComparisonData()],
  ['school', () => useSchoolDashboard('inst-1')],
  ['teacher', () => useTeacherDashboard()],
  ['parent/student', () => useParentStudentDashboard()],
];

describe('dashboard hooks without mock fallback (PRC-M577)', () => {
  it.each(hooks)('%s: 403 -> error set, data undefined, not loading', async (_name, hook) => {
    const { result } = renderHook(hook);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe('Forbidden');
    expect(result.current.data).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('runtime hook modules do not import the sample-data module', () => {
    for (const file of ['queries.ts']) {
      const src = readFileSync(resolve(__dirname, '../api', file), 'utf8');
      expect(src).not.toMatch(/from '\.\/mockData'/);
    }
  });
});
