/**
 * PRC-M578 — dashboard hooks send real scope ids, never 'current' / 'MH' /
 * 'cbse' placeholders the backend cannot resolve.
 */
import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const fetchers = vi.hoisted(() => ({
  fetchStateDashboard: vi.fn(async (id: string) => ({ stateCode: id })),
  fetchBoardAdminDashboard: vi.fn(async (id: string) => ({ boardCode: id })),
  fetchSchoolDashboard: vi.fn(async (id: string) => ({ institutionId: id })),
}));

vi.mock('@/lib/api/dashboards', () => ({
  ...fetchers,
  fetchCountryDashboard: vi.fn(),
  fetchBoardComparison: vi.fn(),
  fetchCrossBoardTransfer: vi.fn(),
  fetchTeacherDashboard: vi.fn(),
  fetchParentStudentDashboard: vi.fn(),
}));

import {
  useBoardAdminDashboardData,
  useSchoolDashboard,
  useStateDashboardData,
} from '../api';
import { DashboardScopeError } from '../api/queries';

afterEach(() => {
  vi.clearAllMocks();
});

describe('dashboard scope ids (PRC-M578)', () => {
  it('state director for KA requests KA, never MH', async () => {
    const { result } = renderHook(() => useStateDashboardData('KA'));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchers.fetchStateDashboard).toHaveBeenCalledWith('KA', expect.anything());
    expect(fetchers.fetchStateDashboard).not.toHaveBeenCalledWith('MH', expect.anything());
  });

  it('missing state/board/institution scope yields a scope error and no request', async () => {
    const state = renderHook(() => useStateDashboardData(undefined));
    const board = renderHook(() => useBoardAdminDashboardData(undefined));
    const school = renderHook(() => useSchoolDashboard(undefined));
    await waitFor(() => {
      expect(state.result.current.error).toBeInstanceOf(DashboardScopeError);
      expect(board.result.current.error).toBeInstanceOf(DashboardScopeError);
      expect(school.result.current.error).toBeInstanceOf(DashboardScopeError);
    });
    expect(fetchers.fetchStateDashboard).not.toHaveBeenCalled();
    expect(fetchers.fetchBoardAdminDashboard).not.toHaveBeenCalled();
    expect(fetchers.fetchSchoolDashboard).not.toHaveBeenCalled();
  });

  it('school dashboard requests the principal institution id', async () => {
    const { result } = renderHook(() => useSchoolDashboard('inst-42'));
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(fetchers.fetchSchoolDashboard).toHaveBeenCalledWith('inst-42', expect.anything());
  });

  it('refetches when the scope id changes', async () => {
    const { result, rerender } = renderHook(({ id }) => useStateDashboardData(id), {
      initialProps: { id: 'KA' as string | undefined },
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ id: 'TN' });
    await waitFor(() =>
      expect(fetchers.fetchStateDashboard).toHaveBeenLastCalledWith('TN', expect.anything()),
    );
  });
});
