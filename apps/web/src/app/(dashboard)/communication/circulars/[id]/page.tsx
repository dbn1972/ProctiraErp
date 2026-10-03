import Link from 'next/link';
import { notFound } from 'next/navigation';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { getCircular } from '@/lib/api/communication';
import { loadStaffLabelMap, loadStudentLabelMap, withPersonLabels } from '@/lib/load-entity-labels';
import { resolveEntityLabel } from '@/lib/entity-label';

import { CircularAckPanel } from '../../_components/circular-ack-panel';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function CircularDetailPage(props: PageProps) {
  await requireSession();
  const { id } = await props.params;
  const [circular, studentLabels, staffLabels] = await Promise.all([
    getCircular(id),
    loadStudentLabelMap(),
    loadStaffLabelMap(),
  ]);
  if (!circular) notFound();
  // PRC-M083: recipients beyond the first directory page are looked up by id.
  const recipientLabels = await withPersonLabels(
    new Map([...studentLabels, ...staffLabels]),
    circular.acks.filter((ack) => !ack.recipientLabel).map((ack) => ack.recipientId),
  );

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            {circular.title}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {circular.audienceType} · {circular.channels.join(', ') || 'no channels'}
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/communication/circulars">All circulars</Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Body</CardTitle>
          <CardDescription>
            {circular.requiresAck ? 'Acknowledgement required' : 'No ack required'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="whitespace-pre-wrap text-sm">{circular.body}</p>
          <CircularAckPanel
            circularId={circular.id}
            status={circular.status}
            ackRate={circular.ackRate}
          />
          <ul className="divide-y divide-border" role="list">
            {circular.acks.map((ack) => (
              <li key={ack.id} className="py-2 text-sm" data-testid="circular-ack-row">
                {ack.recipientLabel ||
                  resolveEntityLabel(ack.recipientId, recipientLabels, 'Recipient')}{' '}
                · {ack.acknowledgedAt ? `acked ${ack.acknowledgedAt}` : 'pending'}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
