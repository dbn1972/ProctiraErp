'use client';

/**
 * Dialog to create a class section for an institution (POST /classes).
 */
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';
import {
  createClassSectionAction,
  type ActionResult,
} from '@/lib/institutions/actions';
import {
  classSectionFormSchema,
  type ClassSectionFormValues,
} from '@/lib/institutions/validation';

interface Option {
  id: string;
  name: string;
  code?: string;
}

interface AddClassSectionButtonProps {
  institutionId: string;
  grades: Option[];
  periods: Option[];
}

export function AddClassSectionButton({
  institutionId,
  grades,
  periods,
}: AddClassSectionButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<ClassSectionFormValues>({
    resolver: zodResolver(classSectionFormSchema),
    defaultValues: {
      institutionId,
      gradeId: '',
      academicPeriodId: '',
      name: '',
      capacity: '',
    },
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = form;

  useEffect(() => {
    if (open) {
      reset({
        institutionId,
        gradeId: grades[0]?.id ?? '',
        academicPeriodId: periods[0]?.id ?? '',
        name: '',
        capacity: '',
      });
      setServerError(null);
    }
  }, [open, institutionId, grades, periods, reset]);

  const gradeId = watch('gradeId');
  const academicPeriodId = watch('academicPeriodId');
  const canSubmit = grades.length > 0 && periods.length > 0;

  function onSubmit(values: ClassSectionFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result: ActionResult<{ id: string }> = await createClassSectionAction(
        values,
        institutionId,
      );
      if (!result.success) {
        setServerError(result.error);
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <Button
        size="sm"
        type="button"
        disabled={!canSubmit}
        title={
          canSubmit
            ? 'Add a class section'
            : 'Add grades and an academic period before creating sections'
        }
        onClick={() => setOpen(true)}
      >
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Add section
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add class section</DialogTitle>
            <DialogDescription>
              Create a section for a grade within an academic period.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <input type="hidden" {...register('institutionId')} />
            <div className="space-y-1.5">
              <Label htmlFor="section-grade">Grade</Label>
              <Select
                value={gradeId || undefined}
                onValueChange={(v) => setValue('gradeId', v, { shouldValidate: true })}
              >
                <SelectTrigger id="section-grade">
                  <SelectValue placeholder="Select grade" />
                </SelectTrigger>
                <SelectContent>
                  {grades.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.code ? `${g.code} · ${g.name}` : g.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.gradeId ? (
                <p className="text-xs text-destructive">{errors.gradeId.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="section-period">Academic period</Label>
              <Select
                value={academicPeriodId || undefined}
                onValueChange={(v) =>
                  setValue('academicPeriodId', v, { shouldValidate: true })
                }
              >
                <SelectTrigger id="section-period">
                  <SelectValue placeholder="Select period" />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.academicPeriodId ? (
                <p className="text-xs text-destructive">
                  {errors.academicPeriodId.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="section-name">Section name</Label>
              <Input id="section-name" placeholder="A" {...register('name')} />
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="section-capacity">Capacity (optional)</Label>
              <Input
                id="section-capacity"
                type="number"
                min={1}
                {...register('capacity')}
              />
              {errors.capacity ? (
                <p className="text-xs text-destructive">{String(errors.capacity.message)}</p>
              ) : null}
            </div>
            {serverError ? (
              <p className="text-sm text-destructive" role="alert">
                {serverError}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? (
                  <Loader2 className="me-1.5 h-4 w-4 animate-spin" aria-hidden="true" />
                ) : null}
                Create section
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
