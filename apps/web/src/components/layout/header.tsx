'use client';

import { Bell, HelpCircle, LogOut, Menu } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';

import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@proctira/ui/components';
import { initialsFromName } from '@/lib/institutions/directory-presentation';
import { signOut } from '@/lib/auth';
import { useDirectoryContext } from '@/lib/institutions/use-directory-context';
import { useEffect, useState } from 'react';

import { useAuth } from '@/providers/AuthProvider';
import { useOptionalBrand } from '@/providers/BrandConfigProvider';

/**
 * Top header bar for the dashboard layout (Design System v2.0).
 * Global search (opens the ⌘K command palette), theme toggle, language
 * switcher, and the user menu with logout action.
 */
export function Header({ onOpenMenu }: { onOpenMenu?: () => void } = {}) {
  const t = useTranslations('auth');
  const { user, status } = useAuth();
  const brand = useOptionalBrand();
  const directory = useDirectoryContext();
  const displayName = user?.name?.trim() || 'Account';
  const roleLabel = (user?.roles?.[0] ?? '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const orgName = directory?.organizationName?.trim() || brand?.name?.trim();
  const subtitle = [roleLabel, orgName].filter(Boolean).join(' · ');

  async function handleLogout() {
    await signOut('/login');
  }

  /** Open the global CommandPalette by dispatching its ⌘K shortcut. */
  function openCommandPalette() {
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }),
    );
  }

  return (
    <header
      data-testid="desktop-shell-header"
      className="relative z-20 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 sm:px-6 dark:bg-card"
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {onOpenMenu ? (
          <button
            type="button"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:hidden"
            aria-label="Open navigation menu"
            data-testid="desktop-shell-menu"
            onClick={onOpenMenu}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : null}
        {/* Global search — opens the command palette */}
        <button
          type="button"
          onClick={openCommandPalette}
          className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-transparent bg-muted px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-input hover:bg-card"
          aria-label="Search (Ctrl+K)"
        >
          <svg
            className="h-4 w-4 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <span className="truncate">Search students, staff, invoices…</span>
          <kbd className="ms-auto hidden rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold sm:inline">
            ⌘K
          </kbd>
        </button>
      </div>

      {/* Right side - user actions */}
      <div className="flex shrink-0 items-center gap-3">
        <ThemeToggle />
        <LanguageSelector />

        <NotificationBell />
        <Link
          href="/help"
          aria-label="Help"
          className="inline-flex h-8 min-h-6 w-8 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </Link>

        {status === 'loading' ? (
          <div
            className="flex items-center gap-2"
            data-testid="header-user-skeleton"
            aria-hidden="true"
          >
            <span className="h-8 w-8 animate-pulse rounded-full bg-muted" />
            <span className="hidden h-8 w-28 animate-pulse rounded-md bg-muted sm:block" />
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex min-h-8 items-center gap-2 rounded-full py-1 pe-2 ps-1 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                aria-label={`Account menu for ${displayName}`}
              >
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[hsl(var(--primary))] text-xs font-semibold text-primary-foreground">
                  {initialsFromName(displayName)}
                </span>
                <span className="hidden text-start leading-tight sm:block">
                  <span className="block text-sm font-semibold text-foreground">{displayName}</span>
                  {subtitle ? (
                    <span className="block text-[11px] text-muted-foreground">{subtitle}</span>
                  ) : null}
                </span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => void handleLogout()}>
                <LogOut className="me-2 h-4 w-4" aria-hidden="true" />
                {t('logout')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}

function NotificationBell() {
  const { status } = useAuth();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (status !== 'authenticated') return;
    const controller = new AbortController();
    const load = () =>
      fetch('/api/v1/notifications/unread-count', {
        cache: 'no-store',
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) return { unread: 0 };
          return (await response.json()) as { unread?: number };
        })
        .then((body) => {
          const count = typeof body.unread === 'number' ? body.unread : 0;
          setUnread(count > 0 ? count : 0);
        })
        .catch(() => {
          setUnread(0);
        });
    void load();
    // PRC-M115: the inbox fires this after mark-read so the bell count updates.
    const onChanged = () => void load();
    window.addEventListener('proctira:notifications-changed', onChanged);
    return () => {
      window.removeEventListener('proctira:notifications-changed', onChanged);
      controller.abort();
    };
  }, [status]);

  const label = unread > 0 ? `Notifications, ${unread} unread` : 'Notifications';

  return (
    <Link
      href="/notifications"
      aria-label={label}
      className="relative inline-flex h-8 min-h-6 w-8 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Bell className="h-4 w-4" aria-hidden="true" />
      {unread > 0 ? (
        <span
          className="absolute end-1 top-1 h-2 w-2 rounded-full bg-red-500"
          data-testid="notification-unread-dot"
        />
      ) : null}
    </Link>
  );
}
