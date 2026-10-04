'use server';

/**
 * Server Actions for student management pages.
 *
 * All writes go through the API gateway, which is the authoritative validator
 * (schema, RBAC and tenant taken from the verified JWT). Every action also
 * validates its input here with zod (form schemas, uuid ids, enums, size caps)
 * as defence-in-depth, so malformed direct calls fail before any upstream call.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import {
  listAcademicPeriods,
  listInstitutionClasses,
  listInstitutionGrades,
} from '@/lib/api/institutions';
import {
  listAcademicPeriods as listTenantAcademicPeriods,
  listGrades as listTenantGrades,
} from '@/lib/institutions/api';
import {
  addStudentDiscipline,
  addStudentSibling,
  bulkUpdateEnrollmentStatus,
  createEnrollment,
  createStudent,
  deleteStudent,
  getStudentEnrollmentsResult,
  removeStudentDiscipline,
  setStudentConsent,
  submitBulkImport,
  validateBulkImportSize,
  transferStudent,
  updateEnrollmentStatus,
  updateStudent,
  uploadStudentPhoto,
  type BulkImportRequest,
  type CreateEnrollmentInput,
  type CreateStudentInput,
  type ImportProgress,
  type ImportResult,
  type StudentTransferInput,
  type UpdateStudentInput,
} from '@/lib/api/students';
import { safeActionErrorMessage } from '@/lib/api/action-error';
import { bulkImportInputSchema } from '@/lib/validation/action-input-schema';
import { getTenantSettings } from '@/lib/api/admin.server';
import { isoDateInTimeZone } from '@/lib/tenant-date';
import {
  enrollmentFormSchema,
  studentFormSchema,
  transferFormSchema,
  type EnrollmentFormValues,
  type StudentFormValues,
  type TransferFormValues,
} from '@/lib/validation/student-schema';
import {
  studentConsentSchema,
  studentDisciplineSchema,
  studentPhotoUploadSchema,
  studentSiblingSchema,
} from '@/lib/validation/student-360-schema';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'partial' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

/* ------------------------------------------------------------------- Create */

export async function createStudentAction(
  values: StudentFormValues,
): Promise<ActionState<{ studentId: string }>> {
  const parsed = studentFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const student = await createStudent(toCreateInput(parsed.data));
    revalidatePath('/students');
    return {
      status: 'success',
      message: 'Student created successfully.',
      data: { studentId: student.id },
    };
  } catch (error) {
    return toErrorState<{ studentId: string }>(error, 'Failed to create student');
  }
}

/* ------------------------------------------------------------------- Update */

export async function updateStudentAction(
  studentId: string,
  values: StudentFormValues,
): Promise<ActionState<{ studentId: string }>> {
  const parsed = studentFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  try {
    const student = await updateStudent(studentId, toUpdateInput(parsed.data));
    revalidatePath('/students');
    revalidatePath(`/students/${studentId}`);
    return {
      status: 'success',
      message: 'Student updated successfully.',
      data: { studentId: student.id },
    };
  } catch (error) {
    return toErrorState<{ studentId: string }>(error, 'Failed to update student');
  }
}

/* ------------------------------------------------------------------- Delete */

export async function deleteStudentAction(studentId: string): Promise<ActionState> {
  if (!UUID_RE.test(studentId)) {
    return { status: 'error', message: 'Invalid student.' };
  }
  try {
    await deleteStudent(studentId);
    revalidatePath('/students');
  } catch (error) {
    return toErrorState(error, 'Failed to delete student');
  }
  redirect('/students');
}

/* ----------------------------------------------------------------- Transfer */

