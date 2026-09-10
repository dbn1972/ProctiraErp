/**
 * LMS repository contract (Wave 8 / G-801, G-802).
 *
 * Entities are tenant-scoped (RLS) and additionally carry a content `scope`:
 *  - `board`  → shared by every school (institution) under `boardId`
 *  - `school` → owned by a single `institutionId`
 */
import type { PaginatedResult, PaginationOptions } from '@proctira/common';

import type { MatchPair, QuestionType } from './grading-engine.js';

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
  questionType?: QuestionType;
  bankId?: string | null;
  payload?: Record<string, unknown>;
}

export interface SubmissionAnswer {
  questionId: string;
  selectedOptionIndex?: number;
  selectedOptionIndexes?: number[];
  numericValue?: number;
  matches?: MatchPair[];
  essayText?: string;
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

export interface RubricLevel {
  label: string;
  points: number;
  description?: string;
}

export interface BankQuestionEntity extends ScopeTarget {
  id: string;
  tenantId: string;
  subject: string;
  gradeLevel: string | null;
  tags: string[];
  questionType: QuestionType;
  prompt: string;
  payload: Record<string, unknown>;
  points: number;
  skillId: string | null;
  rubricId: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface BankQuestionFilter extends ScopeFilter {
  subject?: string;
  gradeLevel?: string;
  questionType?: QuestionType;
  tags?: string[];
  search?: string;
}

export interface RubricEntity extends ScopeTarget {
  id: string;
  tenantId: string;
  name: string;
  subject: string | null;
  gradeLevel: string | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RubricCriterionEntity {
  id: string;
  tenantId: string;
  rubricId: string;
  position: number;
  name: string;
  description: string | null;
  maxPoints: number;
  levels: RubricLevel[];
}

export interface RubricScoreEntity {
  id: string;
  tenantId: string;
  submissionId: string;
  criterionId: string;
  questionId: string | null;
  levelIndex: number;
  points: number;
  comment: string | null;
  scoredBy: string | null;
  scoredAt: Date;
}

export interface AssignmentFileEntity {
  id: string;
  tenantId: string;
  assignmentId: string;
  submissionId: string | null;
  filename: string;
  mimeType: string;
  byteSize: number;
  storageKey: string;
  createdBy: string | null;
  createdAt: Date;
}

export interface DiscussionEntity {
  id: string;
  tenantId: string;
  institutionId: string | null;
  classKey: string;
  title: string;
  locked: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface DiscussionPostEntity {
  id: string;
  tenantId: string;
  discussionId: string;
  parentId: string | null;
  body: string;
  pinned: boolean;
  hidden: boolean;
  createdBy: string | null;
  createdAt: Date;
}

export interface LessonEntity extends ScopeTarget {
  id: string;
  tenantId: string;
  title: string;
  subject: string | null;
  gradeLevel: string | null;
  description: string | null;
  published: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface LessonResourceEntity {
  id: string;
  tenantId: string;
  lessonId: string;
  kind: 'link' | 'file' | 'video';
  title: string;
  url: string | null;
  storageKey: string | null;
  mimeType: string | null;
  position: number;
  createdAt: Date;
}

export type ContentKind = 'link' | 'file' | 'text';

export interface ContentItemEntity extends ScopeTarget {
  id: string;
  tenantId: string;
  title: string;
  kind: ContentKind;
  body: string | null;
  tags: string[];
  classKey: string | null;
  subject: string | null;
  objectKey: string | null;
  mimeType: string | null;
  published: boolean;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
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

