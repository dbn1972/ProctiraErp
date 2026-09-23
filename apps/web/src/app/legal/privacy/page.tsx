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
 * wraps children in `<MarketingLayout>`, and these components render their own, so placing
 * them there would duplicate the header and footer.
 *
 * `chrome="minimal"` for the same reason routing them is safe at all:
 * `<MarketingLayout>`'s header and footer carry 45 link targets with no route in this app,
 * and `app/(marketing)/` has no `page.tsx`, so that chrome was unreachable until these
 * routes existed. Rendering it here would have published 45 dead links on the one page
 * where a dead link matters most. See `LegalDocumentChrome`.
 */
import PrivacyPolicy from '@/features/legal/PrivacyPolicy';

export default function PrivacyPolicyPage(): JSX.Element {
  return <PrivacyPolicy chrome="minimal" />;
}
