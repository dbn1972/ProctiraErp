'use client';

import { FormField } from '@proctira/ui/components';

import type { EntityLabelOption } from '@/lib/entity-label';

const SELECT_CLASS =
  'min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm';

export function HealthStudentSelect({
  options,
  id = 'studentId',
  name = 'studentId',
  label = 'Student',
}: {
  options: EntityLabelOption[];
  id?: string;
  name?: string;
  label?: string;
}) {
  if (options.length === 0) {
    return (
      <FormField label={label} htmlFor={id}>
        <p
          className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          No students loaded for this school. Add students in People, then return here.
        </p>
        <input type="hidden" id={id} name={name} value="" />
      </FormField>
    );
  }

  return (
    <FormField label={label} htmlFor={id}>
      <select id={id} name={name} required className={SELECT_CLASS}>
        <option value="">Select a student…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}

export function HealthStaffSelect({
  options,
  id = 'counsellorId',
  name = 'counsellorId',
  label = 'Counsellor',
}: {
  options: EntityLabelOption[];
  id?: string;
  name?: string;
  label?: string;
}) {
  if (options.length === 0) {
    return (
      <FormField label={label} htmlFor={id}>
        <p
          className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
          role="status"
        >
          No staff loaded for this school. Add staff in People, then return here.
        </p>
        <input type="hidden" id={id} name={name} value="" />
      </FormField>
    );
  }

  return (
    <FormField label={label} htmlFor={id}>
      <select id={id} name={name} required className={SELECT_CLASS}>
        <option value="">Select a counsellor…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </FormField>
  );
}
