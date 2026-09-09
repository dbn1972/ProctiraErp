import type { GradeBand } from './gpa-engine.js';

export type GradeEntryEntity = {
  id: string;
  tenantId: string;
  sectionId: string | null;
  studentId: string;
  assessmentCode: string | null;
  numericScore: number | null;
  letterGrade: string | null;
  enteredBy: string | null;
  enteredAt: string;
  lockedAt: string | null;
  publishedAt: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type CreditRuleEntity = {
  id: string;
  tenantId: string;
  boardId: string | null;
  code: string;
  name: string;
  credits: number;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type GradingScaleEntity = {
  id: string;
  tenantId: string;
  boardId: string;
  code: string;
  name: string;
  scaleType: string;
  isDefault: boolean;
  bands: GradeBand[];
  createdAt: string;
  updatedAt: string;
};

export type GpaSnapshotEntity = {
  id: string;
  tenantId: string;
  studentId: string;
  academicPeriodId: string | null;
  weightedGpa: number | null;
  unweightedGpa: number | null;
  creditsEarned: number | null;
  computedAt: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type TranscriptIssuanceEntity = {
  id: string;
  tenantId: string;
  studentId: string;
  version: number;
  status: 'DRAFT' | 'ISSUED' | 'VOIDED';
  issuedAt: string | null;
  issuedBy: string | null;
  artifactUri: string | null;
  checksumSha256: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type ExportJobEntity = {
  id: string;
  tenantId: string;
  boardId: string;
  institutionId: string | null;
  jobType: string;
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  requestedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  artifactUri: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
};

export type SectionSummary = {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  code: string;
  name: string;
  status: string;
};

export type ListGradeEntriesFilter = {
  sectionId?: string;
  studentId?: string;
};

export type ListTranscriptsFilter = {
  studentId?: string;
};

export type ListSectionsFilter = {
  institutionId?: string;
  academicPeriodId?: string;
};

export type BoardSummary = {
  id: string;
  tenantId: string;
  code: string;
  name: string;
};

export type InstitutionSummary = {
  id: string;
  tenantId: string;
  boardId: string;
  code: string;
  name: string;
};

export type BoardCodeEntity = {
  id: string;
  tenantId: string;
  boardId: string;
  institutionId: string;
  codeType: string;
  codeValue: string;
  label: string | null;
};

export type BoardExportCandidateGrade = {
  assessmentCode: string | null;
  numericScore: number | null;
  letterGrade: string | null;
};

export type BoardExportCandidate = {
  studentId: string;
  firstName: string;
  lastName: string;
  nationalId: string | null;
  institutionId: string;
  grades: BoardExportCandidateGrade[];
  latestTranscript: {
    version: number;
    checksumSha256: string | null;
    issuedAt: string | null;
  } | null;
};

export type ListBoardExportCandidatesFilter = {
  institutionId: string;
  boardId?: string;
  studentIds?: string[];
  /** Cap cohort size for pack generation (default applied in service). */
  limit?: number;
};

export interface GradebookRepository {
  listGradeEntries(tenantId: string, filter?: ListGradeEntriesFilter): Promise<GradeEntryEntity[]>;
  findGradeEntry(
    tenantId: string,
    keys: { studentId: string; sectionId?: string | null; assessmentCode?: string | null },
  ): Promise<GradeEntryEntity | null>;
  getGradeEntry(tenantId: string, id: string): Promise<GradeEntryEntity | null>;
  createGradeEntry(row: GradeEntryEntity): Promise<GradeEntryEntity>;
  updateGradeEntry(
    tenantId: string,
    id: string,
    patch: Partial<GradeEntryEntity>,
  ): Promise<GradeEntryEntity | null>;

  listCreditRules(tenantId: string, boardId?: string): Promise<CreditRuleEntity[]>;
  getCreditRuleByCode(tenantId: string, code: string): Promise<CreditRuleEntity | null>;
  createCreditRule(row: CreditRuleEntity): Promise<CreditRuleEntity>;

  listGradingScales(tenantId: string, boardId?: string): Promise<GradingScaleEntity[]>;
  getGradingScale(tenantId: string, id: string): Promise<GradingScaleEntity | null>;
  getDefaultGradingScale(tenantId: string, boardId: string): Promise<GradingScaleEntity | null>;

  createGpaSnapshot(row: GpaSnapshotEntity): Promise<GpaSnapshotEntity>;
  listGpaSnapshots(tenantId: string, studentId: string): Promise<GpaSnapshotEntity[]>;
  getGpaSnapshot(tenantId: string, id: string): Promise<GpaSnapshotEntity | null>;

  listTranscripts(
    tenantId: string,
    filter?: ListTranscriptsFilter,
  ): Promise<TranscriptIssuanceEntity[]>;
  getTranscript(tenantId: string, id: string): Promise<TranscriptIssuanceEntity | null>;
  getLatestTranscriptVersion(tenantId: string, studentId: string): Promise<number>;
  createTranscript(row: TranscriptIssuanceEntity): Promise<TranscriptIssuanceEntity>;

  createExportJob(row: ExportJobEntity): Promise<ExportJobEntity>;
  getExportJob(tenantId: string, id: string): Promise<ExportJobEntity | null>;
  updateExportJob(
    tenantId: string,
    id: string,
    patch: Partial<ExportJobEntity>,
  ): Promise<ExportJobEntity | null>;
  listExportJobs(tenantId: string, jobType?: string): Promise<ExportJobEntity[]>;

  listSections(tenantId: string, filter?: ListSectionsFilter): Promise<SectionSummary[]>;
  getSection(tenantId: string, id: string): Promise<SectionSummary | null>;

  getBoard(tenantId: string, id: string): Promise<BoardSummary | null>;
  getBoardByCode(tenantId: string, code: string): Promise<BoardSummary | null>;
  listBoards(tenantId: string): Promise<BoardSummary[]>;
  getInstitution(tenantId: string, id: string): Promise<InstitutionSummary | null>;
  listInstitutionsByBoard(tenantId: string, boardId: string): Promise<InstitutionSummary[]>;
  listBoardCodes(
    tenantId: string,
    filter: { institutionId: string; boardId?: string },
  ): Promise<BoardCodeEntity[]>;
  listBoardExportCandidates(
    tenantId: string,
    filter: ListBoardExportCandidatesFilter,
  ): Promise<BoardExportCandidate[]>;
}
