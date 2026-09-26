/**
 * Public layout for unauthenticated, anonymous-accessible routes.
 *
 * Mirrors the lightweight `(auth)` layout but without the auth-screen
 * styling. Used by the public Application Tracking page (Requirement
 * 16.6 / Task 51.4) and any future unauthenticated public surfaces.
 *
 * Uses a short header whose links are real routes (`/track`, `/login`).
 * The marketing header's feature/pricing/about/contact/demo targets are
 * not pages in this app, so they are not shown to applicants.
 */
import { PublicTrackHeader } from './_components/public-track-header';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50 text-foreground">
      <PublicTrackHeader />
      {children}
    </div>
  );
}
