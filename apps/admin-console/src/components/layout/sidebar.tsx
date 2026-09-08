'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Building2,
  CreditCard,
  Puzzle,
  Palette,
  ShieldAlert,
  LifeBuoy,
  Activity,
  ScrollText,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import type { AdminArea } from '@/lib/auth';

interface NavItem {
  label: string;
  href: string;
  icon: typeof LayoutDashboard;
  area?: AdminArea;
}

const NAV: NavItem[] = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Tenants', href: '/tenants', icon: Building2, area: 'tenants' },
  { label: 'Plans', href: '/plans', icon: CreditCard, area: 'plans' },
  { label: 'Plugins', href: '/plugins', icon: Puzzle, area: 'plugins' },
  { label: 'Themes', href: '/themes', icon: Palette, area: 'themes' },
  {
    label: 'Break-glass',
    href: '/break-glass',
    icon: ShieldAlert,
    area: 'breakGlassRequest',
  },
  { label: 'Support', href: '/support', icon: LifeBuoy, area: 'support' },
  { label: 'Health', href: '/health', icon: Activity, area: 'health' },
  { label: 'Audit log', href: '/audit', icon: ScrollText, area: 'audit' },
];

interface SidebarProps {
  /** Areas the current user is allowed to enter. */
  allowedAreas: AdminArea[];
}

/** Side navigation for the Platform Admin Console. */
export function Sidebar({ allowedAreas }: SidebarProps) {
  const pathname = usePathname();
  const allowed = new Set<AdminArea | 'all'>([...allowedAreas, 'all' as const]);

  return (
    <nav
      aria-label="Platform admin sections"
      className="flex h-full w-60 flex-col border-r border-border bg-[hsl(var(--card))]"
    >
      <div className="flex items-center gap-2 px-5 py-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[hsl(var(--primary))] text-sm font-bold text-[hsl(var(--primary-foreground))]">
          E
        </div>
        <div className="flex flex-col leading-tight">
          <span className="text-sm font-semibold">ProctiraERP</span>
          <span className="text-xs text-muted-foreground">Platform Admin</span>
        </div>
      </div>

      <ul className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {NAV.map((item) => {
          const isAllowed = !item.area || allowed.has(item.area);
          const isActive = item.href === '/' ? pathname === '/' : pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={isAllowed ? item.href : '#'}
                aria-disabled={!isAllowed}
                tabIndex={isAllowed ? 0 : -1}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isAllowed
                    ? 'text-foreground hover:bg-secondary'
                    : 'cursor-not-allowed text-muted-foreground/50',
                  isAllowed && isActive && 'bg-[hsl(var(--primary))]/10 text-[hsl(var(--primary))]',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
        Section 41 · Platform Admin
      </div>
    </nav>
  );
}