export async function transferStudentAction(
  studentId: string,
  values: TransferFormValues,
): Promise<ActionState<{ transferId: string }>> {
  const parsed = transferFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: StudentTransferInput = {
    studentId,
    sourceEnrollmentId: parsed.data.sourceEnrollmentId,
    destinationInstitutionId: parsed.data.destinationInstitutionId,
    destinationGradeId: parsed.data.destinationGradeId,
    academicPeriodId: parsed.data.academicPeriodId,
    transferDate: parsed.data.transferDate,
    reason: parsed.data.reason,
    destinationClassId: parsed.data.destinationClassId,
  };

  try {
    const result = await transferStudent(payload);
    revalidatePath(`/students/${studentId}`);
    return {
      status: 'success',
      message: 'Transfer submitted for approval.',
      data: { transferId: result.transferRecord.id },
    };
  } catch (error) {
    return toErrorState<{ transferId: string }>(error, 'Failed to submit transfer');
  }
}

/* ------------------------------------------------------------ Bulk Import */

export interface BulkImportActionInput {
  fileBase64: string;
  fileName: string;
  mimeType: string;
  duplicateResolution: 'skip' | 'update' | 'create';
  async?: boolean;
}

export async function submitBulkImportAction(
  input: BulkImportActionInput,
): Promise<ActionState<ImportResult | ImportProgress>> {
  const parsed = bulkImportInputSchema.safeParse(input);
  if (!parsed.success) {
    return {
      status: 'error',
      message: parsed.error.issues[0]?.message ?? 'A file is required to start the import.',
    };
  }
  const sizeError = validateBulkImportSize(input.fileBase64);
  if (sizeError) {
    return { status: 'error', message: sizeError };
  }
  try {
    const request: BulkImportRequest = {
      fileBase64: parsed.data.fileBase64,
      fileName: parsed.data.fileName,
      mimeType: parsed.data.mimeType,
      duplicateResolution: parsed.data.duplicateResolution,
      async: parsed.data.async ?? false,
    };
    const result = await submitBulkImport(request);
    revalidatePath('/students');
    return {
      status: 'success',
      message:
        'jobId' in result
          ? `Import queued. Job ${result.jobId}.`
          : `Imported ${result.successCount} of ${result.totalRows} rows.`,
      data: result,
    };
  } catch (error) {
    return toErrorState<ImportResult | ImportProgress>(error, 'Failed to start import');
  }
}

/* ------------------------------------------------------------------ Helpers */

function toCreateInput(values: StudentFormValues): CreateStudentInput {
  const out: CreateStudentInput = {
    firstName: values.firstName,
    lastName: values.lastName,
    dateOfBirth: values.dateOfBirth,
    gender: values.gender,
    contacts: values.contacts,
    guardians: values.guardians.map(stripGuardianBlanks),
    identityDocuments: values.identityDocuments.map(stripDocumentBlanks),
    customData: values.customData,
  };
  if (values.nationalId) out.nationalId = values.nationalId;
  if (values.nationality) out.nationality = values.nationality;
  return out;
}

function toUpdateInput(values: StudentFormValues): UpdateStudentInput {
  const base = toCreateInput(values);
  return base;
}

function stripGuardianBlanks(g: StudentFormValues['guardians'][number]) {
  const out: NonNullable<CreateStudentInput['guardians']>[number] = {
    firstName: g.firstName,
    lastName: g.lastName,
    relationship: g.relationship,
  };
  if (g.id) out.id = g.id;
  if (g.contactPhone) out.contactPhone = g.contactPhone;
  if (g.contactEmail) out.contactEmail = g.contactEmail;
  return out;
}

function stripDocumentBlanks(d: StudentFormValues['identityDocuments'][number]) {
  const out: NonNullable<CreateStudentInput['identityDocuments']>[number] = {
    type: d.type,
    number: d.number,
  };
  if (d.issuingCountry) out.issuingCountry = d.issuingCountry;
  if (d.expiryDate) out.expiryDate = d.expiryDate;
  return out;
}

function zodFlatten(fieldErrors: Record<string, string[] | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldErrors)) {
    if (value && value.length > 0 && value[0]) out[key] = value[0];
  }
  return out;
}

