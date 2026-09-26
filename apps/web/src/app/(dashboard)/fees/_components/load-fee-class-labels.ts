/**
 * Class names for fee dues (invoice.class_id is the classes table, not a section).
 */
import { listInstitutions } from '@/lib/api/institutions';
import { listClassesByInstitution } from '@/lib/institutions/api';

export async function loadFeeClassLabels(): Promise<Record<string, string>> {
  try {
    const institutions = await listInstitutions({ pageSize: 100 });
    const groups = await Promise.all(
      institutions.map((institution) => listClassesByInstitution(institution.id).catch(() => [])),
    );
    const labels: Record<string, string> = {};
    for (const group of groups) {
      for (const row of group) {
        const name = row.name?.trim();
        if (name) labels[row.id] = name;
      }
    }
    return labels;
  } catch {
    return {};
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
