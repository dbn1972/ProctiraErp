'use client';

/**
 * G-901 — create dialogs for grades and class sections. Replaces the inert
 * "Add grade" / "Add section" buttons on the institution Grades and Classes
 * tabs with working Server-Action-backed forms.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Plus } from 'lucide-react';

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
} from '@proctira/ui/components';
import {
  createClassSectionAction,
  createGradeAction,
  type ActionResult,
} from '@/lib/institutions/actions';
import { useHydrated } from '@/hooks/useHydrated';
import type { AcademicPeriod, Grade } from '@/lib/institutions/types';

function fieldError(result: ActionResult<unknown> | null, field: string): string | undefined {
  if (!result || result.success) return undefined;
  return result.fieldErrors?.find((e) => e.field === field)?.message;
}

export function AddGradeDialog() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult<{ id: string }> | null>(null);
  const [isPending, startTransition] = useTransition();

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const res = await createGradeAction({
        name: String(formData.get('name') ?? ''),
        code: String(formData.get('code') ?? ''),
        order: Number(formData.get('order') ?? 0),
      });
      setResult(res);
      if (res.success) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="add-grade"
        data-hydrated={hydrated ? 'true' : 'false'}
      >
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Add grade
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-hydrated="true">
          <form action={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add grade</DialogTitle>
              <DialogDescription>
                Grades are tenant-wide levels (e.g. Grade 7) that sections are created under.
              </DialogDescription>
            </DialogHeader>
            {result && !result.success && (
              <p role="alert" className="text-sm text-destructive">
                {result.error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="grade-name">Name</Label>
                <Input id="grade-name" name="name" required placeholder="Grade 7" />
                {fieldError(result, 'name') && (
                  <p className="text-xs text-destructive">{fieldError(result, 'name')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grade-code">Code</Label>
                <Input id="grade-code" name="code" required placeholder="G7" />
                {fieldError(result, 'code') && (
                  <p className="text-xs text-destructive">{fieldError(result, 'code')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="grade-order">Order</Label>
                <Input
                  id="grade-order"
                  name="order"
                  type="number"
                  min={0}
                  required
                  defaultValue={1}
                />
                {fieldError(result, 'order') && (
                  <p className="text-xs text-destructive">{fieldError(result, 'order')}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Create grade
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export interface AddClassSectionDialogProps {
  institutionId: string;
  grades: Grade[];
  periods: AcademicPeriod[];
}

export function AddClassSectionDialog({
  institutionId,
  grades,
  periods,
}: AddClassSectionDialogProps) {
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<ActionResult<{ id: string }> | null>(null);
  const [isPending, startTransition] = useTransition();
  const activePeriod = periods.find((p) => p.status === 'active') ?? periods[0];
  const blocked = grades.length === 0 || periods.length === 0;

  const onSubmit = (formData: FormData) => {
    startTransition(async () => {
      const capacity = String(formData.get('capacity') ?? '');
      const res = await createClassSectionAction({
        institutionId,
        gradeId: String(formData.get('gradeId') ?? ''),
        academicPeriodId: String(formData.get('academicPeriodId') ?? ''),
        name: String(formData.get('name') ?? ''),
        capacity: capacity === '' ? '' : Number(capacity),
      });
      setResult(res);
      if (res.success) {
        setOpen(false);
        router.refresh();
      }
    });
  };

  return (
    <>
      <Button
        size="sm"
        onClick={() => setOpen(true)}
        data-testid="add-section"
        data-hydrated={hydrated ? 'true' : 'false'}
        disabled={blocked}
        title={blocked ? 'Define at least one grade and one academic period first' : undefined}
      >
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Add section
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-hydrated="true">
          <form action={onSubmit} className="space-y-4">
            <DialogHeader>
              <DialogTitle>Add class section</DialogTitle>
              <DialogDescription>
                A section belongs to one grade in one academic period for this institution.
              </DialogDescription>
            </DialogHeader>
            {result && !result.success && (
              <p role="alert" className="text-sm text-destructive">
                {result.error}
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="section-grade">Grade</Label>
                <select
                  id="section-grade"
                  name="gradeId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue={grades[0]?.id}
                >
                  {grades
                    .slice()
                    .sort((a, b) => a.order - b.order)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.code})
                      </option>
                    ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="section-period">Academic period</Label>
                <select
                  id="section-period"
                  name="academicPeriodId"
                  required
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  defaultValue={activePeriod?.id}
                >
                  {periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="section-name">Section name</Label>
                <Input id="section-name" name="name" required placeholder="A" />
                {fieldError(result, 'name') && (
                  <p className="text-xs text-destructive">{fieldError(result, 'name')}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="section-capacity">Capacity</Label>
                <Input
                  id="section-capacity"
                  name="capacity"
                  type="number"
                  min={1}
                  placeholder="40"
                />
                {fieldError(result, 'capacity') && (
                  <p className="text-xs text-destructive">{fieldError(result, 'capacity')}</p>
                )}
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Create section
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
