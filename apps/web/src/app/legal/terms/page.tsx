/**
 * `/legal/terms` — routes the existing `TermsOfService` feature component.
 *
 * See the sibling `../privacy/page.tsx` for why this was missing: both components were
 * mounted by the Vite-era `featureRegistry.ts`, which the App Router does not read, so the
 * routes 404'd while the components and their tests kept passing.
 *
 * The signup form links here from its consent copy, so until now a user was asked to
 * accept terms they could not open.
 */
import TermsOfService from '@/features/legal/TermsOfService';

export default function TermsOfServicePage(): JSX.Element {
  return <TermsOfService />;
}
