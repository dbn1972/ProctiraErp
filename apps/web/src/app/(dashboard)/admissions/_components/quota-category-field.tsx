'use client';

import { useState } from 'react';

import { FormField, Input } from '@proctira/ui/components';
import {
  ADMISSION_QUOTA_CATEGORIES,
  type AdmissionQuotaPreset,
} from '@/lib/admissions/quota-categories';

const selectClassName =
  'flex h-10 min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm';

export function QuotaCategoryField({
  id,
  defaultQuota = 'general',
  disabled,
  testIdPrefix = 'quota',
}: {
  id: string;
  defaultQuota?: string;
  disabled?: boolean;
  testIdPrefix?: string;
}) {
  const known = ADMISSION_QUOTA_CATEGORIES.some(
    (row) => row.value === defaultQuota && row.value !== 'custom',
  );
  const initialPreset: AdmissionQuotaPreset = known
    ? (defaultQuota as AdmissionQuotaPreset)
    : 'custom';
  const [preset, setPreset] = useState<AdmissionQuotaPreset>(initialPreset);

  return (
    <div className="space-y-3">
      <FormField id={id} label="Category / reservation" required>
        <select
          id={id}
          name="quotaPreset"
          data-testid={`${testIdPrefix}-preset`}
          className={selectClassName}
          disabled={disabled}
          value={preset}
          onChange={(event) => setPreset(event.target.value as AdmissionQuotaPreset)}
        >
          {ADMISSION_QUOTA_CATEGORIES.map((row) => (
            <option key={row.value} value={row.value}>
              {row.label}
            </option>
          ))}
        </select>
      </FormField>
      {preset === 'custom' ? (
        <FormField id={`${id}-custom`} label="Custom category key" required>
          <Input
            id={`${id}-custom`}
            name="quotaCustom"
            data-testid={`${testIdPrefix}-custom`}
            defaultValue={known ? '' : defaultQuota}
            maxLength={50}
            placeholder="e.g. defence_ward"
            disabled={disabled}
            required
          />
        </FormField>
      ) : (
        <input type="hidden" name="quotaCustom" value="" />
      )}
    </div>
  );
}
