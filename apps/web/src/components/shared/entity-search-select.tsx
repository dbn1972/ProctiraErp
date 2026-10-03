'use client';

/**
 * Searchable select for entity ids — shows human labels (G-302).
 * Options are `{ id, label }`; filter is client-side on label text.
 *
 * PRC-M083: with `remoteSearch` the picker also searches the full
 * directory server-side (`/api/directory/search`) so entries beyond the
 * capped first page can be found, and `totalAvailable` renders a
 * truncation notice when the seeded list is partial.
 */
import { useEffect, useMemo, useState } from 'react';

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
  remoteSearch,
  totalAvailable,
  onOptionSelected,
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
  /** Also search the full directory server-side (PRC-M083). */
  remoteSearch?: 'student' | 'staff' | 'person';
  /** Directory size when `options` is only a capped first page (PRC-M083). */
  totalAvailable?: number;
  /** Fired with the full option (incl. remote results) when one is chosen. */
  onOptionSelected?: (option: EntityLabelOption | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [value, setValue] = useState(defaultValue);
  const [remoteOptions, setRemoteOptions] = useState<EntityLabelOption[]>([]);
  const [remoteState, setRemoteState] = useState<'idle' | 'loading' | 'error'>('idle');
  useEffect(() => {
    const q = query.trim();
    if (!remoteSearch || q.length < 2) {
      setRemoteState('idle');
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setRemoteState('loading');
      fetch(
        `/api/directory/search?kind=${encodeURIComponent(remoteSearch)}&q=${encodeURIComponent(q)}`,
        { signal: controller.signal, credentials: 'same-origin', cache: 'no-store' },
      )
        .then(async (res) => {
          if (!res.ok) throw new Error(String(res.status));
          const body = (await res.json()) as { data?: EntityLabelOption[] };
          setRemoteOptions((prev) => {
            const merged = new Map(prev.map((o) => [o.id, o]));
            for (const o of body.data ?? []) merged.set(o.id, o);
            return [...merged.values()];
          });
          setRemoteState('idle');
        })
        .catch((err: unknown) => {
          if ((err as { name?: string })?.name === 'AbortError') return;
          setRemoteState('error');
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, remoteSearch]);
  const allOptions = useMemo(() => {
    if (remoteOptions.length === 0) return options;
    const seen = new Set(options.map((o) => o.id));
    return [...options, ...remoteOptions.filter((o) => !seen.has(o.id))];
  }, [options, remoteOptions]);
  const truncated = totalAvailable !== undefined && totalAvailable > options.length;
  const choose = (nextId: string) => {
    setValue(nextId);
    onValueChange?.(nextId);
    onOptionSelected?.(allOptions.find((o) => o.id === nextId) ?? null);
  };
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = !q
      ? allOptions.slice(0, 50)
      : allOptions
          .filter((o) => {
            const hay = `${o.label} ${o.searchText ?? ''} ${o.id}`.toLowerCase();
            return hay.includes(q);
          })
          .slice(0, 50);
    const selected = allOptions.find((o) => o.id === value);
    if (selected && !matched.some((o) => o.id === selected.id)) {
      return [selected, ...matched].slice(0, 50);
    }
    return matched;
  }, [allOptions, query, value]);

  const selectedLabel = allOptions.find((o) => o.id === value)?.label;
  const remoteHint = remoteSearch ? (
    <p className="text-xs text-muted-foreground" role="status" aria-live="polite">
      {remoteState === 'loading'
        ? 'Searching the full directory…'
        : remoteState === 'error'
          ? 'Directory search is unavailable right now. Showing loaded entries only.'
          : truncated
            ? `Showing ${options.length.toLocaleString()} of ${(totalAvailable ?? 0).toLocaleString()}. Type at least 2 letters to search everyone.`
            : null}
    </p>
  ) : truncated ? (
    <p className="text-xs text-muted-foreground" role="status">
      Showing the first {options.length.toLocaleString()} of{' '}
      {(totalAvailable ?? 0).toLocaleString()} entries only.
    </p>
  ) : null;

  return (
    <div className={className ?? 'space-y-1.5'}>
      <Label htmlFor={id}>{label}</Label>
      {options.length === 0 && !remoteSearch ? (
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
              choose('');
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
                      setQuery(option.label);
                      choose(option.id);
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
          {remoteHint}
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
            onChange={(e) => choose(e.target.value)}
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
          {remoteHint}
        </>
      )}
    </div>
  );
}
