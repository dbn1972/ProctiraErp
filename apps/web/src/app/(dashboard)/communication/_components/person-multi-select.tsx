'use client';

import { useState } from 'react';

import { Button } from '@proctira/ui/components';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import { resolveEntityLabel, toLabelMap, type EntityLabelOption } from '@/lib/entity-label';

export function PersonMultiSelect({
  id,
  name,
  label,
  options,
  totalAvailable,
}: {
  id: string;
  name: string;
  label: string;
  options: EntityLabelOption[];
  /** Directory size when `options` is a capped first page (PRC-M083). */
  totalAvailable?: number;
}) {
  const [ids, setIds] = useState<string[]>([]);
  const [pendingId, setPendingId] = useState('');
  // Labels for people found through server-side search (PRC-M083).
  const [picked, setPicked] = useState<EntityLabelOption[]>([]);
  const labels = toLabelMap([...options, ...picked]);
  const remaining = options.filter((option) => !ids.includes(option.id));

  function addPending() {
    if (!pendingId || ids.includes(pendingId)) return;
    setIds((current) => [...current, pendingId]);
    setPendingId('');
  }

  return (
    <div className="space-y-2" data-testid={`${id}-picker`}>
      {ids.map((personId) => (
        <input key={personId} type="hidden" name={name} value={personId} />
      ))}
      {ids.length === 0 ? (
        <p className="text-sm text-muted-foreground" role="status">
          No recipients added yet. Search by name, then add them.
        </p>
      ) : (
        <ul className="divide-y divide-border rounded-md border" role="list">
          {ids.map((personId) => (
            <li
              key={personId}
              className="flex items-center justify-between gap-2 px-3 py-2 text-sm"
            >
              <span>{resolveEntityLabel(personId, labels, 'Person')}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => setIds((current) => current.filter((value) => value !== personId))}
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
      <EntitySearchSelect
        id={id}
        name={`${name}Picker`}
        label={label}
        options={remaining}
        onValueChange={setPendingId}
        remoteSearch="person"
        totalAvailable={totalAvailable}
        onOptionSelected={(option) => {
          if (option && !options.some((o) => o.id === option.id)) {
            setPicked((current) =>
              current.some((o) => o.id === option.id) ? current : [...current, option],
            );
          }
        }}
        emptyMessage="No students or staff are available to address. The directory did not load."
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11"
        onClick={addPending}
        disabled={!pendingId}
      >
        Add recipient
      </Button>
    </div>
  );
}
