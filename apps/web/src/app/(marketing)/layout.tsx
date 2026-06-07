/**
 * Marketing route group layout (Task 50.1, Design §E).
 *
 * Wraps every public marketing page with the shared `<MarketingLayout>`
 * so the tenant logo, primary navigation, language/theme toggles, sign-in
 * + get-started CTAs, the thirteen-column footer, and the brand-aware
 * `<DocumentTitle>` are consistent across all unauthenticated marketing
 * surfaces.
 *
 * No auth boundary — these routes must remain reachable without an
 * active session (Requirement 31 AC 5). The Theme and Language providers
 * sit above `<AuthProvider>` in the provider hierarchy (Design §A) so
 * the toggles render correctly even without a logged-in user.
 *
 * Pages under `app/(marketing)/<route>/page.tsx` should pass their
 * page title via the `<MarketingLayout pageTitle="…">` prop, but since
 * route group layouts cannot directly forward props per-page, individual
 * pages render their own `<DocumentTitle>` (matching the pattern used
 * by `app/(public)/track/page.tsx`) and this layout omits one to avoid
 * a duplicate binding.
 */
import { MarketingLayout } from '@/components/layout/MarketingLayout';

export default function MarketingRouteGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <MarketingLayout skipDocumentTitle>
      {children}
    </MarketingLayout>
  );
}
