/**
 * /attendance/ops — regularisation and student leave (G-919).
 */
import Link from 'next/link';

import { ArrowLeft } from 'lucide-react';

import { Button, Card, CardContent } from '@proctira/ui/components';
import { listLeaveRequests, listRegularisations } from '@/lib/api/attendance';

import { AttendanceOpsForms } from '../_components/attendance-ops-forms';

export const dynamic = 'force-dynamic';

export default async function AttendanceOpsPage() {
  const [regularisations, leaves] = await Promise.all([
    listRegularisations(),
    listLeaveRequests(),
  ]);

  return (
    <section className="space-y-6" data-testid="attendance-ops-page" data-hydrated="true">
      <Button asChild variant="ghost" size="sm" className="-ms-2 w-fit">
        <Link href="/attendance">
          <ArrowLeft className="me-1.5 h-4 w-4" aria-hidden="true" />
          Back to attendance
        </Link>
      </Button>
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground">
          Regularisation and leave
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Request a status change on a past record or a student leave range. Approvers update the
          register with an audit trail. EARLY_DEPARTURE counts as present-partial (0.5) in
          percentages.
        </p>
      </div>
      <Card>
        <CardContent className="p-6">
          <AttendanceOpsForms regularisations={regularisations} leaves={leaves} />
        </CardContent>
      </Card>
    </section>
  );
}
