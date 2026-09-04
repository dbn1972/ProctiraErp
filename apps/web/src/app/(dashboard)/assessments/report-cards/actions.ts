'use server';

/**
 * Server Actions for report-card templates and generation.
 */
import { revalidatePath } from 'next/cache';

import {
  bulkGenerateReportCards,
  createReportCardTemplate,
  deleteReportCardTemplate,
  generateReportCard,
  updateReportCardTemplate,
  type BulkGenerateReportCardResponse,
  type CreateReportCardTemplateInput,
  type ReportCardJob,
  type UpdateReportCardTemplateInput,
} from '@/lib/api/report-cards';
import { GatewayError } from '@/lib/api/gateway';

export interface ActionState<T = unknown> {
  status: 'idle' | 'success' | 'error';
  message?: string;
  fieldErrors?: Record<string, string>;
  data?: T;
}

function toErrorState<T = unknown>(
  error: unknown,
  fallback: string,
): ActionState<T> {
  if (error instanceof GatewayError) {
    return { status: 'error', message: error.message || fallback };
  }
  if (error instanceof Error) {
    return { status: 'error', message: error.message };
  }
  return { status: 'error', message: fallback };
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value.trim());
}

export async function createReportCardTemplateAction(
  input: CreateReportCardTemplateInput,
): Promise<ActionState<{ templateId: string }>> {
  if (!input.name?.trim() || !input.templateContent?.trim()) {
    return {
      status: 'error',
      message: 'Name and template content are required.',
    };
  }

  try {
    const template = await createReportCardTemplate({
      name: input.name.trim(),
      templateContent: input.templateContent,
      isDefault: input.isDefault,
      includeLogo: input.includeLogo,
      includeGradeSummary: input.includeGradeSummary,
      includeComments: input.includeComments,
    });
    revalidatePath('/assessments/report-cards');
    return {
      status: 'success',
      message: 'Template created.',
      data: { templateId: template.id },
    };
  } catch (error) {
    return toErrorState<{ templateId: string }>(
      error,
      'Failed to create template',
    );
  }
}

export async function updateReportCardTemplateAction(
  templateId: string,
  input: UpdateReportCardTemplateInput,
): Promise<ActionState<{ templateId: string }>> {
  if (!isUuid(templateId)) {
    return { status: 'error', message: 'Invalid template id.' };
  }

  try {
    const template = await updateReportCardTemplate(templateId, input);
    revalidatePath('/assessments/report-cards');
    return {
      status: 'success',
      message: 'Template updated.',
      data: { templateId: template.id },
    };
  } catch (error) {
    return toErrorState<{ templateId: string }>(
      error,
      'Failed to update template',
    );
  }
}

export async function deleteReportCardTemplateAction(
  templateId: string,
): Promise<ActionState> {
  if (!isUuid(templateId)) {
    return { status: 'error', message: 'Invalid template id.' };
  }

  try {
    await deleteReportCardTemplate(templateId);
    revalidatePath('/assessments/report-cards');
    return { status: 'success', message: 'Template deleted.' };
  } catch (error) {
    return toErrorState(error, 'Failed to delete template');
  }
}

export interface GenerateReportCardFormInput {
  mode: 'single' | 'bulk';
  studentId?: string;
  studentIds?: string;
  academicPeriodId: string;
  institutionId: string;
  templateId?: string;
}

export async function generateReportCardAction(
  input: GenerateReportCardFormInput,
): Promise<ActionState<{ jobs: ReportCardJob[]; jobsCreated: number }>> {
  const academicPeriodId = input.academicPeriodId?.trim() ?? '';
  const institutionId = input.institutionId?.trim() ?? '';
  const templateId = input.templateId?.trim() || undefined;

  if (!isUuid(academicPeriodId) || !isUuid(institutionId)) {
    return {
      status: 'error',
      message: 'Academic period and institution must be valid UUIDs.',
    };
  }
  if (templateId && !isUuid(templateId)) {
    return { status: 'error', message: 'Template id must be a valid UUID.' };
  }

  try {
    if (input.mode === 'bulk') {
      const studentIds = (input.studentIds ?? '')
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);

      if (studentIds.length === 0) {
        return {
          status: 'error',
          message: 'Provide at least one student UUID for bulk generation.',
        };
      }
      if (studentIds.some((id) => !isUuid(id))) {
        return {
          status: 'error',
          message: 'Every student id must be a valid UUID.',
        };
      }

      const payload: {
        studentIds: string[];
        academicPeriodId: string;
        institutionId: string;
        templateId?: string;
      } = { studentIds, academicPeriodId, institutionId };
      if (templateId) payload.templateId = templateId;

      const response: BulkGenerateReportCardResponse =
        await bulkGenerateReportCards(payload);

      revalidatePath('/assessments/report-cards');
      return {
        status: 'success',
        message: `Queued ${response.jobsCreated} of ${response.totalStudents} report cards.`,
        data: {
          jobs: response.jobs,
          jobsCreated: response.jobsCreated,
        },
      };
    }

    const studentId = input.studentId?.trim() ?? '';
    if (!isUuid(studentId)) {
      return {
        status: 'error',
        message: 'Student id must be a valid UUID.',
      };
    }

    const singlePayload: {
      studentId: string;
      academicPeriodId: string;
      institutionId: string;
      templateId?: string;
    } = { studentId, academicPeriodId, institutionId };
    if (templateId) singlePayload.templateId = templateId;

    const job = await generateReportCard(singlePayload);
    revalidatePath('/assessments/report-cards');
    return {
      status: 'success',
      message: 'Report card generation queued.',
      data: { jobs: [job], jobsCreated: 1 },
    };
  } catch (error) {
    return toErrorState<{ jobs: ReportCardJob[]; jobsCreated: number }>(
      error,
      'Failed to queue report card generation',
    );
  }
}
