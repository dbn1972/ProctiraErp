/**
 * Examination Service
 *
 * Business logic for examination CRUD operations.
 * Handles validation, business rules enforcement, and lifecycle management.
 *
 * Requirements:
 * - 10.1: Create, modify, delete examinations with subjects (min 1), centers (min 1),
 *         sessions, scheduling with exam dates at least 7 days in the future
 * - 10.2: Validate eligibility by verifying active enrollment status and completion
 *         of all prerequisite subjects before confirming registration
 * - 10.3: Reject ineligible candidates with error indicating which conditions failed
 * - 10.7: Support 1–10 grading schemes per examination with minimum pass thresholds
 */
import { ConflictError, NotFoundError, BusinessRuleError, ValidationError } from '@proctira/common';
import type { PaginationOptions, PaginatedResult, FieldError } from '@proctira/common';
import { v4 as uuidv4 } from 'uuid';

import type {
  CandidateRegistration,
  ExaminationEntity,
  ExaminationFilter,
  ExaminationRepository,
  ExaminationSubject,
  ExaminationCenter,
  ExaminationSession,
  ExaminationGradingScheme,
  GradeThreshold,
} from './examination-repository.js';
import type { ResultRepository } from './result-repository.js';
import type {
  CreateExaminationInput,
  UpdateExaminationInput,
  RegisterCandidateInput,
} from './schemas.js';

/** Minimum number of days in the future for exam dates */
export const MIN_DAYS_IN_FUTURE = 7;

/** Maximum number of grading schemes per examination */
export const MAX_GRADING_SCHEMES = 10;

/** Minimum number of grading schemes per examination */
export const MIN_GRADING_SCHEMES = 1;

/**
 * Service handling examination business logic.
 */
export class ExaminationService {
  constructor(
    private readonly repository: ExaminationRepository,
    /** Optional: enables marks/publication reference checks on update (PRC-H053). */
    private readonly resultRepository?: Pick<
      ResultRepository,
      'getCandidates' | 'getPublicationResult'
    >,
  ) {}

