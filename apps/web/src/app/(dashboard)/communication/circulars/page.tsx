import Link from 'next/link';
import { Plus } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listCirculars } from '@/lib/api/communication';

export const dynamic = 'force-dynamic';

export default async function CommunicationCircularsPage() {
  await requireSession();
  const circulars = await listCirculars();

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Circulars</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            School circulars with optional acknowledgement. WhatsApp delivery is sandbox-only.
          </p>
        </div>
        <Button asChild>
          <Link href="/communication/circulars/new">
            <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
            New circular
          </Link>
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Circulars</CardTitle>
          <CardDescription>
            {circulars.length === 0 ? 'No circulars yet.' : `${circulars.length} circular(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {circulars.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Create a circular to notify staff or families.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {circulars.map((row) => (
                <li
                  key={row.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="communication-circular-row"
                >
                  <Link
                    href={`/communication/circulars/${row.id}`}
                    className="inline-flex min-h-11 items-center text-sm font-medium hover:underline"
                  >
                    {row.title}
                  </Link>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.status} · {row.audienceType} · ack {Math.round(row.ackRate * 100)}%
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
