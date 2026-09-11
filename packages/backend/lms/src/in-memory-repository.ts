/**
 * In-memory LMS repository — dev/test fallback when DATABASE_URL is unset.
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';

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
  MasteryFilter,
  PracticeAttemptEntity,
  QuizQuestionEntity,
  RubricCriterionEntity,
  RubricEntity,
  RubricScoreEntity,
  ScopeFilter,
  ScopeTarget,
  SkillEntity,
  SkillFilter,
  SkillMasteryEntity,
  SubmissionEntity,
  SubmissionFilter,
} from './lms-repository.js';

function paginate<T>(items: T[], pagination: PaginationOptions): PaginatedResult<T> {
  const totalItems = items.length;
  const start = (pagination.page - 1) * pagination.pageSize;
  return {
    data: items.slice(start, start + pagination.pageSize),
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalItems,
      totalPages: Math.ceil(totalItems / pagination.pageSize) || 1,
    },
  };
}

/** Shared visibility rule: own-school rows + board-shared rows. */
export function matchesScope(row: ScopeTarget, filter: ScopeFilter): boolean {
  if (filter.scope && row.scope !== filter.scope) return false;
  if (!filter.institutionId && !filter.boardId) return true;
  if (
    filter.institutionId &&
    row.scope === 'school' &&
    row.institutionId === filter.institutionId
  ) {
    return true;
  }
  if (filter.boardId && row.scope === 'board' && row.boardId === filter.boardId) return true;
  return false;
}

export class InMemoryLmsRepository implements LmsRepository {
  private skills = new Map<string, SkillEntity>();
  private assignments = new Map<string, AssignmentEntity>();
  private questions = new Map<string, QuizQuestionEntity[]>();
  private submissions = new Map<string, SubmissionEntity>();
  private mastery = new Map<string, SkillMasteryEntity>();
  private attempts: PracticeAttemptEntity[] = [];
  private bank = new Map<string, BankQuestionEntity>();
  private rubrics = new Map<string, RubricEntity>();
  private rubricCriteria = new Map<string, RubricCriterionEntity[]>();
  private rubricScores = new Map<string, RubricScoreEntity[]>();
  private files = new Map<string, AssignmentFileEntity>();
  private discussions = new Map<string, DiscussionEntity>();
  private posts = new Map<string, DiscussionPostEntity[]>();
  private lessons = new Map<string, LessonEntity>();
  private lessonResources = new Map<string, LessonResourceEntity[]>();
  private content = new Map<string, ContentItemEntity>();
  private modules = new Map<string, import('./lms-repository.js').LmsModuleEntity>();
  private moduleItems = new Map<string, import('./lms-repository.js').LmsModuleItemEntity>();

  clear(): void {
    this.skills.clear();
    this.assignments.clear();
    this.questions.clear();
    this.submissions.clear();
    this.mastery.clear();
    this.attempts = [];
    this.bank.clear();
    this.rubrics.clear();
    this.rubricCriteria.clear();
    this.rubricScores.clear();
    this.files.clear();
    this.discussions.clear();
    this.posts.clear();
    this.lessons.clear();
    this.lessonResources.clear();
    this.content.clear();
    this.modules.clear();
    this.moduleItems.clear();
  }

  // ─── Skills ────────────────────────────────────────────────────────────

  async createSkill(data: Omit<SkillEntity, 'createdAt' | 'updatedAt'>): Promise<SkillEntity> {
    for (const existing of this.skills.values()) {
      if (existing.tenantId === data.tenantId && existing.code === data.code) {
        throw new Error(`duplicate skill code ${data.code}`);
      }
    }
    const now = new Date();
    const entity: SkillEntity = { ...data, createdAt: now, updatedAt: now };
    this.skills.set(entity.id, entity);
    return entity;
  }

  async findSkillById(tenantId: string, id: string): Promise<SkillEntity | null> {
    const skill = this.skills.get(id);
    return skill && skill.tenantId === tenantId ? skill : null;
  }

