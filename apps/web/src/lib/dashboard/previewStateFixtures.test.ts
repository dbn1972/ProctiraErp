import { describe, expect, it } from 'vitest';

import {
  buildPreviewFixture,
  createNeverResolvingDashboardFetch,
  type DashboardFixtureData,
} from './previewStateFixtures';

const ROLE = 'principal' as const;

describe('buildPreviewFixture — filled', () => {
  const fixture = buildPreviewFixture('filled', ROLE);

  it('produces non-empty KPI values for institutions, students, and staff', () => {
    expect(fixture.institutions).not.toBeNull();
    expect(fixture.institutions!.totalItems).toBeGreaterThan(0);
    expect(fixture.students).not.toBeNull();
    expect(fixture.students!.meta.totalItems).toBeGreaterThan(0);
    expect(fixture.staff).not.toBeNull();
    expect(fixture.staff!.meta.totalItems).toBeGreaterThan(0);
  });

  it('produces a populated academic periods array with exactly one active period', () => {
    expect(fixture.periods).not.toBeNull();
    expect(fixture.periods!.length).toBeGreaterThan(0);
    const activePeriods = fixture.periods!.filter((p) => p.status === 'active');
    expect(activePeriods).toHaveLength(1);
  });

  it('produces a populated approvals list covering transfer, leave, and uncategorized', () => {
    expect(fixture.approvals).not.toBeNull();
    expect(fixture.approvals!.length).toBeGreaterThanOrEqual(2);
    expect(fixture.approvals!.some((a) => a.category === 'transfer')).toBe(true);
    expect(fixture.approvals!.some((a) => a.category === 'leave')).toBe(true);
    expect(fixture.approvals!.some((a) => a.category === undefined)).toBe(true);
  });

  it('produces a populated, successful role dashboard for the requested role', () => {
    expect(fixture.roleDashboardResult.dashboard).not.toBeNull();
    expect(fixture.roleDashboardResult.source).toBe('gateway');
    expect(fixture.roleDashboardResult.status).toBe(200);
    const dashboard = fixture.roleDashboardResult.dashboard!;
    expect(dashboard.role).toBe(ROLE);
    expect(dashboard.cards.length).toBeGreaterThan(0);
    // Every card must carry a real, non-placeholder value in the filled state.
    for (const card of dashboard.cards) {
      expect(card.value).not.toBe('—');
      expect(card.value.length).toBeGreaterThan(0);
    }
  });

  it('produces a valid, shaped fixture for every dashboard role, not just principal', () => {
    const roles = ['board', 'principal', 'teacher', 'staff', 'parent'] as const;
    for (const role of roles) {
      const roleFixture = buildPreviewFixture('filled', role);
      expect(roleFixture.roleDashboardResult.dashboard).not.toBeNull();
      expect(roleFixture.roleDashboardResult.dashboard!.role).toBe(role);
      expect(roleFixture.roleDashboardResult.dashboard!.cards.length).toBeGreaterThan(0);
    }
  });
});

describe('buildPreviewFixture — no-approvals', () => {
  const filled = buildPreviewFixture('filled', ROLE);
  const noApprovals = buildPreviewFixture('no-approvals', ROLE);

  it('forces approvals to an empty array while every other source still succeeds', () => {
    expect(noApprovals.approvals).toEqual([]);
    expect(noApprovals.institutions).not.toBeNull();
    expect(noApprovals.students).not.toBeNull();
    expect(noApprovals.staff).not.toBeNull();
    expect(noApprovals.periods).not.toBeNull();
    expect(noApprovals.roleDashboardResult.dashboard).not.toBeNull();
  });

  it('differs from filled only in the approvals array', () => {
    const { approvals: _filledApprovals, ...filledRest } = filled;
    const { approvals: _noApprovalsApprovals, ...noApprovalsRest } = noApprovals;
    expect(noApprovalsRest).toEqual(filledRest);
    expect(noApprovals.approvals).not.toEqual(filled.approvals);
  });

  it('is distinguishable from an empty approvals array caused by degraded/error (those are null, not [])', () => {
    const degraded = buildPreviewFixture('degraded', ROLE);
    const error = buildPreviewFixture('error', ROLE);
    expect(noApprovals.approvals).toEqual([]);
    expect(degraded.approvals).not.toBeNull();
    expect(error.approvals).toBeNull();
  });
});

