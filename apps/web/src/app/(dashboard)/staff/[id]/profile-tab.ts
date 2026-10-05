/** PRC-M117: `?tab=` (used by post-save redirects) selects the initial profile tab. */
export const PROFILE_TABS = ['overview', 'assignments', 'appraisals', 'training'] as const;
export type ProfileTab = (typeof PROFILE_TABS)[number];
export function resolveProfileTab(tab: unknown): ProfileTab {
  return typeof tab === 'string' && (PROFILE_TABS as readonly string[]).includes(tab)
    ? (tab as ProfileTab)
    : 'overview';
}