  async findSkillsByIds(tenantId: string, ids: string[]): Promise<SkillEntity[]> {
    const wanted = new Set(ids);
    return Array.from(this.skills.values()).filter(
      (s) => s.tenantId === tenantId && wanted.has(s.id),
    );
  }

  async listSkills(
    tenantId: string,
    filter: SkillFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SkillEntity>> {
    const search = filter.search?.toLowerCase();
    const items = Array.from(this.skills.values())
      .filter((s) => s.tenantId === tenantId && matchesScope(s, filter))
      .filter((s) => !filter.subject || s.subject === filter.subject)
      .filter((s) => !filter.gradeLevel || s.gradeLevel === filter.gradeLevel)
      .filter(
        (s) =>
          !search || s.name.toLowerCase().includes(search) || s.code.toLowerCase().includes(search),
      )
      .sort((a, b) => a.code.localeCompare(b.code));
    return paginate(items, pagination);
  }

  // ─── Assignments ───────────────────────────────────────────────────────

  async createAssignment(
    data: Omit<AssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AssignmentEntity> {
    const now = new Date();
    const entity: AssignmentEntity = { ...data, createdAt: now, updatedAt: now };
    this.assignments.set(entity.id, entity);
    return entity;
  }

  async updateAssignment(
    tenantId: string,
    id: string,
    patch: Parameters<LmsRepository['updateAssignment']>[2],
  ): Promise<AssignmentEntity | null> {
    const existing = await this.findAssignmentById(tenantId, id);
    if (!existing) return null;
    const updated: AssignmentEntity = { ...existing, ...patch, updatedAt: new Date() };
    this.assignments.set(id, updated);
    return updated;
  }

  async findAssignmentById(tenantId: string, id: string): Promise<AssignmentEntity | null> {
    const a = this.assignments.get(id);
    return a && a.tenantId === tenantId ? a : null;
  }

  async listAssignments(
    tenantId: string,
    filter: AssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AssignmentEntity>> {
    const search = filter.search?.toLowerCase();
    const items = Array.from(this.assignments.values())
      .filter((a) => a.tenantId === tenantId && matchesScope(a, filter))
      .filter((a) => !filter.kind || a.kind === filter.kind)
      .filter((a) => !filter.status || a.status === filter.status)
      .filter((a) => !filter.subject || a.subject === filter.subject)
      .filter((a) => !filter.gradeLevel || a.gradeLevel === filter.gradeLevel)
      .filter((a) => !filter.sectionId || a.sectionId === filter.sectionId)
      .filter((a) => !filter.academicPeriodId || a.academicPeriodId === filter.academicPeriodId)
      .filter((a) => !search || a.title.toLowerCase().includes(search))
      .filter(
        (a) =>
          !filter.dueBefore || (a.dueAt != null && a.dueAt.getTime() <= filter.dueBefore.getTime()),
      )
      .filter(
        (a) =>
          !filter.dueAfter || (a.dueAt != null && a.dueAt.getTime() >= filter.dueAfter.getTime()),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(items, pagination);
  }

  async deleteAssignment(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.findAssignmentById(tenantId, id);
    if (!existing) return false;
    this.assignments.delete(id);
    this.questions.delete(id);
    for (const [sid, s] of this.submissions) {
      if (s.assignmentId === id) this.submissions.delete(sid);
    }
    return true;
  }

  // ─── Quiz questions ────────────────────────────────────────────────────

  async replaceQuestions(
    tenantId: string,
    assignmentId: string,
    questions: Omit<QuizQuestionEntity, 'createdAt'>[],
  ): Promise<QuizQuestionEntity[]> {
    const now = new Date();
    const rows = questions
      .filter((q) => q.tenantId === tenantId && q.assignmentId === assignmentId)
      .map((q) => ({
        ...q,
        questionType: q.questionType ?? 'mcq',
        bankId: q.bankId ?? null,
        payload: q.payload ?? {},
        createdAt: now,
      }))
      .sort((a, b) => a.position - b.position);
    this.questions.set(assignmentId, rows);
    return rows;
  }

  async listQuestions(tenantId: string, assignmentId: string): Promise<QuizQuestionEntity[]> {
    return (this.questions.get(assignmentId) ?? []).filter((q) => q.tenantId === tenantId);
  }

  // ─── Submissions ───────────────────────────────────────────────────────

  async createSubmission(
    data: Omit<SubmissionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SubmissionEntity> {
    const dup = await this.findSubmission(data.tenantId, data.assignmentId, data.studentId);
    if (dup) throw new Error('duplicate submission');
    const now = new Date();
    const entity: SubmissionEntity = { ...data, createdAt: now, updatedAt: now };
    this.submissions.set(entity.id, entity);
    return entity;
  }

  async updateSubmission(
    tenantId: string,
    id: string,
    patch: Parameters<LmsRepository['updateSubmission']>[2],
  ): Promise<SubmissionEntity | null> {
    const existing = await this.findSubmissionById(tenantId, id);
    if (!existing) return null;
    const updated: SubmissionEntity = { ...existing, ...patch, updatedAt: new Date() };
    this.submissions.set(id, updated);
    return updated;
  }

  async findSubmissionById(tenantId: string, id: string): Promise<SubmissionEntity | null> {
    const s = this.submissions.get(id);
    return s && s.tenantId === tenantId ? s : null;
  }

  async findSubmission(
    tenantId: string,
    assignmentId: string,
    studentId: string,
  ): Promise<SubmissionEntity | null> {
    for (const s of this.submissions.values()) {
      if (s.tenantId === tenantId && s.assignmentId === assignmentId && s.studentId === studentId) {
        return s;
      }
    }
    return null;
  }

  async listSubmissions(
    tenantId: string,
    filter: SubmissionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SubmissionEntity>> {
    const items = Array.from(this.submissions.values())
      .filter((s) => s.tenantId === tenantId)
      .filter((s) => !filter.assignmentId || s.assignmentId === filter.assignmentId)
      .filter((s) => !filter.studentId || s.studentId === filter.studentId)
      .filter((s) => !filter.status || s.status === filter.status)
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime());
    return paginate(items, pagination);
  }

  // ─── Spiral PAL ledger ─────────────────────────────────────────────────

  private masteryKey(tenantId: string, studentId: string, skillId: string): string {
    return `${tenantId}:${studentId}:${skillId}`;
  }

  async upsertMastery(
    data: Omit<SkillMasteryEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SkillMasteryEntity> {
    const key = this.masteryKey(data.tenantId, data.studentId, data.skillId);
    const existing = this.mastery.get(key);
    const now = new Date();
    const entity: SkillMasteryEntity = {
      ...data,
      id: existing?.id ?? data.id,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.mastery.set(key, entity);
    return entity;
  }

  async findMastery(
    tenantId: string,
    studentId: string,
    skillId: string,
  ): Promise<SkillMasteryEntity | null> {
    return this.mastery.get(this.masteryKey(tenantId, studentId, skillId)) ?? null;
  }

  async listMastery(tenantId: string, filter: MasteryFilter): Promise<SkillMasteryEntity[]> {
    const wanted = filter.skillIds ? new Set(filter.skillIds) : null;
    return Array.from(this.mastery.values())
      .filter((m) => m.tenantId === tenantId && m.studentId === filter.studentId)
      .filter((m) => !wanted || wanted.has(m.skillId))
      .filter(
        (m) =>
          !filter.dueBefore || (m.dueAt != null && m.dueAt.getTime() <= filter.dueBefore.getTime()),
      );
  }

  async recordAttempt(
    data: Omit<PracticeAttemptEntity, 'createdAt'>,
  ): Promise<PracticeAttemptEntity> {
    const entity: PracticeAttemptEntity = { ...data, createdAt: new Date() };
    this.attempts.push(entity);
    return entity;
  }

  async listAttempts(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PracticeAttemptEntity>> {
    const items = this.attempts
      .filter((a) => a.tenantId === tenantId && a.studentId === studentId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(items, pagination);
  }

  async createBankQuestion(
    data: Omit<BankQuestionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<BankQuestionEntity> {
    const now = new Date();
    const entity: BankQuestionEntity = { ...data, createdAt: now, updatedAt: now };
    this.bank.set(entity.id, entity);
    return entity;
  }

  async updateBankQuestion(
    tenantId: string,
    id: string,
    patch: Parameters<LmsRepository['updateBankQuestion']>[2],
  ): Promise<BankQuestionEntity | null> {
    const existing = await this.findBankQuestion(tenantId, id);
    if (!existing) return null;
    const updated: BankQuestionEntity = { ...existing, ...patch, updatedAt: new Date() };
    this.bank.set(id, updated);
    return updated;
  }

  async findBankQuestion(tenantId: string, id: string): Promise<BankQuestionEntity | null> {
    const row = this.bank.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async findBankQuestionsByIds(tenantId: string, ids: string[]): Promise<BankQuestionEntity[]> {
    const wanted = new Set(ids);
    return Array.from(this.bank.values()).filter(
      (q) => q.tenantId === tenantId && wanted.has(q.id),
    );
  }

  async listBankQuestions(
    tenantId: string,
    filter: BankQuestionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<BankQuestionEntity>> {
    const search = filter.search?.toLowerCase();
    const tags = filter.tags ?? [];
    const items = Array.from(this.bank.values())
      .filter((q) => q.tenantId === tenantId && matchesScope(q, filter))
      .filter((q) => !filter.subject || q.subject === filter.subject)
      .filter((q) => !filter.gradeLevel || q.gradeLevel === filter.gradeLevel)
      .filter((q) => !filter.questionType || q.questionType === filter.questionType)
      .filter((q) => tags.length === 0 || tags.some((t) => q.tags.includes(t)))
      .filter(
        (q) =>
          !search ||
          q.prompt.toLowerCase().includes(search) ||
          q.tags.some((t) => t.toLowerCase().includes(search)),
      )
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(items, pagination);
  }

  async deleteBankQuestion(tenantId: string, id: string): Promise<boolean> {
    const existing = await this.findBankQuestion(tenantId, id);
    if (!existing) return false;
    this.bank.delete(id);
    return true;
  }

  async createRubric(data: Omit<RubricEntity, 'createdAt' | 'updatedAt'>): Promise<RubricEntity> {
    const now = new Date();
    const entity: RubricEntity = { ...data, createdAt: now, updatedAt: now };
    this.rubrics.set(entity.id, entity);
    return entity;
  }

  async findRubric(tenantId: string, id: string): Promise<RubricEntity | null> {
    const row = this.rubrics.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async listRubrics(
    tenantId: string,
    filter: ScopeFilter & { subject?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<RubricEntity>> {
    const items = Array.from(this.rubrics.values())
      .filter((r) => r.tenantId === tenantId && matchesScope(r, filter))
      .filter((r) => !filter.subject || r.subject === filter.subject)
      .sort((a, b) => a.name.localeCompare(b.name));
    return paginate(items, pagination);
  }

  async replaceRubricCriteria(
    tenantId: string,
    rubricId: string,
    criteria: Omit<RubricCriterionEntity, 'createdAt'>[],
  ): Promise<RubricCriterionEntity[]> {
    const rows = criteria
      .filter((c) => c.tenantId === tenantId && c.rubricId === rubricId)
      .sort((a, b) => a.position - b.position);
    this.rubricCriteria.set(rubricId, rows);
    return rows;
  }

  async listRubricCriteria(tenantId: string, rubricId: string): Promise<RubricCriterionEntity[]> {
    return (this.rubricCriteria.get(rubricId) ?? []).filter((c) => c.tenantId === tenantId);
  }

  async replaceRubricScores(
    tenantId: string,
    submissionId: string,
    scores: Omit<RubricScoreEntity, 'scoredAt'>[],
  ): Promise<RubricScoreEntity[]> {
    const now = new Date();
    const rows = scores
      .filter((s) => s.tenantId === tenantId && s.submissionId === submissionId)
      .map((s) => ({ ...s, scoredAt: now }));
    this.rubricScores.set(`${tenantId}:${submissionId}`, rows);
    return rows;
  }

  async listRubricScores(tenantId: string, submissionId: string): Promise<RubricScoreEntity[]> {
    return (this.rubricScores.get(`${tenantId}:${submissionId}`) ?? []).filter(
      (s) => s.tenantId === tenantId,
    );
  }

  async createAssignmentFile(
    data: Omit<AssignmentFileEntity, 'createdAt'>,
  ): Promise<AssignmentFileEntity> {
    const entity: AssignmentFileEntity = { ...data, createdAt: new Date() };
    this.files.set(entity.id, entity);
    return entity;
  }

  async findAssignmentFile(tenantId: string, id: string): Promise<AssignmentFileEntity | null> {
    const row = this.files.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async listAssignmentFiles(
    tenantId: string,
    assignmentId: string,
    submissionId?: string | null,
  ): Promise<AssignmentFileEntity[]> {
    return Array.from(this.files.values())
      .filter((f) => f.tenantId === tenantId && f.assignmentId === assignmentId)
      .filter((f) =>
        submissionId === undefined
          ? true
          : submissionId === null
            ? f.submissionId === null
            : f.submissionId === submissionId,
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createDiscussion(
    data: Omit<DiscussionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DiscussionEntity> {
    const now = new Date();
    const entity: DiscussionEntity = { ...data, createdAt: now, updatedAt: now };
    this.discussions.set(entity.id, entity);
    return entity;
  }

  async findDiscussion(tenantId: string, id: string): Promise<DiscussionEntity | null> {
    const row = this.discussions.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async listDiscussions(
    tenantId: string,
    filter: { institutionId?: string; classKey?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiscussionEntity>> {
    const items = Array.from(this.discussions.values())
      .filter((d) => d.tenantId === tenantId)
      .filter((d) => !filter.institutionId || d.institutionId === filter.institutionId)
      .filter((d) => !filter.classKey || d.classKey === filter.classKey)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(items, pagination);
  }

  async setDiscussionLocked(
    tenantId: string,
    id: string,
    locked: boolean,
  ): Promise<DiscussionEntity | null> {
    const existing = await this.findDiscussion(tenantId, id);
    if (!existing) return null;
    const updated: DiscussionEntity = { ...existing, locked, updatedAt: new Date() };
    this.discussions.set(id, updated);
    return updated;
  }

  async createDiscussionPost(
    data: Omit<DiscussionPostEntity, 'createdAt'>,
  ): Promise<DiscussionPostEntity> {
    const entity: DiscussionPostEntity = { ...data, createdAt: new Date() };
    const list = this.posts.get(data.discussionId) ?? [];
    list.push(entity);
    this.posts.set(data.discussionId, list);
    return entity;
  }

  async findDiscussionPost(tenantId: string, id: string): Promise<DiscussionPostEntity | null> {
    for (const list of this.posts.values()) {
      const found = list.find((p) => p.id === id && p.tenantId === tenantId);
      if (found) return found;
    }
    return null;
  }

  async listDiscussionPosts(
    tenantId: string,
    discussionId: string,
  ): Promise<DiscussionPostEntity[]> {
    return (this.posts.get(discussionId) ?? [])
      .filter((p) => p.tenantId === tenantId)
      .sort(
        (a, b) =>
          Number(b.pinned) - Number(a.pinned) || a.createdAt.getTime() - b.createdAt.getTime(),
      );
  }

  async setPostPinned(
    tenantId: string,
    postId: string,
    pinned: boolean,
  ): Promise<DiscussionPostEntity | null> {
    const post = await this.findDiscussionPost(tenantId, postId);
    if (!post) return null;
    const updated: DiscussionPostEntity = { ...post, pinned };
    const list = (this.posts.get(post.discussionId) ?? []).map((p) =>
      p.id === postId ? updated : p,
    );
    this.posts.set(post.discussionId, list);
    return updated;
  }

  async setPostHidden(
    tenantId: string,
    postId: string,
    hidden: boolean,
  ): Promise<DiscussionPostEntity | null> {
    const post = await this.findDiscussionPost(tenantId, postId);
    if (!post) return null;
    const updated: DiscussionPostEntity = { ...post, hidden };
    const list = (this.posts.get(post.discussionId) ?? []).map((p) =>
      p.id === postId ? updated : p,
    );
    this.posts.set(post.discussionId, list);
    return updated;
  }

  async createLesson(data: Omit<LessonEntity, 'createdAt' | 'updatedAt'>): Promise<LessonEntity> {
    const now = new Date();
    const entity: LessonEntity = { ...data, createdAt: now, updatedAt: now };
    this.lessons.set(entity.id, entity);
    return entity;
  }

  async findLesson(tenantId: string, id: string): Promise<LessonEntity | null> {
    const row = this.lessons.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async listLessons(
    tenantId: string,
    filter: ScopeFilter & { subject?: string; published?: boolean },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<LessonEntity>> {
    const items = Array.from(this.lessons.values())
      .filter((l) => l.tenantId === tenantId && matchesScope(l, filter))
      .filter((l) => !filter.subject || l.subject === filter.subject)
      .filter((l) => filter.published === undefined || l.published === filter.published)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(items, pagination);
  }

  async createLessonResource(
    data: Omit<LessonResourceEntity, 'createdAt'>,
  ): Promise<LessonResourceEntity> {
    const entity: LessonResourceEntity = { ...data, createdAt: new Date() };
    const list = this.lessonResources.get(data.lessonId) ?? [];
    list.push(entity);
    this.lessonResources.set(data.lessonId, list);
    return entity;
  }

  async listLessonResources(tenantId: string, lessonId: string): Promise<LessonResourceEntity[]> {
    return (this.lessonResources.get(lessonId) ?? [])
      .filter((r) => r.tenantId === tenantId)
      .sort((a, b) => a.position - b.position);
  }

  async createContentItem(
    data: Omit<ContentItemEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ContentItemEntity> {
    const now = new Date();
    const entity: ContentItemEntity = { ...data, createdAt: now, updatedAt: now };
    this.content.set(entity.id, entity);
    return entity;
  }

  async findContentItem(tenantId: string, id: string): Promise<ContentItemEntity | null> {
    const row = this.content.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }

  async listContentItems(
    tenantId: string,
    filter: ScopeFilter & { subject?: string; published?: boolean; classKey?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ContentItemEntity>> {
    const items = Array.from(this.content.values())
      .filter((c) => c.tenantId === tenantId && matchesScope(c, filter))
      .filter((c) => !filter.subject || c.subject === filter.subject)
      .filter((c) => filter.published === undefined || c.published === filter.published)
      .filter((c) => !filter.classKey || c.classKey === filter.classKey)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return paginate(items, pagination);
  }
  async createModule(data: import('./lms-repository.js').LmsModuleEntity) {
    this.modules.set(data.id, data);
    return data;
  }
  async findModule(tenantId: string, id: string) {
    const row = this.modules.get(id);
    return row && row.tenantId === tenantId ? row : null;
  }
  async listModules(
    tenantId: string,
    filter: { classKey?: string; academicPeriodId?: string; institutionId?: string },
  ) {
    return [...this.modules.values()]
      .filter((m) => m.tenantId === tenantId)
      .filter((m) => (filter.classKey ? m.classKey === filter.classKey : true))
      .filter((m) => (filter.academicPeriodId ? m.academicPeriodId === filter.academicPeriodId : true))
      .filter((m) => (filter.institutionId ? m.institutionId === filter.institutionId : true))
      .sort((a, b) => a.position - b.position);
  }
  async createModuleItem(data: import('./lms-repository.js').LmsModuleItemEntity) {
    this.moduleItems.set(data.id, data);
    return data;
  }
  async listModuleItems(tenantId: string, moduleId: string) {
    return [...this.moduleItems.values()]
      .filter((i) => i.tenantId === tenantId && i.moduleId === moduleId)
      .sort((a, b) => a.position - b.position);
  }

}