describe('buildPreviewFixture — degraded', () => {
  const fixture = buildPreviewFixture('degraded', ROLE);

  it('forces the three KPI list sources to null (their "Currently unavailable" branch)', () => {
    expect(fixture.institutions).toBeNull();
    expect(fixture.students).toBeNull();
    expect(fixture.staff).toBeNull();
  });

  it('leaves periods, approvals, and the role dashboard successful — a partial outage, not total failure', () => {
    expect(fixture.periods).not.toBeNull();
    expect(fixture.periods!.length).toBeGreaterThan(0);
    expect(fixture.approvals).not.toBeNull();
    expect(fixture.approvals!.length).toBeGreaterThan(0);
    expect(fixture.roleDashboardResult.dashboard).not.toBeNull();
  });

  it('is distinguishable from error (error fails every source, degraded leaves some working)', () => {
    const error = buildPreviewFixture('error', ROLE);
    const degradedNullCount = countNullSources(fixture);
    const errorNullCount = countNullSources(error);
    expect(degradedNullCount).toBeLessThan(errorNullCount);
    expect(fixture.roleDashboardResult.dashboard).not.toBeNull();
    expect(error.roleDashboardResult.dashboard).toBeNull();
  });
});

describe('buildPreviewFixture — error', () => {
  const fixture = buildPreviewFixture('error', ROLE);

  it('forces every one of the six sources to its failure/null branch', () => {
    expect(fixture.institutions).toBeNull();
    expect(fixture.students).toBeNull();
    expect(fixture.staff).toBeNull();
    expect(fixture.periods).toBeNull();
    expect(fixture.approvals).toBeNull();
    expect(fixture.roleDashboardResult.dashboard).toBeNull();
    expect(fixture.roleDashboardResult.source).toBe('scaffold');
    expect(fixture.roleDashboardResult.status).toBe(503);
  });

  it('is distinguishable from no-approvals (no-approvals only empties the approvals array)', () => {
    const noApprovals = buildPreviewFixture('no-approvals', ROLE);
    expect(fixture.approvals).toBeNull();
    expect(noApprovals.approvals).toEqual([]);
    expect(fixture.institutions).toBeNull();
    expect(noApprovals.institutions).not.toBeNull();
  });
});

describe('buildPreviewFixture — general shape guarantees', () => {
  it('returns a fresh object on every call (no shared mutable state between callers)', () => {
    const first = buildPreviewFixture('filled', ROLE);
    const second = buildPreviewFixture('filled', ROLE);
    expect(first).not.toBe(second);
    expect(first.approvals).not.toBe(second.approvals);
    first.approvals!.push({
      id: 'mutated',
      instanceId: 'mutated',
      definitionName: 'mutated',
      subjectType: 'mutated',
      subjectId: 'mutated',
      stepName: 'mutated',
      requestedAt: '2026-01-01T00:00:00.000Z',
      requestedBy: 'mutated',
    });
    expect(second.approvals).toHaveLength(first.approvals!.length - 1);
  });
});

function countNullSources(fixture: DashboardFixtureData): number {
  const values: unknown[] = [
    fixture.institutions,
    fixture.students,
    fixture.staff,
    fixture.periods,
    fixture.approvals,
    fixture.roleDashboardResult.dashboard,
  ];
  return values.filter((v) => v === null).length;
}

describe('createNeverResolvingDashboardFetch', () => {
  it('never settles (neither resolves nor rejects) within a short timeout', async () => {
    const SETTLE_MARKER = Symbol('settled');
    const timeout = new Promise((resolve) => setTimeout(() => resolve(SETTLE_MARKER), 50));

    const result = await Promise.race([createNeverResolvingDashboardFetch<unknown>(), timeout]);

    expect(result).toBe(SETTLE_MARKER);
  });

  it('returns a distinct promise instance on every call', () => {
    const a = createNeverResolvingDashboardFetch<unknown>();
    const b = createNeverResolvingDashboardFetch<unknown>();
    expect(a).not.toBe(b);
  });
});
