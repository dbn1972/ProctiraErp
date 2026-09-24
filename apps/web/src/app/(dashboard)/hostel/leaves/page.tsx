/**
 * Hostel leaves (Server Component).
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
import { ListLoadFailure } from '@/components/route-state/list-load-failure';
import { getListFailureCopy } from '@/components/route-state/list-failure-copy';
import { itemsOrEmpty } from '@/lib/api/list-result';
import { listHostelLeaves, listHostels } from '@/lib/api/hostel';
import { LeaveDecisionButtons } from '../_components/leave-decision-buttons';
import { NewLeaveForm } from '../_components/new-leave-form';

export const dynamic = 'force-dynamic';

export default async function HostelLeavesPage() {
  await requireSession();
  const [leavesResult, hostelsResult] = await Promise.all([listHostelLeaves(), listHostels()]);
  if (!leavesResult.ok) {
    return (
      <div className="space-y-6 p-6">
        <ListLoadFailure
          kind={leavesResult.kind}
          status={leavesResult.status}
          requestId={leavesResult.requestId}
          returnTo="/hostel/leaves"
          copy={await getListFailureCopy()}
        />
      </div>
    );
  }
  const leaves = leavesResult.items;
  // Supporting lookup for a form control, not the page's subject: an explicit
  // opt-out rather than a hidden collapse. The primary list above reports the
  // real reason when the domain is denied or down.
  const hostels = itemsOrEmpty(hostelsResult);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Leaves</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Review leave requests and approve or deny them.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <NewLeaveForm hostels={hostels} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Leave requests</CardTitle>
          <CardDescription>
            {leaves.length === 0
              ? 'No leaves yet.'
              : `${leaves.length} leave${leaves.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {leaves.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No leaves yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {leaves.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">
                    Student {row.studentId.slice(0, 8)} · {row.status}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.startDate} → {row.endDate}
                    {row.reason ? ` · ${row.reason}` : ''}
                  </p>
                  <LeaveDecisionButtons leaveId={row.id} status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