  createBankQuestion(
    data: Omit<BankQuestionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<BankQuestionEntity>;
  updateBankQuestion(
    tenantId: string,
    id: string,
    patch: Partial<
      Pick<
        BankQuestionEntity,
        | 'subject'
        | 'gradeLevel'
        | 'tags'
        | 'questionType'
        | 'prompt'
        | 'payload'
        | 'points'
        | 'skillId'
        | 'rubricId'
      >
    >,
  ): Promise<BankQuestionEntity | null>;
  findBankQuestion(tenantId: string, id: string): Promise<BankQuestionEntity | null>;
  findBankQuestionsByIds(tenantId: string, ids: string[]): Promise<BankQuestionEntity[]>;
  listBankQuestions(
    tenantId: string,
    filter: BankQuestionFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<BankQuestionEntity>>;
  deleteBankQuestion(tenantId: string, id: string): Promise<boolean>;

  createRubric(data: Omit<RubricEntity, 'createdAt' | 'updatedAt'>): Promise<RubricEntity>;
  findRubric(tenantId: string, id: string): Promise<RubricEntity | null>;
  listRubrics(
    tenantId: string,
    filter: ScopeFilter & { subject?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<RubricEntity>>;
  replaceRubricCriteria(
    tenantId: string,
    rubricId: string,
    criteria: Omit<RubricCriterionEntity, 'createdAt'>[],
  ): Promise<RubricCriterionEntity[]>;
  listRubricCriteria(tenantId: string, rubricId: string): Promise<RubricCriterionEntity[]>;
  replaceRubricScores(
    tenantId: string,
    submissionId: string,
    scores: Omit<RubricScoreEntity, 'scoredAt'>[],
  ): Promise<RubricScoreEntity[]>;
  listRubricScores(tenantId: string, submissionId: string): Promise<RubricScoreEntity[]>;

  createAssignmentFile(
    data: Omit<AssignmentFileEntity, 'createdAt'>,
  ): Promise<AssignmentFileEntity>;
  findAssignmentFile(tenantId: string, id: string): Promise<AssignmentFileEntity | null>;
  listAssignmentFiles(
    tenantId: string,
    assignmentId: string,
    submissionId?: string | null,
  ): Promise<AssignmentFileEntity[]>;

  createDiscussion(
    data: Omit<DiscussionEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<DiscussionEntity>;
  findDiscussion(tenantId: string, id: string): Promise<DiscussionEntity | null>;
  listDiscussions(
    tenantId: string,
    filter: { institutionId?: string; classKey?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<DiscussionEntity>>;
  setDiscussionLocked(
    tenantId: string,
    id: string,
    locked: boolean,
  ): Promise<DiscussionEntity | null>;
  createDiscussionPost(
    data: Omit<DiscussionPostEntity, 'createdAt'>,
  ): Promise<DiscussionPostEntity>;
  findDiscussionPost(tenantId: string, id: string): Promise<DiscussionPostEntity | null>;
  listDiscussionPosts(tenantId: string, discussionId: string): Promise<DiscussionPostEntity[]>;
  setPostPinned(
    tenantId: string,
    postId: string,
    pinned: boolean,
  ): Promise<DiscussionPostEntity | null>;
  setPostHidden(
    tenantId: string,
    postId: string,
    hidden: boolean,
  ): Promise<DiscussionPostEntity | null>;

  createLesson(data: Omit<LessonEntity, 'createdAt' | 'updatedAt'>): Promise<LessonEntity>;
  findLesson(tenantId: string, id: string): Promise<LessonEntity | null>;
  listLessons(
    tenantId: string,
    filter: ScopeFilter & { subject?: string; published?: boolean },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<LessonEntity>>;
  createLessonResource(
    data: Omit<LessonResourceEntity, 'createdAt'>,
  ): Promise<LessonResourceEntity>;
  listLessonResources(tenantId: string, lessonId: string): Promise<LessonResourceEntity[]>;

  createContentItem(
    data: Omit<ContentItemEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<ContentItemEntity>;
  findContentItem(tenantId: string, id: string): Promise<ContentItemEntity | null>;
  listContentItems(
    tenantId: string,
    filter: ScopeFilter & { subject?: string; published?: boolean; classKey?: string },
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ContentItemEntity>>;
}
