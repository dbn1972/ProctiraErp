/**
 * `/legal/privacy` — routes the existing `PrivacyPolicy` feature component.
 *
 * ## Why this file did not exist
 *
 * `PrivacyPolicy.tsx` says it is "Mounted at `/legal/privacy` via `featureRegistry.ts`".
 * That registry describes a Vite SPA `RootRouter` that consumed route prefixes and lazy
 * imports. The app has since moved to the Next.js App Router, which does not read the
 * registry, and no `page.tsx` was ever added — so the component, its sibling
 * `TermsOfService`, and their tests all existed while the route returned a 404.
 *
 * That was reachable from a live flow: the signup form links to `/legal/terms` and
 * `/legal/privacy` from the consent copy, so a user was asked to accept terms they could
 * not open. `dead-internal-links.test.ts` now fails on any `href` that does not resolve
 * to a route, which is the check that would have caught it.
 *
 * Deliberately *not* under the `(marketing)` route group: that group's layout already
 * wraps children in `<MarketingLayout>`, and `PrivacyPolicy` renders its own, so placing
 * it there would duplicate the header and footer.
 */
import PrivacyPolicy from '@/features/legal/PrivacyPolicy';

export default function PrivacyPolicyPage(): JSX.Element {
  return <PrivacyPolicy />;
}
