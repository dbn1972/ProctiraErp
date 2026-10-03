/**
 * Class names for fee dues (invoice.class_id is the classes table, not a section).
 */
import { listInstitutionsPage } from '@/lib/api/institutions';
import { listClassesByInstitution } from '@/lib/institutions/api';

/** PRC-M477: safety bound on institution pages walked (100 per page). */
const MAX_INSTITUTION_PAGES = 50;

/**
 * PRC-M477: resolves class names across *all* institutions (not just the first 100),
 * and when `classIds` is given stops as soon as every requested class is labelled.
 */
export async function loadFeeClassLabels(classIds?: readonly string[]): Promise<Record<string, string>> {
  const wanted = classIds ? new Set(classIds.filter((id) => id && id !== 'unassigned')) : null;
  const labels: Record<string, string> = {};
  if (wanted && wanted.size === 0) return labels;
  try {
    for (let page = 1; page <= MAX_INSTITUTION_PAGES; page += 1) {
      const { data: institutions, totalItems } = await listInstitutionsPage({ page, pageSize: 100 });
      const groups = await Promise.all(
        institutions.map((institution) => listClassesByInstitution(institution.id).catch(() => [])),
      );
      for (const group of groups) {
        for (const row of group) {
          const name = row.name?.trim();
          if (name && (!wanted || wanted.has(row.id))) labels[row.id] = name;
        }
      }
      if (wanted && [...wanted].every((id) => labels[id])) break;
      if (institutions.length < 100 || page * 100 >= totalItems) break;
    }
    return labels;
  } catch {
    return labels;
  }
}
/** Replace the dues CSV class id column with the class name operators already see on screen. */
export function labelDuesCsv(csv: string, labels: Record<string, string>): string {
  const lines = csv
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0);
  if (lines.length === 0) return csv;
  const header = lines[0] ?? '';
  const columns = header.split(',');
  if (columns[0] !== 'classId') return csv;
  const nextHeader = ['class', ...columns.slice(1)].join(',');
  const nextRows = lines.slice(1).map((line) => {
    const cells = line.split(',');
    const id = cells[0] ?? '';
    const name = id === 'unassigned' ? 'Unassigned' : labels[id];
    if (name && !name.includes(',') && !name.includes('"')) {
      cells[0] = name;
    }
    return cells.join(',');
  });
  return [nextHeader, ...nextRows].join('\n');
}