function toErrorState<T = unknown>(error: unknown, fallback: string): ActionState<T> {
  return { status: 'error', message: safeActionErrorMessage(error, fallback) };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/* ----------------------------------------------------------------- Enroll */

export async function enrollStudentAction(
  studentId: string,
  values: EnrollmentFormValues,
): Promise<ActionState<{ enrollmentId: string }>> {
  if (!UUID_RE.test(studentId)) {
    return { status: 'error', message: 'Invalid student.' };
  }

  const parsed = enrollmentFormSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }

  const payload: CreateEnrollmentInput = {
    studentId,
    institutionId: parsed.data.institutionId,
    gradeId: parsed.data.gradeId,
    classId: parsed.data.classId,
    academicPeriodId: parsed.data.academicPeriodId,
    enrolledAt: parsed.data.enrolledAt,
  };

  try {
    const enrollment = await createEnrollment(payload);
    revalidatePath('/students');
    revalidatePath(`/students/${studentId}`);
    return {
      status: 'success',
      message: 'Student enrolled successfully.',
      data: { enrollmentId: enrollment.id },
    };
  } catch (error) {
    return toErrorState<{ enrollmentId: string }>(error, 'Failed to enroll student');
  }
}

function revalidateStudent(studentId: string) {
  revalidatePath(`/students/${studentId}`);
  revalidatePath('/students');
}

export async function uploadStudentPhotoAction(
  studentId: string,
  values: { contentBase64: string; mimeType: string },
): Promise<ActionState> {
  if (!UUID_RE.test(studentId)) {
    return { status: 'error', message: 'Invalid student' };
  }
  const parsed = studentPhotoUploadSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please choose a JPEG, PNG, or WebP photo up to 2 MB.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await uploadStudentPhoto(studentId, parsed.data);
    revalidateStudent(studentId);
    return { status: 'success', message: 'Photo uploaded.' };
  } catch (error) {
    return toErrorState(error, 'Failed to upload photo');
  }
}

export async function addStudentSiblingAction(
  studentId: string,
  values: { siblingId: string },
): Promise<ActionState> {
  if (!UUID_RE.test(studentId)) {
    return { status: 'error', message: 'Invalid student' };
  }
  const parsed = studentSiblingSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Enter a valid sibling student id.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await addStudentSibling(studentId, parsed.data.siblingId);
    revalidateStudent(studentId);
    return { status: 'success', message: 'Sibling linked.' };
  } catch (error) {
    return toErrorState(error, 'Failed to link sibling');
  }
}

export async function setStudentConsentAction(
  studentId: string,
  values: { kind: string; granted: boolean },
): Promise<ActionState> {
  if (!UUID_RE.test(studentId)) {
    return { status: 'error', message: 'Invalid student' };
  }
  const parsed = studentConsentSchema.safeParse(values);
  if (!parsed.success) {
    return { status: 'error', message: 'Invalid consent update.' };
  }
  try {
    await setStudentConsent(studentId, parsed.data);
    revalidateStudent(studentId);
    return { status: 'success' };
  } catch (error) {
    return toErrorState(error, 'Failed to update consent');
  }
}

export async function addStudentDisciplineAction(
  studentId: string,
  values: {
    incidentType: string;
    severity: string;
    description: string;
    actionTaken?: string;
    incidentDate: string;
    visibleToParent?: boolean;
  },
): Promise<ActionState> {
  if (!UUID_RE.test(studentId)) {
    return { status: 'error', message: 'Invalid student' };
  }
  const parsed = studentDisciplineSchema.safeParse(values);
  if (!parsed.success) {
    return {
      status: 'error',
      message: 'Please fix the highlighted fields.',
      fieldErrors: zodFlatten(parsed.error.flatten().fieldErrors),
    };
  }
  try {
    await addStudentDiscipline(studentId, {
      ...parsed.data,
      actionTaken: parsed.data.actionTaken || undefined,
    });
    revalidateStudent(studentId);
    return { status: 'success', message: 'Incident recorded.' };
  } catch (error) {
    return toErrorState(error, 'Failed to record incident');
  }
}

