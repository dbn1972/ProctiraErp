import { resolveEntityLabel } from '@/lib/entity-label';

export function transferPartyLabel(
  id: string,
  name: string | null | undefined,
  prefix: 'Student' | 'School',
): string {
  return resolveEntityLabel(id, name ? { [id]: name } : {}, prefix);
}
