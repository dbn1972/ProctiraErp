/**
 * In-Memory Result Repository
 *
 * Used for unit testing without database dependencies.
 * Implements the ResultRepository interface with simple Map-based stores.
 */
import type {
  ResultRepository,
  ExaminationCandidate,
  PublicationResult,
  AcademicRecordUpdate,
  ResultAnalysis,
} from './result-repository.js';

export class InMemoryResultRepository implements ResultRepository {
  private candidates: Map<string, ExaminationCandidate[]> = new Map();
  private publicationResults: Map<string, PublicationResult> = new Map();
  private academicRecords: AcademicRecordUpdate[] = [];
  private resultAnalyses: Map<string, ResultAnalysis> = new Map();

  /** Test helper: seed candidates for an examination */
  seedCandidates(examinationId: string, candidates: ExaminationCandidate[]): void {
    this.candidates.set(examinationId, candidates);
  }

  /** Test helper: get all academic record updates */
  getAcademicRecordUpdates(): AcademicRecordUpdate[] {
    return [...this.academicRecords];
  }

  async getCandidates(examinationId: string, _tenantId: string): Promise<ExaminationCandidate[]> {
    return this.candidates.get(examinationId) ?? [];
  }

  async savePublicationResult(result: PublicationResult): Promise<void> {
    this.publicationResults.set(result.examinationId, result);
  }

  async getPublicationResult(
    examinationId: string,
    _tenantId: string,
  ): Promise<PublicationResult | null> {
    return this.publicationResults.get(examinationId) ?? null;
  }

  async updateAcademicRecords(_tenantId: string, updates: AcademicRecordUpdate[]): Promise<void> {
    this.academicRecords.push(...updates);
  }

  async saveResultAnalysis(analysis: ResultAnalysis): Promise<void> {
    this.resultAnalyses.set(analysis.examinationId, analysis);
  }

  async getResultAnalysis(
    examinationId: string,
    _tenantId: string,
  ): Promise<ResultAnalysis | null> {
    return this.resultAnalyses.get(examinationId) ?? null;
  }

  /** Test helper: clear all data */
  clear(): void {
    this.candidates.clear();
    this.publicationResults.clear();
    this.academicRecords = [];
    this.resultAnalyses.clear();
  }
}
