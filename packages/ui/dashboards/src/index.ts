/**
 * @proctira/ui-dashboards — reusable dashboard widget library.
 *
 * Implements Design §G's reusable widget table for the ProctiraERP Unified
 * Platform multi-level dashboards (Country, State, Board Admin, Board
 * Comparison, Cross-Board Transfer, School/Principal, Teacher, Parent /
 * Student). Each widget:
 *
 *   - Consumes design tokens defined in
 *     `packages/ui/styles/theme.css` (`--card`, `--foreground`,
 *     `--muted-foreground`, `--border`, `--primary`, `--success`,
 *     `--warning`, `--destructive`, `--chart-1` … `--chart-5`) so the
 *     widget repaints automatically in light + dark mode.
 *   - Supports Property F-8: when `loading` is `true`, a skeleton
 *     matching the loaded layout's grid renders so hydration produces
 *     ≤ 0.1 CLS.
 *   - Announces async loads through the global `<LiveRegion>` mounted
 *     in `<AppShell>` (Design L). Polite messages on success;
 *     assertive messages on error or when the payload contains
 *     high-priority items.
 *
 * Validates Task 52.5.
 */

export { KpiCard, type KpiCardProps, type KpiTrend, type KpiTrendDirection } from './KpiCard';
export { KpiCardWithTrend, type KpiCardWithTrendProps } from './KpiCardWithTrend';
export { DashboardSection, type DashboardSectionProps } from './DashboardSection';
export { DataTableCard, type DataTableCardColumn, type DataTableCardProps } from './DataTableCard';
export { MapDrillDown, type MapDrillDownProps, type MapRegion } from './MapDrillDown';
export { RadarComparison, type RadarComparisonProps, type RadarSeries } from './RadarComparison';
export {
  TimelineSchedule,
  type TimelineItem,
  type TimelineItemStatus,
  type TimelineScheduleProps,
} from './TimelineSchedule';
export { TaskChecklist, type ChecklistTask, type TaskChecklistProps } from './TaskChecklist';
export {
  ActionItemList,
  type ActionItem,
  type ActionItemListProps,
  type ActionItemPriority,
} from './ActionItemList';
export { WelcomeBanner, type WelcomeBannerProps, greetingForHour } from './WelcomeBanner';