export async function removeStudentDisciplineAction(
  studentId: string,
  incidentId: string,
): Promise<ActionState> {
  if (!UUID_RE.test(studentId) || !UUID_RE.test(incidentId)) {
    return { status: 'error', message: 'Invalid incident' };
  }
  try {
    await removeStudentDiscipline(studentId, incidentId);
    revalidateStudent(studentId);
    return { status: 'success', message: 'Incident removed.' };
  } catch (error) {
    return toErrorState(error, 'Failed to remove incident');
  }
}

/* ----------------------------------------------------- Lookup helpers */

/**
 * Grades for an enrollment or transfer form.
 * Institution-scoped `/grades` is not mounted; Sunrise (and other tenants)
 * store grades on the tenant-wide list. Use that when the institution call
 * is empty so the grade control is not stuck disabled.
 */
export async function getInstitutionGradesAction(
  institutionId: string,
): Promise<{ id: string; name: string }[]> {
  if (!institutionId) return [];
  try {
    const grades = await listInstitutionGrades(institutionId);
    if (grades.length > 0) return grades.map((g) => ({ id: g.id, name: g.name }));
  } catch {
    // Fall through to the tenant-wide list.
  }
  try {
    const grades = await listTenantGrades();
    return grades.map((g) => ({ id: g.id, name: g.name }));
  } catch {
    return [];
  }
}

/**
 * Academic periods for an enrollment or transfer form.
 * Same fallback as grades: the institution-nested route 404s, while
 * `GET /academic-periods` returns the tenant year (AY 2026-27 at Sunrise).
 */
