'use client';

/**
 * Dialog to create a grade (POST /grades).
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
} from '@proctira/ui/components';
import {
  createGradeAction,
  type ActionResult,
} from '@/lib/institutions/actions';
import {
  gradeFormSchema,
  type GradeFormValues,
} from '@/lib/institutions/validation';

interface AddGradeButtonProps {
  /** Suggested next order value (max existing + 1). */
  nextOrder?: number;
  institutionId: string;
}

export function AddGradeButton({
  nextOrder = 0,
  institutionId,
}: AddGradeButtonProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<GradeFormValues>({
    resolver: zodResolver(gradeFormSchema),
    defaultValues: { name: '', code: '', order: nextOrder },
  });

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = form;

  useEffect(() => {
    if (open) {
      reset({ name: '', code: '', order: nextOrder });
      setServerError(null);
    }
  }, [open, nextOrder, reset]);

  function onSubmit(values: GradeFormValues) {
    setServerError(null);
    startTransition(async () => {
      const result: ActionResult<{ id: string }> = await createGradeAction(
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
      <Button size="sm" type="button" onClick={() => setOpen(true)}>
        <Plus className="me-1.5 h-4 w-4" aria-hidden="true" />
        Add grade
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add grade</DialogTitle>
            <DialogDescription>
              Grades are tenant-wide catalog levels used when configuring sections.
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={handleSubmit(onSubmit)} noValidate>
            <div className="space-y-1.5">
              <Label htmlFor="grade-name">Name</Label>
              <Input id="grade-name" placeholder="Grade VIII" {...register('name')} />
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grade-code">Code</Label>
              <Input id="grade-code" placeholder="VIII" {...register('code')} />
              {errors.code ? (
                <p className="text-xs text-destructive">{errors.code.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="grade-order">Sort order</Label>
              <Input id="grade-order" type="number" min={0} {...register('order')} />
              {errors.order ? (
                <p className="text-xs text-destructive">{errors.order.message}</p>
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
                Create grade
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
