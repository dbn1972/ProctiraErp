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
  questionType?: QuestionType;
  payload?: { rubricId?: string };
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
  bankQuestionIds?: string[];
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

export type QuestionType = 'mcq' | 'msq' | 'numeric' | 'match' | 'essay';
export type ContentKind = 'link' | 'file' | 'text';

export interface BankQuestion {
  id: string;
  scope: LmsScope;
  subject: string;
  gradeLevel: string | null;
  tags: string[];
  questionType: QuestionType;
  difficulty: 'easy' | 'medium' | 'hard';
  prompt: string;
  points: number;
  skillId: string | null;
  rubricId: string | null;
}

export interface LmsRubric {
  id: string;
  name: string;
  subject: string | null;
  criteria?: Array<{
    id: string;
    name: string;
    maxPoints: number;
    levels: Array<{ label: string; points: number }>;
  }>;
}

export interface DiscussionThread {
  id: string;
  classKey: string;
  title: string;
  locked: boolean;
  posts?: Array<{ id: string; body: string; hidden: boolean; pinned: boolean }>;
}

export interface ContentItem {
  id: string;
  title: string;
  kind: ContentKind;
  body: string | null;
  tags: string[];
  classKey: string | null;
  subject: string | null;
  published: boolean;
}

export interface ClassAnalytics {
  classKey: string;
  assignmentCount: number;
  submissionCount: number;
  uniqueStudents: number;
  submissionRate: number;
  averageScore: number;
  masteryBySkill: Array<{
    skillId: string;
    label: string;
    attempts: number;
    averageMastery: number;
  }>;
}

