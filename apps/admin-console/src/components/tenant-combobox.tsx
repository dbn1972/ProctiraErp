'use client';

import { useMemo, useState } from 'react';

import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

export interface TenantOption {
  id: string;
  name: string;
  slug: string;
}

interface TenantComboboxProps {
  id: string;
  /** When set, the selected id is submitted with the owning form. */
  name?: string;
  tenants: TenantOption[];
  defaultValue?: string;
  onValueChange?: (tenantId: string) => void;
  includePlatform?: boolean;
  /** Adds an "all tenants" choice that reports an empty id. */
  allowAll?: boolean;
  allLabel?: string;
  required?: boolean;
  placeholder?: string;
  'aria-invalid'?: boolean;
}

/**
 * Tenant picker with name/slug search. Submits the tenant id, never asks the
 * operator to type a UUID.
 */
export function TenantCombobox({
  id,
  name,
  tenants,
  defaultValue,
  onValueChange,
  includePlatform = false,
  allowAll = false,
  allLabel = 'All tenants',
  required = false,
  placeholder = 'Select a tenant',
  'aria-invalid': ariaInvalid,
}: TenantComboboxProps) {
  const [query, setQuery] = useState('');
  const [value, setValue] = useState<string | undefined>(defaultValue || undefined);

  const options = useMemo(() => {
    const base: TenantOption[] = [];
    if (includePlatform) {
      base.push({ id: 'platform', name: 'Platform', slug: 'platform' });
    }
    for (const tenant of tenants) {
      if (!base.some((option) => option.id === tenant.id)) base.push(tenant);
    }
    if (defaultValue && !base.some((option) => option.id === defaultValue)) {
      base.push({
        id: defaultValue,
        name: 'Unlisted tenant',
        slug: defaultValue,
      });
    }
    const q = query.trim().toLowerCase();
    const filtered = !q
      ? base
      : base.filter((tenant) => {
          return (
            tenant.name.toLowerCase().includes(q) ||
            tenant.slug.toLowerCase().includes(q) ||
            tenant.id.toLowerCase().includes(q)
          );
        });
    if (value && !filtered.some((tenant) => tenant.id === value)) {
      const selected = base.find((tenant) => tenant.id === value);
      if (selected) return [selected, ...filtered];
    }
    return filtered;
  }, [defaultValue, includePlatform, query, tenants, value]);

  const selectValue = value && value.length > 0 ? value : allowAll ? 'all' : undefined;

  function change(next: string) {
    if (next === 'all') {
      setValue(undefined);
      onValueChange?.('');
      return;
    }
    setValue(next);
    onValueChange?.(next);
  }

  return (
    <div className="space-y-1.5">
      <Input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
        placeholder="Search by name"
        aria-label="Search tenants by name"
        autoComplete="off"
      />
      <Select name={name} value={selectValue} onValueChange={change} required={required}>
        <SelectTrigger id={id} aria-invalid={ariaInvalid || undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {allowAll && <SelectItem value="all">{allLabel}</SelectItem>}
          {options.length === 0 && (
            <div className="px-2 py-1.5 text-sm text-muted-foreground">No matching tenants</div>
          )}
          {options.map((tenant) => (
            <SelectItem key={tenant.id} value={tenant.id}>
              {tenant.slug && tenant.slug !== tenant.name
                ? `${tenant.name} · ${tenant.slug}`
                : tenant.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
