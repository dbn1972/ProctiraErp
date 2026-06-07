/**
 * useAsyncAnnounce — fires a single screen-reader announcement when an
 * async-loading widget transitions from `loading=true` to `loading=false`.
 *
 * Each dashboard widget accepts a `loading` prop; while `true`, the widget
 * shows a Skeleton matching the loaded layout (Property F-8). When the
 * payload arrives, the widget calls this hook to push a polite
 * announcement — for example "Today's attendance loaded" — through the
 * global `<LiveRegion>` mounted at the app shell.
 *
 * The hook only fires on the loading→loaded transition (not on the
 * initial render with `loading=false`) so widgets that mount with their
 * data already in cache do not generate phantom announcements.
 *
 * Validates: Requirement 37.6 / Design L (announcements), Property F-8
 * (skeleton-loading).
 */

import { useEffect, useRef } from 'react';
import { useAnnounce } from '@proctira/ui-components';

export interface UseAsyncAnnounceOptions {
  /**
   * Whether the widget is currently loading. The hook fires the
   * announcement on the first transition from `true` → `false`.
   */
  loading: boolean;
  /**
   * Message to announce once the data arrives. Examples:
   *   - "Today's attendance loaded"
   *   - "Enrollment trend updated"
   *   - "5 pending tasks loaded"
   */
  loadedMessage: string;
  /**
   * Optional message to announce if `error` is truthy after a load. The
   * announcement is sent with `'assertive'` priority so screen readers
   * interrupt their current utterance.
   */
  error?: unknown;
  /**
   * Override the assertive message used when `error` is set. Defaults to
   * a derived form of `loadedMessage`: if `loadedMessage` ends in
   * `" loaded"` we replace the suffix with `" failed to load"`, otherwise
   * we append `" failed to load"`.
   */
  errorMessage?: string;
}

function defaultErrorMessage(loaded: string): string {
  if (loaded.endsWith(' loaded')) {
    return `${loaded.slice(0, -' loaded'.length)} failed to load`;
  }
  return `${loaded} failed to load`;
}

export function useAsyncAnnounce({
  loading,
  loadedMessage,
  error,
  errorMessage,
}: UseAsyncAnnounceOptions): void {
  const announce = useAnnounce();
  const wasLoadingRef = useRef<boolean>(loading);

  useEffect(() => {
    const wasLoading = wasLoadingRef.current;
    if (wasLoading && !loading) {
      if (error) {
        announce(
          errorMessage ?? defaultErrorMessage(loadedMessage),
          'assertive',
        );
      } else {
        announce(loadedMessage, 'polite');
      }
    }
    wasLoadingRef.current = loading;
  }, [loading, error, loadedMessage, errorMessage, announce]);
}
