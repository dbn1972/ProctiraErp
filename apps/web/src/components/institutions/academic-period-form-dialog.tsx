'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2 } from 'lucide-react';

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
  createAcademicPeriodAction,
  updateAcademicPeriodAction,
  type ActionResult,
} from '@/lib/institutions/actions';
import {
  academicPeriodFormSchema,
  type AcademicPeriodFormValues,
} from '@/lib/institutions/validation';
import type { AcademicPeriod, AcademicPeriodStatus } from '@/lib/institutions/types';

export interface AcademicPeriodFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialValue?: AcademicPeriod;
}

export function AcademicPeriodFormDialog({
  open,
  onOpenChange,
  initialValue,
}: AcademicPeriodFormDialogProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<AcademicPeriodFormValues>({
    resolver: zodResolver(academicPeriodFormSchema),
    defaultValues: {
      name: '',
      code: '',
      startDate: '',
      endDate: '',
      status: 'inactive',
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

  const status = watch('status');

  useEffect(() => {
    if (open) {
      reset({
        name: initialValue?.name ?? '',
        code: initialValue?.code ?? '',
        startDate: initialValue?.startDate ?? '',
        endDate: initialValue?.endDate ?? '',
        status: initialValue?.status ?? 'inactive',
      });
      setServerError(null);
    }
  }, [open, initialValue, reset]);

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    startTransition(async () => {
      const result: ActionResult<{ id: string }> = initialValue
        ? await updateAcademicPeriodAction(initialValue.id, values)
        : await createAcademicPeriodAction(values);
      if (result.success) {
        onOpenChange(false);
        router.refresh();
        return;
      }
      setServerError(result.error);
    });
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {initialValue ? 'Edit academic period' : 'New academic period'}
          </DialogTitle>
          <DialogDescription>
            Define the academic year or term boundaries used by enrollment,
            attendance, and assessment workflows.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          className="space-y-4"
        >
          {serverError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
            >
              {serverError}
            </div>
          )}

          <div className="space-y-2">
            <Label htmlFor="ap-name">
              Name <span className="text-destructive">*</span>
            </Label>
            <Input id="ap-name" {...register('name')} disabled={isPending} />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ap-code">
              Code <span className="text-destructive">*</span>
            </Label>
            <Input id="ap-code" {...register('code')} disabled={isPending} />
            {errors.code && (
              <p className="text-sm text-destructive">{errors.code.message}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="ap-start">
                Start <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ap-start"
                type="date"
                {...register('startDate')}
                disabled={isPending}
              />
              {errors.startDate && (
                <p className="text-sm text-destructive">{errors.startDate.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="ap-end">
                End <span className="text-destructive">*</span>
              </Label>
              <Input
                id="ap-end"
                type="date"
                {...register('endDate')}
                disabled={isPending}
              />
              {errors.endDate && (
                <p className="text-sm text-destructive">{errors.endDate.message}</p>
              )}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ap-status">Status</Label>
            <Select
              value={status ?? 'inactive'}
              onValueChange={(value) =>
                setValue('status', value as AcademicPeriodStatus, {
                  shouldValidate: true,
                })
              }
              disabled={isPending}
            >
              <SelectTrigger id="ap-status">
                <SelectValue placeholder="Select a status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="archived">Archived</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <DialogFooter className="gap-2 sm:space-x-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              {initialValue ? 'Save changes' : 'Create period'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
