/**
 * G-404 — MobileShell destination registry.
 *
 * Canonical App Router paths (Next.js `(dashboard)` layout). Destinations
 * marked `available: false` are hidden from the shell (not rendered as links).
 */

export interface MobileShellDestination {
  key: string;
  label: string;
  href: string;
  /** When false, the shell must not render a navigable link. */
  available: boolean;
}

/** Bottom-tab primary destinations. */
export const MOBILE_TAB_DESTINATIONS: readonly MobileShellDestination[] = [
  { key: 'home', label: 'Home', href: '/', available: true },
  { key: 'attendance', label: 'Attendance', href: '/attendance', available: true },
  { key: 'students', label: 'Students', href: '/students', available: true },
  /** Profile → admin users (no dedicated /me/profile App Router page yet). */
  { key: 'profile', label: 'Profile', href: '/admin/users', available: true },
] as const;

/** Hamburger drawer secondary destinations. */
export const MOBILE_DRAWER_DESTINATIONS: readonly MobileShellDestination[] = [
  { key: 'settings', label: 'Settings', href: '/admin', available: true },
  { key: 'reports', label: 'Reports', href: '/reports', available: true },
  /**
   * Help was previously /app/help (SPA-only). App Router ships a thin /help
   * page so the link resolves; keep available=true once that page exists.
   */
  { key: 'help', label: 'Help', href: '/help', available: true },
  { key: 'signout', label: 'Sign out', href: '/api/auth/signout', available: true },
] as const;

export function availableDestinations(
  destinations: readonly MobileShellDestination[],
): MobileShellDestination[] {
  return destinations.filter((d) => d.available);
}

/** Assert every available href is a rooted path (no /app/* SPA leftovers). */
export function assertNoDeadAppPrefix(
  destinations: readonly MobileShellDestination[],
): string[] {
  return destinations
    .filter((d) => d.available && d.href.startsWith('/app/'))
    .map((d) => d.href);
}
