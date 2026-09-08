/**
 * LMS repository contract (Wave 8 / G-801, G-802).
 *
 * Entities are tenant-scoped (RLS) and additionally carry a content `scope`:
 *  - `board`  → shared by every school (institution) under `boardId`
 *  - `school` → owned by a single `institutionId`
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';

export type LmsScope = 'board' | 'school';
export type AssignmentKind = 'assignment' | 'homework' | 'quiz';
export type AssignmentStatus = 'draft' | 'published' | 'closed' | 'archived';
export type SubmissionStatus = 'submitted' | 'late' | 'graded' | 'returned';
export type AttemptSource = 'practice' | 'quiz' | 'homework' | 'assignment';

export interface ScopeTarget {
  scope: LmsScope;
  boardId: string | null;
  institutionId: string | null;
}

export interface SkillEntity extends ScopeTarget {
  id: string;
  tenantId: string;
  code: string;
  name: string;
  subject: string;
  gradeLevel: string | null;
  description: string | null;
  prerequisiteSkillIds: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AssignmentEntity extends ScopeTarget {
  id: string;
  tenantId: string;
  kind: AssignmentKind;
  title: string;
  description: string | null;
  subject: string;
  gradeLevel: string | null;
  sectionId: string | null;
  skillIds: string[];
  maxScore: number;
  dueAt: Date | null;
  timeLimitMinutes: number | null;
  allowLate: boolean;
  status: AssignmentStatus;
  createdBy: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface QuizQuestionEntity {
  id: string;
  tenantId: string;
  assignmentId: string;
  position: number;
  prompt: string;
  options: string[];
  correctOptionIndex: number;
  points: number;
  skillId: string | null;
  explanation: string | null;
  createdAt: Date;
}

export interface SubmissionAnswer {
  questionId: string;
  selectedOptionIndex: number;
}

export interface SubmissionEntity {
  id: string;
  tenantId: string;
  assignmentId: string;
  studentId: string;
  institutionId: string | null;
  status: SubmissionStatus;
  content: string | null;
  attachments: string[];
  answers: SubmissionAnswer[];
  score: number | null;
  autoGraded: boolean;
  feedback: string | null;
  submittedAt: Date;
  gradedAt: Date | null;
  gradedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SkillMasteryEntity {
  id: string;
  tenantId: string;
  studentId: string;
  skillId: string;
  institutionId: string | null;
  mastery: number;
  attempts: number;
  correct: number;
  streak: number;
  intervalDays: number;
  dueAt: Date | null;
  lastReviewedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PracticeAttemptEntity {
  id: string;
  tenantId: string;
  studentId: string;
  skillId: string;
  source: AttemptSource;
  sourceId: string | null;
  correct: boolean;
  responseTimeMs: number | null;
  masteryAfter: number;
  createdAt: Date;
}

/**
 * Visibility filter shared by skills and assignments.
 * When `institutionId` is present the result is rows owned by that school
 * plus board-shared rows for `boardId` (if provided). Without either, the
 * caller sees the whole tenant (board/tenant administrators).
 */
export interface ScopeFilter {
  institutionId?: string;
  boardId?: string;
  scope?: LmsScope;
}

export interface SkillFilter extends ScopeFilter {
  subject?: string;
  gradeLevel?: string;
  search?: string;
}

export interface AssignmentFilter extends ScopeFilter {
  kind?: AssignmentKind;
  status?: AssignmentStatus;
  subject?: string;
  gradeLevel?: string;
  sectionId?: string;
  search?: string;
  dueBefore?: Date;
  dueAfter?: Date;
}

export interface SubmissionFilter {
  assignmentId?: string;
  studentId?: string;
  status?: SubmissionStatus;
}

export interface MasteryFilter {
  studentId: string;
  dueBefore?: Date;
  skillIds?: string[];
}

export interface LmsRepository {
  // Skills
  createSkill(data: Omit<SkillEntity, 'createdAt' | 'updatedAt'>): Promise<SkillEntity>;
  findSkillById(tenantId: string, id: string): Promise<SkillEntity | null>;
  findSkillsByIds(tenantId: string, ids: string[]): Promise<SkillEntity[]>;
  listSkills(
    tenantId: string,
    filter: SkillFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SkillEntity>>;

  // Assignments (assignment / homework / quiz)
  createAssignment(
    data: Omit<AssignmentEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AssignmentEntity>;
  updateAssignment(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        AssignmentEntity,
        | 'title'
        | 'description'
        | 'subject'
        | 'gradeLevel'
        | 'sectionId'
        | 'skillIds'
        | 'maxScore'
        | 'dueAt'
        | 'timeLimitMinutes'
        | 'allowLate'
        | 'status'
        | 'publishedAt'
      >
    >,
  ): Promise<AssignmentEntity | null>;
  findAssignmentById(tenantId: string, id: string): Promise<AssignmentEntity | null>;
  listAssignments(
    tenantId: string,
    filter: AssignmentFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<AssignmentEntity>>;
  deleteAssignment(tenantId: string, id: string): Promise<boolean>;

  // Quiz questions
  replaceQuestions(
    tenantId: string,
    assignmentId: string,
    questions: Omit<QuizQuestionEntity, 'createdAt'>[],
  ): Promise<QuizQuestionEntity[]>;
  listQuestions(tenantId: string, assignmentId: string): Promise<QuizQuestionEntity[]>;

  // Submissions
  createSubmission(
    data: Omit<SubmissionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SubmissionEntity>;
  updateSubmission(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        SubmissionEntity,
        'status' | 'score' | 'feedback' | 'gradedAt' | 'gradedBy' | 'autoGraded'
      >
    >,
  ): Promise<SubmissionEntity | null>;
  findSubmissionById(tenantId: string, id: string): Promise<SubmissionEntity | null>;
  findSubmission(
    tenantId: string,
    assignmentId: string,
    studentId: string,
  ): Promise<SubmissionEntity | null>;
  listSubmissions(
    tenantId: string,
    filter: SubmissionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<SubmissionEntity>>;

  // Spiral PAL ledger
  upsertMastery(
    data: Omit<SkillMasteryEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<SkillMasteryEntity>;
  findMastery(
    tenantId: string,
    studentId: string,
    skillId: string,
  ): Promise<SkillMasteryEntity | null>;
  listMastery(tenantId: string, filter: MasteryFilter): Promise<SkillMasteryEntity[]>;
  recordAttempt(data: Omit<PracticeAttemptEntity, 'createdAt'>): Promise<PracticeAttemptEntity>;
  listAttempts(
    tenantId: string,
    studentId: string,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<PracticeAttemptEntity>>;
}
