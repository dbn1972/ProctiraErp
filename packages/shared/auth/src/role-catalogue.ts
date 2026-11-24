/**
 * Role-id spelling normalisation against a role catalogue (PRC-M015, D2).
 *
 * The realm, `DEFAULT_ROLES` and the gateway registry spell role ids in
 * lowercase with `_` (`school_nurse`), except the original realm role
 * `super-admin`. Tokens, seeds and module allow-lists also use other
 * spellings for the same role (`SUPER_ADMIN`, `hostel-warden`,
 * `exam-officer`). {@link canonicalRoleId} maps a spelling onto the id the
 * catalogue defines, so a role is never dropped only because of case or
 * `-`/`_`, and it never invents a role the catalogue lacks.
 */

/**
 * Synonyms the D2 decision collapsed into one canonical id. Only confirmed
 * collapses belong here: `system_admin` / `platform_admin`, `nurse` /
 * `school_nurse` and `parent` / `guardian` are distinct roles (D2 CORRECTION).
 */
export const ROLE_ID_SYNONYMS: Readonly<Record<string, string>> = {
  exam_officer: 'examinations_officer',
  'exam-officer': 'examinations_officer',
};

/**
 * Returns the catalogue id `raw` names, or `undefined` when the catalogue has
 * no such role. Matching order: exact (after trim + lowercase), then the
 * `-`/`_` swapped spelling, then {@link ROLE_ID_SYNONYMS}.
 */
export function canonicalRoleId(
  raw: string,
  catalogueIds: ReadonlySet<string>,
): string | undefined {
  const id = raw.trim().toLowerCase();
  if (!id) return undefined;
  if (catalogueIds.has(id)) return id;
  for (const variant of [id.replace(/-/g, '_'), id.replace(/_/g, '-')]) {
    if (catalogueIds.has(variant)) return variant;
  }
  const synonym = ROLE_ID_SYNONYMS[id];
  return synonym && catalogueIds.has(synonym) ? synonym : undefined;
}
