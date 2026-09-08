/**
 * In-Memory Assessment Result Repository
 *
 * Used for unit testing without database dependencies.
 */
import type {
  AssessmentResultEntity,
  AssessmentResultRepository,
} from './result-repository.js';

export class InMemoryAssessmentResultRepository implements AssessmentResultRepository {
  private results: AssessmentResultEntity[] = [];

  async upsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>,
  ): Promise<AssessmentResultEntity> {
    const now = new Date();

    // Check if a result already exists for this student+item combination
    const existingIndex = this.results.findIndex(
      (r) =>
        r.tenantId === data.tenantId &&
        r.studentId === data.studentId &&
        r.assessmentItemId === data.assessmentItemId,
    );

    if (existingIndex !== -1) {
      // Update existing
      const existing = this.results[existingIndex]!;
      const updated: AssessmentResultEntity = {
        ...existing,
        score: data.score,
        updatedAt: now,
      };
      this.results[existingIndex] = updated;
      return updated;
    }

    // Create new
    const entity: AssessmentResultEntity = {
      ...data,
      createdAt: now,
      updatedAt: now,
    };
    this.results.push(entity);
    return entity;
  }

  async bulkUpsert(
    data: Omit<AssessmentResultEntity, 'createdAt' | 'updatedAt'>[],
  ): Promise<AssessmentResultEntity[]> {
    const results: AssessmentResultEntity[] = [];
    for (const entry of data) {
      const result = await this.upsert(entry);
      results.push(result);
    }
    return results;
  }

  async findByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]> {
    return this.results.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.studentId === studentId &&
        r.subjectId === subjectId &&
        r.academicPeriodId === academicPeriodId,
    );
  }

  async findByStudentPeriod(
    tenantId: string,
    studentId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]> {
    return this.results.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.studentId === studentId &&
        r.academicPeriodId === academicPeriodId,
    );
  }

  async findBySubjectPeriod(
    tenantId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<AssessmentResultEntity[]> {
    return this.results.filter(
      (r) =>
        r.tenantId === tenantId &&
        r.subjectId === subjectId &&
        r.academicPeriodId === academicPeriodId,
    );
  }

  async findByAssessmentItem(
    tenantId: string,
    assessmentItemId: string,
  ): Promise<AssessmentResultEntity[]> {
    return this.results.filter(
      (r) => r.tenantId === tenantId && r.assessmentItemId === assessmentItemId,
    );
  }

  async deleteByStudentSubjectPeriod(
    tenantId: string,
    studentId: string,
    subjectId: string,
    academicPeriodId: string,
  ): Promise<number> {
    const before = this.results.length;
    this.results = this.results.filter(
      (r) =>
        !(
          r.tenantId === tenantId &&
          r.studentId === studentId &&
          r.subjectId === subjectId &&
          r.academicPeriodId === academicPeriodId
        ),
    );
    return before - this.results.length;
  }

  /** Helper for tests: clear all data */
  clear(): void {
    this.results = [];
  }
}
