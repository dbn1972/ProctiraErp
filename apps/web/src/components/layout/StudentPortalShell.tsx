'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookOpen,
  Brain,
  CalendarDays,
  ClipboardList,
  Clock,
  GraduationCap,
  Home,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useBrand } from '@/providers/BrandConfigProvider';

interface StudentNavItem {
  key: string;
  label: string;
  href: string;
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const STUDENT_NAV: readonly StudentNavItem[] = [
  {
    key: 'home',
    label: 'Today',
    href: '/student',
    Icon: Home,
    match: (pathname) => pathname === '/student',
  },
  {
    key: 'attendance',
    label: 'Attendance',
    href: '/student/attendance',
    Icon: ClipboardList,
    match: (pathname) => pathname.startsWith('/student/attendance'),
  },
  {
    key: 'grades',
    label: 'Grades',
    href: '/student/grades',
    Icon: GraduationCap,
    match: (pathname) => pathname.startsWith('/student/grades'),
  },
  {
    key: 'timetable',
    label: 'Timetable',
    href: '/student/timetable',
    Icon: Clock,
    match: (pathname) => pathname.startsWith('/student/timetable'),
  },
  {
    key: 'homework',
    label: 'Homework',
    href: '/student/homework',
    Icon: BookOpen,
    match: (pathname) => pathname.startsWith('/student/homework'),
  },
  {
    key: 'calendar',
    label: 'Calendar',
    href: '/student/calendar',
    Icon: CalendarDays,
    match: (pathname) => pathname.startsWith('/student/calendar'),
  },
  {
    key: 'notices',
    label: 'Notices',
    href: '/student/notices',
    Icon: Bell,
    match: (pathname) => pathname.startsWith('/student/notices'),
  },
  {
    key: 'pal',
    label: 'PAL plan',
    href: '/student/pal',
    Icon: Brain,
    match: (pathname) => pathname.startsWith('/student/pal'),
  },
];

export interface StudentPortalShellProps {
  children: React.ReactNode;
}

export function StudentPortalShell({ children }: StudentPortalShellProps) {
  const pathname = usePathname();
  const { name: brandName } = useBrand();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" data-shell="student">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 min-h-14 max-w-5xl items-center justify-between gap-4 px-4 md:px-6">
          <Link
            href="/student"
            className="inline-flex min-h-12 flex-col justify-center text-foreground"
          >
            <span className="text-base font-semibold tracking-tight">Student portal</span>
            <span className="text-[11px] font-normal text-muted-foreground">{brandName}</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1">
        <nav
          className="hidden w-52 shrink-0 border-e border-border px-3 py-6 md:block"
          aria-label="Student portal navigation"
        >
          <ul className="space-y-1" role="list">
            {STUDENT_NAV.map((item) => {
              const active = item.match(pathname);
              const Icon = item.Icon;
              return (
                <li key={item.key}>
                  <Link
                    href={item.href}
                    className={cn(
                      'flex min-h-12 items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                    )}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main className="flex-1 px-4 py-6 pb-24 md:px-6 md:pb-6">{children}</main>
      </div>

      <nav
        className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:hidden"
        aria-label="Student portal navigation"
      >
        <ul className="mx-auto flex max-w-5xl overflow-x-auto" role="list">
          {STUDENT_NAV.map((item) => {
            const active = item.match(pathname);
            const Icon = item.Icon;
            return (
              <li key={item.key} className="min-w-16 flex-1">
                <Link
                  href={item.href}
                  className={cn(
                    'flex min-h-12 flex-col items-center justify-center gap-0.5 px-1 py-2 text-[11px] font-medium',
                    active ? 'text-primary' : 'text-muted-foreground',
                  )}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon className="h-5 w-5" aria-hidden="true" />
                  <span>{item.label}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
