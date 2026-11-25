/**
 * PRC-M121 — tabs on the general student profile.
 *
 * Health (PHI) is not part of the general profile: the tab is listed only for roles that may read
 * health records (same allow-list as the /health section). The gateway still enforces access and
 * audits every PHI read; this keeps the tab, its fetches and its error panel away from other roles.
 */
import { canAccessHealthRecords } from '@/lib/api/health';

const PROFILE_TABS = [
  'overview',
  'attendance',
  'assessments',
  'guardians',
  'health',
  'fees',
  'lms',
  'history',
] as const;

export type StudentProfileTab = (typeof PROFILE_TABS)[number];

export function studentProfileTabs(
  roles: Array<{ roleName: string }>,
): readonly StudentProfileTab[] {
  return canAccessHealthRecords(roles) ? PROFILE_TABS : PROFILE_TABS.filter((t) => t !== 'health');
}