  /**
   * Create a new examination.
   *
   * Validates:
   * - Examination code is unique within the tenant
   * - At least 1 subject is provided
   * - At least 1 center is provided
   * - Start and end dates are at least 7 days in the future
   * - End date is on or after start date
   * - 1–10 grading schemes are provided with valid pass thresholds
   *
   * @throws ConflictError if code already exists
   * @throws BusinessRuleError if business rules are violated
   * @throws ValidationError if input validation fails
   */
  async create(tenantId: string, input: CreateExaminationInput): Promise<ExaminationEntity> {
    const errors: FieldError[] = [];

    // Check code uniqueness within tenant
    const existingByCode = await this.repository.findByCode(input.code, tenantId);
    if (existingByCode) {
      throw new ConflictError(`Examination with code '${input.code}' already exists`);
    }

    // Validate subjects (minimum 1 enforced by schema, but double-check)
    if (!input.subjects || input.subjects.length < 1) {
      errors.push({
        field: 'subjects',
        message: 'At least 1 subject is required per examination',
        rule: 'minItems',
      });
    }

    // Validate centers (minimum 1 enforced by schema, but double-check)
    if (!input.centers || input.centers.length < 1) {
      errors.push({
        field: 'centers',
        message: 'At least 1 center is required per examination',
        rule: 'minItems',
      });
    }

    // Validate grading schemes count (1–10)
    if (!input.gradingSchemes || input.gradingSchemes.length < MIN_GRADING_SCHEMES) {
      errors.push({
        field: 'gradingSchemes',
        message: `At least ${MIN_GRADING_SCHEMES} grading scheme is required per examination`,
        rule: 'minItems',
      });
    }
    if (input.gradingSchemes && input.gradingSchemes.length > MAX_GRADING_SCHEMES) {
      errors.push({
        field: 'gradingSchemes',
        message: `Maximum ${MAX_GRADING_SCHEMES} grading schemes allowed per examination`,
        rule: 'maxItems',
      });
    }

    // Validate exam dates are at least 7 days in the future
    const dateErrors = this.validateExamDates(input.startDate, input.endDate);
    errors.push(...dateErrors);

    // Validate grading scheme pass thresholds
    if (input.gradingSchemes) {
      for (let i = 0; i < input.gradingSchemes.length; i++) {
        const scheme = input.gradingSchemes[i]!;
        const schemeErrors = this.validateGradingScheme(scheme, i);
        errors.push(...schemeErrors);
      }
    }

    // Validate sessions if provided
    if (input.sessions) {
      const sessionErrors = this.validateSessions(input.sessions, input.startDate, input.endDate);
      errors.push(...sessionErrors);
    }

    if (errors.length > 0) {
      throw new ValidationError('Examination validation failed', errors);
    }

    // Build entity
    const examinationId = uuidv4();

    const subjects: ExaminationSubject[] = input.subjects.map((s) => ({
      id: uuidv4(),
      examinationId,
      name: s.name,
      code: s.code,
      maxScore: s.maxScore,
      gradingSchemeId: s.gradingSchemeId,
    }));

    const centers: ExaminationCenter[] = input.centers.map((c) => ({
      id: uuidv4(),
      examinationId,
      name: c.name,
      code: c.code,
      institutionId: c.institutionId,
      capacity: c.capacity,
    }));

    const gradingSchemes: ExaminationGradingScheme[] = input.gradingSchemes.map((gs) => ({
      id: uuidv4(),
      examinationId,
      name: gs.name,
      minScore: gs.minScore,
      maxScore: gs.maxScore,
      passThreshold: gs.passThreshold,
      thresholds: gs.thresholds.map((t) => ({
        grade: t.grade,
        minScore: t.minScore,
        maxScore: t.maxScore,
        descriptor: t.descriptor,
      })),
    }));

    const sessions: ExaminationSession[] = (input.sessions ?? []).map((s) => ({
      id: uuidv4(),
      examinationId,
      subjectId: s.subjectId,
      date: s.date,
      startTime: s.startTime,
      endTime: s.endTime,
      centerId: s.centerId,
    }));

    const examination: Omit<ExaminationEntity, 'createdAt' | 'updatedAt'> = {
      id: examinationId,
      tenantId,
      name: input.name,
      code: input.code,
      description: input.description ?? null,
      academicPeriodId: input.academicPeriodId,
      startDate: input.startDate,
      endDate: input.endDate,
      status: 'DRAFT',
      subjects,
      centers,
      sessions,
      gradingSchemes,
    };

    return this.repository.create(examination);
  }

