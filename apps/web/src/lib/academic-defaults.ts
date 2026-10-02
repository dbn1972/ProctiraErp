/**
 * PRC-L041 — data-driven defaults for academic pickers (no seed codes).
 */
import type { AcademicPeriod } from '@/lib/institutions/types';

type PeriodLike = Pick<AcademicPeriod, 'id' | 'status' | 'startDate' | 'endDate' | 'parentId'>;

function isoDay(value: string): string {
  return value.slice(0, 10);
}

function contains(period: PeriodLike, today: string): boolean {
  return isoDay(period.startDate) <= today && today <= isoDay(period.endDate);
}

/**
 * Active academic periods: `status === 'active'` and spanning `today`
 * (YYYY-MM-DD). Falls back to any `active` period when none spans today.
 */
export function activeAcademicPeriods<T extends PeriodLike>(periods: T[], today: string): T[] {
  const active = periods.filter((period) => period.status === 'active');
  const current = active.filter((period) => contains(period, today));
  return current.length > 0 ? current : active;
}

/** Preferred period: the innermost current active period, else the first period. */
export function pickActiveAcademicPeriod<T extends PeriodLike>(
  periods: T[],
  today: string,
): T | undefined {
  const active = activeAcademicPeriods(periods, today);
  const parentIds = new Set(active.map((period) => period.parentId).filter(Boolean));
  // A term inside the current year is more specific than the year itself.
  return active.find((period) => !parentIds.has(period.id)) ?? active[0] ?? periods[0];
}

/** First section in an active academic period, else the first section. */
export function pickDefaultSection<T extends { academicPeriodId: string; status?: string }>(
  sections: T[],
  activePeriodIds: ReadonlySet<string>,
): T | undefined {
  const usable = sections.filter((section) => section.status !== 'archived');
  return (
    usable.find((section) => activePeriodIds.has(section.academicPeriodId)) ??
    usable[0] ??
    sections[0]
  );
}

/**
 * Board for grading actions: the board of the default scale, or the only board
 * configured. With several boards and no default, return '' so the user must
 * choose explicitly instead of silently using the first scale.
 */
export function pickGradingBoardId(scales: Array<{ boardId: string; isDefault: boolean }>): string {
  const defaultScale = scales.find((scale) => scale.isDefault);
  if (defaultScale) return defaultScale.boardId;
  const boards = new Set(scales.map((scale) => scale.boardId));
  return boards.size === 1 ? [...boards][0]! : '';
}
