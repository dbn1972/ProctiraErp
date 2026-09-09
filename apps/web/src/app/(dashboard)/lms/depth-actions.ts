'use server';

import { revalidatePath } from 'next/cache';

import { GatewayError } from '@/lib/api/gateway';
import {
  addLessonResource,
  createBankQuestion,
  createContentItem,
  createDiscussion,
  createDiscussionPost,
  createLesson,
  createRubric,
  gradeSubmissionWithRubric,
  hideDiscussionPost,
  lockDiscussion,
  pinDiscussionPost,
  uploadAssignmentFile,
} from '@/lib/api/lms';
import {
  lmsBankItemSchema,
  lmsContentSchema,
  lmsDiscussionSchema,
  lmsFileUploadSchema,
  lmsLessonSchema,
  lmsRubricGradeSchema,
  lmsRubricSchema,
  type LmsBankItemValues,
  type LmsContentValues,
  type LmsDiscussionValues,
  type LmsFileUploadValues,
  type LmsLessonValues,
  type LmsRubricGradeValues,
  type LmsRubricValues,
} from '@/lib/validation/lms-depth-schema';

export interface LmsDepthActionState {
  status: 'idle' | 'success' | 'error';
  message?: string;
  id?: string;
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof GatewayError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}

function optionalId(value?: string): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export async function createBankItemAction(
  input: LmsBankItemValues,
): Promise<LmsDepthActionState> {
  const parsed = lmsBankItemSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid bank item' };
  }
  const data = parsed.data;
  const options = (data.options ?? '')
    .split('\n')
    .map((o) => o.trim())
    .filter(Boolean);
  const payload: Record<string, unknown> = {};
  if (data.questionType === 'mcq' || data.questionType === 'msq') {
    payload.options = options;
    if (data.questionType === 'mcq') payload.correctOptionIndex = data.correctOptionIndex ?? 0;
    if (data.questionType === 'msq') {
      const indexes = (data.correctIndexes ?? '')
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isInteger(n) && n >= 0);
      payload.correctOptionIndexes =
        indexes.length > 0 ? indexes : [data.correctOptionIndex ?? 0];
      payload.partialCredit = true;
    }
  }
  if (data.questionType === 'numeric') {
    payload.correctValue = data.correctValue ?? 0;
    payload.tolerance = data.tolerance ?? 0.01;
  }
  if (data.questionType === 'match') {
    payload.pairs = (data.pairs ?? '')
      .split('\n')
      .map((line) => {
        const [left, right] = line.split('|').map((p) => p.trim());
        return { left: left ?? '', right: right ?? '' };
      })
      .filter((p) => p.left && p.right);
  }
  try {
    const created = await createBankQuestion({
      scope: data.scope,
      boardId: optionalId(data.boardId),
      institutionId: optionalId(data.institutionId),
      subject: data.subject,
      gradeLevel: optionalId(data.gradeLevel),
      tags: data.tags ? data.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
      questionType: data.questionType,
      difficulty: data.difficulty,
      prompt: data.prompt,
      payload,
      points: data.points,
    });
    revalidatePath('/lms/bank');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create bank item') };
  }
}

export async function createRubricAction(input: LmsRubricValues): Promise<LmsDepthActionState> {
  const parsed = lmsRubricSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid rubric' };
  }
  const data = parsed.data;
  try {
    const created = await createRubric({
      scope: data.scope,
      boardId: optionalId(data.boardId),
      institutionId: optionalId(data.institutionId),
      name: data.name,
      subject: optionalId(data.subject),
      criteria: [
        {
          name: data.criterionName,
          maxPoints: data.maxPoints,
          levels: [
            { label: 'Developing', points: Math.max(1, Math.round(data.maxPoints / 2)) },
            { label: 'Secure', points: data.maxPoints },
          ],
        },
      ],
    });
    revalidatePath('/lms/rubrics');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create rubric') };
  }
}

export async function gradeWithRubricAction(
  assignmentId: string,
  input: LmsRubricGradeValues,
): Promise<LmsDepthActionState> {
  const parsed = lmsRubricGradeSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid rubric grade' };
  }
  try {
    await gradeSubmissionWithRubric(parsed.data.submissionId, {
      questionId: optionalId(parsed.data.questionId),
      scores: parsed.data.scores,
    });
    revalidatePath(`/lms/assignments/${assignmentId}`);
    return { status: 'success', id: parsed.data.submissionId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to apply rubric grade') };
  }
}

