'use client';

import { useMemo, useState, useTransition } from 'react';
import { GraduationCap } from 'lucide-react';
import { Button, Checkbox } from '@proctira/ui/components';
import { bulkGraduateStudentsAction } from '../actions';

type Row = { studentId: string; label: string; canGraduate: boolean };

export function StudentsBulkGraduateBar({ rows }: { rows: Row[] }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const eligible = useMemo(() => rows.filter((r) => r.canGraduate), [rows]);

  function toggle(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  if (eligible.length === 0) return null;

  return (
    <div
      className="mb-3 flex flex-wrap items-center gap-3 rounded-md border border-border bg-muted/30 px-3 py-2"
      data-testid="students-bulk-graduate-bar"
    >
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {eligible.slice(0, 25).map((row) => (
          <label key={row.studentId} className="inline-flex items-center gap-1.5">
            <Checkbox
              checked={selected.has(row.studentId)}
              onCheckedChange={(v) => toggle(row.studentId, v === true)}
              aria-label={`Select ${row.label}`}
            />
            <span className="max-w-[10rem] truncate">{row.label}</span>
          </label>
        ))}
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending || selected.size === 0}
        onClick={() => {
          const ids = Array.from(selected);
          if (
            !window.confirm(
              `Graduate ${ids.length} selected student${ids.length === 1 ? '' : 's'}?`,
            )
          ) {
            return;
          }
          setMessage(null);
          startTransition(async () => {
            const result = await bulkGraduateStudentsAction(ids);
            setMessage(result.message ?? result.status);
            if (result.status === 'success') setSelected(new Set());
          });
        }}
      >
        <GraduationCap className="me-1.5 h-4 w-4" aria-hidden="true" />
        {pending ? 'Graduating…' : `Graduate selected (${selected.size})`}
      </Button>
      {message ? (
        <p className="w-full text-xs text-muted-foreground" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
}
