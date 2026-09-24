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
import { listHostelGatePasses, listHostels } from '@/lib/api/hostel';
import { GatePassActions } from '../_components/gate-pass-actions';
import { GatePassRequestForm } from '../_components/gate-pass-form';

export const dynamic = 'force-dynamic';

export default async function HostelGatePassesPage() {
  await requireSession();
  const [hostelsResult, passesResult] = await Promise.all([listHostels(), listHostelGatePasses()]);
  // The pass list can fail without the page being useless: a resident can still request a
  // pass. The panel replaces the table, not the screen.
  const failure = passesResult.ok ? null : passesResult;
  const passes = passesResult.ok ? passesResult.items : [];
  const failureCopy = failure ? await getListFailureCopy() : undefined;
  // Supporting lookup for a form control, not the page's subject: an explicit
  // opt-out rather than a hidden collapse. The primary list above reports the
  // real reason when the domain is denied or down.
  const hostels = itemsOrEmpty(hostelsResult);

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
            {failure
              ? 'Passes could not be loaded.'
              : passes.length === 0
                ? 'No gate passes yet.'
                : `${passes.length} pass${passes.length === 1 ? '' : 'es'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {failure ? (
            <ListLoadFailure
              kind={failure.kind}
              status={failure.status}
              requestId={failure.requestId}
              returnTo="/hostel/gate-passes"
              copy={failureCopy}
            />
          ) : passes.length === 0 ? (
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
