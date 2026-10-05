/**
 * Shared utilization-report assembly (PRC-M352).
 *
 * Repositories aggregate rows per group (and per currency for paid
 * disbursements); this module turns those aggregates into the report shape so
 * the PG and in-memory implementations stay in parity.
 */
import { majorUnitsNumberFromCents } from '@proctira/common';

import type { UtilizationReportData, UtilizationReportFilter } from './scholarship-repository.js';

export type UtilizationGroupBy = NonNullable<UtilizationReportFilter['groupBy']>;

/** Whitelisted SQL group expressions (alias `a` = scholarship_applications). */
export const UTILIZATION_GROUP_EXPR: Record<UtilizationGroupBy, string> = {
  program: 'a.program_id::text',
  area: "COALESCE(a.area_id::text, 'unknown')",
  gender: "COALESCE(a.gender, 'unknown')",
  institution: 'a.institution_id::text',
};

export interface UtilizationAppAggregate {
  groupValue: string;
  applicationCount: number;
  approvedCount: number;
}

export interface UtilizationDisbursementAggregate {
  groupValue: string;
  currency: string;
  disbursedCount: number;
  amountCents: number;
}

/** True when an ISO date (YYYY-MM-DD) falls in the optional inclusive range. */
export function inUtilizationRange(
  date: string | null | undefined,
  filter: Pick<UtilizationReportFilter, 'startDate' | 'endDate'>,
): boolean {
  if (!filter.startDate && !filter.endDate) return true;
  if (!date) return false;
  const d = date.slice(0, 10);
  if (filter.startDate && d < filter.startDate) return false;
  if (filter.endDate && d > filter.endDate) return false;
  return true;
}

export function buildUtilizationReport(
  groupBy: UtilizationGroupBy,
  totalPrograms: number,
  apps: UtilizationAppAggregate[],
  disbursements: UtilizationDisbursementAggregate[],
): UtilizationReportData {
  const groups = new Map<
    string,
    { applicationCount: number; approvedCount: number; disbursedAmountCents: number }
  >();
  const ensure = (key: string) => {
    let g = groups.get(key);
    if (!g) {
      g = { applicationCount: 0, approvedCount: 0, disbursedAmountCents: 0 };
      groups.set(key, g);
    }
    return g;
  };
  let totalApplications = 0;
  let totalApproved = 0;
  for (const a of apps) {
    const g = ensure(a.groupValue);
    g.applicationCount += a.applicationCount;
    g.approvedCount += a.approvedCount;
    totalApplications += a.applicationCount;
    totalApproved += a.approvedCount;
  }
  const byCurrency = new Map<string, number>();
  let totalDisbursed = 0;
  let totalAmountCents = 0;
  for (const d of disbursements) {
    ensure(d.groupValue).disbursedAmountCents += d.amountCents;
    byCurrency.set(d.currency, (byCurrency.get(d.currency) ?? 0) + d.amountCents);
    totalDisbursed += d.disbursedCount;
    totalAmountCents += d.amountCents;
  }
  const currencyTotals = Array.from(byCurrency.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, cents]) => ({
      currency,
      totalAmountCents: cents,
      totalAmount: majorUnitsNumberFromCents(cents),
    }));
  // Never present a mixed-currency sum as a single currency.
  const currency =
    currencyTotals.length === 1
      ? currencyTotals[0]!.currency
      : currencyTotals.length === 0
        ? 'USD'
        : 'MIXED';
  return {
    totalPrograms,
    totalApplications,
    totalApproved,
    totalDisbursed,
    totalAmount: majorUnitsNumberFromCents(totalAmountCents),
    totalAmountCents,
    currency,
    currencyTotals,
    breakdown: Array.from(groups.entries()).map(([key, data]) => ({
      groupKey: groupBy,
      groupValue: key,
      applicationCount: data.applicationCount,
      approvedCount: data.approvedCount,
      disbursedAmountCents: data.disbursedAmountCents,
      disbursedAmount: majorUnitsNumberFromCents(data.disbursedAmountCents),
      utilizationRate:
        data.applicationCount > 0
          ? Math.round((data.approvedCount / data.applicationCount) * 10000) / 100
          : 0,
    })),
  };
}
