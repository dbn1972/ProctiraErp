/**
 * Parent portal home (Server Component).
 */
import Link from 'next/link';
import { CreditCard, MessageSquare, ShieldCheck } from 'lucide-react';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';
import { listChildren } from '@/lib/api/parent-portal';

export const dynamic = 'force-dynamic';

export default async function ParentHomePage() {
  await requireSession();
  const children = await listChildren();

  return (
    <div className="space-y-6" data-testid="parent-home">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Welcome</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stay connected with your school — attendance, grades, timetable, homework, messages,
          permission requests, and fees for your children.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your children</CardTitle>
          <CardDescription>
            {children.length === 0
              ? 'Link a child to get started.'
              : `${children.length} linked child${children.length === 1 ? '' : 'ren'}.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {children.length === 0 ? (
            <p className="text-sm text-muted-foreground" role="status">
              No linked children yet. Contact your school administrator to link your account.
            </p>
          ) : (
            <ul className="divide-y divide-border" role="list">
              {children.map((child) => (
                <li key={child.id} className="py-3 first:pt-0 last:pb-0">
                  <p className="text-sm font-medium text-foreground">
                    Student {child.studentId.slice(0, 8)}…
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {child.relationship} · {child.status}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
              Messages
            </CardTitle>
            <CardDescription>Conversations with school staff</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild className="min-h-12">
              <Link href="/parent/messages">Open messages</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Consents
            </CardTitle>
            <CardDescription>Approve or deny permission requests</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/consents">Open consents</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CreditCard className="h-4 w-4" aria-hidden="true" />
              Fees
            </CardTitle>
            <CardDescription>Invoices and online payments</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/fees">Open fees</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Attendance</CardTitle>
            <CardDescription>Presence and absences</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/attendance">Open attendance</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Grades</CardTitle>
            <CardDescription>Published marks and report cards</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/grades">Open grades</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Timetable</CardTitle>
            <CardDescription>Class meetings</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/timetable">Open timetable</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Homework</CardTitle>
            <CardDescription>Assignments that are due</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/homework">Open homework</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Calendar</CardTitle>
            <CardDescription>Holidays and school events</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/calendar">Open calendar</Link>
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Notices</CardTitle>
            <CardDescription>School announcements</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline" className="min-h-12">
              <Link href="/parent/notices">Open notices</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
