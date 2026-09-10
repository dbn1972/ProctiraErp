import type {
  BoardCodeEntity,
  BoardExportCandidate,
  BoardSummary,
  CreditRuleEntity,
  ExportJobEntity,
  GpaSnapshotEntity,
  GradeEntryEntity,
  GradebookRepository,
  GradingScaleEntity,
  InstitutionSummary,
  ListBoardExportCandidatesFilter,
  ListGradeEntriesFilter,
  ListSectionsFilter,
  ListTranscriptsFilter,
  SectionSummary,
  TranscriptIssuanceEntity,
} from './gradebook-repository.js';

export class InMemoryGradebookRepository implements GradebookRepository {
  private readonly entries = new Map<string, GradeEntryEntity>();
  private readonly creditRules = new Map<string, CreditRuleEntity>();
  private readonly scales = new Map<string, GradingScaleEntity>();
  private readonly snapshots = new Map<string, GpaSnapshotEntity>();
  private readonly transcripts = new Map<string, TranscriptIssuanceEntity>();
  private readonly jobs = new Map<string, ExportJobEntity>();
  private readonly sections = new Map<string, SectionSummary>();
  private readonly boards = new Map<string, BoardSummary>();
  private readonly institutions = new Map<string, InstitutionSummary>();
  private readonly boardCodes = new Map<string, BoardCodeEntity>();
  private readonly candidates = new Map<string, BoardExportCandidate>();

  seedSection(section: SectionSummary) {
    this.sections.set(section.id, section);
  }

  seedScale(scale: GradingScaleEntity) {
    this.scales.set(scale.id, scale);
  }

  seedBoard(board: BoardSummary) {
    this.boards.set(board.id, board);
  }

  seedInstitution(institution: InstitutionSummary) {
    this.institutions.set(institution.id, institution);
  }

  seedBoardCode(code: BoardCodeEntity) {
    this.boardCodes.set(code.id, code);
  }

  seedExportCandidate(candidate: BoardExportCandidate) {
    this.candidates.set(candidate.studentId, candidate);
  }

