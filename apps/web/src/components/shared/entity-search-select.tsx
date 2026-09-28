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
  emptyMessage = 'No directory entries loaded. Add students or staff first, or try again when the directory API is available.',
  className,
  onValueChange,
  presentation = 'select',
}: {
  id: string;
  name: string;
  label: string;
  options: EntityLabelOption[];
  defaultValue?: string;
  required?: boolean;
  placeholder?: string;
  /** Shown instead of a paste field when the directory is empty. */
  emptyMessage?: string;
  className?: string;
  /** Fired when the chosen id changes. The select `name` still submits the id. */
  onValueChange?: (id: string) => void;
  /**
   * `select` keeps the native list under the search box.
   * `combobox` is one field: type to filter, choose a match, submit the id.
   */
  presentation?: 'select' | 'combobox';
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
        <div className="space-y-1.5">
          <input type="hidden" id={id} name={name} value="" />
          <p
            className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
            role="status"
          >
            {emptyMessage}
          </p>
        </div>
      ) : presentation === 'combobox' ? (
        <div className="space-y-1.5">
          <input type="hidden" name={name} value={value} />
          <Input
            id={id}
            value={query}
            required={required}
            onChange={(e) => {
              setQuery(e.target.value);
              setValue('');
              onValueChange?.('');
            }}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={query.trim().length > 0 && filtered.length > 0}
            aria-controls={`${id}-listbox`}
            aria-autocomplete="list"
          />
          {query.trim().length > 0 && (
            <ul
              id={`${id}-listbox`}
              role="listbox"
              className="max-h-48 overflow-auto rounded-md border border-border bg-background"
            >
              {filtered.slice(0, 8).map((option) => (
                <li key={option.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    aria-selected={value === option.id}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setValue(option.id);
                      setQuery(option.label);
                      onValueChange?.(option.id);
                    }}
                  >
                    {option.label}
                  </button>
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted-foreground">No matches</li>
              )}
            </ul>
          )}
        </div>
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
            onChange={(e) => {
              setValue(e.target.value);
              onValueChange?.(e.target.value);
            }}
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
