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
import { NewStaffLeaveForm } from './_components/new-staff-leave-form';
import { StaffLeaveDecisionButtons } from './_components/leave-decision-buttons';

export const dynamic = 'force-dynamic';

export default async function StaffLeavesPage() {
  await requireSession();
  const leaves = await listStaffLeaves();

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

      <NewStaffLeaveForm />

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
              {leaves.map((leave) => (
                <li
                  key={leave.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="staff-leave-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    {leave.leaveType} · {leave.startDate} → {leave.endDate}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Staff {leave.staffId.slice(0, 8)}… · {leave.status}
                    {leave.reason ? ` · ${leave.reason}` : ''}
                  </p>
                  <StaffLeaveDecisionButtons leaveId={leave.id} status={leave.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
