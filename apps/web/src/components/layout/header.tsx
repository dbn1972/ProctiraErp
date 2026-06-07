'use client';

import { useTranslations } from 'next-intl';
import { LanguageSelector } from '@/components/LanguageSelector';
import { ThemeToggle } from '@/components/ThemeToggle';
import { signOut } from '@/lib/auth';

/**
 * Top header bar for the dashboard layout (Design System v2.0).
 * Global search (opens the ⌘K command palette), theme toggle, language
 * switcher, and the user menu with logout action.
 */
export function Header() {
  const t = useTranslations('auth');

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
    <header className="flex h-16 items-center justify-between gap-4 border-b border-border bg-white/85 px-6 backdrop-blur dark:bg-card/85">
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
        <span className="truncate">Search students, staff, schools…</span>
        <kbd className="ms-auto hidden rounded border border-border bg-card px-1.5 py-0.5 text-[11px] font-semibold sm:inline">
          ⌘K
        </kbd>
      </button>

      {/* Right side - user actions */}
      <div className="flex shrink-0 items-center gap-3">
        {/* Theme Toggle (Task 47.4) */}
        <ThemeToggle />

        {/* Language Selector (Task 48.3) — native-name dropdown over the
            Indian_Language_Set + the Arabic RTL pilot. */}
        <LanguageSelector />

        {/* User Menu */}
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[var(--color-primary-500)] to-[var(--color-primary-700)]">
            <span className="text-sm font-semibold text-white">U</span>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-700 dark:text-muted-foreground dark:hover:text-foreground"
          >
            {t('logout')}
          </button>
        </div>
      </div>
    </header>
  );
}
