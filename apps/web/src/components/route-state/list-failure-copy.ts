/**
 * Localised copy for `ListLoadFailure` (V15-17).
 *
 * ## Why this is a separate module and not `useTranslations` inside the panel
 *
 * `ListLoadFailure` is rendered from server components, and its own test file renders it
 * synchronously with no providers. Reaching for `useTranslations` would make it a client
 * component and drag every consumer over the boundary; reaching for `getTranslations` would
 * make it `async` and unrenderable by React Testing Library. This repository already solved
 * the same problem once — `(dashboard)/loading.tsx` resolves `getTranslations` and passes a
 * string into the presentational `RouteLoadingPanel` — so this follows that pattern rather
 * than inventing a second one.
 *
 * The panel keeps English defaults, so an unmigrated caller degrades to today's behaviour
 * rather than rendering blank keys.
 */

import { getTranslations } from 'next-intl/server';

import type { ListFailureKind } from '@/lib/api/list-result';

export interface ListFailureCopy {
  title: string;
  description: string;
}

export interface ListFailureCopyBundle {
  kinds: Record<ListFailureKind, ListFailureCopy>;
  signIn: string;
  reference: string;
  requestId: string;
  tryAgain: string;
  retrying: string;
}

/**
 * Resolve the panel's copy for the request's locale.
 *
 * Call from a server component and pass the result to `ListLoadFailure`. Each of the four
 * kinds must stay distinguishable in every language — a translation that collapses "you may
 * not see this" into "nothing found" reintroduces the original defect in that locale, which
 * is why the four are separate keys rather than one parameterised string.
 */
export async function getListFailureCopy(): Promise<ListFailureCopyBundle> {
  const t = await getTranslations('routeState');
  return {
    kinds: {
      unauthenticated: {
        title: t('unauthenticatedTitle'),
        description: t('unauthenticatedBody'),
      },
      denied: { title: t('deniedTitle'), description: t('deniedBody') },
      missing: { title: t('missingTitle'), description: t('missingBody') },
      unavailable: { title: t('unavailableTitle'), description: t('unavailableBody') },
    },
    signIn: t('signIn'),
    reference: t('reference'),
    requestId: t('requestId'),
    tryAgain: t('tryAgain'),
    retrying: t('retrying'),
  };
}
