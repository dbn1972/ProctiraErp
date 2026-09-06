import type {
  CreditRuleEntity,
  ExportJobEntity,
  GpaSnapshotEntity,
  GradeEntryEntity,
  GradebookRepository,
  GradingScaleEntity,
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

  seedSection(section: SectionSummary) {
    this.sections.set(section.id, section);
  }

  seedScale(scale: GradingScaleEntity) {
    this.scales.set(scale.id, scale);
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
      [...this.creditRules.values()].find(
        (r) => r.tenantId === tenantId && r.code === code,
      ) ?? null
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
      [...this.scales.values()].find(
        (s) => s.tenantId === tenantId && s.boardId === boardId,
      ) ??
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
}
