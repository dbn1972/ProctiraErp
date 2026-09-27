import { getRubric, listRubrics, type LmsRubric } from '@/lib/api/lms';
import type { EntityLabelOption } from '@/lib/entity-label';

/** Criteria a teacher can pick when the assignment has no attached rubric grid. */
export async function loadCriterionOptions(
  attached: LmsRubric | null,
): Promise<EntityLabelOption[]> {
  if (attached?.criteria && attached.criteria.length > 0) return [];
  const listed = await listRubrics().catch(() => []);
  const detailed = await Promise.all(
    listed.map(async (row) =>
      row.criteria && row.criteria.length > 0
        ? row
        : ((await getRubric(row.id).catch(() => null)) ?? row),
    ),
  );
  return detailed.flatMap((row) =>
    (row.criteria ?? []).map((criterion) => ({
      id: criterion.id,
      label: `${row.name} · ${criterion.name}`,
      searchText: `${row.name} ${criterion.name}`,
    })),
  );
}
