import Link from 'next/link';
import { Bell, BookOpen, Brain, CalendarDays, ClipboardList, Clock, GraduationCap } from 'lucide-react';

import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@proctira/ui/components';
import { requireSession } from '@/lib/auth/server';

export const dynamic = 'force-dynamic';

const LINKS = [
  { href: '/student/attendance', label: 'Attendance', Icon: ClipboardList, hint: 'Your recent days' },
  { href: '/student/grades', label: 'Grades', Icon: GraduationCap, hint: 'Published marks' },
  { href: '/student/timetable', label: 'Timetable', Icon: Clock, hint: 'Class meetings' },
  { href: '/student/homework', label: 'Homework', Icon: BookOpen, hint: 'Work that is due' },
  { href: '/student/calendar', label: 'Calendar', Icon: CalendarDays, hint: 'Holidays and events' },
  { href: '/student/notices', label: 'Notices', Icon: Bell, hint: 'School announcements' },
  { href: '/student/pal', label: 'PAL plan', Icon: Brain, hint: 'Today’s practice plan' },
] as const;

export default async function StudentHomePage() {
  await requireSession();

  return (
    <div className="space-y-6" data-testid="student-home">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Attendance, grades, timetable, homework, and your Spiral PAL plan — only for you.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {LINKS.map((item) => {
          const Icon = item.Icon;
          return (
            <Card key={item.href}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </CardTitle>
                <CardDescription>{item.hint}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline" className="min-h-12">
                  <Link href={item.href}>Open {item.label.toLowerCase()}</Link>
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
