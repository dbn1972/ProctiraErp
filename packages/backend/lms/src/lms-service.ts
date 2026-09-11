/**
 * LMS service — assignments, homework, quizzes and Spiral PAL (Wave 8).
 *
 * Tenancy rules enforced here (not only in the gateway):
 *  - Content is `board` (shared across all schools of a board) or `school`.
 *  - A school-bound actor (JWT `institutions` non-empty, not tenant admin) may
 *    only author or read school-scoped rows for its own institutions.
 *  - Student actors can only submit / practise as themselves (`sub` binding).
 */
import { randomUUID } from 'node:crypto';

import {
  AppError,
  BusinessRuleError,
  ConflictError,
  ErrorCode,
  NotFoundError,
  ValidationError,
  type PaginatedResult,
  type PaginationOptions,
} from '@proctira/common';

import {
  gradeEssay,
  gradeObjectiveQuiz,
  itemDifficulty,
  mean,
  median,
  type QuizAnalytics,
  type QuestionType,
} from './grading-engine.js';
import {
  assertAllowedUpload,
  createLmsFileDownloadToken,
  decodeBase64Payload,
  putLmsFile,
  verifyLmsFileDownloadToken,
} from './lms-file-store.js';
import type {
  AssignmentEntity,
  AssignmentFileEntity,
  AssignmentFilter,
  BankQuestionEntity,
  BankQuestionFilter,
  ContentItemEntity,
  DiscussionEntity,
  DiscussionPostEntity,
  LessonEntity,
  LessonResourceEntity,
  LmsRepository,
  PracticeAttemptEntity,
  QuizQuestionEntity,
  RubricCriterionEntity,
  SkillEntity,
  SkillFilter,
  SkillMasteryEntity,
  SubmissionEntity,
  SubmissionFilter,
} from './lms-repository.js';
import type {
  CreateAssignmentInput,
  CreateBankQuestionInput,
  CreateContentItemInput,
  CreateDiscussionInput,
  CreateLessonInput,
  CreateLessonResourceInput,
  CreatePostInput,
  CreateRubricInput,
  CreateSkillInput,
  CreateSubmissionInput,
  GradeRubricInput,
  GradeSubmissionInput,
  PlanQuery,
  QuizQuestionInput,
  RecordAttemptInput,
  UpdateAssignmentInput,
  UploadFileInput,
} from './schemas.js';
import { applyAttempt, buildSpiralPlan, INITIAL_MASTERY, type SpiralPlan } from './spiral-pal.js';

export class ForbiddenError extends AppError {
  constructor(message = 'Forbidden') {
    super(message, ErrorCode.FORBIDDEN, 403);
  }
}

/** Minimal actor context derived from the gateway JWT. */
export interface LmsActor {
  userId: string | null;
  roles: string[];
  institutions: string[];
}

