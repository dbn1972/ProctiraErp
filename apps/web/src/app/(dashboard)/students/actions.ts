'use server';

/**
 * Server Actions for student management pages.
 *
 * All writes go through the API gateway (X-Tenant-ID enforced).
 * Validation is performed both client-side (react-hook-form + zod) and here
 * via the same zod schema, so direct calls are safe.
 */
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

import { listAcademicPeriods, listInstitutionGrades } from '@/lib/api/institutions';
import {
  addStudentDiscipline,
  addStudentSibling,
  bulkUpdateEnrollmentStatus,
  createEnrollment,
  createStudent,
  deleteStudent,
  getStudentEnrollments,
  setStudentConsent,
  submitBulkImport,
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
import { GatewayError } from '@/lib/api/gateway';
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
  status: 'idle' | 'success' | 'error';
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
    ...(parsed.data.destinationClassId
      ? { destinationClassId: parsed.data.destinationClassId }
      : {}),
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
  if (!input.fileBase64 || !input.fileName) {
    return { status: 'error', message: 'A file is required to start the import.' };
  }
  try {
    const request: BulkImportRequest = {
      fileBase64: input.fileBase64,
      fileName: input.fileName,
      mimeType: input.mimeType,
      duplicateResolution: input.duplicateResolution,
      async: input.async ?? false,
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
  if (error instanceof GatewayError) {
    return {
      status: 'error',
      message: error.message || fallback,
    };
  }
  if (error instanceof Error) {
    return { status: 'error', message: error.message };
  }
  return { status: 'error', message: fallback };
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
    academicPeriodId: parsed.data.academicPeriodId,
    enrolledAt: parsed.data.enrolledAt,
    ...(parsed.data.classId ? { classId: parsed.data.classId } : {}),
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

/* ----------------------------------------------------- Lookup helpers */

/** Fetch grades for an institution. Used by the transfer form. */
export async function getInstitutionGradesAction(
  institutionId: string,
): Promise<{ id: string; name: string }[]> {
  if (!institutionId) return [];
  try {
    const grades = await listInstitutionGrades(institutionId);
    return grades.map((g) => ({ id: g.id, name: g.name }));
  } catch {
    return [];
  }
}

/** Fetch academic periods for an institution. Used by the transfer form. */
export async function getInstitutionPeriodsAction(
  institutionId: string,
): Promise<{ id: string; name: string }[]> {
  if (!institutionId) return [];
  try {
    const periods = await listAcademicPeriods(institutionId);
    return periods.map((p) => ({ id: p.id, name: p.name }));
  } catch {
    return [];
  }
}

/* ----------------------------------------------------- Wave 11 graduate */

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
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
      effectiveDate: todayIsoDate(),
    });
    revalidatePath(`/students/${studentId}`);
    revalidatePath('/students');
    return { status: 'success', message: 'Student graduated.' };
  } catch (error) {
    return toErrorState(error, 'Failed to graduate student');
  }
}

/** Resolve current ENROLLED rows for the given students, then bulk-graduate. */
export async function bulkGraduateStudentsAction(
  studentIds: string[],
): Promise<ActionState<{ graduated: number; failed: number }>> {
  const ids = [...new Set(studentIds)].filter((id) => UUID_RE.test(id)).slice(0, 100);
  if (ids.length === 0) {
    return { status: 'error', message: 'Select at least one student.' };
  }

  try {
    const enrollmentIds: string[] = [];
    for (const studentId of ids) {
      const enrollments = await getStudentEnrollments(studentId);
      for (const row of enrollments) {
        if (row.status === 'ENROLLED') enrollmentIds.push(row.id);
      }
    }
    if (enrollmentIds.length === 0) {
      return {
        status: 'error',
        message: 'No active (ENROLLED) enrollments found for the selection.',
      };
    }

    const result = await bulkUpdateEnrollmentStatus({
      enrollmentIds,
      status: 'GRADUATED',
      reason: 'Bulk graduate from student list',
      effectiveDate: todayIsoDate(),
    });

    revalidatePath('/students');
    for (const id of ids) revalidatePath(`/students/${id}`);

    const graduated = result.updated.length;
    const failed = result.failed.length;
    return {
      status: failed === 0 ? 'success' : 'error',
      message:
        failed === 0
          ? `Graduated ${graduated} enrollment${graduated === 1 ? '' : 's'}.`
          : `Graduated ${graduated}; ${failed} failed.`,
      data: { graduated, failed },
    };
  } catch (error) {
    return toErrorState(error, 'Failed to bulk graduate');
  }
}
