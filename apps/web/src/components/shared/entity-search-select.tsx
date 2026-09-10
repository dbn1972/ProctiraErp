'use client';

/**
 * Searchable select for entity ids — shows human labels (G-302).
 * Options are `{ id, label }`; filter is client-side on label text.
 */
import { useMemo, useState } from 'react';

import { Input, Label } from '@proctira/ui/components';

import type { EntityLabelOption } from '@/lib/entity-label';

export function EntitySearchSelect({
  id,
  name,
  label,
  options,
  defaultValue = '',
  required = false,
  placeholder = 'Search by code or name…',
  className,
}: {
  id: string;
  name: string;
  label: string;
  options: EntityLabelOption[];
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const [query, setQuery] = useState('');
  const [value, setValue] = useState(defaultValue);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options.slice(0, 50);
    return options
      .filter((o) => {
        const hay = `${o.label} ${o.searchText ?? ''} ${o.id}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 50);
  }, [options, query]);

  const selectedLabel = options.find((o) => o.id === value)?.label;

  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {options.length === 0 ? (
        <Input
          id={id}
          name={name}
          required={required}
          defaultValue={defaultValue}
          autoComplete="off"
          placeholder="No directory loaded — enter id"
        />
      ) : (
        <>
          <Input
            id={`${id}-search`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            autoComplete="off"
            aria-label={`${label} search`}
          />
          <select
            id={id}
            name={name}
            required={required}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="">{selectedLabel ? `Selected: ${selectedLabel}` : 'Select…'}</option>
            {filtered.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          {value && selectedLabel ? (
            <p className="text-xs text-muted-foreground" data-testid={`${id}-selected-label`}>
              {selectedLabel}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