export async function uploadLmsFileAction(input: LmsFileUploadValues): Promise<LmsDepthActionState> {
  const parsed = lmsFileUploadSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid file' };
  }
  try {
    const file = await uploadAssignmentFile(parsed.data.assignmentId, {
      filename: parsed.data.filename,
      mimeType: parsed.data.mimeType,
      contentBase64: parsed.data.contentBase64,
      submissionId: optionalId(parsed.data.submissionId),
    });
    revalidatePath(`/lms/assignments/${parsed.data.assignmentId}`);
    return { status: 'success', id: file.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to upload file') };
  }
}

export async function createDiscussionAction(
  input: LmsDiscussionValues,
): Promise<LmsDepthActionState> {
  const parsed = lmsDiscussionSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid discussion' };
  }
  try {
    const created = await createDiscussion({
      classKey: parsed.data.classKey,
      title: parsed.data.title,
      institutionId: optionalId(parsed.data.institutionId),
    });
    revalidatePath('/lms/discussions');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create discussion') };
  }
}

export async function createDiscussionPostAction(
  threadId: string,
  body: string,
): Promise<LmsDepthActionState> {
  if (!body.trim()) return { status: 'error', message: 'Write a reply first.' };
  try {
    const post = await createDiscussionPost(threadId, body.trim());
    revalidatePath('/lms/discussions');
    return { status: 'success', id: post.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to post') };
  }
}

export async function lockDiscussionAction(
  threadId: string,
  locked: boolean,
): Promise<LmsDepthActionState> {
  try {
    await lockDiscussion(threadId, locked);
    revalidatePath('/lms/discussions');
    return { status: 'success', id: threadId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to lock thread') };
  }
}

export async function hidePostAction(
  threadId: string,
  postId: string,
  hidden: boolean,
): Promise<LmsDepthActionState> {
  try {
    await hideDiscussionPost(threadId, postId, hidden);
    revalidatePath('/lms/discussions');
    return { status: 'success', id: postId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to hide post') };
  }
}

export async function createContentAction(input: LmsContentValues): Promise<LmsDepthActionState> {
  const parsed = lmsContentSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid content' };
  }
  try {
    const created = await createContentItem({
      scope: parsed.data.scope,
      boardId: optionalId(parsed.data.boardId),
      institutionId: optionalId(parsed.data.institutionId),
      title: parsed.data.title,
      kind: parsed.data.kind,
      body: optionalId(parsed.data.body),
      classKey: optionalId(parsed.data.classKey),
      subject: optionalId(parsed.data.subject),
      published: parsed.data.published,
    });
    revalidatePath('/lms/content');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create content') };
  }
}

export async function createLessonAction(input: LmsLessonValues): Promise<LmsDepthActionState> {
  const parsed = lmsLessonSchema.safeParse(input);
  if (!parsed.success) {
    return { status: 'error', message: parsed.error.issues[0]?.message ?? 'Invalid lesson' };
  }
  try {
    const created = await createLesson({
      scope: 'school',
      institutionId: parsed.data.institutionId,
      title: parsed.data.title,
      subject: optionalId(parsed.data.subject),
      description: optionalId(parsed.data.description),
      published: parsed.data.published,
    });
    if (parsed.data.resourceTitle && parsed.data.resourceUrl) {
      await addLessonResource(created.id, {
        kind: 'video',
        title: parsed.data.resourceTitle,
        url: parsed.data.resourceUrl,
      });
    }
    revalidatePath('/lms/lessons');
    return { status: 'success', id: created.id };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to create lesson') };
  }
}

export async function pinPostAction(
  threadId: string,
  postId: string,
  pinned: boolean,
): Promise<LmsDepthActionState> {
  try {
    await pinDiscussionPost(threadId, postId, pinned);
    revalidatePath('/lms/discussions');
    return { status: 'success', id: postId };
  } catch (error) {
    return { status: 'error', message: errorMessage(error, 'Failed to pin post') };
  }
}
