/**
 * PRC-L242 — map the coverage summary to panel rows without fabricating
 * taught dates. Real timestamps are used when the API supplies them.
 */
import type { CoverageSummary } from '@/lib/api/curriculum';

export interface CoverageRow {
  unitId: string;
  /** ISO timestamp, or null when the API did not report when the unit was taught. */
  taughtAt: string | null;
}

export function coverageRowsFrom(
  coverage: Pick<CoverageSummary, 'taughtUnitIds' | 'taughtUnits'> | null | undefined,
): CoverageRow[] {
  if (!coverage) return [];
  const dates = new Map(
    (coverage.taughtUnits ?? [])
      .filter((u) => !Number.isNaN(Date.parse(u.taughtAt)))
      .map((u) => [u.unitId, u.taughtAt] as const),
  );
  return coverage.taughtUnitIds.map((unitId) => ({ unitId, taughtAt: dates.get(unitId) ?? null }));
}