export const ANONYMOUS_ACTOR: LmsActor = { userId: null, roles: [], institutions: [] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `created_by` / `graded_by` are UUID columns; IdP subjects are not guaranteed
 * to be UUIDs (Keycloak yes, service accounts / legacy IdPs no). Non-UUID
 * subjects are stored as NULL rather than failing the write.
 */
export function uuidOrNull(value: string | null | undefined): string | null {
  return value && UUID_RE.test(value) ? value : null;
}

const TENANT_ADMIN_ROLES = new Set(['admin', 'platform_admin', 'super-admin', 'board_admin']);
const AUTHOR_ROLES = new Set([...TENANT_ADMIN_ROLES, 'principal', 'teacher', 'staff']);
const LEARNER_ROLES = new Set(['student']);

export function isTenantAdmin(actor: LmsActor): boolean {
  return actor.roles.some((r) => TENANT_ADMIN_ROLES.has(r));
}

export function canAuthor(actor: LmsActor): boolean {
  return actor.roles.some((r) => AUTHOR_ROLES.has(r));
}

export function isLearner(actor: LmsActor): boolean {
  return actor.roles.some((r) => LEARNER_ROLES.has(r)) && !canAuthor(actor);
}

/** School-bound = has an institution list and is not a tenant/board admin. */
function isSchoolBound(actor: LmsActor): boolean {
  return actor.institutions.length > 0 && !isTenantAdmin(actor);
}

function assertInstitutionAllowed(actor: LmsActor, institutionId: string | null | undefined) {
  if (!institutionId) return;
  if (isSchoolBound(actor) && !actor.institutions.includes(institutionId)) {
    throw new ForbiddenError('Institution is outside the caller scope');
  }
}

function assertScopeTarget(scope: 'board' | 'school', boardId?: string, institutionId?: string) {
  if (scope === 'board' && !boardId) {
    throw new ValidationError('boardId is required for board-scoped content', [
      { field: 'boardId', rule: 'required', message: 'boardId is required when scope=board' },
    ]);
  }
  if (scope === 'school' && !institutionId) {
    throw new ValidationError('institutionId is required for school-scoped content', [
      {
        field: 'institutionId',
        rule: 'required',
        message: 'institutionId is required when scope=school',
      },
    ]);
  }
}

function normaliseQuestions(
  tenantId: string,
  assignmentId: string,
  questions: QuizQuestionInput[],
): Omit<QuizQuestionEntity, 'createdAt'>[] {
  return questions.map((q, index) => {
    const questionType: QuestionType = q.questionType ?? 'mcq';
    const options = q.options ?? [];
    if (questionType === 'mcq') {
      if (options.length < 2) {
        throw new ValidationError('MCQ questions need at least two options', [
          {
            field: `questions[${index}].options`,
            rule: 'min',
            message: 'Provide at least two options',
          },
        ]);
      }
      const idx = q.correctOptionIndex ?? 0;
      if (idx >= options.length) {
        throw new ValidationError('correctOptionIndex is out of range', [
          {
            field: `questions[${index}].correctOptionIndex`,
            rule: 'range',
            message: 'correctOptionIndex must reference one of the options',
          },
        ]);
      }
    }
    return {
      id: randomUUID(),
      tenantId,
      assignmentId,
      position: index,
      prompt: q.prompt,
      options,
      correctOptionIndex: q.correctOptionIndex ?? -1,
      points: q.points ?? 1,
      skillId: q.skillId ?? null,
      explanation: q.explanation ?? null,
      questionType,
      bankId: q.bankId ?? null,
      payload: (q.payload as Record<string, unknown> | undefined) ?? {},
    };
  });
}

function bankToQuizQuestion(
  tenantId: string,
  assignmentId: string,
  bank: BankQuestionEntity,
  position: number,
): Omit<QuizQuestionEntity, 'createdAt'> {
  const rawOptions = bank.payload.options;
  const options = Array.isArray(rawOptions)
    ? rawOptions.filter((item): item is string => typeof item === 'string')
    : [];
  const correctOptionIndex =
    typeof bank.payload.correctOptionIndex === 'number' ? bank.payload.correctOptionIndex : -1;
  return {
    id: randomUUID(),
    tenantId,
    assignmentId,
    position,
    prompt: bank.prompt,
    options,
    correctOptionIndex,
    points: bank.points,
    skillId: bank.skillId,
    explanation: typeof bank.payload.explanation === 'string' ? bank.payload.explanation : null,
    questionType: bank.questionType,
    bankId: bank.id,
    payload: {
      ...bank.payload,
      tags: bank.tags,
      rubricId:
        bank.rubricId ??
        (typeof bank.payload.rubricId === 'string' ? bank.payload.rubricId : undefined),
    },
  };
}

function toBankLike(q: QuizQuestionEntity) {
  return {
    id: q.id,
    questionType: q.questionType ?? 'mcq',
    points: q.points,
    skillId: q.skillId,
    correctOptionIndex: q.correctOptionIndex,
    payload: q.payload ?? {},
  };
}

function stripAnswerKey(q: QuizQuestionEntity): QuizQuestionEntity {
  const payload = { ...(q.payload ?? {}) };
  delete payload.correctOptionIndex;
  delete payload.correctOptionIndexes;
  delete payload.correctValue;
  delete payload.pairs;
  return {
    ...q,
    correctOptionIndex: -1,
    explanation: null,
    payload,
  };
}

export interface AssignmentWithQuestions extends AssignmentEntity {
  questions: QuizQuestionEntity[];
  submissionCount?: number;
}

export interface StudentProgress {
  studentId: string;
  skills: Array<{
    skill: SkillEntity;
    mastery: SkillMasteryEntity | null;
  }>;
  summary: { mastered: number; inProgress: number; notStarted: number; averageMastery: number };
}

export class LmsService {
  constructor(private readonly repository: LmsRepository) {}

  // ─── Skills ────────────────────────────────────────────────────────────

  async createSkill(
    tenantId: string,
    input: CreateSkillInput,
    actor: LmsActor,
  ): Promise<SkillEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can create skills');
    assertScopeTarget(input.scope, input.boardId, input.institutionId);
    assertInstitutionAllowed(actor, input.institutionId);
    if (input.prerequisiteSkillIds && input.prerequisiteSkillIds.length > 0) {
      const found = await this.repository.findSkillsByIds(tenantId, input.prerequisiteSkillIds);
      if (found.length !== new Set(input.prerequisiteSkillIds).size) {
        throw new ValidationError('Unknown prerequisite skill', [
          {
            field: 'prerequisiteSkillIds',
            rule: 'exists',
            message: 'All prerequisites must exist',
          },
        ]);
      }
    }
    try {
      return await this.repository.createSkill({
        id: randomUUID(),
        tenantId,
        scope: input.scope,
        boardId: input.scope === 'board' ? input.boardId! : null,
        institutionId: input.scope === 'school' ? input.institutionId! : null,
        code: input.code.trim().toUpperCase(),
        name: input.name.trim(),
        subject: input.subject.trim(),
        gradeLevel: input.gradeLevel ?? null,
        description: input.description ?? null,
        prerequisiteSkillIds: input.prerequisiteSkillIds ?? [],
      });
    } catch (error) {
      if (error instanceof Error && /duplicate/i.test(error.message)) {
        throw new ConflictError(`Skill code ${input.code} already exists`);
      }
      throw error;
    }
  }

  async listSkills(
    tenantId: string,
    filter: SkillFilter,
    pagination: PaginationOptions,
    actor: LmsActor,
  ): Promise<PaginatedResult<SkillEntity>> {
    assertInstitutionAllowed(actor, filter.institutionId);
    return this.repository.listSkills(tenantId, filter, pagination);
  }

  // ─── Assignments ───────────────────────────────────────────────────────

  async createAssignment(
    tenantId: string,
    input: CreateAssignmentInput,
    actor: LmsActor,
  ): Promise<AssignmentWithQuestions> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can author assignments');
    assertScopeTarget(input.scope, input.boardId, input.institutionId);
    assertInstitutionAllowed(actor, input.institutionId);
    if (input.scope === 'board' && isSchoolBound(actor)) {
      throw new ForbiddenError('Only board/tenant administrators can publish board-wide content');
    }

    const skillIds = Array.from(new Set<string>(input.skillIds ?? []));
    if (skillIds.length > 0) {
      const found = await this.repository.findSkillsByIds(tenantId, skillIds);
      if (found.length !== skillIds.length) {
        throw new ValidationError('Unknown skill reference', [
          { field: 'skillIds', rule: 'exists', message: 'All skills must exist in this tenant' },
        ]);
      }
    }

    const questions = input.questions ?? [];
    const bankIds = Array.from(new Set<string>(input.bankQuestionIds ?? []));
    if (input.kind !== 'quiz' && (questions.length > 0 || bankIds.length > 0)) {
      throw new ValidationError('Only quizzes may carry questions', [
        { field: 'questions', rule: 'kind', message: 'questions are only valid when kind=quiz' },
      ]);
    }
    const publish = input.publish === true;
    if (publish && input.kind === 'quiz' && questions.length === 0 && bankIds.length === 0) {
      throw new BusinessRuleError('A quiz needs at least one question before it is published');
    }

    const id = randomUUID();
    const fromInline = normaliseQuestions(tenantId, id, questions);
    const fromBank =
      bankIds.length > 0
        ? await this.copyBankQuestions(tenantId, id, bankIds, fromInline.length)
        : [];
    const normalised = [...fromInline, ...fromBank];
    const quizPoints = normalised.reduce((sum, q) => sum + q.points, 0);
    const maxScore = input.maxScore ?? (input.kind === 'quiz' && quizPoints > 0 ? quizPoints : 100);
    const now = new Date();

    const assignment = await this.repository.createAssignment({
      id,
      tenantId,
      scope: input.scope,
      boardId: input.scope === 'board' ? input.boardId! : null,
      institutionId: input.scope === 'school' ? input.institutionId! : null,
      kind: input.kind,
      title: input.title.trim(),
      description: input.description ?? null,
      subject: input.subject.trim(),
      gradeLevel: input.gradeLevel ?? null,
      sectionId: input.sectionId ?? null,
      academicPeriodId: input.academicPeriodId ?? null,
      skillIds,
      maxScore,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      allowLate: input.allowLate ?? true,
      status: publish ? 'published' : 'draft',
      createdBy: uuidOrNull(actor.userId),
      publishedAt: publish ? now : null,
    });
    const savedQuestions =
      normalised.length > 0 ? await this.repository.replaceQuestions(tenantId, id, normalised) : [];
    return { ...assignment, questions: savedQuestions };
  }

  async updateAssignment(
    tenantId: string,
    id: string,
    input: UpdateAssignmentInput,
    actor: LmsActor,
  ): Promise<AssignmentWithQuestions> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can edit assignments');
    const existing = await this.requireAssignment(tenantId, id, actor);
    if (existing.status === 'archived') {
      throw new BusinessRuleError('Archived assignments are read-only');
    }
    if (input.status) this.assertTransition(existing.status, input.status);
    if (input.questions && existing.kind !== 'quiz') {
      throw new ValidationError('Only quizzes may carry questions', [
        { field: 'questions', rule: 'kind', message: 'questions are only valid when kind=quiz' },
      ]);
    }
    if (input.skillIds) {
      const unique = Array.from(new Set<string>(input.skillIds));
      const found = await this.repository.findSkillsByIds(tenantId, unique);
      if (found.length !== unique.length) {
        throw new ValidationError('Unknown skill reference', [
          { field: 'skillIds', rule: 'exists', message: 'All skills must exist in this tenant' },
        ]);
      }
    }

    let questions = await this.repository.listQuestions(tenantId, id);
    if (input.questions) {
      questions = await this.repository.replaceQuestions(
        tenantId,
        id,
        normaliseQuestions(tenantId, id, input.questions),
      );
    }
    const targetStatus = input.status ?? existing.status;
    if (targetStatus === 'published' && existing.kind === 'quiz' && questions.length === 0) {
      throw new BusinessRuleError('A quiz needs at least one question before it is published');
    }

    const patch: Parameters<LmsRepository['updateAssignment']>[2] = {};
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.subject !== undefined) patch.subject = input.subject.trim();
    if (input.gradeLevel !== undefined) patch.gradeLevel = input.gradeLevel;
    if (input.sectionId !== undefined) patch.sectionId = input.sectionId;
    if (input.skillIds !== undefined) patch.skillIds = Array.from(new Set<string>(input.skillIds));
    if (input.maxScore !== undefined) patch.maxScore = input.maxScore;
    if (input.dueAt !== undefined) patch.dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (input.timeLimitMinutes !== undefined) patch.timeLimitMinutes = input.timeLimitMinutes;
    if (input.allowLate !== undefined) patch.allowLate = input.allowLate;
    if (input.status !== undefined) {
      patch.status = input.status;
      if (input.status === 'published' && !existing.publishedAt) patch.publishedAt = new Date();
    }
    const updated = await this.repository.updateAssignment(tenantId, id, patch);
    if (!updated) throw new NotFoundError('Assignment not found');
    return { ...updated, questions };
  }

  private assertTransition(from: AssignmentEntity['status'], to: AssignmentEntity['status']) {
    const allowed: Record<AssignmentEntity['status'], AssignmentEntity['status'][]> = {
      draft: ['draft', 'published', 'archived'],
      published: ['published', 'closed', 'archived'],
      closed: ['closed', 'published', 'archived'],
      archived: ['archived'],
    };
    if (!allowed[from].includes(to)) {
      throw new BusinessRuleError(`Cannot move assignment from ${from} to ${to}`);
    }
  }

  async publishAssignment(tenantId: string, id: string, actor: LmsActor) {
    return this.updateAssignment(tenantId, id, { status: 'published' }, actor);
  }

  async closeAssignment(tenantId: string, id: string, actor: LmsActor) {
    return this.updateAssignment(tenantId, id, { status: 'closed' }, actor);
  }

  async getAssignment(
    tenantId: string,
    id: string,
    actor: LmsActor,
  ): Promise<AssignmentWithQuestions> {
    const assignment = await this.requireAssignment(tenantId, id, actor);
    if (isLearner(actor) && assignment.status === 'draft') {
      throw new NotFoundError('Assignment not found');
    }
    const questions = await this.repository.listQuestions(tenantId, id);
    const submissions = await this.repository.listSubmissions(
      tenantId,
      { assignmentId: id },
      { page: 1, pageSize: 1 },
    );
    return {
      ...assignment,
      // Learners never see the answer key.
      questions: isLearner(actor) ? questions.map(stripAnswerKey) : questions,
      submissionCount: submissions.meta.totalItems,
    };
  }

  async listAssignments(
    tenantId: string,
    filter: AssignmentFilter,
    pagination: PaginationOptions,
    actor: LmsActor,
  ): Promise<PaginatedResult<AssignmentEntity>> {
    assertInstitutionAllowed(actor, filter.institutionId);
    // School-bound callers without an explicit institution are pinned to their
    // first institution so they never see other schools' school-scoped rows.
    const effective: AssignmentFilter = { ...filter };
    if (isSchoolBound(actor) && !effective.institutionId) {
      effective.institutionId = actor.institutions[0];
    }
    if (isLearner(actor)) effective.status = effective.status ?? 'published';
    if (isLearner(actor) && effective.status !== 'published' && effective.status !== 'closed') {
      throw new ForbiddenError('Learners can only list published or closed work');
    }
    return this.repository.listAssignments(tenantId, effective, pagination);
  }

  async deleteAssignment(tenantId: string, id: string, actor: LmsActor): Promise<void> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can delete assignments');
    const existing = await this.requireAssignment(tenantId, id, actor);
    if (existing.status !== 'draft') {
      throw new BusinessRuleError('Only draft assignments can be deleted; archive instead');
    }
    await this.repository.deleteAssignment(tenantId, id);
  }

  private async requireAssignment(
    tenantId: string,
    id: string,
    actor: LmsActor,
  ): Promise<AssignmentEntity> {
    const assignment = await this.repository.findAssignmentById(tenantId, id);
    if (!assignment) throw new NotFoundError('Assignment not found');
    if (assignment.scope === 'school') {
      // Cross-school IDOR guard: school-bound actors only see their own school.
      if (isSchoolBound(actor) && !actor.institutions.includes(assignment.institutionId!)) {
        throw new NotFoundError('Assignment not found');
      }
    }
    return assignment;
  }

  // ─── Submissions ───────────────────────────────────────────────────────

  async submit(
    tenantId: string,
    assignmentId: string,
    input: CreateSubmissionInput,
    actor: LmsActor,
    now: Date = new Date(),
  ): Promise<SubmissionEntity> {
    const assignment = await this.requireAssignment(tenantId, assignmentId, actor);
    if (isLearner(actor) && actor.userId && input.studentId !== actor.userId) {
      throw new ForbiddenError('Students can only submit their own work');
    }
    assertInstitutionAllowed(actor, input.institutionId);
    if (assignment.status !== 'published') {
      throw new BusinessRuleError('Assignment is not open for submissions');
    }
    const existing = await this.repository.findSubmission(tenantId, assignmentId, input.studentId);
    if (existing) throw new ConflictError('Student already submitted this assignment');

    const late = assignment.dueAt != null && now.getTime() > assignment.dueAt.getTime();
    if (late && !assignment.allowLate) {
      throw new BusinessRuleError('Deadline has passed and late submissions are not allowed');
    }

    let score: number | null = null;
    let status: SubmissionEntity['status'] = late ? 'late' : 'submitted';
    let autoGraded = false;
    let gradedAt: Date | null = null;
    const answers = input.answers ?? [];

    if (assignment.kind === 'quiz') {
      const questions = await this.repository.listQuestions(tenantId, assignmentId);
      if (answers.length === 0) {
        throw new ValidationError('Quiz submissions require answers', [
          { field: 'answers', rule: 'required', message: 'Provide at least one answer' },
        ]);
      }
      const graded = gradeObjectiveQuiz(questions.map(toBankLike), answers);
      score =
        !graded.pendingEssay && graded.maxScore > 0
          ? Math.round((graded.score / graded.maxScore) * assignment.maxScore * 100) / 100
          : graded.score;
      if (!graded.pendingEssay) {
        status = 'graded';
        autoGraded = true;
        gradedAt = now;
      }
      for (const r of graded.results) {
        if (!r.skillId) continue;
        await this.applyPalAttempt(tenantId, input.studentId, r.skillId, {
          correct: r.correct,
          source: 'quiz',
          sourceId: assignmentId,
          institutionId: input.institutionId ?? assignment.institutionId,
          now,
        });
      }
    } else if (answers.length > 0) {
      throw new ValidationError('Only quizzes accept answers', [
        { field: 'answers', rule: 'kind', message: 'answers are only valid for quizzes' },
      ]);
    }

    try {
      return await this.repository.createSubmission({
        id: randomUUID(),
        tenantId,
        assignmentId,
        studentId: input.studentId,
        institutionId: input.institutionId ?? assignment.institutionId,
        status,
        content: input.content ?? null,
        attachments: input.attachments ?? [],
        answers,
        score,
        autoGraded,
        feedback: null,
        submittedAt: now,
        gradedAt,
        gradedBy: null,
      });
    } catch (error) {
      if (error instanceof Error && /duplicate/i.test(error.message)) {
        throw new ConflictError('Student already submitted this assignment');
      }
      throw error;
    }
  }

  async grade(
    tenantId: string,
    submissionId: string,
    input: GradeSubmissionInput,
    actor: LmsActor,
    now: Date = new Date(),
  ): Promise<SubmissionEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can grade');
    const submission = await this.repository.findSubmissionById(tenantId, submissionId);
    if (!submission) throw new NotFoundError('Submission not found');
    const assignment = await this.requireAssignment(tenantId, submission.assignmentId, actor);
    if (input.score > assignment.maxScore) {
      throw new ValidationError('Score exceeds the assignment maximum', [
        { field: 'score', rule: 'max', message: `score must be ≤ ${assignment.maxScore}` },
      ]);
    }
    const updated = await this.repository.updateSubmission(tenantId, submissionId, {
      score: input.score,
      feedback: input.feedback ?? null,
      status: input.returnToStudent ? 'returned' : 'graded',
      gradedAt: now,
      gradedBy: uuidOrNull(actor.userId),
      autoGraded: false,
    });
    if (!updated) throw new NotFoundError('Submission not found');

    // Homework/assignment grades feed the PAL ledger for the linked skills:
    // ≥ 60 % counts as a correct attempt.
    if (assignment.skillIds.length > 0 && assignment.maxScore > 0) {
      const correct = input.score / assignment.maxScore >= 0.6;
      for (const skillId of assignment.skillIds) {
        await this.applyPalAttempt(tenantId, submission.studentId, skillId, {
          correct,
          source: assignment.kind === 'quiz' ? 'quiz' : assignment.kind,
          sourceId: assignment.id,
          institutionId: submission.institutionId,
          now,
        });
      }
    }
    return updated;
  }

  async listSubmissions(
    tenantId: string,
    filter: SubmissionFilter,
    pagination: PaginationOptions,
    actor: LmsActor,
  ): Promise<PaginatedResult<SubmissionEntity>> {
    const effective: SubmissionFilter = { ...filter };
    if (isLearner(actor)) {
      if (!actor.userId) throw new ForbiddenError('Unknown learner');
      effective.studentId = actor.userId;
    }
    if (effective.assignmentId)
      await this.requireAssignment(tenantId, effective.assignmentId, actor);
    return this.repository.listSubmissions(tenantId, effective, pagination);
  }

  async getSubmission(tenantId: string, id: string, actor: LmsActor): Promise<SubmissionEntity> {
    const submission = await this.repository.findSubmissionById(tenantId, id);
    if (!submission) throw new NotFoundError('Submission not found');
    if (isLearner(actor) && submission.studentId !== actor.userId) {
      throw new NotFoundError('Submission not found');
    }
    await this.requireAssignment(tenantId, submission.assignmentId, actor);
    return submission;
  }

  // ─── Spiral PAL ────────────────────────────────────────────────────────

  private async applyPalAttempt(
    tenantId: string,
    studentId: string,
    skillId: string,
    opts: {
      correct: boolean;
      responseTimeMs?: number | null;
      source: PracticeAttemptEntity['source'];
      sourceId: string | null;
      institutionId: string | null;
      now: Date;
    },
  ): Promise<SkillMasteryEntity> {
    const current = await this.repository.findMastery(tenantId, studentId, skillId);
    const next = applyAttempt(current ?? INITIAL_MASTERY, {
      correct: opts.correct,
      responseTimeMs: opts.responseTimeMs ?? null,
      now: opts.now,
    });
    const saved = await this.repository.upsertMastery({
      id: current?.id ?? randomUUID(),
      tenantId,
      studentId,
      skillId,
      institutionId: opts.institutionId ?? current?.institutionId ?? null,
      ...next,
    });
    await this.repository.recordAttempt({
      id: randomUUID(),
      tenantId,
      studentId,
      skillId,
      source: opts.source,
      sourceId: opts.sourceId,
      correct: opts.correct,
      responseTimeMs: opts.responseTimeMs ?? null,
      masteryAfter: next.mastery,
    });
    return saved;
  }

  async recordAttempt(
    tenantId: string,
    studentId: string,
    input: RecordAttemptInput,
    actor: LmsActor,
    now: Date = new Date(),
  ): Promise<SkillMasteryEntity> {
    if (isLearner(actor) && actor.userId && studentId !== actor.userId) {
      throw new ForbiddenError('Students can only practise as themselves');
    }
    assertInstitutionAllowed(actor, input.institutionId);
    const skill = await this.repository.findSkillById(tenantId, input.skillId);
    if (!skill) throw new NotFoundError('Skill not found');
    return this.applyPalAttempt(tenantId, studentId, input.skillId, {
      correct: input.correct,
      responseTimeMs: input.responseTimeMs ?? null,
      source: 'practice',
      sourceId: null,
      institutionId: input.institutionId ?? null,
      now,
    });
  }

  async getPlan(
    tenantId: string,
    studentId: string,
    query: PlanQuery,
    actor: LmsActor,
    now: Date = new Date(),
  ): Promise<SpiralPlan> {
    if (isLearner(actor) && actor.userId && studentId !== actor.userId) {
      throw new ForbiddenError('Students can only view their own plan');
    }
    assertInstitutionAllowed(actor, query.institutionId);
    const skills = await this.repository.listSkills(
      tenantId,
      {
        institutionId: query.institutionId,
        boardId: query.boardId,
        subject: query.subject,
      },
      { page: 1, pageSize: 200 },
    );
    const mastery = await this.repository.listMastery(tenantId, { studentId });
    return buildSpiralPlan({
      skills: skills.data.map((s) => ({
        id: s.id,
        name: s.name,
        subject: s.subject,
        prerequisiteSkillIds: s.prerequisiteSkillIds,
      })),
      mastery: mastery.map((m) => ({
        skillId: m.skillId,
        mastery: m.mastery,
        dueAt: m.dueAt,
        streak: m.streak,
      })),
      now,
      limit: query.limit ?? 10,
    });
  }

  async getProgress(
    tenantId: string,
    studentId: string,
    query: PlanQuery,
    actor: LmsActor,
  ): Promise<StudentProgress> {
    if (isLearner(actor) && actor.userId && studentId !== actor.userId) {
      throw new ForbiddenError('Students can only view their own progress');
    }
    assertInstitutionAllowed(actor, query.institutionId);
    const skills = await this.repository.listSkills(
      tenantId,
      { institutionId: query.institutionId, boardId: query.boardId, subject: query.subject },
      { page: 1, pageSize: 200 },
    );
    const mastery = await this.repository.listMastery(tenantId, { studentId });
    const bySkill = new Map(mastery.map((m) => [m.skillId, m]));
    let mastered = 0;
    let inProgress = 0;
    let notStarted = 0;
    let total = 0;
    const rows = skills.data.map((skill) => {
      const m = bySkill.get(skill.id) ?? null;
      if (!m) notStarted += 1;
      else if (m.mastery >= 0.8) mastered += 1;
      else inProgress += 1;
      total += m?.mastery ?? 0;
      return { skill, mastery: m };
    });
    return {
      studentId,
      skills: rows,
      summary: {
        mastered,
        inProgress,
        notStarted,
        averageMastery: rows.length ? Math.round((total / rows.length) * 10_000) / 10_000 : 0,
      },
    };
  }

  async listAttempts(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
    actor: LmsActor,
  ): Promise<PaginatedResult<PracticeAttemptEntity>> {
    if (isLearner(actor) && actor.userId && studentId !== actor.userId) {
      throw new ForbiddenError('Students can only view their own attempts');
    }
    return this.repository.listAttempts(tenantId, studentId, pagination);
  }

  private async copyBankQuestions(
    tenantId: string,
    assignmentId: string,
    bankIds: string[],
    startPosition: number,
  ): Promise<Omit<QuizQuestionEntity, 'createdAt'>[]> {
    const found = await this.repository.findBankQuestionsByIds(tenantId, bankIds);
    if (found.length !== bankIds.length) {
      throw new ValidationError('Unknown bank question', [
        { field: 'bankQuestionIds', rule: 'exists', message: 'All bank questions must exist' },
      ]);
    }
    const byId = new Map(found.map((q) => [q.id, q]));
    return bankIds.map((id, i) =>
      bankToQuizQuestion(tenantId, assignmentId, byId.get(id)!, startPosition + i),
    );
  }

  async assembleFromBank(
    tenantId: string,
    assignmentId: string,
    questionIds: string[],
    actor: LmsActor,
  ): Promise<AssignmentWithQuestions> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can assemble quizzes');
    const assignment = await this.requireAssignment(tenantId, assignmentId, actor);
    if (assignment.kind !== 'quiz') {
      throw new ValidationError('Only quizzes may carry questions', [
        { field: 'questionIds', rule: 'kind', message: 'questions are only valid when kind=quiz' },
      ]);
    }
    const existing = await this.repository.listQuestions(tenantId, assignmentId);
    const copied = await this.copyBankQuestions(
      tenantId,
      assignmentId,
      questionIds,
      existing.length,
    );
    const merged = [
      ...existing.map((q, i) => ({ ...q, position: i })),
      ...copied.map((q, i) => ({ ...q, position: existing.length + i })),
    ];
    const questions = await this.repository.replaceQuestions(tenantId, assignmentId, merged);
    return { ...assignment, questions };
  }

  async createBankQuestion(
    tenantId: string,
    input: CreateBankQuestionInput,
    actor: LmsActor,
  ): Promise<BankQuestionEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can author the question bank');
    assertScopeTarget(input.scope, input.boardId, input.institutionId);
    assertInstitutionAllowed(actor, input.institutionId);
    return this.repository.createBankQuestion({
      id: randomUUID(),
      tenantId,
      scope: input.scope,
      boardId: input.scope === 'board' ? input.boardId! : null,
      institutionId: input.scope === 'school' ? input.institutionId! : null,
      subject: input.subject.trim(),
      gradeLevel: input.gradeLevel ?? null,
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
      questionType: input.questionType,
      prompt: input.prompt.trim(),
      payload: (input.payload as Record<string, unknown> | undefined) ?? {},
      points: input.points ?? 1,
      skillId: input.skillId ?? null,
      rubricId: input.rubricId ?? null,
      difficulty: input.difficulty ?? 'medium',
      createdBy: uuidOrNull(actor.userId),
    });
  }

  async listBankQuestions(
    tenantId: string,
    filter: BankQuestionFilter,
    pagination: { page: number; pageSize: number },
    actor: LmsActor,
  ) {
    assertInstitutionAllowed(actor, filter.institutionId);
    return this.repository.listBankQuestions(tenantId, filter, pagination);
  }

  async getBankQuestion(
    tenantId: string,
    id: string,
    actor: LmsActor,
  ): Promise<BankQuestionEntity> {
    const row = await this.repository.findBankQuestion(tenantId, id);
    if (!row) throw new NotFoundError('Question not found');
    if (
      row.scope === 'school' &&
      isSchoolBound(actor) &&
      !actor.institutions.includes(row.institutionId!)
    ) {
      throw new NotFoundError('Question not found');
    }
    return row;
  }

  async createRubric(tenantId: string, input: CreateRubricInput, actor: LmsActor) {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can create rubrics');
    assertScopeTarget(input.scope, input.boardId, input.institutionId);
    assertInstitutionAllowed(actor, input.institutionId);
    const rubric = await this.repository.createRubric({
      id: randomUUID(),
      tenantId,
      scope: input.scope,
      boardId: input.scope === 'board' ? input.boardId! : null,
      institutionId: input.scope === 'school' ? input.institutionId! : null,
      name: input.name.trim(),
      subject: input.subject ?? null,
      gradeLevel: input.gradeLevel ?? null,
      createdBy: uuidOrNull(actor.userId),
    });
    const criteria = await this.repository.replaceRubricCriteria(
      tenantId,
      rubric.id,
      input.criteria.map((c, i) => ({
        id: randomUUID(),
        tenantId,
        rubricId: rubric.id,
        position: i,
        name: c.name.trim(),
        description: c.description ?? null,
        maxPoints: c.maxPoints,
        levels: c.levels,
      })),
    );
    return { ...rubric, criteria };
  }

  async getRubric(tenantId: string, id: string, actor: LmsActor) {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can view rubrics');
    const rubric = await this.repository.findRubric(tenantId, id);
    if (!rubric) throw new NotFoundError('Rubric not found');
    const criteria = await this.repository.listRubricCriteria(tenantId, id);
    return { ...rubric, criteria };
  }

  async listRubrics(
    tenantId: string,
    filter: { institutionId?: string; boardId?: string; subject?: string },
    pagination: { page: number; pageSize: number },
    actor: LmsActor,
  ) {
    assertInstitutionAllowed(actor, filter.institutionId);
    return this.repository.listRubrics(tenantId, filter, pagination);
  }

  async gradeWithRubric(
    tenantId: string,
    submissionId: string,
    input: GradeRubricInput,
    actor: LmsActor,
    now: Date = new Date(),
  ): Promise<SubmissionEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can grade');
    const submission = await this.repository.findSubmissionById(tenantId, submissionId);
    if (!submission) throw new NotFoundError('Submission not found');
    const assignment = await this.requireAssignment(tenantId, submission.assignmentId, actor);
    const questions = await this.repository.listQuestions(tenantId, assignment.id);
    const essay = input.questionId
      ? questions.find((q) => q.id === input.questionId)
      : questions.find((q) => q.questionType === 'essay');
    const criteriaById = new Map<string, RubricCriterionEntity>();
    const rubricId =
      essay && typeof essay.payload?.rubricId === 'string'
        ? essay.payload.rubricId
        : questions.find(
            (q) => q.questionType === 'essay' && typeof q.payload?.rubricId === 'string',
          )?.payload?.rubricId;
    if (typeof rubricId === 'string') {
      for (const c of await this.repository.listRubricCriteria(tenantId, rubricId)) {
        criteriaById.set(c.id, c);
      }
    }
    const scored = input.scores.map((s) => {
      const criterion = criteriaById.get(s.criterionId);
      return {
        criterionId: s.criterionId,
        points: s.points,
        maxPoints: criterion?.maxPoints ?? s.points,
      };
    });
    const essayPoints = essay?.points ?? assignment.maxScore;
    const essayResult = gradeEssay(scored, essayPoints);
    await this.repository.replaceRubricScores(
      tenantId,
      submissionId,
      input.scores.map((s) => ({
        id: randomUUID(),
        tenantId,
        submissionId,
        criterionId: s.criterionId,
        questionId: input.questionId ?? essay?.id ?? null,
        levelIndex: s.levelIndex,
        points: s.points,
        comment: s.comment ?? null,
        scoredBy: uuidOrNull(actor.userId),
      })),
    );
    const objective = gradeObjectiveQuiz(questions.map(toBankLike), submission.answers);
    const combined = objective.results
      .filter((r) => r.questionType !== 'essay')
      .reduce((s, r) => s + r.score, 0);
    const total = combined + essayResult.score;
    const updated = await this.repository.updateSubmission(tenantId, submissionId, {
      score: Math.round(total * 100) / 100,
      feedback: input.feedback ?? submission.feedback,
      status: input.returnToStudent ? 'returned' : 'graded',
      gradedAt: now,
      gradedBy: uuidOrNull(actor.userId),
      autoGraded: false,
    });
    if (!updated) throw new NotFoundError('Submission not found');
    return updated;
  }

  async getQuizAnalytics(
    tenantId: string,
    assignmentId: string,
    actor: LmsActor,
  ): Promise<QuizAnalytics> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can view analytics');
    const assignment = await this.requireAssignment(tenantId, assignmentId, actor);
    const questions = await this.repository.listQuestions(tenantId, assignmentId);
    const submissions = await this.repository.listSubmissions(
      tenantId,
      { assignmentId },
      { page: 1, pageSize: 500 },
    );
    const scores = submissions.data.map((s) => s.score).filter((s): s is number => s != null);
    const items = questions.map((q) => {
      let correctCount = 0;
      let attemptCount = 0;
      for (const sub of submissions.data) {
        const answer = sub.answers.find((a) => a.questionId === q.id);
        if (!answer && q.questionType !== 'essay') continue;
        attemptCount += 1;
        if (q.questionType === 'essay') {
          const full = (sub.score ?? 0) >= assignment.maxScore * 0.6;
          if (full) correctCount += 1;
        } else {
          const graded = gradeObjectiveQuiz([toBankLike(q)], sub.answers);
          if (graded.results[0]?.correct) correctCount += 1;
        }
      }
      return {
        questionId: q.id,
        prompt: q.prompt,
        questionType: q.questionType ?? 'mcq',
        difficulty: itemDifficulty(correctCount, attemptCount),
        correctCount,
        attemptCount,
      };
    });
    const students = submissions.data.map((s) => {
      const answered = s.answers.length;
      const total = questions.length;
      return {
        studentId: s.studentId,
        score: s.score,
        answered,
        total,
        completion: total === 0 ? 0 : Math.round((answered / total) * 100) / 100,
      };
    });
    return {
      assignmentId,
      submissionCount: submissions.data.length,
      mean: mean(scores),
      median: median(scores),
      items,
      students,
    };
  }

  async uploadAssignmentFile(
    tenantId: string,
    assignmentId: string,
    input: UploadFileInput,
    actor: LmsActor,
  ): Promise<AssignmentFileEntity> {
    await this.requireAssignment(tenantId, assignmentId, actor);
    if (input.submissionId) {
      const sub = await this.repository.findSubmissionById(tenantId, input.submissionId);
      if (!sub) throw new NotFoundError('Submission not found');
      if (isLearner(actor) && sub.studentId !== actor.userId) {
        throw new ForbiddenError('Students can only upload to their own submission');
      }
    } else if (!canAuthor(actor)) {
      throw new ForbiddenError('Only staff can attach files to an assignment');
    }
    let bytes: Buffer;
    try {
      bytes = decodeBase64Payload(input.contentBase64);
    } catch {
      throw new ValidationError('Invalid base64 payload', [
        { field: 'contentBase64', rule: 'base64', message: 'contentBase64 must be valid base64' },
      ]);
    }
    try {
      assertAllowedUpload(input.mimeType, bytes.length);
    } catch (error) {
      throw new ValidationError((error as Error).message, [
        { field: 'mimeType', rule: 'allow-list', message: (error as Error).message },
      ]);
    }
    const id = randomUUID();
    const stored = await putLmsFile(tenantId, id, input.filename, bytes);
    return this.repository.createAssignmentFile({
      id,
      tenantId,
      assignmentId,
      submissionId: input.submissionId ?? null,
      filename: input.filename,
      mimeType: input.mimeType,
      byteSize: stored.byteSize,
      storageKey: stored.storageKey,
      createdBy: uuidOrNull(actor.userId),
    });
  }

  async listAssignmentFiles(
    tenantId: string,
    assignmentId: string,
    actor: LmsActor,
    submissionId?: string,
  ) {
    await this.requireAssignment(tenantId, assignmentId, actor);
    return this.repository.listAssignmentFiles(tenantId, assignmentId, submissionId);
  }

  async signedFileDownload(tenantId: string, fileId: string, actor: LmsActor) {
    const file = await this.repository.findAssignmentFile(tenantId, fileId);
    if (!file) throw new NotFoundError('File not found');
    await this.requireAssignment(tenantId, file.assignmentId, actor);
    const token = createLmsFileDownloadToken(tenantId, file.id);
    return { ...file, ...token, url: `/lms/files/${file.id}/download?token=${token.token}` };
  }

  async downloadFile(tenantId: string, fileId: string, token: string, actor: LmsActor) {
    const file = await this.repository.findAssignmentFile(tenantId, fileId);
    if (!file) throw new NotFoundError('File not found');
    await this.requireAssignment(tenantId, file.assignmentId, actor);
    const verified = verifyLmsFileDownloadToken(tenantId, fileId, token);
    if (!verified.ok) throw new ForbiddenError(verified.reason);
    return file;
  }

  async createDiscussion(
    tenantId: string,
    input: CreateDiscussionInput,
    actor: LmsActor,
  ): Promise<DiscussionEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can open discussions');
    assertInstitutionAllowed(actor, input.institutionId);
    return this.repository.createDiscussion({
      id: randomUUID(),
      tenantId,
      institutionId: input.institutionId ?? null,
      classKey: input.classKey.trim(),
      title: input.title.trim(),
      locked: false,
      createdBy: uuidOrNull(actor.userId),
    });
  }

  async listDiscussions(
    tenantId: string,
    filter: { institutionId?: string; classKey?: string },
    pagination: { page: number; pageSize: number },
    actor: LmsActor,
  ) {
    assertInstitutionAllowed(actor, filter.institutionId);
    return this.repository.listDiscussions(tenantId, filter, pagination);
  }

  async getDiscussion(tenantId: string, id: string, actor: LmsActor) {
    const discussion = await this.repository.findDiscussion(tenantId, id);
    if (!discussion) throw new NotFoundError('Discussion not found');
    assertInstitutionAllowed(actor, discussion.institutionId);
    const posts = await this.repository.listDiscussionPosts(tenantId, id);
    return {
      ...discussion,
      posts: isLearner(actor) ? posts.filter((p) => !p.hidden) : posts,
    };
  }

  async lockDiscussion(tenantId: string, id: string, locked: boolean, actor: LmsActor) {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can lock discussions');
    await this.getDiscussion(tenantId, id, actor);
    const updated = await this.repository.setDiscussionLocked(tenantId, id, locked);
    if (!updated) throw new NotFoundError('Discussion not found');
    return updated;
  }

  async createPost(
    tenantId: string,
    discussionId: string,
    input: CreatePostInput,
    actor: LmsActor,
  ): Promise<DiscussionPostEntity> {
    const discussion = await this.repository.findDiscussion(tenantId, discussionId);
    if (!discussion) throw new NotFoundError('Discussion not found');
    assertInstitutionAllowed(actor, discussion.institutionId);
    if (discussion.locked && !canAuthor(actor)) {
      throw new ForbiddenError('This discussion is locked');
    }
    if (input.parentId) {
      const parent = await this.repository.findDiscussionPost(tenantId, input.parentId);
      if (!parent || parent.discussionId !== discussionId) {
        throw new ValidationError('Unknown parent post', [
          { field: 'parentId', rule: 'exists', message: 'parentId must belong to this thread' },
        ]);
      }
    }
    return this.repository.createDiscussionPost({
      id: randomUUID(),
      tenantId,
      discussionId,
      parentId: input.parentId ?? null,
      body: input.body.trim(),
      pinned: false,
      hidden: false,
      createdBy: uuidOrNull(actor.userId),
    });
  }

  async pinPost(
    tenantId: string,
    discussionId: string,
    postId: string,
    pinned: boolean,
    actor: LmsActor,
  ) {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can pin posts');
    await this.getDiscussion(tenantId, discussionId, actor);
    const post = await this.repository.findDiscussionPost(tenantId, postId);
    if (!post || post.discussionId !== discussionId) throw new NotFoundError('Post not found');
    const updated = await this.repository.setPostPinned(tenantId, postId, pinned);
    if (!updated) throw new NotFoundError('Post not found');
    return updated;
  }

  async hidePost(
    tenantId: string,
    discussionId: string,
    postId: string,
    hidden: boolean,
    actor: LmsActor,
  ) {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can hide posts');
    await this.getDiscussion(tenantId, discussionId, actor);
    const post = await this.repository.findDiscussionPost(tenantId, postId);
    if (!post || post.discussionId !== discussionId) throw new NotFoundError('Post not found');
    const updated = await this.repository.setPostHidden(tenantId, postId, hidden);
    if (!updated) throw new NotFoundError('Post not found');
    return updated;
  }

  async createContentItem(
    tenantId: string,
    input: CreateContentItemInput,
    actor: LmsActor,
  ): Promise<ContentItemEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can author content');
    assertScopeTarget(input.scope, input.boardId, input.institutionId);
    assertInstitutionAllowed(actor, input.institutionId);
    let objectKey: string | null = null;
    let mimeType: string | null = input.mimeType ?? null;
    if (input.kind === 'file') {
      if (!input.contentBase64 || !input.mimeType) {
        throw new ValidationError('File content needs contentBase64 and mimeType', [
          { field: 'contentBase64', rule: 'required', message: 'Upload a file' },
        ]);
      }
      const bytes = decodeBase64Payload(input.contentBase64);
      try {
        assertAllowedUpload(input.mimeType, bytes.length);
      } catch (error) {
        throw new ValidationError((error as Error).message, [
          { field: 'mimeType', rule: 'allow-list', message: (error as Error).message },
        ]);
      }
      const stored = await putLmsFile(tenantId, randomUUID(), input.title, bytes);
      objectKey = stored.storageKey;
      mimeType = input.mimeType;
    }
    return this.repository.createContentItem({
      id: randomUUID(),
      tenantId,
      scope: input.scope,
      boardId: input.scope === 'board' ? input.boardId! : null,
      institutionId: input.scope === 'school' ? input.institutionId! : null,
      title: input.title.trim(),
      kind: input.kind,
      body: input.body ?? null,
      tags: (input.tags ?? []).map((t) => t.trim()).filter(Boolean),
      classKey: input.classKey ?? null,
      subject: input.subject ?? null,
      objectKey,
      mimeType,
      published: input.published === true,
      createdBy: uuidOrNull(actor.userId),
    });
  }

  async listContentItems(
    tenantId: string,
    filter: {
      institutionId?: string;
      boardId?: string;
      subject?: string;
      classKey?: string;
      published?: boolean;
      scope?: 'board' | 'school';
    },
    pagination: { page: number; pageSize: number },
    actor: LmsActor,
  ) {
    assertInstitutionAllowed(actor, filter.institutionId);
    const effective = { ...filter };
    if (isLearner(actor)) effective.published = true;
    return this.repository.listContentItems(tenantId, effective, pagination);
  }

  async getContentItem(tenantId: string, id: string, actor: LmsActor) {
    const item = await this.repository.findContentItem(tenantId, id);
    if (!item) throw new NotFoundError('Content not found');
    if (isLearner(actor) && !item.published) throw new NotFoundError('Content not found');
    return item;
  }

  async getClassAnalytics(
    tenantId: string,
    query: { classKey: string; institutionId?: string; boardId?: string },
    actor: LmsActor,
  ) {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can view class analytics');
    assertInstitutionAllowed(actor, query.institutionId);
    const listed = await this.repository.listAssignments(
      tenantId,
      {
        institutionId: query.institutionId,
        boardId: query.boardId,
      },
      { page: 1, pageSize: 200 },
    );
    const assignments = listed.data.filter(
      (a) => a.gradeLevel === query.classKey || a.sectionId === query.classKey,
    );
    let submissionCount = 0;
    const students = new Set<string>();
    const scores: number[] = [];
    const skillHits = new Map<string, { label: string; correct: number; attempts: number }>();
    for (const assignment of assignments) {
      const submissions = await this.repository.listSubmissions(
        tenantId,
        { assignmentId: assignment.id },
        { page: 1, pageSize: 500 },
      );
      submissionCount += submissions.data.length;
      const questions = await this.repository.listQuestions(tenantId, assignment.id);
      for (const sub of submissions.data) {
        students.add(sub.studentId);
        if (sub.score != null) scores.push(sub.score);
        const graded = gradeObjectiveQuiz(questions.map(toBankLike), sub.answers);
        for (const r of graded.results) {
          if (r.questionType === 'essay') continue;
          const key = r.skillId ?? 'untagged';
          const current = skillHits.get(key) ?? {
            label: r.skillId ?? 'untagged',
            correct: 0,
            attempts: 0,
          };
          current.attempts += 1;
          if (r.correct) current.correct += 1;
          skillHits.set(key, current);
        }
        for (const q of questions) {
          const rawTags = q.payload?.tags;
          const tags = Array.isArray(rawTags)
            ? rawTags.filter((item): item is string => typeof item === 'string')
            : [];
          for (const tag of tags) {
            const key = `tag:${tag}`;
            const current = skillHits.get(key) ?? { label: tag, correct: 0, attempts: 0 };
            const hit = graded.results.find((r) => r.questionId === q.id);
            current.attempts += 1;
            if (hit?.correct) current.correct += 1;
            skillHits.set(key, current);
          }
        }
      }
    }
    return {
      classKey: query.classKey,
      assignmentCount: assignments.length,
      submissionCount,
      uniqueStudents: students.size,
      rosterSize: students.size,
      submissionRate:
        assignments.length === 0 || students.size === 0
          ? 0
          : Math.round((submissionCount / (assignments.length * students.size)) * 10000) / 10000,
      missingStudentIds: [] as string[],
      averageScore: mean(scores) ?? 0,
      masteryBySkill: Array.from(skillHits.entries()).map(([id, row]) => ({
        skillId: id,
        label: row.label,
        attempts: row.attempts,
        averageMastery: itemDifficulty(row.correct, row.attempts) ?? 0,
      })),
    };
  }

  async createLesson(
    tenantId: string,
    input: CreateLessonInput,
    actor: LmsActor,
  ): Promise<LessonEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can author lessons');
    assertScopeTarget(input.scope, input.boardId, input.institutionId);
    assertInstitutionAllowed(actor, input.institutionId);
    return this.repository.createLesson({
      id: randomUUID(),
      tenantId,
      scope: input.scope,
      boardId: input.scope === 'board' ? input.boardId! : null,
      institutionId: input.scope === 'school' ? input.institutionId! : null,
      title: input.title.trim(),
      subject: input.subject ?? null,
      gradeLevel: input.gradeLevel ?? null,
      description: input.description ?? null,
      published: input.published === true,
      createdBy: uuidOrNull(actor.userId),
    });
  }

  async listLessons(
    tenantId: string,
    filter: { institutionId?: string; boardId?: string; subject?: string; published?: boolean },
    pagination: { page: number; pageSize: number },
    actor: LmsActor,
  ) {
    assertInstitutionAllowed(actor, filter.institutionId);
    const effective = { ...filter };
    if (isLearner(actor)) effective.published = true;
    return this.repository.listLessons(tenantId, effective, pagination);
  }

  async getLesson(tenantId: string, id: string, actor: LmsActor) {
    const lesson = await this.repository.findLesson(tenantId, id);
    if (!lesson) throw new NotFoundError('Lesson not found');
    if (isLearner(actor) && !lesson.published) throw new NotFoundError('Lesson not found');
    const resources = await this.repository.listLessonResources(tenantId, id);
    return { ...lesson, resources };
  }

  async addLessonResource(
    tenantId: string,
    lessonId: string,
    input: CreateLessonResourceInput,
    actor: LmsActor,
  ): Promise<LessonResourceEntity> {
    if (!canAuthor(actor)) throw new ForbiddenError('Only staff can add resources');
    const lesson = await this.repository.findLesson(tenantId, lessonId);
    if (!lesson) throw new NotFoundError('Lesson not found');
    const existing = await this.repository.listLessonResources(tenantId, lessonId);
    let storageKey: string | null = null;
    if (input.kind === 'file') {
      if (!input.contentBase64 || !input.mimeType) {
        throw new ValidationError('File resources need contentBase64 and mimeType', [
          { field: 'contentBase64', rule: 'required', message: 'Upload a file' },
        ]);
      }
      const bytes = decodeBase64Payload(input.contentBase64);
      assertAllowedUpload(input.mimeType, bytes.length);
      const stored = await putLmsFile(tenantId, randomUUID(), input.title, bytes);
      storageKey = stored.storageKey;
    }
    return this.repository.createLessonResource({
      id: randomUUID(),
      tenantId,
      lessonId,
      kind: input.kind,
      title: input.title.trim(),
      url: input.url ?? null,
      storageKey,
      mimeType: input.mimeType ?? null,
      position: existing.length,
    });
  }
  /** World-class rollover — clone published assignments as drafts (no submissions). */
  async cloneAssignmentsForPeriod(
    tenantId: string,
    actorId: string,
    sourcePeriodId: string,
    targetPeriodId: string,
    options: { dryRun?: boolean } = {},
  ): Promise<{ cloned: number; source: number }> {
    const listed = await this.repository.listAssignments(
      tenantId,
      { academicPeriodId: sourcePeriodId },
      { page: 1, pageSize: 500 },
    );
    const source = listed.data.filter(
      (a) => a.status === 'published' || a.status === 'closed' || a.status === 'draft',
    );
    if (options.dryRun) {
      // Count how many would be newly created (skip if same code already in target).
      const targetListed = await this.repository.listAssignments(
        tenantId,
        { academicPeriodId: targetPeriodId },
        { page: 1, pageSize: 500 },
      );
      const targetTitles = new Set(targetListed.data.map((a) => a.title.toLowerCase()));
      const planned = source.filter((a) => !targetTitles.has(a.title.toLowerCase())).length;
      return { cloned: planned, source: source.length };
    }
    let cloned = 0;
    for (const assignment of source) {
      const { createdAt: _c, updatedAt: _u, ...rest } = assignment;
      await this.repository.createAssignment({
        ...rest,
        id: randomUUID(),
        academicPeriodId: targetPeriodId,
        status: 'draft',
        createdBy: actorId,
        publishedAt: null,
      });
      cloned += 1;
    }
    return { cloned, source: source.length };
  }

  async createModule(
    tenantId: string,
    actorId: string,
    input: {
      title: string;
      classKey?: string;
      institutionId?: string;
      academicPeriodId?: string;
      position?: number;
      published?: boolean;
    },
  ) {
    const id = randomUUID();
    return this.repository.createModule({
      id,
      tenantId,
      title: input.title,
      classKey: input.classKey ?? null,
      institutionId: input.institutionId ?? null,
      academicPeriodId: input.academicPeriodId ?? null,
      position: input.position ?? 0,
      published: input.published ?? false,
      createdBy: actorId,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  async addModuleItem(
    tenantId: string,
    moduleId: string,
    input: {
      itemType: 'assignment' | 'content' | 'discussion' | 'url';
      itemId?: string;
      title: string;
      position?: number;
      required?: boolean;
    },
  ) {
    const module = await this.repository.findModule(tenantId, moduleId);
    if (!module) throw new NotFoundError('Module not found');
    const id = randomUUID();
    return this.repository.createModuleItem({
      id,
      tenantId,
      moduleId,
      itemType: input.itemType,
      itemId: input.itemId ?? null,
      title: input.title,
      position: input.position ?? 0,
      required: input.required ?? false,
      createdAt: new Date(),
    });
  }

  async listModules(
    tenantId: string,
    filter: { classKey?: string; academicPeriodId?: string; institutionId?: string },
  ) {
    return this.repository.listModules(tenantId, filter);
  }

  async listModuleItems(tenantId: string, moduleId: string) {
    return this.repository.listModuleItems(tenantId, moduleId);
  }
}
