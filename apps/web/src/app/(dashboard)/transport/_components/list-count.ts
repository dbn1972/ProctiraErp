/**
 * T-D2: count copy for transport list screens. The count is the list's total,
 * not the rows on screen; when fewer rows were read it says "Showing N of M".
 */
export function listCountCopy(
  list: { items: readonly unknown[]; totalItems: number; truncated: boolean },
  noun: { one: string; many: string },
  suffix = '',
): string {
  const label = `${list.totalItems === 1 ? noun.one : noun.many}${suffix}.`;
  return list.truncated
    ? `Showing ${list.items.length} of ${list.totalItems} ${label}`
    : `${list.totalItems} ${label}`;
}
