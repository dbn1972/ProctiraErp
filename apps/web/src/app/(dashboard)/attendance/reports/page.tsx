/**
 * /attendance/reports — Attendance analytics (Server Component).
 *
 * Layout per redesign/web/attendance-reports.html:
 *  - Page head with Export CSV + Mark attendance CTAs
 *  - Scope / date pickers + Run report
 *  - KPI cards + status breakdown from percentage API result
 *
 * Export CSV is client-side from loaded report rows (no export API).
 */
import { listInstitutions } from '@/lib/api/institutions';

import { AttendanceReportsClient } from '../_components/attendance-reports-client';

export const dynamic = 'force-dynamic';

export default async function AttendanceReportsPage() {
  const institutions = await listInstitutions({ pageSize: 200 });

  return (
    <AttendanceReportsClient
      institutions={institutions.map((i) => ({
        id: i.id,
        name: i.name,
      }))}
    />
  );
}