export async function listBankQuestions(filter: {
  subject?: string;
  gradeLevel?: string;
  questionType?: QuestionType;
  tags?: string;
  pageSize?: number;
} = {}): Promise<BankQuestion[]> {
  const result = await gatewayFetch<{ data: BankQuestion[] }>(
    `/lms/bank${toQuery({ ...filter, pageSize: filter.pageSize ?? 100 })}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createBankQuestion(input: {
  scope: LmsScope;
  boardId?: string;
  institutionId?: string;
  subject: string;
  gradeLevel?: string;
  tags?: string[];
  questionType: QuestionType;
  difficulty?: 'easy' | 'medium' | 'hard';
  prompt: string;
  payload?: Record<string, unknown>;
  points?: number;
  skillId?: string;
  rubricId?: string;
}): Promise<BankQuestion> {
  const result = await gatewayFetch<BankQuestion>('/lms/bank', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create bank item');
  return result.data;
}

export async function listRubrics(): Promise<LmsRubric[]> {
  const result = await gatewayFetch<{ data: LmsRubric[] }>('/lms/rubrics?pageSize=100', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function getRubric(id: string): Promise<LmsRubric | null> {
  const result = await gatewayFetch<LmsRubric>(`/lms/rubrics/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function createRubric(input: {
  scope: LmsScope;
  boardId?: string;
  institutionId?: string;
  name: string;
  subject?: string;
  criteria: Array<{
    name: string;
    maxPoints: number;
    levels: Array<{ label: string; points: number }>;
  }>;
}): Promise<LmsRubric> {
  const result = await gatewayFetch<LmsRubric>('/lms/rubrics', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create rubric');
  return result.data;
}

export async function gradeSubmissionWithRubric(
  submissionId: string,
  input: {
    questionId?: string;
    scores: Array<{ criterionId: string; levelIndex: number; points: number; comment?: string }>;
    feedback?: string;
  },
): Promise<LmsSubmission> {
  const result = await gatewayFetch<LmsSubmission>(
    `/lms/submissions/${submissionId}/rubric-grade`,
    { method: 'POST', json: input, throwOnError: false },
  );
  if (!result.data) failed(result, 'Failed to apply rubric grade');
  return result.data;
}

export async function uploadAssignmentFile(
  assignmentId: string,
  input: { filename: string; mimeType: string; contentBase64: string; submissionId?: string },
): Promise<{ id: string; filename: string }> {
  const result = await gatewayFetch<{ id: string; filename: string }>(
    `/lms/assignments/${assignmentId}/files`,
    { method: 'POST', json: input, throwOnError: false },
  );
  if (!result.data) failed(result, 'Failed to upload file');
  return result.data;
}

export async function getDiscussion(id: string): Promise<DiscussionThread | null> {
  const result = await gatewayFetch<DiscussionThread>(`/lms/discussions/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function listDiscussions(classKey?: string): Promise<DiscussionThread[]> {
  const result = await gatewayFetch<{ data: DiscussionThread[] }>(
    `/lms/discussions${toQuery({ classKey, pageSize: 50 })}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createDiscussion(input: {
  institutionId?: string;
  classKey: string;
  title: string;
}): Promise<DiscussionThread> {
  const result = await gatewayFetch<DiscussionThread>('/lms/discussions', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create discussion');
  return result.data;
}

export async function createDiscussionPost(
  threadId: string,
  body: string,
): Promise<{ id: string }> {
  const result = await gatewayFetch<{ id: string }>(`/lms/discussions/${threadId}/posts`, {
    method: 'POST',
    json: { body },
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to post');
  return result.data;
}

export async function lockDiscussion(threadId: string, locked: boolean): Promise<DiscussionThread> {
  const result = await gatewayFetch<DiscussionThread>(`/lms/discussions/${threadId}/lock`, {
    method: 'POST',
    json: { locked },
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to lock discussion');
  return result.data;
}

export async function hideDiscussionPost(
  threadId: string,
  postId: string,
  hidden: boolean,
): Promise<{ id: string; hidden: boolean }> {
  const result = await gatewayFetch<{ id: string; hidden: boolean }>(
    `/lms/discussions/${threadId}/posts/${postId}/hide`,
    { method: 'POST', json: { hidden }, throwOnError: false },
  );
  if (!result.data) failed(result, 'Failed to hide post');
  return result.data;
}

export async function listContentItems(filter: {
  classKey?: string;
  published?: boolean;
} = {}): Promise<ContentItem[]> {
  const result = await gatewayFetch<{ data: ContentItem[] }>(
    `/lms/content${toQuery({ ...filter, pageSize: 100 })}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export async function createContentItem(input: {
  scope: LmsScope;
  boardId?: string;
  institutionId?: string;
  title: string;
  kind: ContentKind;
  body?: string;
  tags?: string[];
  classKey?: string;
  subject?: string;
  published?: boolean;
}): Promise<ContentItem> {
  const result = await gatewayFetch<ContentItem>('/lms/content', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create content');
  return result.data;
}

export async function getClassAnalytics(classKey: string, institutionId?: string): Promise<ClassAnalytics | null> {
  const result = await gatewayFetch<ClassAnalytics>(
    `/lms/analytics${toQuery({ classKey, institutionId })}`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data ?? null;
}

export interface QuizItemAnalytics {
  questionId: string;
  prompt: string;
  questionType: QuestionType;
  difficulty: number | null;
  correctCount: number;
  attemptCount: number;
}

export interface QuizAnalytics {
  assignmentId: string;
  submissionCount: number;
  mean: number | null;
  median: number | null;
  items: QuizItemAnalytics[];
  students: Array<{
    studentId: string;
    score: number | null;
    answered: number;
    total: number;
    completion: number;
  }>;
}

export async function getQuizAnalytics(assignmentId: string): Promise<QuizAnalytics | null> {
  const result = await gatewayFetch<QuizAnalytics>(`/lms/assignments/${assignmentId}/analytics`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function listAssignmentFiles(
  assignmentId: string,
): Promise<Array<{ id: string; filename: string }>> {
  const result = await gatewayFetch<{ data: Array<{ id: string; filename: string }> }>(
    `/lms/assignments/${assignmentId}/files`,
    { throwOnError: false, next: { revalidate: 0 } },
  );
  return result.data?.data ?? [];
}

export interface LmsLesson {
  id: string;
  title: string;
  subject: string | null;
  gradeLevel: string | null;
  description: string | null;
  published: boolean;
  resources?: Array<{ id: string; kind: string; title: string; url: string | null }>;
}

export async function getLesson(id: string): Promise<LmsLesson | null> {
  const result = await gatewayFetch<LmsLesson>(`/lms/lessons/${id}`, {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data ?? null;
}

export async function listLessons(): Promise<LmsLesson[]> {
  const result = await gatewayFetch<{ data: LmsLesson[] }>('/lms/lessons?pageSize=100', {
    throwOnError: false,
    next: { revalidate: 0 },
  });
  return result.data?.data ?? [];
}

export async function createLesson(input: {
  scope: LmsScope;
  boardId?: string;
  institutionId?: string;
  title: string;
  subject?: string;
  gradeLevel?: string;
  description?: string;
  published?: boolean;
}): Promise<LmsLesson> {
  const result = await gatewayFetch<LmsLesson>('/lms/lessons', {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to create lesson');
  return result.data;
}

export async function addLessonResource(
  lessonId: string,
  input: { kind: 'link' | 'file' | 'video'; title: string; url?: string },
): Promise<{ id: string }> {
  const result = await gatewayFetch<{ id: string }>(`/lms/lessons/${lessonId}/resources`, {
    method: 'POST',
    json: input,
    throwOnError: false,
  });
  if (!result.data) failed(result, 'Failed to add resource');
  return result.data;
}

export async function pinDiscussionPost(
  threadId: string,
  postId: string,
  pinned: boolean,
): Promise<{ id: string; pinned: boolean }> {
  const result = await gatewayFetch<{ id: string; pinned: boolean }>(
    `/lms/discussions/${threadId}/posts/${postId}/pin`,
    { method: 'POST', json: { pinned }, throwOnError: false },
  );
  if (!result.data) failed(result, 'Failed to pin post');
  return result.data;
}
