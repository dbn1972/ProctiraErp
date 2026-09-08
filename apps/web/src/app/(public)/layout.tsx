/**
 * Public layout for unauthenticated, anonymous-accessible routes.
 *
 * Mirrors the lightweight `(auth)` layout but without the auth-screen
 * styling. Used by the public Application Tracking page (Requirement
 * 16.6 / Task 51.4) and any future unauthenticated public surfaces.
 *
 * Includes the `<MarketingHeader>` so anonymous visitors can use the
 * `<ThemeToggle>` (Task 47.4) — the toggle works here because
 * `<ThemeProvider>` sits ABOVE `<AuthProvider>` in the provider
 * hierarchy (Design §A).
 */
import { MarketingHeader } from '@/components/layout/marketing-header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <MarketingHeader />
      {children}
    </div>
  );
}
