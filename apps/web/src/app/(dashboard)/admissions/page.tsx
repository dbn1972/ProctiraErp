/**
 * Admissions CRM hub (Server Component).
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
import { listApplications, listInterviewSlots, listWaitlist } from '@/lib/api/admissions';
import { AdmissionsNav } from './_components/admissions-nav';
import { StatusForm } from './_components/status-form';
import { NewInterviewSlotForm } from './_components/new-interview-slot-form';
import { BookInterviewForm } from './_components/book-interview-form';

export const dynamic = 'force-dynamic';

export default async function AdmissionsPage() {
  await requireSession();
  const [applications, waitlist, slots] = await Promise.all([
    listApplications(),
    listWaitlist(),
    listInterviewSlots(),
  ]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Admissions</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Staff CRM for enquiries, applications, merit lists, offers, waitlist, and interview
            slots.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/">Dashboard</Link>
        </Button>
      </div>

      <AdmissionsNav current="/admissions" />

      <div className="grid gap-6 lg:grid-cols-2">
        <StatusForm applications={applications} />
        <NewInterviewSlotForm />
      </div>
      <BookInterviewForm applications={applications} slots={slots} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Applications</CardTitle>
          <CardDescription>
            {applications.length === 0
              ? 'No applications in this gateway process yet.'
              : `${applications.length} application(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Submit via public registration API or seed data to populate the inbox.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {applications.map((app) => (
                <li
                  key={app.id}
                  className="py-3 first:pt-0 last:pb-0"
                  data-testid="application-row"
                >
                  <p className="text-sm font-medium text-foreground">
                    <Link className="underline" href={`/admissions/${app.id}`}>
                      {app.firstName} {app.lastName} · {app.trackingNumber}
                    </Link>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {app.status} · {app.institutionName}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Waitlist</CardTitle>
          <CardDescription>
            {waitlist.length === 0 ? 'Empty.' : `${waitlist.length} entr(y/ies).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {waitlist.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Set an application status to waitlisted to enqueue.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {waitlist.map((entry) => (
                <li key={entry.id} className="py-3 first:pt-0 last:pb-0" data-testid="waitlist-row">
                  <p className="text-sm font-medium text-foreground">
                    Position {entry.position} · app {entry.applicationId.slice(0, 8)}…
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Interview slots</CardTitle>
          <CardDescription>
            {slots.length === 0 ? 'None yet.' : `${slots.length} slot(s).`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {slots.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              Create a slot above to schedule interviews.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {slots.map((slot) => (
                <li key={slot.id} className="py-3 first:pt-0 last:pb-0" data-testid="slot-row">
                  <p className="text-sm font-medium text-foreground">
                    {new Date(slot.startsAt).toLocaleString()} →{' '}
                    {new Date(slot.endsAt).toLocaleTimeString()}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    capacity {slot.capacity} · {slot.status}
                    {slot.location ? ` · ${slot.location}` : ''}
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
