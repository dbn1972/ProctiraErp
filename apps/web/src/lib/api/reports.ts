/**
 * Report service client — re-exports the G-909 catalogue client.
 */
export {
  createReportSchedule,
  deleteReportSchedule,
  generateReport,
  getReportTemplate,
  getRoleDashboard,
  listReportRuns,
  listReportSchedules,
  listReportTemplates,
  runDueReportSchedules,
  runReportSchedule,
  setReportScheduleEnabled,
  type CreateReportScheduleInput,
  type DashboardRole,
  type GenerateReportInput,
  type ReportFilter,
  type ReportFormat,
  type ReportRun,
  type ReportSchedule,
  type ReportTemplate,
  type RoleDashboard,
  type ScaffoldDataSource,
} from '@/lib/reports/api';
