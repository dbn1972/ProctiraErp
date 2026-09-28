/**
 * Institutions directory order.
 *
 * Active schools come first, then inactive schools. Within each group the
 * institution code decides the order (UDISE / campus code), so the main
 * campus with the lowest code leads and an inactive campus stays last even
 * when its code would sort earlier alphabetically.
 */
export function compareDirectoryInstitutions(
  a: { status: string; code: string },
  b: { status: string; code: string },
): number {
  const rank = (status: string) => (status.toUpperCase() === 'INACTIVE' ? 1 : 0);
  const byStatus = rank(a.status) - rank(b.status);
  if (byStatus !== 0) return byStatus;
  return a.code.localeCompare(b.code);
}
