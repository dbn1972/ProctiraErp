/**
 * LMS service client — assignments · homework · quizzes · Spiral PAL.
 *
 * Validates: Wave 8 FRS (docs/requirements/WAVE8_LMS_SPIRAL_PAL_FRS.md)
 * FR-LMS-001…015, FR-PAL-001…015.
 */
import { GatewayError, gatewayFetch } from './gateway';

export type LmsScope = 'board' | 'school';
export type AssignmentKind = 'assignment' | 'homework' | 'quiz';
export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';
export type SubmissionStatus = 'submitted' | 'late' | 'graded' | 'returned';

export interface LmsSkill {
  id: string;
  scope: LmsScope;
  boardId: string | null;
  institutionId: string | null;
  code: string;
  name: string;
  subject: string;
  gradeLevel: string | null;
  description: string | null;
  prerequisiteSkillIds: string[];
}

export interface QuizQuestion {
  id: string;
  position: number;
  prompt: string;
  options: string[];
  /** -1 when the caller is a learner (answer key hidden). */
  correctOptionIndex: number;
  points: number;
  skillId: string | null;
  explanation: string | null;
}

export interface LmsAssignment {
  id: string;
  scope: LmsScope;
  boardId: string | null;
  institutionId: string | null;
  kind: AssignmentKind;
  title: string;
  description: string | null;
  subject: string;
  gradeLevel: string | null;
  sectionId: string | null;
  skillIds: string[];
  maxScore: number;
  dueAt: string | null;
  timeLimitMinutes: number | null;
  allowLate: boolean;
  status: AssignmentStatus;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  questions?: QuizQuestion[];
  submissionCount?: number;
}

export interface LmsSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  institutionId: string | null;
  status: SubmissionStatus;
  content: string | null;
  attachments: string[];
  answers: Array<{ questionId: string; selectedOptionIndex: number }>;
  score: number | null;
  autoGraded: boolean;
  feedback: string | null;
  submittedAt: string;
  gradedAt: string | null;
  gradedBy: string | null;
}

export interface SkillMastery {
  skillId: string;
  mastery: number;
  attempts: number;
  correct: number;
  streak: number;
  intervalDays: number;
  dueAt: string | null;
  lastReviewedAt: string | null;
}

export interface SpiralPlanItem {
  type: 'review' | 'reinforce' | 'introduce';
  skillId: string;
  skillName: string;
  subject: string;
  mastery: number;
  dueAt: string | null;
  reason: string;
}

export interface SpiralPlan {
  studentId: string;
  generatedAt: string;
  items: SpiralPlanItem[];
  blockedSkillIds: string[];
  summary: {
    dueReviews: number;
    mastered: number;
    inProgress: number;
    notStarted: number;
    blocked: number;
  };
}

export interface StudentProgress {
  studentId: string;
  summary: { mastered: number; inProgress: number; notStarted: number; averageMastery: number };
  skills: Array<{ skill: LmsSkill; mastery: SkillMastery | null }>;
}

export interface QuizQuestionInput {
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  points?: number;
  skillId?: string;
  explanation?: string;
}

export interface CreateAssignmentInput {
  scope: LmsScope;
  boardId?: string;
  institutionId?: string;
  kind: AssignmentKind;
  title: string;
  description?: string;
  subject: string;
  gradeLevel?: string;
  sectionId?: string;
  skillIds?: string[];
  maxScore?: number;
  dueAt?: string;
  timeLimitMinutes?: number;
  allowLate?: boolean;
  publish?: boolean;
  questions?: QuizQuestionInput[];
}

export interface CreateSkillInput {
  scope: LmsScope;
  boardId?: string;
  institutionId?: string;
  code: string;
  name: string;
  subject: string;
  gradeLevel?: string;
  description?: string;
  prerequisiteSkillIds?: string[];
}

export interface GradeSubmissionInput {
  score: number;
  feedback?: string;
  returnToStudent?: boolean;
}

export interface AssignmentListFilter {
  kind?: AssignmentKind;
  status?: AssignmentStatus;
  scope?: LmsScope;
  institutionId?: string;
  boardId?: string;
  subject?: string;
  search?: string;
  pageSize?: number;
}

function toQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function failed(
  result: { status: number; error?: { code?: string; message?: string } | null },
  fallback: string,
): never {
  throw new GatewayError({
    status: result.status,
    code: result.error?.code ?? 'LMS_REQUEST_FAILED',
    message: result.error?.message ?? fallback,
  });
}

export async function listAssignments(filter: AssignmentListFilter = {}): Promise<LmsAssignment[]> {
  const result = await gatewayFetch<{ data: LmsAssignment[] }>(
    `/lms/assignments${toQuery({ ...filter, pageSize: filter.pageSize ?? 100 })}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function getAssignment(id: string): Promise<LmsAssignment | null> {
  const result = await gatewayFetch<LmsAssignment>(`/lms/assignments/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function createAssignment(input: CreateAssignmentInput): Promise<LmsAssignment> {
  const result = await gatewayFetch<LmsAssignment>('/lms/assignments', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create assignment');
  return result.data;
}

export async function publishAssignment(id: string): Promise<LmsAssignment> {
  const result = await gatewayFetch<LmsAssignment>(`/lms/assignments/${id}/publish`, {
    method: 'POST',
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to publish assignment');
  return result.data;
}

export async function closeAssignment(id: string): Promise<LmsAssignment> {
  const result = await gatewayFetch<LmsAssignment>(`/lms/assignments/${id}/close`, {
    method: 'POST',
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to close assignment');
  return result.data;
}

export async function listSubmissions(assignmentId: string): Promise<LmsSubmission[]> {
  const result = await gatewayFetch<{ data: LmsSubmission[] }>(
    `/lms/assignments/${assignmentId}/submissions?pageSize=100`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function gradeSubmission(
  submissionId: string,
  input: GradeSubmissionInput,
): Promise<LmsSubmission> {
  const result = await gatewayFetch<LmsSubmission>(`/lms/submissions/${submissionId}/grade`, {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to grade submission');
  return result.data;
}

export async function listSkills(
  filter: { scope?: LmsScope; institutionId?: string; boardId?: string; subject?: string } = {},
): Promise<LmsSkill[]> {
  const result = await gatewayFetch<{ data: LmsSkill[] }>(
    `/lms/skills${toQuery({ ...filter, pageSize: 200 })}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createSkill(input: CreateSkillInput): Promise<LmsSkill> {
  const result = await gatewayFetch<LmsSkill>('/lms/skills', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create skill');
  return result.data;
}

export async function getStudentPlan(
  studentId: string,
  query: { boardId?: string; institutionId?: string; limit?: number } = {},
): Promise<SpiralPlan | null> {
  const result = await gatewayFetch<SpiralPlan>(
    `/lms/pal/students/${studentId}/plan${toQuery(query)}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data ?? null;
}

export async function getStudentProgress(
  studentId: string,
  query: { boardId?: string; institutionId?: string } = {},
): Promise<StudentProgress | null> {
  const result = await gatewayFetch<StudentProgress>(
    `/lms/pal/students/${studentId}/progress${toQuery(query)}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data ?? null;
}

export async function recordPracticeAttempt(
  studentId: string,
  input: { skillId: string; correct: boolean; responseTimeMs?: number },
): Promise<SkillMastery> {
  const result = await gatewayFetch<SkillMastery>(`/lms/pal/students/${studentId}/attempts`, {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to record attempt');
  return result.data;
}