export async function getInstitutionPeriodsAction(
  institutionId: string,
): Promise<{ id: string; name: string }[]> {
  if (!institutionId) return [];
  try {
    const periods = await listAcademicPeriods(institutionId);
    if (periods.length > 0) return periods.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    // Fall through to the tenant-wide list.
  }
  try {
    const periods = await listTenantAcademicPeriods();
    return periods.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

/** Fetch class/section placements for an institution (optionally scoped to a period). */
export async function getInstitutionClassesAction(
  institutionId: string,
  academicPeriodId?: string,
): Promise<{ id: string; name: string; gradeId: string; academicPeriodId: string }[]> {
  if (!institutionId) return [];
  try {
    const classes = await listInstitutionClasses(institutionId, academicPeriodId);
    return classes.map((c) => ({
      id: c.id,
      name: c.name,
      gradeId: c.gradeId,
      academicPeriodId: c.academicPeriodId,
    }));
  } catch {
    return [];
  }
}

/* ----------------------------------------------------- Wave 11 graduate */

/**
 * Today's date in the tenant timezone (PRC-L248). Falls back to UTC when the
 * tenant settings cannot be read by the current user.
 */
async function todayIsoDate(): Promise<string> {
  let timeZone: string | undefined;
  try {
    const { settings } = await getTenantSettings();
    timeZone = settings?.timezone || undefined;
  } catch {
    timeZone = undefined;
  }
  return isoDateInTimeZone(timeZone);
}

export interface BulkGraduateFailure {
  enrollmentId?: string;
  studentId?: string;
  code: string;
  message: string;
}

export interface BulkGraduateResult {
  graduated: number;
  failed: number;
  lookupFailedStudentIds: string[];
  failures: BulkGraduateFailure[];
}

export async function graduateEnrollmentAction(
  studentId: string,
  enrollmentId: string,
): Promise<ActionState> {
  if (!UUID_RE.test(studentId) || !UUID_RE.test(enrollmentId)) {
    return { status: 'error', message: 'Invalid student or enrollment.' };
  }
  try {
    await updateEnrollmentStatus(enrollmentId, {
      status: 'GRADUATED',
      reason: 'Graduated from student profile',
      effectiveDate: await todayIsoDate(),
    });
    revalidatePath(`/students/${studentId}`);
    revalidatePath('/students');
    return { status: 'success', message: 'Student graduated.' };
  } catch (error) {
    return toErrorState(error, 'Failed to graduate student');
  }
}

/** Bounded-concurrency map so a 100-student batch does not run serially. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const ENROLLMENT_LOOKUP_CONCURRENCY = 8;

/** Resolve current ENROLLED rows for the given students, then bulk-graduate. */
export async function bulkGraduateStudentsAction(
  studentIds: string[],
): Promise<ActionState<BulkGraduateResult>> {
  const ids = [...new Set(studentIds)].filter((id) => UUID_RE.test(id)).slice(0, 100);
  if (ids.length === 0) {
    return { status: 'error', message: 'Select at least one student.' };
  }

  try {
    const lookups = await mapWithConcurrency(ids, ENROLLMENT_LOOKUP_CONCURRENCY, (studentId) =>
      getStudentEnrollmentsResult(studentId),
    );
    const enrollmentIds: string[] = [];
    const studentByEnrollment = new Map<string, string>();
    const lookupFailedStudentIds: string[] = [];
    lookups.forEach((lookup, index) => {
      if (!lookup.ok) {
        lookupFailedStudentIds.push(ids[index] as string);
        return;
      }
      for (const row of lookup.enrollments) {
        if (row.status === 'ENROLLED') {
          enrollmentIds.push(row.id);
          studentByEnrollment.set(row.id, ids[index] as string);
        }
      }
    });
    if (enrollmentIds.length === 0) {
      return {
        status: 'error',
        message:
          lookupFailedStudentIds.length > 0
            ? `Could not load enrollments for ${lookupFailedStudentIds.length} student(s); nothing was graduated.`
            : 'No active (ENROLLED) enrollments found for the selection.',
        data: {
          graduated: 0,
          failed: 0,
          lookupFailedStudentIds,
          failures: lookupFailedStudentIds.map((studentId) => ({
            studentId,
            code: 'LOOKUP_FAILED',
            message: 'Enrollments could not be loaded',
          })),
        },
      };
    }

    const result = await bulkUpdateEnrollmentStatus({
      enrollmentIds,
      status: 'GRADUATED',
      reason: 'Bulk graduate from student list',
      effectiveDate: await todayIsoDate(),
    });

    revalidatePath('/students');
    for (const id of ids) revalidatePath(`/students/${id}`);

    const graduated = result.updated.length;
    const failed = result.failed.length;
    const lookupNote =
      lookupFailedStudentIds.length > 0
        ? ` Enrollments could not be loaded for ${lookupFailedStudentIds.length} student(s).`
        : '';
    // Per-student failures so the caller can show/retry them (PRC-L248).
    const failures: BulkGraduateFailure[] = [
      ...result.failed.map((f) => ({
        enrollmentId: f.enrollmentId,
        studentId: studentByEnrollment.get(f.enrollmentId),
        code: f.code,
        message: f.message,
      })),
      ...lookupFailedStudentIds.map((studentId) => ({
        studentId,
        code: 'LOOKUP_FAILED',
        message: 'Enrollments could not be loaded',
      })),
    ];
    const status = failures.length === 0 ? 'success' : graduated > 0 ? 'partial' : 'error';
    return {
      status,
      message:
        (failed === 0
          ? `Graduated ${graduated} enrollment${graduated === 1 ? '' : 's'}.`
          : `Graduated ${graduated}; ${failed} failed.`) + lookupNote,
      data: { graduated, failed, lookupFailedStudentIds, failures },
    };
  } catch (error) {
    return toErrorState(error, 'Failed to bulk graduate');
  }
}
