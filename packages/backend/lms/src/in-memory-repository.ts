/**
 * In-memory LMS repository — dev/test fallback when DATABASE_URL is unset.
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';

import type {
  AssignmentEntity,
  AssignmentFilter,
  LmsRepository,
  MasteryFilter,
  PracticeAttemptEntity,
  QuizQuestionEntity,
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

  clear(): void {
    this.skills.clear();
    this.assignments.clear();
    this.questions.clear();
    this.submissions.clear();
    this.mastery.clear();
    this.attempts = [];
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
      .map((q) => ({ ...q, createdAt: now }))
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
}
