'use client';

/**
 * Transfer form — Client Component.
 *
 * - Lets the user pick a destination institution via the AreaPicker (filtered)
 *   plus a flat institution list, then capture grade, academic period, transfer
 *   date, and reason.
 * - Submits via the `transferStudentAction` Server Action.
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
  Textarea,
} from '@proctira/ui/components';
import { transferFormSchema, type TransferFormValues } from '@/lib/validation/student-schema';

import {
  getInstitutionClassesAction,
  getInstitutionGradesAction,
  getInstitutionPeriodsAction,
  transferStudentAction,
  type ActionState,
} from '../../../actions';

interface ActiveEnrollment {
  id: string;
  institutionId: string;
  gradeId: string;
  academicPeriodId: string;
  /** School and class/section. Never the enrollment UUID. */
  label: string;
}

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

interface TransferFormProps {
  studentId: string;
  activeEnrollments: ActiveEnrollment[];
  institutions: InstitutionLite[];
  areas: AreaLite[];
}

export function TransferForm({
  studentId,
  activeEnrollments,
  institutions,
  areas,
}: TransferFormProps) {
  const router = useRouter();
  const [selectedAreaIds, setSelectedAreaIds] = useState<string[]>([]);
  const [grades, setGrades] = useState<{ id: string; name: string }[]>([]);
  const [periods, setPeriods] = useState<{ id: string; name: string }[]>([]);
  const [classes, setClasses] = useState<
    { id: string; name: string; gradeId: string; academicPeriodId: string }[]
  >([]);
  const [serverState, setServerState] = useState<ActionState<{ transferId: string }> | null>(null);
  const [isPending, setIsPending] = useState(false);

  const defaultEnrollment = activeEnrollments[0];

  const form = useForm<TransferFormValues>({
    resolver: zodResolver(transferFormSchema),
    defaultValues: {
      sourceEnrollmentId: defaultEnrollment?.id ?? '',
      destinationInstitutionId: '',
      destinationGradeId: '',
      destinationClassId: '',
      academicPeriodId: '',
      transferDate: new Date().toISOString().slice(0, 10),
      reason: '',
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

  const destinationInstitutionId = watch('destinationInstitutionId');
  const destinationGradeId = watch('destinationGradeId');
  const academicPeriodId = watch('academicPeriodId');

  const filteredClasses = useMemo(() => {
    if (!destinationGradeId) return classes;
    return classes.filter((section) => section.gradeId === destinationGradeId);
  }, [classes, destinationGradeId]);

  // Build the area picker tree.
  const areaTree: AreaPickerNode[] = useMemo(() => buildAreaTree(areas), [areas]);

  // Filter the institution list by selected areas (if any).
  const filteredInstitutions = useMemo(() => {
    if (selectedAreaIds.length === 0) return institutions;
    const selected = new Set(selectedAreaIds);
    return institutions.filter((inst) => inst.areaId !== null && selected.has(inst.areaId));
  }, [institutions, selectedAreaIds]);

  // When destination institution changes, fetch its grades and academic periods.
  useEffect(() => {
    if (!destinationInstitutionId) {
      setGrades([]);
      setPeriods([]);
      setClasses([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [gradeList, periodList] = await Promise.all([
          getInstitutionGradesAction(destinationInstitutionId),
          getInstitutionPeriodsAction(destinationInstitutionId),
        ]);
        if (!cancelled) {
          setGrades(gradeList);
          setPeriods(periodList);
          setClasses([]);
          setValue('destinationGradeId', '');
          setValue('academicPeriodId', '');
          setValue('destinationClassId', '');
        }
      } catch {
        if (!cancelled) {
          setGrades([]);
          setPeriods([]);
          setClasses([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destinationInstitutionId, setValue]);

  useEffect(() => {
    if (!destinationInstitutionId || !academicPeriodId) {
      setClasses([]);
      setValue('destinationClassId', '');
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const classList = await getInstitutionClassesAction(
          destinationInstitutionId,
          academicPeriodId,
        );
        if (!cancelled) {
          setClasses(classList);
          setValue('destinationClassId', '');
        }
      } catch {
        if (!cancelled) {
          setClasses([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [destinationInstitutionId, academicPeriodId, setValue]);

  async function onSubmit(values: TransferFormValues) {
    setIsPending(true);
    setServerState(null);
    try {
      const result = await transferStudentAction(studentId, values);
      setServerState(result);
      if (result.status === 'error' && result.fieldErrors) {
        for (const [field, message] of Object.entries(result.fieldErrors)) {
          setError(field as keyof TransferFormValues, { type: 'server', message });
        }
      }
      if (result.status === 'success') {
        router.push(`/students/${studentId}?transfer=submitted`);
        router.refresh();
      }
    } finally {
      setIsPending(false);
    }
  }

  return (
    <form
      noValidate
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
        id="sourceEnrollmentId"
        label="Source enrollment"
        required
        error={errors.sourceEnrollmentId?.message ?? null}
      >
        <Select
          value={watch('sourceEnrollmentId')}
          onValueChange={(value) => setValue('sourceEnrollmentId', value, { shouldValidate: true })}
        >
          <SelectTrigger id="sourceEnrollmentId">
            <SelectValue placeholder="Select source enrollment" />
          </SelectTrigger>
          <SelectContent>
            {activeEnrollments.map((enrollment) => (
              <SelectItem key={enrollment.id} value={enrollment.id}>
                {enrollment.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id="destinationArea"
        label="Filter by area"
        hint="Optional — narrow the destination institution list."
      >
        <AreaPicker
          areas={areaTree}
          selectedIds={selectedAreaIds}
          onSelect={(ids) => setSelectedAreaIds(ids)}
          ariaLabel="Filter destination institutions by area"
          searchable
          multiple
          placeholder="Select one or more areas"
        />
      </FormField>

      <FormField
        id="destinationInstitutionId"
        label="Destination institution"
        required
        error={errors.destinationInstitutionId?.message ?? null}
      >
        <Select
          value={destinationInstitutionId}
          onValueChange={(value) =>
            setValue('destinationInstitutionId', value, { shouldValidate: true })
          }
        >
          <SelectTrigger id="destinationInstitutionId">
            <SelectValue placeholder="Select destination" />
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
        <FormField
          id="destinationGradeId"
          label="Destination grade"
          required
          error={errors.destinationGradeId?.message ?? null}
        >
          <Select
            value={watch('destinationGradeId')}
            onValueChange={(value) =>
              setValue('destinationGradeId', value, { shouldValidate: true })
            }
            disabled={!destinationInstitutionId}
          >
            <SelectTrigger id="destinationGradeId">
              <SelectValue placeholder="Select grade" />
            </SelectTrigger>
            <SelectContent>
              {grades.length === 0 ? (
                <SelectItem value="__none" disabled>
                  Select an institution first
                </SelectItem>
              ) : (
                grades.map((grade) => (
                  <SelectItem key={grade.id} value={grade.id}>
                    {grade.name}
                  </SelectItem>
                ))
              )}
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
            onValueChange={(value) => setValue('academicPeriodId', value, { shouldValidate: true })}
            disabled={!destinationInstitutionId}
          >
            <SelectTrigger id="academicPeriodId">
              <SelectValue placeholder="Select academic period" />
            </SelectTrigger>
            <SelectContent>
              {periods.length === 0 ? (
                <SelectItem value="__none" disabled>
                  Select an institution first
                </SelectItem>
              ) : (
                periods.map((period) => (
                  <SelectItem key={period.id} value={period.id}>
                    {period.name}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        </FormField>
      </div>

      <FormField
        id="destinationClassId"
        label="Destination class / section"
        required
        error={errors.destinationClassId?.message ?? null}
        hint="Transfers must place the student in a destination section for the selected grade and period."
      >
        <Select
          value={watch('destinationClassId')}
          onValueChange={(value) => setValue('destinationClassId', value, { shouldValidate: true })}
          disabled={
            !destinationInstitutionId ||
            !destinationGradeId ||
            !academicPeriodId ||
            filteredClasses.length === 0
          }
        >
          <SelectTrigger id="destinationClassId" data-testid="transfer-class-select">
            <SelectValue
              placeholder={
                !destinationInstitutionId
                  ? 'Select a destination institution first'
                  : !destinationGradeId
                    ? 'Select a destination grade first'
                    : !academicPeriodId
                      ? 'Select an academic period first'
                      : filteredClasses.length === 0
                        ? 'No classes for this grade and period'
                        : 'Select class / section'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {filteredClasses.length === 0 ? (
              <SelectItem value="__none" disabled>
                No classes match the selected grade and period
              </SelectItem>
            ) : (
              filteredClasses.map((section) => (
                <SelectItem key={section.id} value={section.id}>
                  {section.name}
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
      </FormField>

      <FormField
        id="transferDate"
        label="Effective date"
        required
        error={errors.transferDate?.message ?? null}
      >
        <Input
          id="transferDate"
          type="date"
          {...register('transferDate')}
          aria-invalid={Boolean(errors.transferDate)}
        />
      </FormField>

      <FormField
        id="reason"
        label="Reason for transfer"
        required
        error={errors.reason?.message ?? null}
        hint="Provide context for the approver. Up to 500 characters."
      >
        <Textarea
          id="reason"
          rows={4}
          {...register('reason')}
          aria-invalid={Boolean(errors.reason)}
        />
      </FormField>

      <div className="flex justify-end gap-3">
        <Button type="button" variant="outline" onClick={() => router.back()} disabled={isPending}>
          Cancel
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending ? 'Submitting…' : 'Submit transfer for approval'}
        </Button>
      </div>
    </form>
  );
}

/** Build a tree from a flat list of areas. */
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
