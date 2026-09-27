import { formatCodeNameLabel, type EntityLabelOption } from '@/lib/entity-label';

/** Directory rows for pickers. A missing name falls back to the code, never a raw id. */
export function toNamedOptions(
  rows: Array<{ id: string; code?: string | null; name?: string | null }>,
): EntityLabelOption[] {
  return rows
    .filter((row) => row.id.trim().length > 0)
    .map((row) => {
      const label = formatCodeNameLabel(row.code, row.name);
      return {
        id: row.id,
        label: label || 'Unnamed record',
        searchText: `${row.code ?? ''} ${row.name ?? ''}`.trim(),
      };
    });
}
