'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';

/** Navigation items for the sidebar */
export const navItems = [
  { key: 'dashboard', href: '/', icon: 'HomeIcon' },
  { key: 'institutions', href: '/institutions', icon: 'BuildingIcon' },
  { key: 'academicPeriods', href: '/academic-periods', icon: 'CalendarIcon' },
  { key: 'students', href: '/students', icon: 'UsersIcon' },
  { key: 'admissions', href: '/admissions', icon: 'ClipboardIcon' },
  { key: 'staff', href: '/staff', icon: 'BriefcaseIcon' },
  { key: 'assessments', href: '/assessments', icon: 'ClipboardIcon' },
  { key: 'attendance', href: '/attendance', icon: 'CheckCircleIcon' },
  { key: 'examinations', href: '/examinations', icon: 'DocumentIcon' },
  { key: 'scholarships', href: '/scholarships', icon: 'AcademicCapIcon' },
  { key: 'health', href: '/health', icon: 'HeartIcon' },
  { key: 'parentPortal', href: '/parent', icon: 'UserGroupIcon' },
  { key: 'notifications', href: '/notifications', icon: 'BellIcon' },
  { key: 'transport', href: '/transport', icon: 'BusIcon' },
  { key: 'communication', href: '/communication', icon: 'MegaphoneIcon' },
  { key: 'hostel', href: '/hostel', icon: 'BedIcon' },
  { key: 'library', href: '/library', icon: 'BookOpenIcon' },
  { key: 'workflows', href: '/workflows', icon: 'ArrowPathIcon' },
  { key: 'dataWarehouse', href: '/data-warehouse', icon: 'DatabaseIcon' },
  { key: 'reports', href: '/reports', icon: 'ChartBarIcon' },
  { key: 'admin', href: '/admin', icon: 'CogIcon' },
] as const;

type IconName = (typeof navItems)[number]['icon'];

/**
 * Sidebar navigation component (Design System v2.0).
 * Deep-navy chrome with per-module stroke icons and an active rail.
 * Supports RTL layout automatically via CSS dir attribute.
 */
export function Sidebar() {
  const t = useTranslations('nav');
  const pathname = usePathname();

  return (
    <aside className="flex w-64 flex-col bg-[var(--color-navy-900)] text-slate-300">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)] text-[15px] font-extrabold text-white"
          aria-hidden="true"
        >
          P
        </span>
        <Link
          href="/"
          aria-label="ProctiraERP home"
          className="inline-flex min-h-12 items-center text-[15px] font-bold tracking-tight text-white"
        >
          Proctira
          <span className="text-[var(--color-primary-400)]">ERP</span>
        </Link>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 overflow-y-auto px-3 py-3" aria-label="Main navigation">
        <ul className="space-y-0.5" role="list">
          {navItems.map((item) => {
            const isActive = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);

            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className={`sidebar-link ${
                    isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'
                  }`}
                  aria-current={isActive ? 'page' : undefined}
                >
                  <NavIcon name={item.icon} />
                  <span>{t(item.key)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}

/** Lucide-style stroke icon paths, one per module. */
const ICON_PATHS: Record<IconName, string> = {
  HomeIcon: 'm3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M9 22V12h6v10',
  BuildingIcon: 'm4 6 8-4 8 4 M18 10l4 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-8l4-2 M18 5v17 M6 5v17',
  CalendarIcon:
    'M8 2v4 M16 2v4 M3 10h18 M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  UsersIcon:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M22 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z',
  BriefcaseIcon:
    'M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16 M4 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z',
  ClipboardIcon:
    'M9 2h6a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 12h6 M9 16h6',
  CheckCircleIcon: 'M22 11.08V12a10 10 0 1 1-5.93-9.14 M22 4 12 14.01l-3-3',
  DocumentIcon:
    'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z M14 2v6h6 M16 13H8 M16 17H8',
  AcademicCapIcon: 'M22 10v6 M2 10l10-5 10 5-10 5z M6 12v5c3 3 9 3 12 0v-5',
  HeartIcon:
    'M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7z',
  UserGroupIcon:
    'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0z M22 21v-2a4 4 0 0 0-3-3.87 M17 3.13a4 4 0 0 1 0 7.74',
  BellIcon: 'M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9 M10.3 21a1.94 1.94 0 0 0 3.4 0',
  BusIcon:
    'M8 6v6 M16 6v6 M2 12h20v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z M4 18v2 M20 18v2 M6 6h12a2 2 0 0 1 2 2v4H4V8a2 2 0 0 1 2-2z',
  MegaphoneIcon: 'm3 11 18-5v12L3 14v-3z M11.6 16.8a3 3 0 1 1-5.8-1.6',
  BedIcon: 'M2 4v16 M2 8h20v8 M6 8V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2 M6 12h4',
  BookOpenIcon:
    'M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z',
  ArrowPathIcon:
    'M6 3v12 M18 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M18 9a9 9 0 0 1-9 9',
  DatabaseIcon:
    'M12 8c4.97 0 9-1.34 9-3s-4.03-3-9-3-9 1.34-9 3 4.03 3 9 3z M21 12c0 1.66-4 3-9 3s-9-1.34-9-3 M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5',
  ChartBarIcon: 'M12 20v-10 M18 20V4 M6 20v-4',
  CogIcon:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z',
};

/** Per-module stroke icon (inline SVG, lucide-style). */
function NavIcon({ name }: { name: IconName }) {
  return (
    <span
      className="inline-flex h-5 w-5 items-center justify-center text-current opacity-85"
      aria-hidden="true"
    >
      <svg
        className="h-[17px] w-[17px]"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={ICON_PATHS[name]} />
      </svg>
    </span>
  );
}