  /**
   * Update an existing examination.
   *
   * @throws NotFoundError if examination not found
   * @throws ConflictError if code uniqueness violated
   * @throws BusinessRuleError if business rules violated
   * @throws ValidationError if input validation fails
   */
  async update(
    tenantId: string,
    id: string,
    input: UpdateExaminationInput,
  ): Promise<ExaminationEntity> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Examination with id '${id}' not found`);
    }

    // Cannot update completed or cancelled examinations
    if (existing.status === 'COMPLETED' || existing.status === 'CANCELLED') {
      throw new BusinessRuleError(`Cannot update examination in '${existing.status}' status`);
    }

    const errors: FieldError[] = [];

    // Check code uniqueness if code is being changed
    if (input.code && input.code !== existing.code) {
      const existingByCode = await this.repository.findByCode(input.code, tenantId);
      if (existingByCode) {
        throw new ConflictError(`Examination with code '${input.code}' already exists`);
      }
    }

    // Validate subjects if provided
    if (input.subjects !== undefined && input.subjects.length < 1) {
      errors.push({
        field: 'subjects',
        message: 'At least 1 subject is required per examination',
        rule: 'minItems',
      });
    }

    // Validate centers if provided
    if (input.centers !== undefined && input.centers.length < 1) {
      errors.push({
        field: 'centers',
        message: 'At least 1 center is required per examination',
        rule: 'minItems',
      });
    }

    // Validate grading schemes if provided
    if (input.gradingSchemes !== undefined) {
      if (input.gradingSchemes.length < MIN_GRADING_SCHEMES) {
        errors.push({
          field: 'gradingSchemes',
          message: `At least ${MIN_GRADING_SCHEMES} grading scheme is required per examination`,
          rule: 'minItems',
        });
      }
      if (input.gradingSchemes.length > MAX_GRADING_SCHEMES) {
        errors.push({
          field: 'gradingSchemes',
          message: `Maximum ${MAX_GRADING_SCHEMES} grading schemes allowed per examination`,
          rule: 'maxItems',
        });
      }
      for (let i = 0; i < input.gradingSchemes.length; i++) {
        const scheme = input.gradingSchemes[i]!;
        const schemeErrors = this.validateGradingScheme(scheme, i);
        errors.push(...schemeErrors);
      }
    }

    // Validate dates if provided
    const startDate = input.startDate ?? existing.startDate;
    const endDate = input.endDate ?? existing.endDate;
    if (input.startDate || input.endDate) {
      const dateErrors = this.validateExamDates(startDate, endDate);
      errors.push(...dateErrors);
    }

    // Validate sessions if provided
    if (input.sessions) {
      const sessionErrors = this.validateSessions(input.sessions, startDate, endDate);
      errors.push(...sessionErrors);
    }

    if (errors.length > 0) {
      throw new ValidationError('Examination validation failed', errors);
    }

    // Build update data
    const updateData: Partial<ExaminationEntity> = {};
    if (input.name !== undefined) updateData.name = input.name;
    if (input.code !== undefined) updateData.code = input.code;
    if (input.description !== undefined) updateData.description = input.description;
    if (input.academicPeriodId !== undefined) updateData.academicPeriodId = input.academicPeriodId;
    if (input.startDate !== undefined) updateData.startDate = input.startDate;
    if (input.endDate !== undefined) updateData.endDate = input.endDate;
    if (input.status !== undefined) updateData.status = input.status;

    // PRC-H053: nested arrays are merged by id. Supplied ids are preserved;
    // only entries without an id receive a new UUID.
    const idErrors: FieldError[] = [];
    if (input.subjects !== undefined) {
      updateData.subjects = input.subjects.map((s, i) => ({
        id: resolveNestedId(s.id, existing.subjects, `subjects[${i}].id`, idErrors),
        examinationId: id,
        name: s.name,
        code: s.code,
        maxScore: s.maxScore,
        gradingSchemeId: s.gradingSchemeId,
      }));
    }

    if (input.centers !== undefined) {
      updateData.centers = input.centers.map((c, i) => ({
        id: resolveNestedId(c.id, existing.centers, `centers[${i}].id`, idErrors),
        examinationId: id,
        name: c.name,
        code: c.code,
        institutionId: c.institutionId,
        capacity: c.capacity,
      }));
    }

    if (input.sessions !== undefined) {
      updateData.sessions = input.sessions.map((s, i) => ({
        id: resolveNestedId(s.id, existing.sessions, `sessions[${i}].id`, idErrors),
        examinationId: id,
        subjectId: s.subjectId,
        date: s.date,
        startTime: s.startTime,
        endTime: s.endTime,
        centerId: s.centerId,
      }));
    }

    if (input.gradingSchemes !== undefined) {
      updateData.gradingSchemes = input.gradingSchemes.map((gs, i) => ({
        id: resolveNestedId(gs.id, existing.gradingSchemes, `gradingSchemes[${i}].id`, idErrors),
        examinationId: id,
        name: gs.name,
        minScore: gs.minScore,
        maxScore: gs.maxScore,
        passThreshold: gs.passThreshold,
        thresholds: gs.thresholds.map((t) => ({
          grade: t.grade,
          minScore: t.minScore,
          maxScore: t.maxScore,
          descriptor: t.descriptor,
        })),
      }));
    }

    if (idErrors.length > 0) {
      throw new ValidationError('Examination validation failed', idErrors);
    }

    await this.assertStructuralEditAllowed(tenantId, existing, updateData);

    const updated = await this.repository.update(id, tenantId, updateData);
    if (!updated) {
      throw new NotFoundError(`Examination with id '${id}' not found`);
    }

    return updated;
  }

  /**
   * Delete an examination.
   *
   * @throws NotFoundError if examination not found
   * @throws BusinessRuleError if examination cannot be deleted (in progress or completed)
   */
  async delete(tenantId: string, id: string): Promise<void> {
    const existing = await this.repository.findById(id, tenantId);
    if (!existing) {
      throw new NotFoundError(`Examination with id '${id}' not found`);
    }

    if (existing.status === 'IN_PROGRESS' || existing.status === 'COMPLETED') {
      throw new BusinessRuleError(`Cannot delete examination in '${existing.status}' status`);
    }

    const deleted = await this.repository.delete(id, tenantId);
    if (!deleted) {
      throw new NotFoundError(`Examination with id '${id}' not found`);
    }
  }

  /**
   * Get a single examination by ID.
   *
   * @throws NotFoundError if examination not found
   */
  async getById(tenantId: string, id: string): Promise<ExaminationEntity> {
    const examination = await this.repository.findById(id, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${id}' not found`);
    }
    return examination;
  }

  /**
   * List examinations with pagination and filtering.
   */
  async list(
    tenantId: string,
    filter: ExaminationFilter,
    pagination: PaginationOptions,
  ): Promise<PaginatedResult<ExaminationEntity>> {
    return this.repository.list(tenantId, filter, pagination);
  }

  /**
   * Register a candidate for an examination with eligibility validation.
   *
   * Validates:
   * - Examination exists and is in a registrable state (DRAFT or SCHEDULED)
   * - Student has active enrollment status
   * - Student has completed all prerequisite subjects for the examination
   * - Candidate is not already registered for this examination
   *
   * Requirement 10.2: Validate eligibility by verifying active enrollment status
   *                   and completion of all prerequisite subjects
   * Requirement 10.3: Reject ineligible candidates with error indicating which
   *                   eligibility conditions were not met
   *
   * @throws NotFoundError if examination not found
   * @throws BusinessRuleError if examination is not in a registrable state
   * @throws ValidationError if candidate fails eligibility validation
   * @throws ConflictError if candidate is already registered
   */
  /** List registrations for the Candidates tab (G-902). */
  async listCandidates(tenantId: string, examinationId: string): Promise<CandidateRegistration[]> {
    const examination = await this.repository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }
    return this.repository.listCandidateRegistrations(examinationId, tenantId);
  }

  async registerCandidate(
    tenantId: string,
    examinationId: string,
    input: RegisterCandidateInput,
  ): Promise<CandidateRegistration> {
    // Verify examination exists
    const examination = await this.repository.findById(examinationId, tenantId);
    if (!examination) {
      throw new NotFoundError(`Examination with id '${examinationId}' not found`);
    }

    // Verify examination is in a registrable state
    if (examination.status !== 'DRAFT' && examination.status !== 'SCHEDULED') {
      throw new BusinessRuleError(
        `Cannot register candidates for examination in '${examination.status}' status`,
      );
    }

    // Check if candidate is already registered
    const existingRegistration = await this.repository.findCandidateRegistration(
      examinationId,
      input.studentId,
      tenantId,
    );
    if (existingRegistration) {
      throw new ConflictError(
        `Student '${input.studentId}' is already registered for this examination`,
      );
    }

    // Validate eligibility
    const eligibilityErrors = await this.validateCandidateEligibility(
      tenantId,
      examination,
      input.studentId,
    );

    if (eligibilityErrors.length > 0) {
      throw new ValidationError('Candidate eligibility validation failed', eligibilityErrors);
    }

    // Validate center exists in the examination
    const centerExists = examination.centers.some((c) => c.id === input.centerId);
    if (!centerExists) {
      throw new ValidationError('Invalid center for this examination', [
        {
          field: 'centerId',
          message: `Center '${input.centerId}' is not a valid center for this examination`,
          rule: 'reference',
        },
      ]);
    }

    // Validate subjects exist in the examination
    const invalidSubjects: string[] = [];
    for (const subjectId of input.subjectIds) {
      const subjectExists = examination.subjects.some((s) => s.id === subjectId);
      if (!subjectExists) {
        invalidSubjects.push(subjectId);
      }
    }
    if (invalidSubjects.length > 0) {
      throw new ValidationError('Invalid subjects for this examination', [
        {
          field: 'subjectIds',
          message: `Subjects [${invalidSubjects.join(', ')}] are not valid for this examination`,
          rule: 'reference',
        },
      ]);
    }

    // Create registration
    const registration: CandidateRegistration = {
      id: uuidv4(),
      examinationId,
      studentId: input.studentId,
      tenantId,
      centerId: input.centerId,
      subjectIds: input.subjectIds,
      status: 'REGISTERED',
      registeredAt: new Date(),
    };

    return this.repository.createCandidateRegistration(registration);
  }

  /**
   * PRC-H053: reject removal of subjects/centers that registrations or
   * candidate marks reference, and block any structural change to
   * subjects/centers/grading schemes once the exam is IN_PROGRESS or results
   * have been published.
   */
  private async assertStructuralEditAllowed(
    tenantId: string,
    existing: ExaminationEntity,
    updateData: Partial<ExaminationEntity>,
  ): Promise<void> {
    const subjectsChanged =
      updateData.subjects !== undefined && !sameStructure(existing.subjects, updateData.subjects);
    const centersChanged =
      updateData.centers !== undefined && !sameStructure(existing.centers, updateData.centers);
    const schemesChanged =
      updateData.gradingSchemes !== undefined &&
      !sameStructure(existing.gradingSchemes, updateData.gradingSchemes);
    if (!subjectsChanged && !centersChanged && !schemesChanged) return;

    const published = this.resultRepository
      ? await this.resultRepository.getPublicationResult(existing.id, tenantId)
      : null;
    if (existing.status === 'IN_PROGRESS' || published) {
      throw new BusinessRuleError(
        'Subjects, centers and grading schemes cannot be changed once the examination is in progress or results exist',
      );
    }

    const removedSubjects = removedIds(existing.subjects, updateData.subjects);
    const removedCenters = removedIds(existing.centers, updateData.centers);
    if (removedSubjects.size === 0 && removedCenters.size === 0) return;

    const referencedSubjects = new Set<string>();
    const referencedCenters = new Set<string>();
    const registrations = await this.repository.listCandidateRegistrations(existing.id, tenantId);
    for (const r of registrations) {
      referencedCenters.add(r.centerId);
      for (const sid of r.subjectIds) referencedSubjects.add(sid);
    }
    if (this.resultRepository) {
      const candidates = await this.resultRepository.getCandidates(existing.id, tenantId);
      for (const c of candidates) {
        referencedCenters.add(c.centerId);
        for (const sr of c.subjectResults) referencedSubjects.add(sr.subjectId);
      }
    }

    const blockedSubjects = [...removedSubjects].filter((sid) => referencedSubjects.has(sid));
    const blockedCenters = [...removedCenters].filter((cid) => referencedCenters.has(cid));
    if (blockedSubjects.length > 0 || blockedCenters.length > 0) {
      const parts: string[] = [];
      if (blockedSubjects.length > 0) parts.push(`subjects [${blockedSubjects.join(', ')}]`);
      if (blockedCenters.length > 0) parts.push(`centers [${blockedCenters.join(', ')}]`);
      throw new BusinessRuleError(
        `Cannot remove ${parts.join(' and ')}: referenced by candidate registrations or marks`,
      );
    }
  }

  /**
   * Validate candidate eligibility for an examination.
   *
   * Checks:
   * 1. Active enrollment status (must be 'enrolled')
   * 2. Completion of all prerequisite subjects (all exam subject codes must be
   *    present in the student's completed subjects)
   *
   * Returns an array of FieldError objects describing which conditions failed.
   */
  private async validateCandidateEligibility(
    tenantId: string,
    examination: ExaminationEntity,
    studentId: string,
  ): Promise<FieldError[]> {
    const errors: FieldError[] = [];

    // Get student enrollment information
    const enrollment = await this.repository.getStudentEnrollment(studentId, tenantId);

    if (!enrollment) {
      errors.push({
        field: 'studentId',
        message: 'Student record not found or has no enrollment',
        rule: 'eligibility',
      });
      return errors;
    }

    // Check active enrollment status
    if (enrollment.status !== 'enrolled') {
      errors.push({
        field: 'enrollmentStatus',
        message: `Student enrollment status is '${enrollment.status}'; must be 'enrolled' to register for examination`,
        rule: 'activeEnrollment',
      });
    }

    // Check prerequisite subject completion
    // All examination subjects are considered prerequisites that must be completed.
    // Skipped when the enrollment source cannot supply transcript data (null).
    if (enrollment.completedSubjectCodes === null) {
      return errors;
    }
    const examSubjectCodes = examination.subjects.map((s) => s.code);
    const completedCodes = new Set(enrollment.completedSubjectCodes);
    const missingSubjects: string[] = [];

    for (const code of examSubjectCodes) {
      if (!completedCodes.has(code)) {
        missingSubjects.push(code);
      }
    }

    if (missingSubjects.length > 0) {
      errors.push({
        field: 'prerequisiteSubjects',
        message: `Student has not completed prerequisite subjects: ${missingSubjects.join(', ')}`,
        rule: 'prerequisiteCompletion',
      });
    }

    return errors;
  }

  /**
   * Validate that exam dates are at least 7 days in the future.
   * Also validates that endDate >= startDate.
   */
  private validateExamDates(startDate: string, endDate: string): FieldError[] {
    const errors: FieldError[] = [];
    const now = new Date();
    const minDate = new Date(now);
    minDate.setDate(minDate.getDate() + MIN_DAYS_IN_FUTURE);
    // Reset time to start of day for comparison
    minDate.setHours(0, 0, 0, 0);

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime())) {
      errors.push({
        field: 'startDate',
        message: 'Invalid start date format',
        rule: 'format',
      });
    } else if (start < minDate) {
      errors.push({
        field: 'startDate',
        message: `Examination start date must be at least ${MIN_DAYS_IN_FUTURE} days in the future`,
        rule: 'minDate',
      });
    }

    if (isNaN(end.getTime())) {
      errors.push({
        field: 'endDate',
        message: 'Invalid end date format',
        rule: 'format',
      });
    } else if (end < minDate) {
      errors.push({
        field: 'endDate',
        message: `Examination end date must be at least ${MIN_DAYS_IN_FUTURE} days in the future`,
        rule: 'minDate',
      });
    }

    if (!isNaN(start.getTime()) && !isNaN(end.getTime()) && end < start) {
      errors.push({
        field: 'endDate',
        message: 'End date must be on or after start date',
        rule: 'dateRange',
      });
    }

    return errors;
  }

  /**
   * Validate a grading scheme's pass threshold and thresholds.
   */
  private validateGradingScheme(
    scheme: {
      name: string;
      minScore: number;
      maxScore: number;
      passThreshold: number;
      thresholds: GradeThreshold[];
    },
    index: number,
  ): FieldError[] {
    const errors: FieldError[] = [];
    const prefix = `gradingSchemes[${index}]`;

    // Pass threshold must be within min/max range
    if (scheme.passThreshold < scheme.minScore) {
      errors.push({
        field: `${prefix}.passThreshold`,
        message: `Pass threshold (${scheme.passThreshold}) must be >= minimum score (${scheme.minScore})`,
        rule: 'range',
      });
    }
    if (scheme.passThreshold > scheme.maxScore) {
      errors.push({
        field: `${prefix}.passThreshold`,
        message: `Pass threshold (${scheme.passThreshold}) must be <= maximum score (${scheme.maxScore})`,
        rule: 'range',
      });
    }

    // Max score must be greater than min score
    if (scheme.maxScore <= scheme.minScore) {
      errors.push({
        field: `${prefix}.maxScore`,
        message: `Maximum score (${scheme.maxScore}) must be greater than minimum score (${scheme.minScore})`,
        rule: 'range',
      });
    }

    // Validate individual thresholds are within scheme range
    for (let j = 0; j < scheme.thresholds.length; j++) {
      const threshold = scheme.thresholds[j]!;
      if (threshold.minScore < scheme.minScore || threshold.maxScore > scheme.maxScore) {
        errors.push({
          field: `${prefix}.thresholds[${j}]`,
          message: `Grade threshold '${threshold.grade}' scores must be within scheme range [${scheme.minScore}, ${scheme.maxScore}]`,
          rule: 'range',
        });
      }
      if (threshold.maxScore < threshold.minScore) {
        errors.push({
          field: `${prefix}.thresholds[${j}].maxScore`,
          message: `Grade threshold '${threshold.grade}' maxScore must be >= minScore`,
          rule: 'range',
        });
      }
    }

    return errors;
  }

  /**
   * Validate examination sessions.
   */
  private validateSessions(
    sessions: Array<{
      subjectId: string;
      date: string;
      startTime: string;
      endTime: string;
      centerId?: string;
    }>,
    startDate: string,
    endDate: string,
  ): FieldError[] {
    const errors: FieldError[] = [];
    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let i = 0; i < sessions.length; i++) {
      const session = sessions[i]!;
      const sessionDate = new Date(session.date);

      if (!isNaN(sessionDate.getTime()) && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        if (sessionDate < start || sessionDate > end) {
          errors.push({
            field: `sessions[${i}].date`,
            message: `Session date must be within examination date range (${startDate} to ${endDate})`,
            rule: 'dateRange',
          });
        }
      }

      // Validate start time is before end time
      if (session.startTime >= session.endTime) {
        errors.push({
          field: `sessions[${i}].endTime`,
          message: 'Session end time must be after start time',
          rule: 'timeRange',
        });
      }
    }

    return errors;
  }
}

/**
 * Preserve a supplied nested id when it belongs to the existing examination;
 * generate a new id for new entries (PRC-H053).
 */
function resolveNestedId(
  suppliedId: string | undefined,
  existing: ReadonlyArray<{ id: string }>,
  field: string,
  errors: FieldError[],
): string {
  if (suppliedId === undefined) return uuidv4();
  if (!existing.some((e) => e.id === suppliedId)) {
    errors.push({
      field,
      message: `Unknown id '${suppliedId}' for this examination; omit id for new entries`,
      rule: 'reference',
    });
  }
  return suppliedId;
}

function removedIds(
  before: ReadonlyArray<{ id: string }>,
  after: ReadonlyArray<{ id: string }> | undefined,
): Set<string> {
  if (after === undefined) return new Set();
  const kept = new Set(after.map((a) => a.id));
  return new Set(before.map((b) => b.id).filter((bid) => !kept.has(bid)));
}

function sameStructure(a: ReadonlyArray<unknown>, b: ReadonlyArray<unknown>): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Key-order-insensitive JSON (undefined/null fields dropped) for structural comparison. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined && v !== null)
      .sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
