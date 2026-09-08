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

import type {
  AssignmentEntity,
  AssignmentFilter,
  LmsRepository,
  PracticeAttemptEntity,
  QuizQuestionEntity,
  SkillEntity,
  SkillFilter,
  SkillMasteryEntity,
  SubmissionEntity,
  SubmissionFilter,
} from './lms-repository.js';
import type {
  CreateAssignmentInput,
  CreateSkillInput,
  CreateSubmissionInput,
  GradeSubmissionInput,
  PlanQuery,
  QuizQuestionInput,
  RecordAttemptInput,
  UpdateAssignmentInput,
} from './schemas.js';
import {
  applyAttempt,
  buildSpiralPlan,
  gradeQuiz,
  INITIAL_MASTERY,
  type SpiralPlan,
} from './spiral-pal.js';

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
    if (q.correctOptionIndex >= q.options.length) {
      throw new ValidationError('correctOptionIndex is out of range', [
        {
          field: `questions[${index}].correctOptionIndex`,
          rule: 'range',
          message: 'correctOptionIndex must reference one of the options',
        },
      ]);
    }
    return {
      id: randomUUID(),
      tenantId,
      assignmentId,
      position: index,
      prompt: q.prompt,
      options: q.options,
      correctOptionIndex: q.correctOptionIndex,
      points: q.points ?? 1,
      skillId: q.skillId ?? null,
      explanation: q.explanation ?? null,
    };
  });
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
    if (input.kind !== 'quiz' && questions.length > 0) {
      throw new ValidationError('Only quizzes may carry questions', [
        { field: 'questions', rule: 'kind', message: 'questions are only valid when kind=quiz' },
      ]);
    }
    const publish = input.publish === true;
    if (publish && input.kind === 'quiz' && questions.length === 0) {
      throw new BusinessRuleError('A quiz needs at least one question before it is published');
    }

    const id = randomUUID();
    const normalised = normaliseQuestions(tenantId, id, questions);
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
      skillIds,
      maxScore,
      dueAt: input.dueAt ? new Date(input.dueAt) : null,
      timeLimitMinutes: input.timeLimitMinutes ?? null,
      allowLate: input.allowLate ?? true,
      status: publish ? 'published' : 'draft',
      createdBy: actor.userId,
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
      questions: isLearner(actor)
        ? questions.map((q) => ({ ...q, correctOptionIndex: -1, explanation: null }))
        : questions,
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
      const graded = gradeQuiz(questions, answers);
      // Scale to the assignment's maxScore so quizzes stay comparable.
      score =
        graded.maxScore > 0
          ? Math.round((graded.score / graded.maxScore) * assignment.maxScore * 100) / 100
          : 0;
      status = 'graded';
      autoGraded = true;
      gradedAt = now;
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
      gradedBy: actor.userId,
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
}
