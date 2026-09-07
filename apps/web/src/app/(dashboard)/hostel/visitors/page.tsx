/**
 * Hostel visitors (Server Component).
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
import { listHostelVisitors, listHostels } from '@/lib/api/hostel';
import { NewVisitorForm } from '../_components/new-visitor-form';
import { VisitorStatusButtons } from '../_components/visitor-status-buttons';

export const dynamic = 'force-dynamic';

export default async function HostelVisitorsPage() {
  await requireSession();
  const [visitors, hostels] = await Promise.all([listHostelVisitors(), listHostels()]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Visitors</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Visitor register via GET/POST `/hostel/visitors` · status via
            `/hostel/visitors/:id/status`.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/hostel">Back to hostel</Link>
        </Button>
      </div>

      <NewVisitorForm hostels={hostels} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Visitor log</CardTitle>
          <CardDescription>
            {visitors.length === 0
              ? 'No visitors yet.'
              : `${visitors.length} visitor${visitors.length === 1 ? '' : 's'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {visitors.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No visitors yet.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {visitors.map((row) => (
                <li key={row.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">
                    {row.visitorName} · {row.status}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {row.visitDate} · student {row.studentId.slice(0, 8)}
                  </p>
                  <VisitorStatusButtons visitorId={row.id} status={row.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
