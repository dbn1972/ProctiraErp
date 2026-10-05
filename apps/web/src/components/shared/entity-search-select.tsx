'use client';

/**
 * Searchable select for entity ids — shows human labels (G-302).
 * Options are `{ id, label }`; filter is client-side on label text.
 *
 * PRC-M063: load failures and loading states are distinct from an empty
 * directory, a required field can never submit an empty id, and the
 * combobox presentation follows the ARIA combobox/listbox keyboard pattern
 * (ArrowUp/ArrowDown move, Enter selects, Escape closes).
 *
 * PRC-M083: with `remoteSearch` the picker also searches the full
 * directory server-side (`/api/directory/search`) so entries beyond the
 * capped first page can be found, and `totalAvailable` renders a
 * truncation notice when the seeded list is partial.
 */
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';

import { Input, Label } from '@proctira/ui/components';

import type { EntityLabelOption } from '@/lib/entity-label';

const MAX_COMBOBOX_OPTIONS = 8;

export function EntitySearchSelect({
  id,
  name,
  label,
  options,
  defaultValue = '',
  required = false,
  placeholder = 'Search by code or name…',
  emptyMessage = 'No directory entries loaded. Add students or staff first, or try again when the directory API is available.',
  error = null,
  loading = false,
  loadingMessage = 'Loading directory…',
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
  /** Load failure message. Rendered as an alert instead of the empty message. */
  error?: string | null;
  /** True while options are still loading. */
  loading?: boolean;
  loadingMessage?: string;
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
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
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
  const comboboxOptions = filtered.slice(0, MAX_COMBOBOX_OPTIONS);
  const listboxId = `${id}-listbox`;
  const optionId = (index: number) => `${id}-option-${index}`;
  const listOpen = open && query.trim().length > 0;

  function setChosen(nextId: string) {
    setValue(nextId);
    onValueChange?.(nextId);
    onOptionSelected?.(nextId ? (allOptions.find((o) => o.id === nextId) ?? null) : null);
  }

  function choose(option: EntityLabelOption) {
    setQuery(option.label);
    setOpen(false);
    setActiveIndex(-1);
    setChosen(option.id);
  }

  function onComboboxKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (comboboxOptions.length === 0 ? -1 : (i + 1) % comboboxOptions.length));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) =>
        comboboxOptions.length === 0
          ? -1
          : (i - 1 + comboboxOptions.length) % comboboxOptions.length,
      );
    } else if (event.key === 'Enter') {
      const option = listOpen ? comboboxOptions[activeIndex] : undefined;
      if (option) {
        event.preventDefault();
        choose(option);
      }
    } else if (event.key === 'Escape') {
      if (listOpen) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
    }
  }

  // With `remoteSearch`, an empty first page can still be searched (PRC-M083).
  const unavailable = loading || Boolean(error) || (options.length === 0 && !remoteSearch);
  const statusId = `${id}-status`;
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
      {unavailable ? (
        <div className="space-y-1.5">
          {/*
           * A required select with no choosable option blocks native form
           * submission, so an unloaded directory can never submit an empty id.
           */}
          <select
            id={id}
            name={name}
            required={required}
            value=""
            onChange={() => undefined}
            aria-describedby={statusId}
            aria-busy={loading || undefined}
            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground"
          >
            <option value="">{loading ? loadingMessage : 'Unavailable'}</option>
          </select>
          {error ? (
            <p
              id={statusId}
              role="alert"
              className="rounded-md border border-destructive/40 px-3 py-2 text-sm text-destructive"
              data-testid={`${id}-error`}
            >
              {error}
            </p>
          ) : (
            <p
              id={statusId}
              className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground"
              role="status"
            >
              {loading ? loadingMessage : emptyMessage}
            </p>
          )}
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
              setOpen(true);
              setActiveIndex(-1);
              setChosen('');
            }}
            onKeyDown={onComboboxKeyDown}
            onBlur={() => setOpen(false)}
            placeholder={placeholder}
            autoComplete="off"
            role="combobox"
            aria-expanded={listOpen && comboboxOptions.length > 0}
            aria-controls={listboxId}
            aria-autocomplete="list"
            aria-activedescendant={listOpen && activeIndex >= 0 ? optionId(activeIndex) : undefined}
          />
          {listOpen && (
            <ul
              id={listboxId}
              role="listbox"
              aria-label={label}
              className="max-h-48 overflow-auto rounded-md border border-border bg-background"
            >
              {comboboxOptions.map((option, index) => (
                <li
                  key={option.id}
                  id={optionId(index)}
                  role="option"
                  aria-selected={value === option.id || index === activeIndex}
                  className={`cursor-pointer px-3 py-2 text-left text-sm hover:bg-muted ${
                    index === activeIndex ? 'bg-muted' : ''
                  }`}
                  // mousedown keeps focus on the input (blur would close first).
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                >
                  {option.label}
                </li>
              ))}
              {comboboxOptions.length === 0 && (
                <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">
                  No matches
                </li>
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
            onChange={(e) => setChosen(e.target.value)}
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
