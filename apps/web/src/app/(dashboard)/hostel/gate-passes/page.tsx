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
import { listHostelGatePasses, listHostels } from '@/lib/api/hostel';
import { GatePassActions } from '../_components/gate-pass-actions';
import { GatePassRequestForm } from '../_components/gate-pass-form';

export const dynamic = 'force-dynamic';

export default async function HostelGatePassesPage() {
  await requireSession();
  const [hostels, passes] = await Promise.all([listHostels(), listHostelGatePasses()]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Gate passes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Request, approve or reject, then scan out and in.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <GatePassRequestForm hostels={hostels} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passes</CardTitle>
          <CardDescription>
            {passes.length === 0
              ? 'No gate passes yet.'
              : `${passes.length} pass${passes.length === 1 ? '' : 'es'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {passes.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No gate passes yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {passes.map((pass) => (
                <li
                  key={pass.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="hostel-gate-pass-row"
                  data-gate-status={pass.status}
                >
                  <p className="text-sm font-medium text-foreground">
                    {pass.status}
                    {pass.overdueReturn ? ' · overdue return' : ''}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    student {pass.studentId.slice(0, 8)} · out {pass.expectedOutAt.slice(0, 16)} →
                    in {pass.expectedInAt.slice(0, 16)}
                  </p>
                  <GatePassActions id={pass.id} status={pass.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
