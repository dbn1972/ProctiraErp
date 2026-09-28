'use client';

import { Bell, HelpCircle, LogOut } from 'lucide-react';
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
import { useAuth } from '@/providers/AuthProvider';
import { useOptionalBrand } from '@/providers/BrandConfigProvider';

/**
 * Top header bar for the dashboard layout (Design System v2.0).
 * Global search (opens the ⌘K command palette), theme toggle, language
 * switcher, and the user menu with logout action.
 */
export function Header() {
  const t = useTranslations('auth');
  const { user } = useAuth();
  const brand = useOptionalBrand();
  const displayName = user?.name?.trim() || 'Account';
  const roleLabel = (user?.roles?.[0] ?? '')
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const orgName = brand?.name?.trim();
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

      {/* Right side - user actions */}
      <div className="flex shrink-0 items-center gap-3">
        <ThemeToggle />
        <LanguageSelector />

        <Link
          href="/notifications"
          aria-label="Notifications"
          className="inline-flex h-8 min-h-6 w-8 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Bell className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          href="/help"
          aria-label="Help"
          className="inline-flex h-8 min-h-6 w-8 min-w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <HelpCircle className="h-4 w-4" aria-hidden="true" />
        </Link>

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
      </div>
    </header>
  );
}