  async listGradeEntries(tenantId: string, filter?: ListGradeEntriesFilter) {
    return [...this.entries.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (filter?.sectionId && row.sectionId !== filter.sectionId) return false;
      if (filter?.studentId && row.studentId !== filter.studentId) return false;
      return true;
    });
  }

  async findGradeEntry(
    tenantId: string,
    keys: { studentId: string; sectionId?: string | null; assessmentCode?: string | null },
  ) {
    const sectionId = keys.sectionId ?? null;
    const assessmentCode = keys.assessmentCode ?? null;
    return (
      [...this.entries.values()].find(
        (row) =>
          row.tenantId === tenantId &&
          row.studentId === keys.studentId &&
          (row.sectionId ?? null) === sectionId &&
          (row.assessmentCode ?? null) === assessmentCode,
      ) ?? null
    );
  }

  async getGradeEntry(tenantId: string, id: string) {
    const row = this.entries.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async createGradeEntry(row: GradeEntryEntity) {
    this.entries.set(row.id, row);
    return row;
  }

  async updateGradeEntry(tenantId: string, id: string, patch: Partial<GradeEntryEntity>) {
    const cur = await this.getGradeEntry(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.entries.set(id, next);
    return next;
  }

  async listCreditRules(tenantId: string, boardId?: string) {
    return [...this.creditRules.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (boardId && row.boardId !== boardId) return false;
      return true;
    });
  }

  async getCreditRuleByCode(tenantId: string, code: string) {
    return (
      [...this.creditRules.values()].find((r) => r.tenantId === tenantId && r.code === code) ?? null
    );
  }

  async createCreditRule(row: CreditRuleEntity) {
    this.creditRules.set(row.id, row);
    return row;
  }

  async listGradingScales(tenantId: string, boardId?: string) {
    return [...this.scales.values()].filter((row) => {
      if (row.tenantId !== tenantId) return false;
      if (boardId && row.boardId !== boardId) return false;
      return true;
    });
  }

  async getGradingScale(tenantId: string, id: string) {
    const row = this.scales.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async getDefaultGradingScale(tenantId: string, boardId: string) {
    return (
      [...this.scales.values()].find(
        (s) => s.tenantId === tenantId && s.boardId === boardId && s.isDefault,
      ) ??
      [...this.scales.values()].find((s) => s.tenantId === tenantId && s.boardId === boardId) ??
      null
    );
  }

  async createGpaSnapshot(row: GpaSnapshotEntity) {
    this.snapshots.set(row.id, row);
    return row;
  }

  async listGpaSnapshots(tenantId: string, studentId: string) {
    return [...this.snapshots.values()]
      .filter((s) => s.tenantId === tenantId && s.studentId === studentId)
      .sort((a, b) => b.computedAt.localeCompare(a.computedAt));
  }

  async getGpaSnapshot(tenantId: string, id: string) {
    const row = this.snapshots.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async listTranscripts(tenantId: string, filter?: ListTranscriptsFilter) {
    return [...this.transcripts.values()]
      .filter((row) => {
        if (row.tenantId !== tenantId) return false;
        if (filter?.studentId && row.studentId !== filter.studentId) return false;
        return true;
      })
      .sort((a, b) => b.version - a.version);
  }

  async getTranscript(tenantId: string, id: string) {
    const row = this.transcripts.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async getLatestTranscriptVersion(tenantId: string, studentId: string) {
    const rows = await this.listTranscripts(tenantId, { studentId });
    return rows.reduce((max, r) => Math.max(max, r.version), 0);
  }

  async createTranscript(row: TranscriptIssuanceEntity) {
    this.transcripts.set(row.id, row);
    return row;
  }

  async createExportJob(row: ExportJobEntity) {
    this.jobs.set(row.id, row);
    return row;
  }

  async getExportJob(tenantId: string, id: string) {
    const row = this.jobs.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async updateExportJob(tenantId: string, id: string, patch: Partial<ExportJobEntity>) {
    const cur = await this.getExportJob(tenantId, id);
    if (!cur) return null;
    const next = {
      ...cur,
      ...patch,
      id: cur.id,
      tenantId: cur.tenantId,
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(id, next);
    return next;
  }

  async listExportJobs(tenantId: string, jobType?: string) {
    return [...this.jobs.values()]
      .filter((j) => j.tenantId === tenantId && (!jobType || j.jobType === jobType))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listSections(tenantId: string, filter?: ListSectionsFilter) {
    return [...this.sections.values()].filter((s) => {
      if (s.tenantId !== tenantId) return false;
      if (filter?.institutionId && s.institutionId !== filter.institutionId) return false;
      if (filter?.academicPeriodId && s.academicPeriodId !== filter.academicPeriodId) {
        return false;
      }
      return true;
    });
  }

  async getSection(tenantId: string, id: string) {
    const row = this.sections.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async getBoard(tenantId: string, id: string) {
    const row = this.boards.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async getBoardByCode(tenantId: string, code: string) {
    return (
      [...this.boards.values()].find(
        (b) => b.tenantId === tenantId && b.code.toUpperCase() === code.toUpperCase(),
      ) ?? null
    );
  }

  async listBoards(tenantId: string) {
    return [...this.boards.values()]
      .filter((b) => b.tenantId === tenantId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async getInstitution(tenantId: string, id: string) {
    const row = this.institutions.get(id);
    return row?.tenantId === tenantId ? row : null;
  }

  async listInstitutionsByBoard(tenantId: string, boardId: string) {
    return [...this.institutions.values()]
      .filter((i) => i.tenantId === tenantId && i.boardId === boardId)
      .sort((a, b) => a.code.localeCompare(b.code));
  }

  async listBoardCodes(tenantId: string, filter: { institutionId: string; boardId?: string }) {
    return [...this.boardCodes.values()].filter((c) => {
      if (c.tenantId !== tenantId) return false;
      if (c.institutionId !== filter.institutionId) return false;
      if (filter.boardId && c.boardId !== filter.boardId) return false;
      return true;
    });
  }

  async listBoardExportCandidates(tenantId: string, filter: ListBoardExportCandidatesFilter) {
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 500);
    // Prefer explicit seed candidates; fall back to synthesizing from grade entries.
    let rows = [...this.candidates.values()].filter((c) => {
      if (c.institutionId !== filter.institutionId) return false;
      if (filter.studentIds && !filter.studentIds.includes(c.studentId)) return false;
      return true;
    });

    if (rows.length === 0) {
      const byStudent = new Map<string, BoardExportCandidate>();
      for (const entry of this.entries.values()) {
        if (entry.tenantId !== tenantId) continue;
        if (filter.studentIds && !filter.studentIds.includes(entry.studentId)) continue;
        const section = entry.sectionId ? this.sections.get(entry.sectionId) : null;
        if (section && section.institutionId !== filter.institutionId) continue;
        if (!section && filter.institutionId) {
          // Allow entries without section only when candidate seed not used
        }
        const existing = byStudent.get(entry.studentId) ?? {
          studentId: entry.studentId,
          firstName: 'Student',
          lastName: entry.studentId.slice(0, 8),
          nationalId: entry.studentId,
          institutionId: section?.institutionId ?? filter.institutionId,
          grades: [],
          latestTranscript: null,
        };
        if (existing.institutionId !== filter.institutionId) continue;
        existing.grades.push({
          assessmentCode: entry.assessmentCode,
          numericScore: entry.numericScore,
          letterGrade: entry.letterGrade,
        });
        byStudent.set(entry.studentId, existing);
      }
      rows = [...byStudent.values()];
      for (const row of rows) {
        const transcripts = await this.listTranscripts(tenantId, { studentId: row.studentId });
        const latest = transcripts[0];
        if (latest) {
          row.latestTranscript = {
            version: latest.version,
            checksumSha256: latest.checksumSha256,
            issuedAt: latest.issuedAt,
          };
        }
      }
    }

    return rows.slice(0, limit);
  }
}
