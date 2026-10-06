/**
 * PRC-M120 — staff type classification for the list tabs.
 *
 * Position is free text, so teaching vs non-teaching is derived from it:
 * a position is "teaching" when it names a teacher/faculty role or a
 * recognised Indian teacher cadre (PGT/TGT/PRT/NTT). Everything else
 * (Principal, Clerk, Counselor, Support Staff, …) is non-teaching.
 */
export type StaffTypeFilter = 'TEACHING' | 'NON_TEACHING';

const TEACHING_CADRES = new Set(['PGT', 'TGT', 'PRT', 'NTT']);
const TEACHING_WORDS = /\b(teacher|teaching|faculty|lecturer|professor|tutor|instructor)\b/i;

export function isTeachingPosition(position: string | null | undefined): boolean {
  const p = (position ?? '').trim();
  if (!p) return false;
  if (TEACHING_CADRES.has(p.toUpperCase())) return true;
  return TEACHING_WORDS.test(p);
}

export function matchesStaffType(
  position: string | null | undefined,
  type: StaffTypeFilter | undefined,
): boolean {
  if (!type) return true;
  return type === 'TEACHING' ? isTeachingPosition(position) : !isTeachingPosition(position);
}

/** Staff ids with an approved leave covering `today` (YYYY-MM-DD, inclusive). */
export function staffIdsOnLeave(
  leaves: ReadonlyArray<{ staffId: string; status: string; startDate: string; endDate: string }>,
  today: string,
): Set<string> {
  const ids = new Set<string>();
  for (const l of leaves) {
    if (l.status !== 'approved') continue;
    if (l.startDate.slice(0, 10) <= today && l.endDate.slice(0, 10) >= today) ids.add(l.staffId);
  }
  return ids;
}
