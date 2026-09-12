'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Bell,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Clock,
  CreditCard,
  FileText,
  GraduationCap,
  Home,
  Layers,
  Library,
  MessageSquare,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useBrand } from '@/providers/BrandConfigProvider';

interface ParentNavItem {
  key: string;
  label: string;
  href: string;
  Icon: LucideIcon;
  match: (pathname: string) => boolean;
}

const PARENT_NAV: readonly ParentNavItem[] = [
  {
    key: 'home',
    label: 'Home',
    href: '/parent',
    Icon: Home,
    match: (pathname) => pathname === '/parent',
  },
  {
    key: 'attendance',
    label: 'Attendance',
    href: '/parent/attendance',
    Icon: ClipboardList,
    match: (pathname) => pathname.startsWith('/parent/attendance'),
  },
  {
    key: 'grades',
    label: 'Grades',
    href: '/parent/grades',
    Icon: GraduationCap,
    match: (pathname) => pathname.startsWith('/parent/grades'),
  },
  {
    key: 'timetable',
    label: 'Timetable',
    href: '/parent/timetable',
    Icon: Clock,
    match: (pathname) => pathname.startsWith('/parent/timetable'),
  },
  {
    key: 'homework',
    label: 'Homework',
    href: '/parent/homework',
    Icon: BookOpen,
    match: (pathname) => pathname.startsWith('/parent/homework'),
  },
  {
    key: 'lms',
    label: 'LMS',
    href: '/parent/lms',
    Icon: Layers,
    match: (pathname) => pathname.startsWith('/parent/lms'),
  },
  {
    key: 'report-cards',
    label: 'Report cards',
    href: '/parent/report-cards',
    Icon: FileText,
    match: (pathname) => pathname.startsWith('/parent/report-cards'),
  },
  {
    key: 'pal',
    label: 'PAL',
    href: '/parent/pal',
    Icon: Sparkles,
    match: (pathname) => pathname.startsWith('/parent/pal'),
  },
  {
    key: 'library',
    label: 'Library',
    href: '/parent/library',
    Icon: Library,
    match: (pathname) => pathname.startsWith('/parent/library'),
  },
  {
    key: 'calendar',
    label: 'Calendar',
    href: '/parent/calendar',
    Icon: CalendarDays,
    match: (pathname) => pathname.startsWith('/parent/calendar'),
  },
  {
    key: 'notices',
    label: 'Notices',
    href: '/parent/notices',
    Icon: Bell,
    match: (pathname) => pathname.startsWith('/parent/notices'),
  },
  {
    key: 'messages',
    label: 'Messages',
    href: '/parent/messages',
    Icon: MessageSquare,
    match: (pathname) => pathname.startsWith('/parent/messages'),
  },
  {
    key: 'consents',
    label: 'Consents',
    href: '/parent/consents',
    Icon: ShieldCheck,
    match: (pathname) => pathname.startsWith('/parent/consents'),
  },
  {
    key: 'fees',
    label: 'Fees',
    href: '/parent/fees',
    Icon: CreditCard,
    match: (pathname) => pathname.startsWith('/parent/fees'),
  },
  {
    key: 'offers',
    label: 'Offers',
    href: '/parent/offers',
    Icon: FileText,
    match: (pathname) => pathname.startsWith('/parent/offers'),
  },
];

export interface ParentPortalShellProps {
  children: React.ReactNode;
}

export function ParentPortalShell({ children }: ParentPortalShellProps) {
  const pathname = usePathname();
  const { name: brandName } = useBrand();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground" data-shell="parent">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="mx-auto flex h-14 min-h-14 max-w-5xl items-center justify-between gap-4 px-4 md:px-6">
          <Link
            href="/parent"
            className="inline-flex min-h-12 flex-col justify-center text-foreground"
          >
            <span className="text-base font-semibold tracking-tight">Family portal</span>
            <span className="text-[11px] font-normal text-muted-foreground">{brandName}</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1">
        <nav
          className="hidden w-52 shrink-0 border-e border-border px-3 py-6 md:block"
          aria-label="Parent portal navigation"
        >
          <ul className="space-y-1" role="list">
            {PARENT_NAV.map((item) => {
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
        aria-label="Parent portal navigation"
      >
        <ul className="mx-auto flex max-w-5xl overflow-x-auto" role="list">
          {PARENT_NAV.map((item) => {
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
