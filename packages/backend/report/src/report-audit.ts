/**
 * PRC-L340 (topic 5): audit event emission for the mounted report catalogue.
 *
 * The catalogue emits an audit EVENT when a report is generated, downloaded or
 * scheduled so those actions are attributable to an actor and tenant. The event
 * carries field NAMES and identifiers only (report key, artifact/schedule id,
 * format, action) — never report row values or any other PHI.
 *
 * This is event emission through an injected sink; it is intentionally NOT the
 * same-transaction keyed hash chain (that durable store is B07
 * t1-audit-integrity-batch5). The gateway wires a real audit sink; unit tests
 * use RecordingReportAuditPort; when nothing is wired the NoopReportAuditPort
 * default keeps the catalogue working.
 */

/** The audited report actions. Field names, not PHI values. */
export type ReportAuditAction = 'report.generate' | 'report.download' | 'report.schedule.create';

export interface ReportAuditEvent {
  /** Tenant taken from the verified principal (never a client header). */
  tenantId: string;
  /** Acting user id (sub/userId) from the verified principal. */
  actorId: string;
  /** What happened. */
  action: ReportAuditAction;
  /** Catalogue report key (an identifier/field name, not row data). */
  reportKey?: string;
  /** Artifact id for generate/download. */
  artifactId?: string;
  /** Schedule id for schedule creation. */
  scheduleId?: string;
  /** Output format (csv/xlsx/pdf). */
  format?: string;
  /** Run id when available (generate). */
  runId?: string;
}

export interface ReportAuditPort {
  record(event: ReportAuditEvent): Promise<void>;
}

/** Test / default-recording sink that retains events in-process. */
export class RecordingReportAuditPort implements ReportAuditPort {
  readonly events: ReportAuditEvent[] = [];
  /** When true, the next record() rejects (to prove audit failures are non-fatal). */
  failNext = false;

  async record(event: ReportAuditEvent): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('audit sink failure (test)');
    }
    this.events.push(event);
  }
}

/** No-op sink used when no audit backend is wired. */
export class NoopReportAuditPort implements ReportAuditPort {
  async record(_event: ReportAuditEvent): Promise<void> {
    // intentionally empty
  }
}
