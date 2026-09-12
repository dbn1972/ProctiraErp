'use client';

/**
 * Enroll form — place an existing student into an institution / grade / period.
 *
 * Mirrors TransferForm patterns (AreaPicker, grade/period lookups, Server Action).
 */
import { zodResolver } from '@hookform/resolvers/zod';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';

import { AreaPicker } from '@proctira/ui/area-picker';
import type { AreaNode as AreaPickerNode } from '@proctira/ui/area-picker';
import {
  Button,
  FormField,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@proctira/ui/components';
import { enrollmentFormSchema, type EnrollmentFormValues } from '@/lib/validation/student-schema';

import {
  enrollStudentAction,
  getInstitutionGradesAction,
  getInstitutionPeriodsAction,
  type ActionState,
} from '../../../actions';

interface InstitutionLite {
  id: string;
  name: string;
  areaId: string | null;
}

interface AreaLite {
  id: string;
  name: string;
  parentId: string | null;
  level: number;
}

interface EnrollFormProps {
  studentId: string;
  institutions: InstitutionLite[];
  areas: AreaLite[];
}

function buildAreaTree(flat: AreaLite[]): AreaPickerNode[] {
  const byId = new Map<string, AreaPickerNode>();
  for (const item of flat) {
    byId.set(item.id, {
      id: item.id,
      name: item.name,
      parentId: item.parentId,
      level: item.level,
      children: [],
    });
  }
  const roots: AreaPickerNode[] = [];
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      const parent = byId.get(node.parentId);
      parent?.children?.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

export function EnrollForm({ studentId, institutions, areas }: EnrollFormProps) {
  const router = useRouter();
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [grades, setGrades] = useState<{ id: string; name: string }[]>([]);
  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [serverState, setServerState] = useState<ActionState<{ enrollmentId: string }> | null>(
    null,
  );
  const [isPending, setIsPending] = useState(false);

  const form = useForm<EnrollmentFormValues>({
    resolver: zodResolver(enrollmentFormSchema),
    defaultValues: {
      institutionId: '',
      gradeId: '',
      classId: '',
      academicPeriodId: '',
      enrolledAt: new Date().toISOString().slice(0, 10),
    },
    mode: 'onBlur',
  });

  const {
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    setError,
    watch,
  } = form;

  const institutionId = watch('institutionId');
  const areaTree: AreaPickerNode[] = useMemo(() => buildAreaTree(areas), [areas]);

  const filteredInstitutions = useMemo(() => {
    if (selectedAreaIds.length === 0) return institutions;
    const selected = new Set(selectedAreaIds);
    return institutions.filter((inst) => inst.areaId !== null && selected.has(inst.areaId));
  }, [institutions, selectedAreaIds]);

  useEffect(() => {
    if (!institutionId) {
      setGrades([]);
      setPeriods([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [gradeList, periodList] = await Promise.all([
          getInstitutionGradesAction(institutionId),
          getInstitutionPeriodsAction(institutionId),
        ]);
        if (!cancelled) {
          setGrades(gradeList);
          setPeriods(periodList);
          setValue('gradeId', '');
          setValue('academicPeriodId', '');
        }
      } catch {
        if (!cancelled) {
          setGrades([]);
          setPeriods([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [institutionId, setValue]);

  async function onSubmit(values: EnrollmentFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result = await enrollStudentAction(studentId, values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof EnrollmentFormValues, { type: 'server', message });
        }
      }
      if (result.status === 'success') {
        router.push(`/students/${studentId}?enrolled=1`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  if (institutions.length === 0) {
    return (
      <div
        className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
        role="status"
        data-testid="enroll-empty-institutions"
      >
        No institutions are available for this tenant. Create or sync an institution before
        enrolling students.
      </div>
    );
  }

  return (
    <form
      noValidate
      data-testid="enroll-form"
      data-hydrated="true"
      onSubmit={(event) => {
        void handleSubmit(onSubmit)(event);
      }}
      className="space-y-5"
      aria-busy={isPending}
    >
      {serverState?.status === 'error' && serverState.message && (
        <div
          className="rounded-md border border-[hsl(var(--destructive))]/40 bg-[hsl(var(--destructive))]/10 px-4 py-3 text-sm text-[hsl(var(--destructive))]"
          role="alert"
        >
          {serverState.message}
        </div>
      )}

      <FormField
        id="destinationArea"
        label="Filter by area"
        hint="Optional — narrow the institution list."
      >
        <AreaPicker
          areas={areaTree}
          selectedIds={selectedAreaIds}
          onSelect={(ids) => setSelectedAreaIds(ids)}
          ariaLabel="Filter institutions by area"
          searchable
          multiple
          placeholder="Select one or more areas"
        />
      </FormField>

      <FormField
        id="institutionId"
        label="Institution"
        required
        error={errors.institutionId?.message ?? null}
      >
        <Select
          value={institutionId}
          onValueChange={(value: string) => setValue('institutionId', value, { shouldValidate: true })}
        >
          <SelectTrigger id="institutionId">
            <SelectValue placeholder="Select institution" />
          </SelectTrigger>
          <SelectContent>
            {filteredInstitutions.length === 0 ? (
              <SelectItem value="__none" disabled>
                No institutions match the selected areas
              </SelectItem>
            ) : (
              filteredInstitutions.map((inst) => (
                <SelectItem key={inst.id} value={inst.id}>
                  {inst.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </FormField>

      <div className="grid gap-4 md:grid-cols-2">
        <FormField id="gradeId" label="Grade" required error={errors.gradeId?.message ?? null}>
          <Select
            value={watch('gradeId')}
            onValueChange={(value: string) => setValue('gradeId', value, { shouldValidate: true })}
            disabled={!institutionId || grades.length === 0}
          >
            <SelectTrigger id="gradeId">
              <SelectValue
                placeholder={
                  !institutionId
                    ? 'Select an institution first'
                    : grades.length === 0
                      ? 'No grades available'
                      : 'Select grade'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {grades.map((grade) => (
                <SelectItem key={grade.id} value={grade.id}>
                  {grade.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>

        <FormField
          id="academicPeriodId"
          label="Academic period"
          required
          error={errors.academicPeriodId?.message ?? null}
        >
          <Select
            value={watch('academicPeriodId')}
            onValueChange={(value: string) =>
              setValue('academicPeriodId', value, { shouldValidate: true })
            }
            disabled={!institutionId || periods.length === 0}
          >
            <SelectTrigger id="academicPeriodId">
              <SelectValue
                placeholder={
                  !institutionId
                    ? 'Select an institution first'
                    : periods.length === 0
                      ? 'No periods available'
                      : 'Select period'
                }
              />
            </SelectTrigger>
            <SelectContent>
              {periods.map((period) => (
                <SelectItem key={period.id} value={period.id}>
                  {period.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField
        id="enrolledAt"
        label="Enrollment date"
        required
        error={errors.enrolledAt?.message ?? null}
      >
        <Input id="enrolledAt" type="date" {...register('enrolledAt')} />
      </FormField>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button type="submit" disabled={isPending} data-testid="enroll-submit">
          {isPending ? 'Enrolling…' : 'Enroll'}
        </Button>
      </div>
    </form>
  );
}
