'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Pencil } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@proctira/ui/components';

import { assignClassSectionAction } from '@/lib/institutions/actions';
import { EntitySearchSelect } from '@/components/shared/entity-search-select';
import type { EntityLabelOption } from '@/lib/entity-label';

export function ClassPeriodFilter(props: {
  periods: { id: string; name: string; status: string }[];
  value: string;
}) {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-muted-foreground">Academic period</span>
      <select
        className="h-10 min-h-11 rounded-md border border-input bg-background px-3 text-sm"
        value={props.value}
        aria-label="Academic period"
        data-testid="class-period-filter"
        onChange={(event) => {
          const params = new URLSearchParams();
          if (event.target.value) params.set('period', event.target.value);
          const query = params.toString();
          router.push(query ? `${pathname}?${query}` : pathname);
        }}
      >
        <option value="all">All periods</option>
        {props.periods.map((period) => (
          <option key={period.id} value={period.id}>
            {period.name} · {period.status}
          </option>
        ))}
      </select>
    </label>
  );
}

export function AssignClassSectionButton(props: {
  institutionId: string;
  classId: string;
  sectionLabel: string;
  classTeacherStaffId: string | null;
  roomName: string | null;
  staffOptions: EntityLabelOption[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-11 w-11"
        aria-label={`Assign teacher and room for ${props.sectionLabel}`}
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-4 w-4" aria-hidden="true" />
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              const fd = new FormData(event.currentTarget);
              setError(null);
              startTransition(async () => {
                const result = await assignClassSectionAction({
                  institutionId: props.institutionId,
                  classId: props.classId,
                  classTeacherStaffId: String(fd.get('classTeacherStaffId') ?? ''),
                  roomName: String(fd.get('roomName') ?? ''),
                });
                if (!result.success) {
                  setError(result.error ?? 'Could not save this section');
                  return;
                }
                setOpen(false);
                router.refresh();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Assign {props.sectionLabel}</DialogTitle>
            </DialogHeader>
            <EntitySearchSelect
              id={`teacher-${props.classId}`}
              name="classTeacherStaffId"
              label="Class teacher"
              options={props.staffOptions}
              defaultValue={props.classTeacherStaffId ?? ''}
            />
            <label className="block text-sm font-medium" htmlFor={`room-${props.classId}`}>
              Room
            </label>
            <input
              id={`room-${props.classId}`}
              name="roomName"
              defaultValue={props.roomName ?? ''}
              maxLength={120}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              placeholder="Room 201"
            />
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? 'Saving…' : 'Save'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
