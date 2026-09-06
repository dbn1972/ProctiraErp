/**
 * Gradebook / GPA / transcripts gateway client (WS3).
 *
 * Routes under `/api/v1/gradebook/*`. Surfaces SCHEMA_MISSING honestly.
 */
import { GatewayError, gatewayFetch } from './gateway';

export interface GradeEntry {
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
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SectionSummary {
  id: string;
  tenantId: string;
  institutionId: string;
  academicPeriodId: string;
  code: string;
  name: string;
  status: string;
}

export interface GpaSnapshot {
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
}

export interface TranscriptIssuance {
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
}

export interface ReportCardJob {
  id: string;
  tenantId: string;
  boardId: string;
  institutionId: string | null;
  jobType: string;
  status: string;
  requestedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  artifactUri: string | null;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface CreditRule {
  id: string;
  tenantId: string;
  boardId: string | null;
  code: string;
  name: string;
  credits: number;
  metadata: Record<string, unknown>;
}

export interface GradingScale {
  id: string;
  tenantId: string;
  boardId: string;
  code: string;
  name: string;
  scaleType: string;
  isDefault: boolean;
  bands: Array<{
    label: string;
    minPercent: number;
    maxPercent: number;
    gradePoints: number | null;
  }>;
}

export type GradebookLoadResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; status?: number };

function mapError(error: unknown): { error: string; code?: string; status?: number } {
  if (error instanceof GatewayError) {
    return { error: error.message, code: error.code, status: error.status };
  }
  if (error instanceof Error) {
    return { error: error.message };
  }
  return { error: 'Unexpected gradebook API error' };
}

export async function listGradebookSections(filters?: {
  institutionId?: string;
  academicPeriodId?: string;
}): Promise<GradebookLoadResult<SectionSummary[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.institutionId) params.set('institutionId', filters.institutionId);
    if (filters?.academicPeriodId) params.set('academicPeriodId', filters.academicPeriodId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: SectionSummary[] }>(
      `/gradebook/sections${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function listGradeEntries(filters?: {
  sectionId?: string;
  studentId?: string;
}): Promise<GradebookLoadResult<GradeEntry[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.sectionId) params.set('sectionId', filters.sectionId);
    if (filters?.studentId) params.set('studentId', filters.studentId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: GradeEntry[] }>(
      `/gradebook/entries${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function upsertGradeEntry(input: {
  sectionId?: string | null;
  studentId: string;
  assessmentCode?: string | null;
  numericScore?: number | null;
  letterGrade?: string | null;
  creditRuleCode?: string | null;
}): Promise<GradeEntry> {
  const result = await gatewayFetch<GradeEntry>('/gradebook/entries', {
    method: 'PUT',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from grade entry upsert',
    });
  }
  return result.data;
}

export async function computeGpa(input: {
  studentId: string;
  academicPeriodId?: string | null;
  boardId?: string | null;
  gradingScaleId?: string | null;
}): Promise<GpaSnapshot> {
  const result = await gatewayFetch<GpaSnapshot>('/gradebook/gpa/compute', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from GPA compute',
    });
  }
  return result.data;
}

export async function listGpaSnapshots(
  studentId: string,
): Promise<GradebookLoadResult<GpaSnapshot[]>> {
  try {
    const result = await gatewayFetch<{ data: GpaSnapshot[] }>(
      `/gradebook/gpa?studentId=${encodeURIComponent(studentId)}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function listTranscripts(filters?: {
  studentId?: string;
}): Promise<GradebookLoadResult<TranscriptIssuance[]>> {
  try {
    const params = new URLSearchParams();
    if (filters?.studentId) params.set('studentId', filters.studentId);
    const qs = params.toString();
    const result = await gatewayFetch<{ data: TranscriptIssuance[] }>(
      `/gradebook/transcripts${qs ? `?${qs}` : ''}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function issueTranscript(input: {
  studentId: string;
  gpaSnapshotId?: string | null;
}): Promise<TranscriptIssuance> {
  const result = await gatewayFetch<TranscriptIssuance>('/gradebook/transcripts/issue', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from transcript issue',
    });
  }
  return result.data;
}

export async function createReportCardJob(input: {
  studentId: string;
  boardId: string;
  institutionId?: string | null;
  academicPeriodId?: string | null;
}): Promise<ReportCardJob> {
  const result = await gatewayFetch<ReportCardJob>('/gradebook/report-cards', {
    method: 'POST',
    json: input,
  });
  if (!result.data) {
    throw new GatewayError({
      status: result.status,
      code: 'EMPTY_RESPONSE',
      message: 'Empty response from report-card create',
    });
  }
  return result.data;
}

export async function listReportCardJobs(): Promise<GradebookLoadResult<ReportCardJob[]>> {
  try {
    const result = await gatewayFetch<{ data: ReportCardJob[] }>('/gradebook/report-cards', {
      next: { revalidate: 0 },
    });
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function listCreditRules(
  boardId?: string,
): Promise<GradebookLoadResult<CreditRule[]>> {
  try {
    const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
    const result = await gatewayFetch<{ data: CreditRule[] }>(`/gradebook/credit-rules${qs}`, {
      next: { revalidate: 0 },
    });
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}

export async function listGradingScales(
  boardId?: string,
): Promise<GradebookLoadResult<GradingScale[]>> {
  try {
    const qs = boardId ? `?boardId=${encodeURIComponent(boardId)}` : '';
    const result = await gatewayFetch<{ data: GradingScale[] }>(
      `/gradebook/grading-scales${qs}`,
      { next: { revalidate: 0 } },
    );
    return { ok: true, data: result.data?.data ?? [] };
  } catch (error) {
    return { ok: false, ...mapError(error) };
  }
}
