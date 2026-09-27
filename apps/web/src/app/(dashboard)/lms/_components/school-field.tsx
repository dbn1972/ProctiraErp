'use client';

import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';

export function SchoolField({
  id,
  schools,
  required = false,
  label = 'School',
}: {
  id: string;
  schools: EntityLabelOption[];
  required?: boolean;
  label?: string;
}) {
  return (
    <EntitySearchSelect
      id={id}
      name="institutionId"
      label={required ? label : `${label} (optional)`}
      options={schools}
      required={required}
      placeholder="Search schools by code or name…"
      emptyMessage="No schools are loaded. Add a school under Institutions, then return here."
    />
  );
}
