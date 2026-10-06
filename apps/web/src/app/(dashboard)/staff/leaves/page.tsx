/**
 * Staff leave queue (Server Component).
 */
import Link from 'next/link';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listStaffLeaves } from '@/lib/api/staff';
import { resolveEntityLabel } from '@/lib/entity-label';
import { loadStaffOptions } from '@/lib/load-entity-labels';
import { NewStaffLeaveForm } from './_components/new-staff-leave-form';
import {
  StaffLeaveDecisionButtons,
  StaffLeaveStatusBadge,
} from './_components/leave-decision-buttons';
import { inclusiveLeaveDays } from './_components/leave-days';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function StaffLeavesPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireSession();
  // PRC-M117: the staff profile links here with ?staffId= to preselect the requester.
  const sp = (await props.searchParams) ?? {};
  const defaultStaffId =
    typeof sp.staffId === 'string' && UUID_RE.test(sp.staffId) ? sp.staffId : '';
  const [leaves, staffOptions] = await Promise.all([listStaffLeaves(), loadStaffOptions()]);
  const staffLabels = new Map(staffOptions.map((option) => [option.id, option.label]));

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Staff leave</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Request and approve staff leave. Payroll and balances are deferred.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/staff">Back to staff</Link>
        </Button>
      </div>

      <NewStaffLeaveForm staffOptions={staffOptions} defaultStaffId={defaultStaffId} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leave requests</CardTitle>
          <CardDescription>
            {leaves.length === 0 ? 'No leave requests yet.' : `${leaves.length} request(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Submit a leave request above. Approvers can approve or reject pending items.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {leaves.map((leave) => {
                const staffName = resolveEntityLabel(leave.staffId, staffLabels, 'Staff');
                const days = inclusiveLeaveDays(leave.startDate, leave.endDate);
                return (
                  <li
                    key={leave.id}
                    className="py-3 first:pt-0 last:pb-0"
                    data-testid="staff-leave-row"
                  >
                    <p className="text-sm font-medium text-foreground">
                      {leave.leaveType} · {leave.startDate} → {leave.endDate}
                      {days !== null ? ` · ${days} day${days === 1 ? '' : 's'}` : ''}
                    </p>
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{staffName}</span>
                      {leave.status === 'pending' ? (
                        <StaffLeaveStatusBadge status={leave.status} />
                      ) : null}
                      {leave.reason ? <span>· {leave.reason}</span> : null}
                    </p>
                    <StaffLeaveDecisionButtons
                      leaveId={leave.id}
                      status={leave.status}
                      staffName={staffName}
                      leaveType={leave.leaveType}
                      startDate={leave.startDate}
                      endDate={leave.endDate}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
